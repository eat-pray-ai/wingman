import { homedir, platform } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import Database from "better-sqlite3";
import type { AgentAdapter, AgentConfig, UsageRecord } from "../types.js";

function getVscodeUserDir(): string {
  switch (platform()) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", "Code", "User");
    case "win32":
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Code", "User");
    default: // linux and others
      return join(homedir(), ".config", "Code", "User");
  }
}

const VSCODE_USER = getVscodeUserDir();
const WORKSPACE_STORAGE = join(VSCODE_USER, "workspaceStorage");
const GLOBAL_STORAGE = join(VSCODE_USER, "globalStorage");

export default {
  name: "github-copilot",
  displayName: "GitHub Copilot",

  async detect(): Promise<boolean> {
    return existsSync(WORKSPACE_STORAGE);
  },

  async collect(_since: Date, _until: Date): Promise<UsageRecord[]> {
    return [];
  },

  async config(): Promise<AgentConfig> {
    return { mcpServers: [], plugins: [], models: [], skills: [] };
  },
} satisfies AgentAdapter;
