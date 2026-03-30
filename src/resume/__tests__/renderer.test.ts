import { describe, it, expect } from "vitest";
import { generateResumeYaml, type ResumeOptions } from "../renderer.js";
import type { ShowcaseData } from "../../types.js";
import type { ModelInfo } from "../../pricing/models-dev.js";

const defaultOpts: ResumeOptions = { name: "Wingman", headline: "AI Development Assistants" };

function makeTestData(): ShowcaseData {
  const since = new Date("2026-03-01");
  const until = new Date("2026-03-30");
  return {
    period: { since, until },
    agents: [
      {
        agent: "claude-code",
        displayName: "Claude Code",
        totalTokens: 400_000_000,
        totalCost: 1000,
        unknownCost: false,
        sessionCount: 8,
        models: {
          "claude-sonnet-4": { tokens: 320_000_000, cost: 960 },
          "claude-haiku-4": { tokens: 80_000_000, cost: 40 },
        },
        dailyActivity: {
          "2026-03-05": 50_000,
          "2026-03-10": 100_000,
          "2026-03-20": 150_000,
          "2026-03-25": 100_000,
        },
        config: { mcpServers: ["filesystem", "github"], plugins: [], models: [], skills: ["debugging"] },
      },
      {
        agent: "copilot",
        displayName: "GitHub Copilot",
        totalTokens: 100_000_000,
        totalCost: 200,
        unknownCost: false,
        sessionCount: 5,
        models: {
          "gpt-4o": { tokens: 100_000_000, cost: 200 },
        },
        dailyActivity: {
          "2026-03-10": 40_000_000,
          "2026-03-15": 60_000_000,
        },
        config: { mcpServers: [], plugins: [], models: [], skills: [] },
      },
    ],
    totals: {
      tokens: 500_000_000,
      inputTokens: 300_000_000,
      outputTokens: 150_000_000,
      cacheReadTokens: 40_000_000,
      cacheWriteTokens: 10_000_000,
      cost: 1200,
      sessions: 13,
    },
    modelDailyActivity: {},
    inventory: {
      plugins: [{ name: "superpowers", version: "5.0", skills: [], agents: [], commands: [], sources: ["claude-code"] }],
      mcpServers: [
        { name: "filesystem", sources: ["claude-code"] },
        { name: "github", sources: ["claude-code"] },
      ],
      skills: [{ name: "debugging", sources: ["claude-code"] }],
    },
  };
}

function makeModelInfo(): Map<string, ModelInfo> {
  const map = new Map<string, ModelInfo>();
  map.set("claude-sonnet-4", {
    id: "claude-sonnet-4",
    name: "Claude Sonnet 4",
    family: "claude-sonnet",
    provider: "anthropic",
    lab: "Anthropic",
    releaseDate: "2025-05-14",
    knowledge: "2025-03-31",
    modalities: { input: ["text", "image", "pdf"], output: ["text"] },
    capabilities: ["reasoning", "tool_call", "attachment"],
    limits: { context: 200000, output: 64000 },
  });
  map.set("claude-haiku-4", {
    id: "claude-haiku-4",
    name: "Claude Haiku 4",
    family: "claude-haiku",
    provider: "anthropic",
    lab: "Anthropic",
    releaseDate: "2025-05-01",
    modalities: { input: ["text", "image"], output: ["text"] },
    capabilities: ["tool_call"],
    limits: { context: 200000, output: 64000 },
  });
  map.set("gpt-4o", {
    id: "gpt-4o",
    name: "GPT-4o",
    family: "gpt-4o",
    provider: "openai",
    lab: "OpenAI",
    releaseDate: "2024-05-13",
    knowledge: "2024-10-01",
    modalities: { input: ["text", "image"], output: ["text"] },
    capabilities: ["reasoning", "tool_call"],
    limits: { context: 128000, output: 16384 },
  });
  return map;
}

describe("generateResumeYaml", () => {
  it("produces YAML with cv top-level key", () => {
    const yaml = generateResumeYaml(makeTestData(), makeModelInfo(), defaultOpts);
    expect(yaml).toMatch(/^cv:\n/);
  });

  it("includes name and headline", () => {
    const yaml = generateResumeYaml(makeTestData(), makeModelInfo(), defaultOpts);
    expect(yaml).toContain("name: Wingman");
    expect(yaml).toContain("headline: AI Development Assistants");
  });

  it("allows overriding name and headline", () => {
    const yaml = generateResumeYaml(makeTestData(), makeModelInfo(), {
      name: "My Team",
      headline: "Custom Headline",
    });
    expect(yaml).toContain("name: My Team");
    expect(yaml).toContain("headline: Custom Headline");
  });

  it("has summary section with stats", () => {
    const yaml = generateResumeYaml(makeTestData(), makeModelInfo(), defaultOpts);
    expect(yaml).toContain("summary:");
    expect(yaml).toContain("**2 agents**");
    expect(yaml).toContain("**500M tokens**");
    expect(yaml).toContain("**13 sessions**");
  });

  it("has experience section with agents sorted by token usage", () => {
    const yaml = generateResumeYaml(makeTestData(), makeModelInfo(), defaultOpts);
    expect(yaml).toContain("experience:");
    expect(yaml).toContain("company: Claude Code");
    expect(yaml).toContain("company: GitHub Copilot");
    expect(yaml).toContain("Primary Agent");
    expect(yaml).toContain("Secondary Agent");
  });

  it("has experience entries with date ranges from dailyActivity", () => {
    const yaml = generateResumeYaml(makeTestData(), makeModelInfo(), defaultOpts);
    // Claude Code: earliest=2026-03-05, latest=2026-03-25
    expect(yaml).toContain("start_date: 2026-03-05");
    expect(yaml).toContain("end_date: 2026-03-25");
  });

  it("has education section grouped by AI company", () => {
    const yaml = generateResumeYaml(makeTestData(), makeModelInfo(), defaultOpts);
    expect(yaml).toContain("education:");
    // Grouped by company, not one per model
    expect(yaml).toContain("institution: Anthropic");
    expect(yaml).toContain("institution: OpenAI");
    // Primary model as degree
    expect(yaml).toContain("degree: Claude Sonnet 4");
    expect(yaml).toContain("degree: GPT-4o");
    // Merged modalities for Anthropic group (text, image from haiku + pdf from sonnet)
    expect(yaml).toContain("'text, image, pdf'");
    // Individual models in highlights (bold names)
    expect(yaml).toContain("**Claude Sonnet 4**:");
    expect(yaml).toContain("**Claude Haiku 4**:");
    expect(yaml).toContain("**GPT-4o**:");
  });

  it("uses earliest knowledge as start_date and latest release as end_date per group", () => {
    const yaml = generateResumeYaml(makeTestData(), makeModelInfo(), defaultOpts);
    // Anthropic group: knowledge min(2025-03-31, undefined) = 2025-03-31
    //                  release max(2025-05-14, 2025-05-01) = 2025-05-14
    expect(yaml).toContain("start_date: 2025-03-31");
    expect(yaml).toContain("end_date: 2025-05-14");
  });

  it("has technologies section with inventory items", () => {
    const yaml = generateResumeYaml(makeTestData(), makeModelInfo(), defaultOpts);
    expect(yaml).toContain("technologies:");
    expect(yaml).toContain("label: Plugins");
    expect(yaml).toContain("superpowers");
    expect(yaml).toContain("label: MCP Servers");
    expect(yaml).toContain("filesystem");
    expect(yaml).toContain("label: Skills");
    expect(yaml).toContain("debugging");
  });

  it("omits empty inventory categories", () => {
    const data = makeTestData();
    data.inventory = { plugins: [], mcpServers: [], skills: [] };
    const yaml = generateResumeYaml(data, makeModelInfo(), defaultOpts);
    expect(yaml).not.toContain("technologies:");
  });

  it("handles unknown models gracefully", () => {
    const yaml = generateResumeYaml(makeTestData(), new Map(), defaultOpts);
    expect(yaml).toContain("education:");
    // Company derived from model ID prefix, not ModelInfo provider
    expect(yaml).toContain("institution: Anthropic");
    expect(yaml).toContain("institution: OpenAI");
    expect(yaml).toContain("area: Language Models");
    // Raw model ID used as degree when no ModelInfo
    expect(yaml).toContain("degree: claude-sonnet-4");
    expect(yaml).toContain("degree: gpt-4o");
    expect(yaml).toContain("end_date: present");
  });
});

describe("generateResumeYaml edge cases", () => {
  it("handles single agent (Primary Agent only)", () => {
    const data = makeTestData();
    data.agents = [data.agents[0]];
    data.totals.tokens = data.agents[0].totalTokens;
    const yaml = generateResumeYaml(data, makeModelInfo(), defaultOpts);
    expect(yaml).toContain("Primary Agent");
    expect(yaml).not.toContain("Secondary Agent");
  });

  it("handles three+ agents with Supporting Agent label", () => {
    const data = makeTestData();
    data.agents.push({
      agent: "cursor",
      displayName: "Cursor",
      totalTokens: 50_000_000,
      totalCost: 100,
      unknownCost: false,
      sessionCount: 2,
      models: { "gpt-4o-mini": { tokens: 50_000_000, cost: 100 } },
      dailyActivity: { "2026-03-20": 50_000_000 },
      config: { mcpServers: [], plugins: [], models: [], skills: [] },
    });
    data.totals.tokens = 550_000_000;
    const yaml = generateResumeYaml(data, makeModelInfo(), defaultOpts);
    expect(yaml).toContain("Primary Agent");
    expect(yaml).toContain("Secondary Agent");
    expect(yaml).toContain("Supporting Agent");
  });

  it("filters out agents with <= 1% token usage", () => {
    const data = makeTestData();
    data.agents.push({
      agent: "gemini-cli",
      displayName: "Gemini CLI",
      totalTokens: 1_000,
      totalCost: 0.01,
      unknownCost: false,
      sessionCount: 1,
      models: { "gemini-flash": { tokens: 1_000, cost: 0.01 } },
      dailyActivity: { "2026-03-20": 1_000 },
      config: { mcpServers: [], plugins: [], models: [], skills: [] },
    });
    const yaml = generateResumeYaml(data, makeModelInfo(), defaultOpts);
    expect(yaml).not.toContain("Gemini CLI");
  });

  it("falls back to period dates when agent has no dailyActivity", () => {
    const data = makeTestData();
    data.agents[0].dailyActivity = {};
    const yaml = generateResumeYaml(data, makeModelInfo(), defaultOpts);
    expect(yaml).toContain("start_date: 2026-03-01");
    expect(yaml).toContain("end_date: 2026-03-30");
  });

  it("produces valid YAML structure (all lines properly indented)", () => {
    const yaml = generateResumeYaml(makeTestData(), makeModelInfo(), defaultOpts);
    const lines = yaml.split("\n");
    expect(lines[0]).toBe("cv:");
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim().length > 0) {
        expect(lines[i]).toMatch(/^ /);
      }
    }
  });

  it("quotes strings with special characters", () => {
    const data = makeTestData();
    data.agents[0].displayName = "Agent: Special & Co.";
    const yaml = generateResumeYaml(data, makeModelInfo(), defaultOpts);
    // Contains colon so must be quoted
    expect(yaml).toContain("'Agent: Special & Co.'");
  });
});
