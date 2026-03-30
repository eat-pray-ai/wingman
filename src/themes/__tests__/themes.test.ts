import { describe, it, expect } from "vitest";
import type { ShowcaseData } from "../../types.js";
import githubDark from "../github-dark/index.js";
import githubLight from "../github-light/index.js";
import onedark from "../onedark/index.js";
import { getTheme, getAvailableThemes } from "../registry.js";

function makeTestData(): ShowcaseData {
  const since = new Date("2026-03-01");
  const until = new Date("2026-03-30");
  return {
    period: { since, until },
    agents: [
      {
        agent: "claude-code",
        displayName: "Claude Code",
        totalTokens: 500_000,
        totalCost: 12.5,
        unknownCost: false,
        sessionCount: 10,
        models: {
          "claude-sonnet-4": { tokens: 400_000, cost: 10.0 },
          "claude-haiku-4": { tokens: 100_000, cost: 2.5 },
        },
        dailyActivity: {
          "2026-03-10": 50_000,
          "2026-03-15": 100_000,
          "2026-03-20": 200_000,
          "2026-03-25": 150_000,
        },
        config: { mcpServers: [], plugins: [], models: [], skills: [] },
      },
    ],
    totals: {
      tokens: 500_000,
      inputTokens: 300_000,
      outputTokens: 150_000,
      cacheReadTokens: 40_000,
      cacheWriteTokens: 10_000,
      cost: 12.5,
      sessions: 10,
    },
    modelDailyActivity: {
      "claude-sonnet-4": {
        "2026-03-10": 40_000,
        "2026-03-15": 80_000,
        "2026-03-20": 160_000,
        "2026-03-25": 120_000,
      },
      "claude-haiku-4": {
        "2026-03-10": 10_000,
        "2026-03-15": 20_000,
        "2026-03-20": 40_000,
        "2026-03-25": 30_000,
      },
    },
    inventory: { plugins: [], mcpServers: [], skills: [] },
  };
}

function makeEmptyData(): ShowcaseData {
  return {
    period: { since: new Date("2026-03-01"), until: new Date("2026-03-30") },
    agents: [],
    totals: {
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
      sessions: 0,
    },
    modelDailyActivity: {},
    inventory: { plugins: [], mcpServers: [], skills: [] },
  };
}

describe("github-dark theme", () => {
  it("renders valid SVG with data", () => {
    const svg = githubDark.render(makeTestData());
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("Wingman Stats");
    expect(svg).toContain("#0d1117"); // dark background
  });

  it("renders empty state", () => {
    const svg = githubDark.render(makeEmptyData());
    expect(svg).toContain("No activity in this period");
  });

  it("has correct name", () => {
    expect(githubDark.name).toBe("github-dark");
  });
});

describe("github-light theme", () => {
  it("renders valid SVG with data", () => {
    const svg = githubLight.render(makeTestData());
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("Wingman Stats");
    expect(svg).toContain("#ffffff"); // light background
  });

  it("renders empty state", () => {
    const svg = githubLight.render(makeEmptyData());
    expect(svg).toContain("No activity in this period");
  });

  it("has correct name", () => {
    expect(githubLight.name).toBe("github-light");
  });

  it("does not contain dark theme colors in background", () => {
    const svg = githubLight.render(makeTestData());
    // The outer rect fill should be white, not dark
    expect(svg).toMatch(/fill="#ffffff".*rx="12"/);
  });
});

describe("onedark theme", () => {
  it("renders valid SVG with data", () => {
    const svg = onedark.render(makeTestData());
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("Wingman Stats");
    expect(svg).toContain("#282c34"); // onedark background
  });

  it("renders empty state", () => {
    const svg = onedark.render(makeEmptyData());
    expect(svg).toContain("No activity in this period");
  });

  it("has correct name", () => {
    expect(onedark.name).toBe("onedark");
  });
});

describe("--sections filtering", () => {
  it("renders only requested sections", () => {
    const svg = githubDark.render(makeTestData(), { sections: ["header", "stats"] });
    expect(svg).toContain("Wingman Stats"); // header
    expect(svg).toContain("TOTAL TOKENS"); // stats
    expect(svg).not.toContain("ACTIVITY"); // heatmap excluded
    expect(svg).not.toContain("AGENTS"); // charts excluded
  });

  it("renders single section", () => {
    const svg = githubDark.render(makeTestData(), { sections: ["heatmap"] });
    expect(svg).toContain("ACTIVITY");
    expect(svg).not.toContain("Wingman Stats");
  });

  it("renders all sections when sections is undefined", () => {
    const full = githubDark.render(makeTestData());
    const explicit = githubDark.render(makeTestData(), {});
    expect(full).toBe(explicit);
  });

  it("produces smaller SVG with fewer sections", () => {
    const full = githubDark.render(makeTestData());
    const partial = githubDark.render(makeTestData(), { sections: ["header", "footer"] });
    expect(partial.length).toBeLessThan(full.length);
  });
});

describe("theme registry", () => {
  it("lists all themes", () => {
    const themes = getAvailableThemes();
    expect(themes).toContain("github-dark");
    expect(themes).toContain("github-light");
    expect(themes).toContain("onedark");
  });

  it("returns theme by name", () => {
    expect(getTheme("github-dark")).toBe(githubDark);
    expect(getTheme("github-light")).toBe(githubLight);
    expect(getTheme("onedark")).toBe(onedark);
  });

  it("returns undefined for unknown theme", () => {
    expect(getTheme("nonexistent")).toBeUndefined();
  });
});
