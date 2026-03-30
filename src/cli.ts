import { Command } from "commander";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAllAdapters } from "./agents/registry.js";
import { createPricingEngine } from "./pricing/engine.js";
import { aggregate } from "./aggregator.js";
import { getTheme, getAvailableThemes } from "./themes/registry.js";
import { SECTION_NAMES } from "./themes/shared/sections.js";
import { generateResumeYaml } from "./resume/renderer.js";
import { fetchModelInfo } from "./pricing/models-dev.js";
import type { UsageRecord, AgentConfig, ModelPricing } from "./types.js";

const parseIntArg = (v: string) => parseInt(v, 10);
const program = new Command();

program
  .name("wingman")
  .description("Showcase your AI pair usage — SVG cards, resumes, and more")
  .version("0.1.0");

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
  .action(async (opts) => {
    // Snap to local-time day boundaries
    const until = opts.until ? new Date(opts.until + "T23:59:59.999") : new Date();
    let since: Date;
    if (opts.since) {
      since = new Date(opts.since + "T00:00:00");
    } else {
      since = new Date(until.getTime() - opts.days * 24 * 60 * 60 * 1000);
    }

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

    const agentFilter = opts.agents
      ? new Set(opts.agents.split(",").map((s: string) => s.trim()))
      : null;

    let adapters = getAllAdapters();
    if (agentFilter) {
      adapters = adapters.filter((a) => agentFilter.has(a.name));
    }

    console.log("🔍 Detecting agents...");
    const detected = [];
    for (const adapter of adapters) {
      if (await adapter.detect()) {
        detected.push(adapter);
        console.log(`  ✓ ${adapter.displayName}`);
      }
    }

    if (detected.length === 0) {
      console.error("No AI agents detected on this machine.");
      process.exit(1);
    }

    console.log("\n📊 Collecting usage data...");
    const allRecords: UsageRecord[] = [];
    const configsMap = new Map<string, { displayName: string; config: AgentConfig }>();
    const pricingOverrides: ModelPricing[] = [];

    for (const adapter of detected) {
      try {
        const records = await adapter.collect(since, until);
        allRecords.push(...records);
        const config = await adapter.config();
        configsMap.set(adapter.name, { displayName: adapter.displayName, config });
        console.log(`  ${adapter.displayName}: ${records.length} records`);
      } catch (err) {
        console.warn(`  ⚠ ${adapter.displayName}: ${(err as Error).message}`);
      }
    }

    console.log("\n💰 Loading pricing data...");
    const pricing = await createPricingEngine(pricingOverrides);

    console.log("🎨 Rendering SVG...");
    const data = aggregate(allRecords, configsMap, pricing, since, until);
    const svg = theme.render(data, { sections: sectionsFilter });

    const outputPath = resolve(opts.output);
    writeFileSync(outputPath, svg, "utf-8");
    console.log(`\n✅ Saved to ${outputPath}`);
  });

program
  .command("resume")
  .description("Generate a rendercv-compatible YAML resume from AI agent usage stats")
  .option("--name <name>", "resume name", "Wingman")
  .option("--headline <text>", "resume headline", "AI pair for everything")
  .option("-o, --output <path>", "output file path", "resume.yaml")
  .option("--agents <names>", `comma-separated agent filter (${getAllAdapters().map((a) => a.name).join(", ")})`)
  .option("--since <date>", "start date (YYYY-MM-DD)")
  .option("--until <date>", "end date (YYYY-MM-DD)")
  .option("--days <n>", "last N days", parseIntArg, 180)
  .action(async (opts) => {
    const until = opts.until ? new Date(opts.until + "T23:59:59.999") : new Date();
    let since: Date;
    if (opts.since) {
      since = new Date(opts.since + "T00:00:00");
    } else {
      since = new Date(until.getTime() - opts.days * 24 * 60 * 60 * 1000);
    }

    const agentFilter = opts.agents
      ? new Set(opts.agents.split(",").map((s: string) => s.trim()))
      : null;

    let adapters = getAllAdapters();
    if (agentFilter) {
      adapters = adapters.filter((a) => agentFilter.has(a.name));
    }

    console.log("🔍 Detecting agents...");
    const detected = [];
    for (const adapter of adapters) {
      if (await adapter.detect()) {
        detected.push(adapter);
        console.log(`  ✓ ${adapter.displayName}`);
      }
    }

    if (detected.length === 0) {
      console.error("No AI agents detected on this machine.");
      process.exit(1);
    }

    console.log("\n📊 Collecting usage data...");
    const allRecords: UsageRecord[] = [];
    const configsMap = new Map<string, { displayName: string; config: AgentConfig }>();
    const pricingOverrides: ModelPricing[] = [];

    for (const adapter of detected) {
      try {
        const records = await adapter.collect(since, until);
        allRecords.push(...records);
        const config = await adapter.config();
        configsMap.set(adapter.name, { displayName: adapter.displayName, config });
        console.log(`  ${adapter.displayName}: ${records.length} records`);
      } catch (err) {
        console.warn(`  ⚠ ${adapter.displayName}: ${(err as Error).message}`);
      }
    }

    console.log("\n💰 Loading pricing data...");
    const pricing = await createPricingEngine(pricingOverrides);

    console.log("📋 Loading model metadata...");
    const modelInfo = await fetchModelInfo();

    console.log("📝 Generating resume YAML...");
    const data = aggregate(allRecords, configsMap, pricing, since, until);

    const yaml = generateResumeYaml(data, modelInfo, {
      name: opts.name,
      headline: opts.headline,
    });

    const outputPath = resolve(opts.output);
    writeFileSync(outputPath, yaml, "utf-8");
    console.log(`\n✅ Saved to ${outputPath}`);
    console.log(`📄 Render your resume at https://rendercv.com/`);
  });

program.parse();
