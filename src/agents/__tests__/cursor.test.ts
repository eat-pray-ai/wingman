import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

type KvRow = { key: string; value: string };

let kvRows: KvRow[] = [];

vi.mock("better-sqlite3", () => {
  return {
    default: class MockDatabase {
      prepare(sql: string) {
        return {
          all: () => {
            if (sql.includes("bubbleId:")) {
              return kvRows.filter((r) => r.key.startsWith("bubbleId:"));
            }
            if (sql.includes("composerData:")) {
              return kvRows.filter((r) => r.key.startsWith("composerData:"));
            }
            return [];
          },
        };
      }
      close() {}
    },
  };
});

describe("cursor adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    kvRows = [];
  });

  describe("detect()", () => {
    it("returns true when Cursor dir or state db exists", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      const { default: adapter } = await import("../cursor.js");
      expect(await adapter.detect()).toBe(true);
    });

    it("returns false when neither Cursor path exists", async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const { default: adapter } = await import("../cursor.js");
      expect(await adapter.detect()).toBe(false);
    });
  });

  describe("collect()", () => {
    const since = new Date("2026-06-01T00:00:00Z");
    const until = new Date("2026-07-01T00:00:00Z");

    it("emits bubble records when tokenCount is non-zero", async () => {
      vi.mocked(existsSync).mockImplementation((path) => {
        const p = String(path);
        if (p.includes("usage-events") || p.endsWith(".cursor")) return false;
        return p.includes("state.vscdb") || p.includes("globalStorage");
      });
      vi.mocked(readdirSync).mockReturnValue([]);

      kvRows = [
        {
          key: "bubbleId:comp-1:bub-1",
          value: JSON.stringify({
            createdAt: "2026-06-10T12:00:00.000Z",
            modelInfo: { modelName: "claude-opus-4" },
            tokenCount: { inputTokens: 1000, outputTokens: 200 },
          }),
        },
        {
          key: "bubbleId:comp-1:bub-2",
          value: JSON.stringify({
            createdAt: "2026-06-10T12:05:00.000Z",
            modelInfo: { modelName: "claude-opus-4" },
            tokenCount: { inputTokens: 0, outputTokens: 0 },
          }),
        },
        {
          key: "composerData:comp-1",
          value: JSON.stringify({
            createdAt: Date.parse("2026-06-10T12:00:00.000Z"),
            lastUpdatedAt: Date.parse("2026-06-10T12:05:00.000Z"),
            modelConfig: { modelName: "claude-opus-4" },
            promptTokenBreakdown: { totalUsedTokens: 50_000 },
          }),
        },
      ];

      const { default: adapter } = await import("../cursor.js");
      const records = await adapter.collect(since, until);

      // Prefer non-zero bubble tokens; skip composer snapshot for that session
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        agent: "cursor",
        model: "claude-opus-4",
        provider: "cursor",
        sessionId: "comp-1",
        tokens: { input: 1000, output: 200 },
      });
    });

    it("falls back to composer promptTokenBreakdown when bubbles have no tokens", async () => {
      vi.mocked(existsSync).mockImplementation((path) => {
        const p = String(path);
        if (p.endsWith(".cursor") && !p.includes("state.vscdb")) return false;
        return p.includes("state.vscdb");
      });
      vi.mocked(readdirSync).mockReturnValue([]);

      kvRows = [
        {
          key: "bubbleId:comp-2:bub-1",
          value: JSON.stringify({
            createdAt: "2026-06-15T08:00:00.000Z",
            modelInfo: { modelName: "grok-4.5" },
            tokenCount: { inputTokens: 0, outputTokens: 0 },
          }),
        },
        {
          key: "composerData:comp-2",
          value: JSON.stringify({
            createdAt: Date.parse("2026-06-15T08:00:00.000Z"),
            lastUpdatedAt: Date.parse("2026-06-15T09:00:00.000Z"),
            modelConfig: {
              modelName: "grok-4.5",
              selectedModels: [{ modelId: "grok-4.5" }],
            },
            promptTokenBreakdown: { totalUsedTokens: 42_000 },
          }),
        },
      ];

      const { default: adapter } = await import("../cursor.js");
      const records = await adapter.collect(since, until);

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        agent: "cursor",
        model: "grok-4.5",
        provider: "cursor",
        sessionId: "comp-2",
        tokens: { input: 42_000, output: 0 },
      });
    });

    it("parses an explicit usage-events CSV path when provided", async () => {
      vi.mocked(existsSync).mockImplementation((path) => String(path).includes("state.vscdb"));
      vi.mocked(readdirSync).mockReturnValue([]);
      vi.mocked(readFileSync).mockReturnValue(
        [
          "Date,Kind,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost",
          '"2026-06-11T17:01:11.468Z","Included","auto","0","55507","676928","18613","751048","Included"',
          '"2026-05-01T17:01:11.468Z","Included","auto","0","1","1","1","3","Included"',
        ].join("\n"),
      );

      const { default: adapter } = await import("../cursor.js");
      const records = await adapter.collect(since, until, {
        cursorUsageCsv: "/tmp/usage-events-2026-06-11.csv",
      });

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        agent: "cursor",
        model: "auto",
        provider: "cursor",
        tokens: {
          input: 55_507,
          output: 18_613,
          cacheRead: 676_928,
          cacheWrite: 0,
        },
      });
    });

    it("lists usage-events*.csv files in a directory", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        "usage-events-2026-07-25.csv",
        "readme.md",
        "usage-events.csv",
        "other.csv",
      ] as unknown as ReturnType<typeof readdirSync>);

      const { findUsageEventsCsvFiles } = await import("../cursor.js");
      const files = findUsageEventsCsvFiles("/work");
      expect(files.map((f) => f.replace(/\\/g, "/"))).toEqual([
        "/work/usage-events-2026-07-25.csv",
        "/work/usage-events.csv",
      ]);
    });

    it("peeks the newest timestamp from a usage-events CSV", async () => {
      vi.mocked(readFileSync).mockReturnValue(
        [
          "Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens",
          '"2026-06-11T17:01:11.468Z","auto","0","1","1","1"',
          '"2026-07-25T03:48:17.119Z","auto","0","1","1","1"',
          '"2026-07-01T00:00:00.000Z","auto","0","1","1","1"',
        ].join("\n"),
      );

      const { peekUsageEventsCsvNewest } = await import("../cursor.js");
      const newest = peekUsageEventsCsvNewest("/tmp/usage-events.csv");
      expect(newest?.toISOString()).toBe("2026-07-25T03:48:17.119Z");
    });

    it("uses CSV path from prepareCursorUsageCsv when collect has no options", async () => {
      vi.mocked(existsSync).mockImplementation((path) => {
        const p = String(path);
        return p.includes("usage-events") || p.includes("state.vscdb");
      });
      vi.mocked(readdirSync).mockReturnValue([]);
      vi.mocked(readFileSync).mockReturnValue(
        [
          "Date,Kind,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost",
          '"2026-06-11T17:01:11.468Z","Included","auto","0","55507","676928","18613","751048","Included"',
        ].join("\n"),
      );

      const { default: adapter, prepareCursorUsageCsv } = await import("../cursor.js");
      const until = new Date("2026-07-01T00:00:00Z");
      prepareCursorUsageCsv({
        explicitPath: "/tmp/usage-events-prepared.csv",
        cursorDetected: true,
        until,
      });

      const records = await adapter.collect(since, until);
      expect(records).toHaveLength(1);
      expect(records[0].tokens.input).toBe(55_507);
    });

    it("filters out-of-range composer snapshots", async () => {
      vi.mocked(existsSync).mockImplementation((path) => String(path).includes("state.vscdb"));
      vi.mocked(readdirSync).mockReturnValue([]);

      kvRows = [
        {
          key: "composerData:old",
          value: JSON.stringify({
            createdAt: Date.parse("2025-01-01T00:00:00.000Z"),
            lastUpdatedAt: Date.parse("2025-01-01T00:00:00.000Z"),
            modelConfig: { modelName: "composer-2.5" },
            promptTokenBreakdown: { totalUsedTokens: 10_000 },
          }),
        },
      ];

      const { default: adapter } = await import("../cursor.js");
      const records = await adapter.collect(since, until);
      expect(records).toHaveLength(0);
    });
  });

  describe("prepareCursorUsageCsv()", () => {
    const until = new Date("2026-07-25T23:59:59.999Z");

    it("skips resolve/warn when Cursor is neither detected nor named", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { prepareCursorUsageCsv } = await import("../cursor.js");

      const path = prepareCursorUsageCsv({
        agents: "claude-code",
        cursorDetected: false,
        until,
      });

      expect(path).toBeUndefined();
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("warns and falls back when Cursor is detected and no CSV is available", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { prepareCursorUsageCsv } = await import("../cursor.js");

      const path = prepareCursorUsageCsv({ cursorDetected: true, until });

      expect(path).toBeUndefined();
      expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("No usage-events*.csv"))).toBe(true);
      warnSpy.mockRestore();
    });

    it("warns when --agents includes cursor even if not detected", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { prepareCursorUsageCsv } = await import("../cursor.js");

      prepareCursorUsageCsv({ agents: "cursor", cursorDetected: false, until });

      expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("No usage-events*.csv"))).toBe(true);
      warnSpy.mockRestore();
    });

    it("resolves an explicit CSV path and warns when stale", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        [
          "Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens",
          '"2026-06-01T00:00:00.000Z","auto","0","1","1","1"',
        ].join("\n"),
      );
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const { prepareCursorUsageCsv } = await import("../cursor.js");

      const path = prepareCursorUsageCsv({
        explicitPath: "/tmp/usage-events-stale.csv",
        cursorDetected: true,
        until,
      });

      expect(path?.replace(/\\/g, "/")).toBe("/tmp/usage-events-stale.csv");
      expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("looks stale"))).toBe(true);
      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    it("fails when multiple usage-events CSV files exist in cwd", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        "usage-events-a.csv",
        "usage-events-b.csv",
      ] as unknown as ReturnType<typeof readdirSync>);
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
        throw new Error(`exit:${code}`);
      }) as never);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { prepareCursorUsageCsv } = await import("../cursor.js");

      expect(() => prepareCursorUsageCsv({ cursorDetected: true, until })).toThrow("exit:1");
      expect(errorSpy.mock.calls.some((c) => String(c[0]).includes("Multiple Cursor usage-events"))).toBe(true);
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe("config()", () => {
    it("collects skills, models, plugins, and mcp servers", async () => {
      vi.mocked(existsSync).mockImplementation((path) => {
        const p = String(path);
        if (p.includes("mcp.json") && !p.includes(".mcp.json")) return true;
        if (p.includes("cli-config.json")) return true;
        if (p.includes("plugins/cache")) return true;
        if (p.includes("skills-cursor")) return true;
        if (p.includes("SKILL.md")) return true;
        if (p.includes(".cursor-plugin/plugin.json")) return true;
        if (p.includes(".mcp.json")) return true;
        if (p.includes("skills") && p.includes("figma")) return true;
        return false;
      });

      vi.mocked(readdirSync).mockImplementation(((path: string, opts?: { withFileTypes?: boolean }) => {
        const p = String(path);
        const asDirents = (names: string[], dirs = true) =>
          names.map((name) => ({
            name,
            isDirectory: () => dirs,
            isFile: () => !dirs,
          }));

        if (opts?.withFileTypes) {
          if (p.endsWith("plugins/cache")) return asDirents(["cursor-public"]);
          if (p.endsWith("cursor-public")) return asDirents(["figma"]);
          if (p.endsWith("figma") && p.includes("cache")) return asDirents(["v1"]);
          if (p.endsWith("skills-cursor")) return asDirents(["create-rule"]);
          if (p.includes("figma") && p.endsWith("skills")) return asDirents(["figma-use"]);
          return [];
        }
        return [];
      }) as unknown as typeof readdirSync);

      vi.mocked(readFileSync).mockImplementation(((path: string) => {
        const p = String(path);
        if (p.endsWith("mcp.json") && !p.includes(".mcp.json")) {
          return JSON.stringify({ mcpServers: { filesystem: {} } });
        }
        if (p.includes("cli-config.json")) {
          return JSON.stringify({
            model: { modelId: "grok-4.5" },
            modelSelectionHistory: ["composer-2.5"],
            modelParameters: { "gpt-5.5": [] },
          });
        }
        if (p.includes(".cursor-plugin/plugin.json")) {
          return JSON.stringify({ name: "figma", version: "2.0.0" });
        }
        if (p.includes(".mcp.json")) {
          return JSON.stringify({ mcpServers: { figma: { type: "http" } } });
        }
        if (p.includes("SKILL.md")) {
          return "---\nname: create-rule\n---\n";
        }
        return "{}";
      }) as unknown as typeof readFileSync);

      const { default: adapter } = await import("../cursor.js");
      const cfg = await adapter.config();

      expect(cfg.models).toEqual(expect.arrayContaining(["grok-4.5", "composer-2.5", "gpt-5.5"]));
      expect(cfg.mcpServers).toEqual(expect.arrayContaining(["filesystem", "figma"]));
      expect(cfg.plugins.some((p) => p.name === "figma")).toBe(true);
      expect(cfg.skills).toContain("create-rule");
    });
  });
});
