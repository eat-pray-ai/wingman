import { Command } from "commander";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAllAdapters } from "./agents/registry.js";
import { findUsageEventsCsvFiles, peekUsageEventsCsvNewest } from "./agents/cursor.js";
import { createPricingEngine } from "./pricing/engine.js";
import { aggregate } from "./aggregator.js";
import { getTheme, getAvailableThemes } from "./themes/registry.js";
import { SECTION_NAMES } from "./themes/shared/sections.js";
import { generateResumeYaml } from "./resume/renderer.js";
import { fetchModelInfo } from "./pricing/models-dev.js";
import type {
  AgentAdapter,
  UsageRecord,
  AgentConfig,
  ShowcaseData,
  ModelPricing,
  CollectOptions,
} from "./types.js";

function findPackageJson(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("package.json not found");
}

const pkg = JSON.parse(readFileSync(findPackageJson(), "utf-8"));

function parseDateRange(opts: { since?: string; until?: string; days: number }) {
  const until = opts.until ? new Date(opts.until + "T23:59:59.999") : new Date();
  let since: Date;
  if (opts.since) {
    since = new Date(opts.since + "T00:00:00");
  } else {
    since = new Date(until.getTime() - opts.days * 24 * 60 * 60 * 1000);
    since.setHours(0, 0, 0, 0);
  }
  return { since, until };
}

function parseAgentFilter(agents?: string): Set<string> | null {
  return agents ? new Set(agents.split(",").map((s) => s.trim())) : null;
}

/** Cursor CSV resolve/warn when Cursor is on-device, or explicitly named in --agents. */
function shouldHandleCursorCsv(agentsOpt: string | undefined, detected: AgentAdapter[]): boolean {
  if (detected.some((a) => a.name === "cursor")) return true;
  return parseAgentFilter(agentsOpt)?.has("cursor") ?? false;
}

async function detectAgents(agents?: string): Promise<AgentAdapter[]> {
  const agentFilter = parseAgentFilter(agents);

  let adapters = getAllAdapters();
  if (agentFilter) {
    adapters = adapters.filter((a) => agentFilter.has(a.name));
  }

  console.log("🔍 Detecting agents...");
  const detected: AgentAdapter[] = [];
  for (const adapter of adapters) {
    if (await adapter.detect()) {
      detected.push(adapter);
      console.log(`  ✓ ${adapter.displayName}`);
    }
  }

  return detected;
}

const CURSOR_USAGE_DASHBOARD_URL = "https://cursor.com/dashboard/usage";

function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function warnIfCursorUsageCsvStale(path: string, until: Date): void {
  const newest = peekUsageEventsCsvNewest(path);
  if (!newest) return;
  if (ymdUtc(newest) < ymdUtc(until)) {
    console.warn(
      `⚠ Cursor usage CSV looks stale: newest event is ${ymdUtc(newest)}, but --until/today is ${ymdUtc(until)}.`,
    );
    console.warn(
      `  Re-export from ${CURSOR_USAGE_DASHBOARD_URL} (Export CSV) for a fresher file.`,
    );
  }
}

/**
 * Resolve a Cursor usage-events CSV path when Cursor is detected or
 * explicitly requested via `--agents cursor`.
 * 1. `--cursor-usage-csv` if provided
 * 2. else a single `usage-events*.csv` in cwd (announce it)
 * 3. else fail when multiple matches exist
 * 4. else warn about local DB undercount and recommend the dashboard CSV
 */
function resolveCursorUsageCsv(
  explicitPath: string | undefined,
  handleCursor: boolean,
  until: Date,
): string | undefined {
  // Skip when Cursor is neither on-device nor named in --agents.
  if (!handleCursor) return undefined;

  if (explicitPath) {
    const path = resolve(explicitPath);
    if (!existsSync(path)) {
      console.error(`Cursor usage CSV not found: ${path}`);
      process.exit(1);
    }
    console.log(`📄 Using Cursor usage CSV: ${path}`);
    warnIfCursorUsageCsvStale(path, until);
    return path;
  }

  const matches = findUsageEventsCsvFiles(process.cwd());
  if (matches.length === 1) {
    console.log(`📄 Detected Cursor usage CSV in working directory: ${basename(matches[0])}`);
    warnIfCursorUsageCsvStale(matches[0], until);
    return matches[0];
  }

  if (matches.length > 1) {
    console.error("Multiple Cursor usage-events CSV files found in working directory:");
    for (const file of matches) {
      console.error(`  - ${basename(file)}`);
    }
    console.error("Pass one with --cursor-usage-csv <path>, or delete the ones you do not need.");
    process.exit(1);
  }

  console.warn(
    "⚠ No usage-events*.csv in the working directory (and --cursor-usage-csv not set).",
  );
  console.warn(
    "  Falling back to local state.vscdb estimates. These are usually much smaller and inaccurate:",
  );
  console.warn(
    "  each chat contributes only a latest context-window snapshot (not cumulative billed usage),",
  );
  console.warn(
    "  with no in/out/read/write split — the whole snapshot is put into `in` (out/read/write stay 0).",
  );
  console.warn(
    "  Strongly recommended: download a usage-events CSV for accurate totals.",
  );
  console.warn(`  1. Open ${CURSOR_USAGE_DASHBOARD_URL}`);
  console.warn("  2. Click Export CSV (usage-events-*.csv)");
  console.warn("  3. Place it in the cwd, or pass --cursor-usage-csv <path>");
  return undefined;
}

async function collectAndAggregate(
  detected: AgentAdapter[],
  since: Date,
  until: Date,
  collectOptions: CollectOptions = {},
): Promise<ShowcaseData> {
  console.log("\n📊 Collecting usage data...");
  const allRecords: UsageRecord[] = [];
  const configsMap = new Map<string, { displayName: string; config: AgentConfig }>();
  const pricingOverrides: ModelPricing[] = [];

  for (const adapter of detected) {
    try {
      const records = await adapter.collect(since, until, collectOptions);
      for (const r of records) allRecords.push(r);
      const config = await adapter.config();
      configsMap.set(adapter.name, { displayName: adapter.displayName, config });
      console.log(`  ${adapter.displayName}: ${records.length} records`);
    } catch (err) {
      console.warn(`  ⚠ ${adapter.displayName}: ${(err as Error).message}`);
    }
  }

  console.log("\n💰 Loading pricing data...");
  const pricing = await createPricingEngine(pricingOverrides);

  return aggregate(allRecords, configsMap, pricing, since, until);
}

const parseIntArg = (v: string) => parseInt(v, 10);
const program = new Command();

program
  .name("wingman")
  .description("Showcase your AI pair usage — SVG cards, résumés, and more")
  .version(pkg.version);

const cursorUsageCsvOption = [
  "--cursor-usage-csv <path>",
  "Recommended Cursor usage-events CSV (else auto-detect usage-events*.csv in cwd; state.vscdb fallback)",
] as const;

program
  .command("card")
  .description("Generate an SVG stats card from local AI agent data")
  .option("-o, --output <path>", "output file path", "wingman.svg")
  .option("-t, --theme <name>", `theme name (${getAvailableThemes().join(", ")})`, "github-dark")
  .option("--agents <names>", `comma-separated agent filter (${getAllAdapters().map((a) => a.name).join(", ")})`)
  .option("--since <date>", "start date (YYYY-MM-DD)")
  .option("--until <date>", "end date (YYYY-MM-DD)")
  .option("--days <n>", "last N days", parseIntArg, 90)
  .option("--sections <names>", `comma-separated sections to include (${SECTION_NAMES.join(", ")})`)
  .option(...cursorUsageCsvOption)
  .action(async (opts) => {
    const { since, until } = parseDateRange(opts);

    const theme = getTheme(opts.theme);
    if (!theme) {
      console.error(
        `Unknown theme "${opts.theme}". Available: ${getAvailableThemes().join(", ")}`
      );
      process.exit(1);
    }

    const sectionsFilter = opts.sections
      ? opts.sections.split(",").map((s: string) => s.trim())
      : undefined;

    if (sectionsFilter) {
      const invalid = sectionsFilter.filter((s: string) => !SECTION_NAMES.includes(s));
      if (invalid.length > 0) {
        console.error(
          `Unknown section(s): ${invalid.join(", ")}. Available: ${SECTION_NAMES.join(", ")}`
        );
        process.exit(1);
      }
    }

    const detected = await detectAgents(opts.agents);
    const cursorUsageCsv = resolveCursorUsageCsv(
      opts.cursorUsageCsv,
      shouldHandleCursorCsv(opts.agents, detected),
      until,
    );
    if (detected.length === 0) {
      console.error("No AI agents detected on this machine.");
      process.exit(1);
    }
    const data = await collectAndAggregate(detected, since, until, { cursorUsageCsv });

    console.log("🎨 Rendering SVG...");
    const svg = theme.render(data, { sections: sectionsFilter });

    const outputPath = resolve(opts.output);
    writeFileSync(outputPath, svg, "utf-8");
    console.log(`\n✅ Saved to ${outputPath}`);
  });

program
  .command("resume")
  .description("Generate a rendercv-compatible YAML résumé from AI agent usage stats")
  .option("--name <name>", "résumé name", "Wingman")
  .option("--headline <text>", "résumé headline", "Your AI agents, one résumé")
  .option("-o, --output <path>", "output file path", "resume.yaml")
  .option("--agents <names>", `comma-separated agent filter (${getAllAdapters().map((a) => a.name).join(", ")})`)
  .option("--since <date>", "start date (YYYY-MM-DD)")
  .option("--until <date>", "end date (YYYY-MM-DD)")
  .option("--days <n>", "last N days", parseIntArg, 180)
  .option(...cursorUsageCsvOption)
  .action(async (opts) => {
    const { since, until } = parseDateRange(opts);
    const detected = await detectAgents(opts.agents);
    const cursorUsageCsv = resolveCursorUsageCsv(
      opts.cursorUsageCsv,
      shouldHandleCursorCsv(opts.agents, detected),
      until,
    );
    if (detected.length === 0) {
      console.error("No AI agents detected on this machine.");
      process.exit(1);
    }
    const data = await collectAndAggregate(detected, since, until, { cursorUsageCsv });

    console.log("📋 Loading model metadata...");
    const modelInfo = await fetchModelInfo();

    console.log("📝 Generating résumé YAML...");
    const yaml = generateResumeYaml(data, modelInfo, {
      name: opts.name,
      headline: opts.headline,
    });

    const outputPath = resolve(opts.output);
    writeFileSync(outputPath, yaml, "utf-8");
    console.log(`\n✅ Saved to ${outputPath}`);
    console.log(`📄 Render AI's résumé at https://rendercv.com/`);
  });

program.parse();
