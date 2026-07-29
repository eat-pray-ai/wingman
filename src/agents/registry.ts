import type { AgentAdapter } from "../types.js";
// To add a new agent: 1) create src/agents/my-agent.ts  2) add import + array entry below
import claudeCode from "./claude-code.js";
import opencode from "./opencode.js";
import geminiCli from "./gemini-cli.js";
import codex from "./codex.js";
import githubCopilot from "./github-copilot.js";
import cursor from "./cursor.js";

const adapters: AgentAdapter[] = [claudeCode, opencode, geminiCli, codex, githubCopilot, cursor];

export function getAllAdapters(): AgentAdapter[] {
  return adapters;
}
