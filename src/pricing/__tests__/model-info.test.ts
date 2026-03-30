import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelInfo } from "../models-dev.js";

describe("fetchModelInfo", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("extracts ModelInfo fields from models.dev response", async () => {
    const mockResponse = {
      anthropic: {
        id: "anthropic",
        models: {
          "claude-opus-4": {
            id: "claude-opus-4",
            name: "Claude Opus 4",
            family: "claude-opus",
            release_date: "2025-06-01",
            knowledge: "2025-03-31",
            modalities: {
              input: ["text", "image", "pdf"],
              output: ["text"],
            },
            capabilities: ["reasoning", "tool_call", "attachment"],
            limits: {
              context: 200000,
              output: 32000,
            },
            cost: {
              input: 15,
              output: 75,
            },
          },
        },
      },
    };

    vi.doMock("node:fs/promises", () => ({
      readFile: vi.fn().mockResolvedValue(
        JSON.stringify({ fetchedAt: Date.now(), data: mockResponse }),
      ),
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
    }));

    const { fetchModelInfo } = await import("../models-dev.js");
    const info = await fetchModelInfo();

    expect(info.size).toBeGreaterThanOrEqual(1);

    const opus = info.get("claude-opus-4");
    expect(opus).toBeDefined();
    expect(opus!.name).toBe("Claude Opus 4");
    expect(opus!.family).toBe("claude-opus");
    expect(opus!.provider).toBe("anthropic");
    expect(opus!.lab).toBe("Anthropic");
    expect(opus!.releaseDate).toBe("2025-06-01");
    expect(opus!.knowledge).toBe("2025-03-31");
    expect(opus!.modalities).toEqual({
      input: ["text", "image", "pdf"],
      output: ["text"],
    });
    expect(opus!.capabilities).toEqual(["reasoning", "tool_call", "attachment"]);
    expect(opus!.limits).toEqual({ context: 200000, output: 32000 });
  });

  it("handles models without optional fields", async () => {
    const mockResponse = {
      openai: {
        id: "openai",
        models: {
          "gpt-4o": {
            id: "gpt-4o",
            name: "GPT-4o",
            cost: { input: 5, output: 15 },
          },
        },
      },
    };

    vi.doMock("node:fs/promises", () => ({
      readFile: vi.fn().mockResolvedValue(
        JSON.stringify({ fetchedAt: Date.now(), data: mockResponse }),
      ),
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
    }));

    const { fetchModelInfo } = await import("../models-dev.js");
    const info = await fetchModelInfo();
    const gpt = info.get("gpt-4o");

    expect(gpt).toBeDefined();
    expect(gpt!.name).toBe("GPT-4o");
    expect(gpt!.provider).toBe("openai");
    expect(gpt!.lab).toBe("OpenAI");
    expect(gpt!.family).toBeUndefined();
    expect(gpt!.releaseDate).toBeUndefined();
    expect(gpt!.capabilities).toEqual([]);
  });

  it("supports normalized ID fallback", async () => {
    const mockResponse = {
      anthropic: {
        id: "anthropic",
        models: {
          "claude-sonnet-4-20250514": {
            id: "claude-sonnet-4-20250514",
            name: "Claude Sonnet 4",
            family: "claude-sonnet",
            cost: { input: 3, output: 15 },
          },
        },
      },
    };

    vi.doMock("node:fs/promises", () => ({
      readFile: vi.fn().mockResolvedValue(
        JSON.stringify({ fetchedAt: Date.now(), data: mockResponse }),
      ),
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
    }));

    const { fetchModelInfo } = await import("../models-dev.js");
    const info = await fetchModelInfo();

    // Exact match works
    expect(info.get("claude-sonnet-4-20250514")).toBeDefined();
    // Should find by normalized key directly
    expect(info.get("claude-sonnet-4")).toBeDefined();
    expect(info.get("claude-sonnet-4")!.name).toBe("Claude Sonnet 4");
  });
});
