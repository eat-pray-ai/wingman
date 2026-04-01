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

// Shared state for the Database mock that persists across resetModules
let dbRows: { key: string; value: string }[] = [];

vi.mock("better-sqlite3", () => {
  return {
    default: class MockDatabase {
      prepare() {
        return {
          all() {
            return dbRows;
          },
        };
      }
      close() {}
    },
  };
});

describe("github-copilot adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    dbRows = [];
  });

  describe("detect()", () => {
    it("returns true when Copilot extension directory exists", async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const { default: adapter } = await import("../github-copilot.js");
      expect(await adapter.detect()).toBe(true);
    });

    it("returns false when Copilot extension directory does not exist", async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const { default: adapter } = await import("../github-copilot.js");
      expect(await adapter.detect()).toBe(false);
    });
  });

  describe("collect()", () => {
    const since = new Date("2025-01-01T00:00:00Z");
    const until = new Date("2025-01-31T23:59:59Z");

    const inRangeTs1 = new Date("2025-01-10T10:00:00Z").getTime(); // 1736503200000
    const inRangeTs2 = new Date("2025-01-20T15:00:00Z").getTime(); // 1737385200000
    const outOfRangeTs = new Date("2024-06-01T00:00:00Z").getTime();

    it("parses requests from old-format .json session files", async () => {
      const sessionData = {
        sessionId: "sess-abc-123",
        selectedModel: { metadata: { id: "gpt-4o" } },
        requests: [
          { timestamp: inRangeTs1, modelId: "copilot/gpt-4.1" },
          { timestamp: inRangeTs2, modelId: "copilot/gpt-4.1" },
          { timestamp: outOfRangeTs, modelId: "copilot/gpt-4.1" },
        ],
      };

      vi.mocked(existsSync).mockReturnValue(true);

      vi.mocked(readdirSync).mockImplementation(((path: string) => {
        if (path.includes("workspaceStorage") && !path.includes("chatSessions")) {
          return [{ name: "abc123hash", isDirectory: () => true }] as unknown[];
        }
        if (path.includes("chatSessions") || path.includes("emptyWindowChatSessions")) {
          if (path.includes("abc123hash") || path.includes("chatSessions")) {
            return path.includes("abc123hash")
              ? [{ name: "sess-abc-123.json", isFile: () => true }]
              : [];
          }
          return [];
        }
        return [];
      }) as typeof readdirSync);

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(sessionData));

      const { default: adapter } = await import("../github-copilot.js");
      const records = await adapter.collect(since, until);

      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({
        agent: "github-copilot",
        model: "gpt-4.1",
        provider: "copilot",
        sessionId: "sess-abc-123",
      });
      expect(records[1]).toMatchObject({
        agent: "github-copilot",
        model: "gpt-4.1",
        provider: "copilot",
        sessionId: "sess-abc-123",
      });
    });

    it("falls back to selectedModel.metadata.id when modelId is absent", async () => {
      const sessionData = {
        sessionId: "sess-fallback-456",
        selectedModel: { metadata: { id: "gpt-4o" } },
        requests: [
          { timestamp: inRangeTs1 },
        ],
      };

      vi.mocked(existsSync).mockReturnValue(true);

      vi.mocked(readdirSync).mockImplementation(((path: string) => {
        if (path.includes("workspaceStorage") && !path.includes("chatSessions")) {
          return [{ name: "hash456", isDirectory: () => true }] as unknown[];
        }
        if (path.includes("hash456") && path.includes("chatSessions")) {
          return [{ name: "sess-fallback-456.json", isFile: () => true }];
        }
        return [];
      }) as typeof readdirSync);

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(sessionData));

      const { default: adapter } = await import("../github-copilot.js");
      const records = await adapter.collect(since, until);

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        agent: "github-copilot",
        model: "gpt-4o",
        provider: "copilot",
        sessionId: "sess-fallback-456",
      });
    });

    it("skips sessions with empty requests", async () => {
      const sessionData = {
        sessionId: "sess-empty-789",
        selectedModel: { metadata: { id: "gpt-4o" } },
        requests: [],
      };

      vi.mocked(existsSync).mockReturnValue(true);

      vi.mocked(readdirSync).mockImplementation(((path: string) => {
        if (path.includes("workspaceStorage") && !path.includes("chatSessions")) {
          return [{ name: "hash789", isDirectory: () => true }] as unknown[];
        }
        if (path.includes("hash789") && path.includes("chatSessions")) {
          return [{ name: "sess-empty-789.json", isFile: () => true }];
        }
        return [];
      }) as typeof readdirSync);

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(sessionData));

      const { default: adapter } = await import("../github-copilot.js");
      const records = await adapter.collect(since, until);

      expect(records).toHaveLength(0);
    });

    it("uses per-request usage data from .json when available", async () => {
      const sessionData = {
        sessionId: "sess-usage-001",
        selectedModel: { metadata: { id: "gpt-4o" } },
        requests: [
          {
            timestamp: inRangeTs1,
            modelId: "copilot/gpt-4o",
            result: { usage: { promptTokens: 5000, completionTokens: 800 } },
          },
        ],
      };

      vi.mocked(existsSync).mockReturnValue(true);

      vi.mocked(readdirSync).mockImplementation(((path: string) => {
        if (path.includes("workspaceStorage") && !path.includes("chatSessions")) {
          return [{ name: "hashUsage", isDirectory: () => true }] as unknown[];
        }
        if (path.includes("hashUsage") && path.includes("chatSessions")) {
          return [{ name: "sess-usage-001.json", isFile: () => true }];
        }
        return [];
      }) as typeof readdirSync);

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(sessionData));

      const { default: adapter } = await import("../github-copilot.js");
      const records = await adapter.collect(since, until);

      expect(records).toHaveLength(1);
      expect(records[0].tokens.input).toBe(5000);
      expect(records[0].tokens.output).toBe(800);
    });

    it("parses .jsonl session files with real token data", async () => {
      const jsonlContent = [
        JSON.stringify({
          kind: 0,
          v: {
            sessionId: "sess-jsonl-001",
            inputState: {
              selectedModel: { metadata: { id: "gpt-5.2" } },
            },
          },
        }),
        JSON.stringify({
          kind: 2,
          k: ["requests"],
          v: [
            {
              timestamp: inRangeTs1,
              modelId: "copilot/gpt-5.2",
              result: { usage: { promptTokens: 18000, completionTokens: 400 } },
            },
            {
              timestamp: inRangeTs2,
              modelId: "copilot/gpt-5.2",
              result: { usage: { promptTokens: 20000, completionTokens: 600 } },
            },
            {
              timestamp: outOfRangeTs,
              modelId: "copilot/gpt-5.2",
              result: { usage: { promptTokens: 1000, completionTokens: 100 } },
            },
          ],
        }),
      ].join("\n");

      vi.mocked(existsSync).mockReturnValue(true);

      vi.mocked(readdirSync).mockImplementation(((path: string) => {
        if (path.includes("workspaceStorage") && !path.includes("chatSessions")) {
          return [{ name: "hashJsonl", isDirectory: () => true }] as unknown[];
        }
        if (path.includes("hashJsonl") && path.includes("chatSessions")) {
          return [{ name: "sess-jsonl-001.jsonl", isFile: () => true }];
        }
        return [];
      }) as typeof readdirSync);

      vi.mocked(readFileSync).mockReturnValue(jsonlContent);

      const { default: adapter } = await import("../github-copilot.js");
      const records = await adapter.collect(since, until);

      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({
        agent: "github-copilot",
        model: "gpt-5.2",
        provider: "copilot",
        sessionId: "sess-jsonl-001",
        tokens: { input: 18000, output: 400 },
      });
      expect(records[1]).toMatchObject({
        tokens: { input: 20000, output: 600 },
      });
    });

    it("falls back to global stats when session has no token data", async () => {
      const sessionData = {
        sessionId: "sess-tokens-001",
        selectedModel: { metadata: { id: "gpt-4o" } },
        requests: [
          { timestamp: inRangeTs1, modelId: "copilot/gpt-4o" },
          { timestamp: inRangeTs2, modelId: "copilot/gpt-4o" },
        ],
      };

      vi.mocked(existsSync).mockReturnValue(true);

      vi.mocked(readdirSync).mockImplementation(((path: string) => {
        if (path.includes("workspaceStorage") && !path.includes("chatSessions")) {
          return [{ name: "hashTokens", isDirectory: () => true }] as unknown[];
        }
        if (path.includes("hashTokens") && path.includes("chatSessions")) {
          return [{ name: "sess-tokens-001.json", isFile: () => true }];
        }
        return [];
      }) as typeof readdirSync);

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(sessionData));

      const tokenStatsValue = JSON.stringify({
        extensions: [{
          extensionId: "GitHub.copilot-chat",
          requestCount: 10,
          tokenCount: 5000,
          participants: [
            { id: "github.copilot.default", requestCount: 5, tokenCount: 3000 },
          ],
        }],
      });

      dbRows = [
        { key: "languageModelStats.copilot-gpt-4o", value: tokenStatsValue },
      ];

      const { default: adapter } = await import("../github-copilot.js");
      const records = await adapter.collect(since, until);

      // 2 session records with fallback average + 1 synthetic remainder record
      expect(records).toHaveLength(3);
      // Total tokens: 5000 + 3000 = 8000, total requests: 10 + 5 = 15 (all-time from global stats)
      // Per-request average: 8000 / 15 ≈ 533
      const avg = Math.round(8000 / 15);
      expect(records[0].tokens.output).toBe(avg);
      expect(records[1].tokens.output).toBe(avg);
      expect(records[0].tokens.input).toBe(0);
      // Synthetic remainder: 8000 - (533 * 2) = 6934
      expect(records[2].tokens.output).toBe(8000 - avg * 2);
      expect(records[2].tokens.input).toBe(0);
    });

    it("prefers per-request usage over global stats fallback", async () => {
      const sessionData = {
        sessionId: "sess-prefer-usage",
        selectedModel: { metadata: { id: "gpt-4o" } },
        requests: [
          {
            timestamp: inRangeTs1,
            modelId: "copilot/gpt-4o",
            result: { usage: { promptTokens: 12000, completionTokens: 500 } },
          },
        ],
      };

      vi.mocked(existsSync).mockReturnValue(true);

      vi.mocked(readdirSync).mockImplementation(((path: string) => {
        if (path.includes("workspaceStorage") && !path.includes("chatSessions")) {
          return [{ name: "hashPrefer", isDirectory: () => true }] as unknown[];
        }
        if (path.includes("hashPrefer") && path.includes("chatSessions")) {
          return [{ name: "sess-prefer-usage.json", isFile: () => true }];
        }
        return [];
      }) as typeof readdirSync);

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(sessionData));

      // Global stats exist but should NOT be used when session has real data
      dbRows = [
        {
          key: "languageModelStats.copilot-gpt-4o",
          value: JSON.stringify({
            extensions: [{ requestCount: 100, tokenCount: 99999 }],
          }),
        },
      ];

      const { default: adapter } = await import("../github-copilot.js");
      const records = await adapter.collect(since, until);

      // 1 session record + 1 synthetic remainder record
      expect(records).toHaveLength(2);
      expect(records[0].tokens.input).toBe(12000);
      expect(records[0].tokens.output).toBe(500);
      // Synthetic remainder: 99999 - (12000 + 500) = 87499
      expect(records[1].tokens.output).toBe(99999 - 12500);
      expect(records[1].tokens.input).toBe(0);
    });
  });
});
