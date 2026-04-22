/**
 * Generate demo SVG and résumé YAML with mock data for the README.
 * Usage: npx tsx scripts/generate-demo.ts
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTheme } from "../src/themes/registry.js";
import { generateResumeYaml } from "../src/resume/renderer.js";
import type { AgentSummary, ShowcaseData } from "../src/types.js";
import type { ModelInfo } from "../src/pricing/models-dev.js";

// Generate daily activity spread across a date range
function spreadActivity(
  startDate: Date,
  days: number,
  totalTokens: number,
  activeDays: number,
): Record<string, number> {
  const activity: Record<string, number> = {};
  const tokensPerDay = totalTokens / activeDays;
  let remaining = activeDays;

  for (let i = 0; i < days && remaining > 0; i++) {
    // Skip ~20% of days deterministically
    if (i % 10 === 7 || i % 10 === 3) continue;
    const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    // Vary intensity: weekdays busier, some spikes
    const factor = i % 7 < 5 ? 1.2 : 0.6;
    const spike = i % 13 === 0 ? 2.5 : 1;
    activity[key] = Math.round(tokensPerDay * factor * spike);
    remaining--;
  }
  return activity;
}

function makeModel(id: string, overrides: Partial<ModelInfo> & Pick<ModelInfo, "name" | "provider" | "lab">): ModelInfo {
  return { id, capabilities: [], ...overrides };
}

function makeAgent(
  agent: string,
  displayName: string,
  overrides: Omit<AgentSummary, "agent" | "displayName" | "unknownCost">,
): AgentSummary {
  return { agent, displayName, unknownCost: false, ...overrides };
}

const mockModels: Map<string, ModelInfo> = new Map(
  [
    makeModel("claude-opus-4-6", {
      name: "Claude Opus 4.6", family: "claude-opus", provider: "anthropic", lab: "Anthropic",
      releaseDate: "2026-02-17", knowledge: "2025-05",
      modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      capabilities: ["reasoning", "tool_call", "attachment"],
      limits: { context: 200000, output: 64000 },
    }),
    makeModel("claude-sonnet-4-6", {
      name: "Claude Sonnet 4.6", family: "claude-sonnet", provider: "anthropic", lab: "Anthropic",
      releaseDate: "2026-01-28", knowledge: "2025-05",
      modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      capabilities: ["reasoning", "tool_call", "attachment"],
      limits: { context: 200000, output: 64000 },
    }),
    makeModel("claude-haiku-4-5", {
      name: "Claude Haiku 4.5", family: "claude-haiku", provider: "anthropic", lab: "Anthropic",
      releaseDate: "2025-10-01",
      modalities: { input: ["text", "image"], output: ["text"] },
      capabilities: ["tool_call"],
      limits: { context: 200000, output: 64000 },
    }),
    makeModel("gemini-3-pro-preview", {
      name: "Gemini 3 Pro", family: "gemini-3-pro", provider: "google", lab: "Google",
      releaseDate: "2026-02-19", knowledge: "2025-01",
      modalities: { input: ["text", "image", "video", "audio", "pdf"], output: ["text"] },
      capabilities: ["reasoning", "tool_call"],
      limits: { context: 1000000, output: 65536 },
    }),
    makeModel("gemini-3.5-flash", {
      name: "Gemini 3.5 Flash", family: "gemini-3.5-flash", provider: "google", lab: "Google",
      releaseDate: "2026-03-15", knowledge: "2025-06",
      modalities: { input: ["text", "image", "video", "audio"], output: ["text"] },
      capabilities: ["tool_call"],
      limits: { context: 1000000, output: 65536 },
    }),
    makeModel("gpt-5.1", {
      name: "GPT-5.1", family: "gpt-5.1", provider: "openai", lab: "OpenAI",
      releaseDate: "2025-12-11", knowledge: "2024-09-30",
      modalities: { input: ["text", "image"], output: ["text"] },
      capabilities: ["reasoning", "tool_call"],
      limits: { context: 128000, output: 32768 },
    }),
    makeModel("o3-pro", {
      name: "o3 Pro", family: "o", provider: "openai", lab: "OpenAI",
      releaseDate: "2025-11-20", knowledge: "2024-09-30",
      modalities: { input: ["text", "image"], output: ["text"] },
      capabilities: ["reasoning", "tool_call"],
      limits: { context: 200000, output: 100000 },
    }),
  ].map((m) => [m.id, m]),
);

const since = new Date("2025-10-02");
const until = new Date("2026-03-30");

const data: ShowcaseData = {
  period: { since, until },
  agents: [
    makeAgent("claude-code", "Claude Code", {
      totalTokens: 5_600_000_000, totalCost: 8_950, sessionCount: 2_800,
      models: {
        "claude-opus-4-6": { tokens: 3_200_000_000, cost: 6_400 },
        "claude-sonnet-4-6": { tokens: 1_800_000_000, cost: 2_100 },
        "claude-haiku-4-5": { tokens: 600_000_000, cost: 450 },
      },
      dailyActivity: spreadActivity(since, 180, 5_600_000_000, 145),
      config: {
        mcpServers: ["github", "playwright", "context7", "yutu"],
        plugins: [], models: [],
        skills: ["debugging", "code-review"],
      },
    }),
    makeAgent("opencode", "opencode", {
      totalTokens: 3_200_000_000, totalCost: 4_280, sessionCount: 1_650,
      models: {
        "gemini-3-pro-preview": { tokens: 1_500_000_000, cost: 620 },
        "claude-opus-4-6": { tokens: 1_200_000_000, cost: 3_200 },
        "gpt-5.1": { tokens: 500_000_000, cost: 460 },
      },
      dailyActivity: spreadActivity(new Date("2025-11-01"), 150, 3_200_000_000, 120),
      config: {
        mcpServers: ["github", "context7"],
        plugins: [], models: [], skills: [],
      },
    }),
    makeAgent("gemini-cli", "Gemini CLI", {
      totalTokens: 1_800_000_000, totalCost: 740, sessionCount: 520,
      models: {
        "gemini-3-pro-preview": { tokens: 1_200_000_000, cost: 500 },
        "gemini-3.5-flash": { tokens: 600_000_000, cost: 240 },
      },
      dailyActivity: spreadActivity(new Date("2025-12-01"), 120, 1_800_000_000, 96),
      config: {
        mcpServers: ["context7"],
        plugins: [], models: [], skills: [],
      },
    }),
    makeAgent("codex", "Codex", {
      totalTokens: 600_000_000, totalCost: 380, sessionCount: 180,
      models: {
        "gpt-5.1": { tokens: 400_000_000, cost: 280 },
        "o3-pro": { tokens: 200_000_000, cost: 100 },
      },
      dailyActivity: spreadActivity(new Date("2026-01-15"), 74, 600_000_000, 60),
      config: {
        mcpServers: [], plugins: [], models: [], skills: [],
      },
    }),
  ],
  totals: {
    tokens: 11_200_000_000,
    inputTokens: 3_800_000_000,
    outputTokens: 1_500_000_000,
    cacheReadTokens: 5_200_000_000,
    cacheWriteTokens: 700_000_000,
    cost: 14_350,
    sessions: 5_150,
  },
  modelDailyActivity: {
    "claude-opus-4-6": spreadActivity(since, 180, 4_400_000_000, 145),
    "claude-sonnet-4-6": spreadActivity(new Date("2025-10-15"), 166, 1_800_000_000, 133),
    "gemini-3-pro-preview": spreadActivity(new Date("2025-11-01"), 150, 2_700_000_000, 120),
    "gpt-5.1": spreadActivity(new Date("2025-12-01"), 120, 900_000_000, 96),
    "claude-haiku-4-5": spreadActivity(new Date("2025-12-15"), 105, 600_000_000, 84),
    "gemini-3.5-flash": spreadActivity(new Date("2025-12-01"), 120, 600_000_000, 96),
    "o3-pro": spreadActivity(new Date("2026-01-15"), 74, 200_000_000, 60),
  },
  inventory: {
    plugins: [
      { name: "superpowers", version: "5.0", skills: [], agents: [], commands: [], sources: ["claude-code", "opencode"] },
    ],
    mcpServers: [
      { name: "github", sources: ["claude-code", "opencode"] },
      { name: "playwright", sources: ["claude-code"] },
      { name: "context7", sources: ["claude-code", "opencode", "gemini-cli"] },
      { name: "yutu", sources: ["claude-code"] },
    ],
    skills: [
      { name: "debugging", sources: ["claude-code"] },
      { name: "code-review", sources: ["claude-code"] },
    ],
  },
};

// Generate SVG
const theme = getTheme("github-dark")!;
const svg = theme.render(data);
const svgPath = resolve("docs/wingman.svg");
writeFileSync(svgPath, svg, "utf-8");
console.log(`✅ Demo SVG saved to ${svgPath}`);

// Generate résumé YAML
const yaml = generateResumeYaml(data, mockModels, {
  name: "Wingman",
  headline: "Your AI agents, one résumé",
});
const yamlPath = resolve("docs/resume.yaml");
writeFileSync(yamlPath, yaml, "utf-8");
console.log(`✅ Demo résumé saved to ${yamlPath}`);
