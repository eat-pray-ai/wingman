import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync } from "node:fs";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, existsSync: vi.fn() };
});

describe("github-copilot adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("detect()", () => {
    it("returns true when workspaceStorage directory exists", async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const { default: adapter } = await import("../github-copilot.js");
      expect(await adapter.detect()).toBe(true);
    });

    it("returns false when workspaceStorage directory does not exist", async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      vi.resetModules();
      const { default: adapter } = await import("../github-copilot.js");
      expect(await adapter.detect()).toBe(false);
    });
  });
});
