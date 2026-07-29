import { Command } from "commander";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAllAdapters } from "./agents/registry.js";
import { CURSOR_USAGE_CSV_OPTION, prepareCursorUsageCsv } from "./agents/cursor.js";
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

/** Detect agents, resolve Cursor CSV, and exit if nothing usable was found. */
async function prepareAndRequireAgents(opts: {
  agents?: string;
  cursorUsageCsv?: string;
  until: Date;
}): Promise<{ detected: AgentAdapter[]; cursorUsageCsv?: string }> {
  const detected = await detectAgents(opts.agents);
  let cursorUsageCsv: string | undefined;
  try {
    cursorUsageCsv = prepareCursorUsageCsv({
      explicitPath: opts.cursorUsageCsv,
      agents: opts.agents,
      cursorDetected: detected.some((a) => a.name === "cursor"),
      until: opts.until,
    });
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
  if (detected.length === 0) {
    console.error("No AI agents detected on this machine.");
    process.exit(1);
  }
  return { detected, cursorUsageCsv };
}

async function collectAndAggregate(
  detected: AgentAdapter[],
  since: Date,
  until: Date,
  cursorUsageCsv?: string,
): Promise<ShowcaseData> {
  console.log("\n📊 Collecting usage data...");
  const allRecords: UsageRecord[] = [];
  const configsMap = new Map<string, { displayName: string; config: AgentConfig }>();
  const pricingOverrides: ModelPricing[] = [];

  for (const adapter of detected) {
    try {
      // Cursor accepts an optional third arg; other adapters ignore it via 2-arg collect.
      const collect = adapter.collect as (
        since: Date,
        until: Date,
        options?: { cursorUsageCsv?: string },
      ) => Promise<UsageRecord[]>;
      const records = await collect(
        since,
        until,
        adapter.name === "cursor" ? { cursorUsageCsv } : undefined,
      );
      for (const r of records) allRecords.push(r);
      const config = await adapter.config();
      configsMap.set(adapter.name, { displayName: adapter.displayName, config });
      console.log(`  ${adapter.displayName}: ${records.length} records`);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      if (msg.includes("NODE_MODULE_VERSION")) {
        console.warn(`  ⚠ ${adapter.displayName}: native module was built for a different Node.js version. Fix: npm cache npx rm @eat-pray-ai/wingman`);
      } else {
        console.warn(`  ⚠ ${adapter.displayName}: ${msg}`);
      }
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
  .option(...CURSOR_USAGE_CSV_OPTION)
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

    const { detected, cursorUsageCsv } = await prepareAndRequireAgents({
      agents: opts.agents,
      cursorUsageCsv: opts.cursorUsageCsv,
      until,
    });
    const data = await collectAndAggregate(detected, since, until, cursorUsageCsv);

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
  .option(...CURSOR_USAGE_CSV_OPTION)
  .action(async (opts) => {
    const { since, until } = parseDateRange(opts);
    const { detected, cursorUsageCsv } = await prepareAndRequireAgents({
      agents: opts.agents,
      cursorUsageCsv: opts.cursorUsageCsv,
      until,
    });
    const data = await collectAndAggregate(detected, since, until, cursorUsageCsv);

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
