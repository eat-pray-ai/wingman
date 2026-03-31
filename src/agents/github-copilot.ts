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

interface RawRequest {
  model: string;
  timestamp: Date;
  sessionId: string;
}

/** Normalize model IDs from different sources to a common key.
 *  Session JSON uses "copilot/gpt-4.1", SQLite keys use "copilot-gpt-4o". */
function normalizeModelId(raw: string): string {
  return raw.replace(/^copilot[\/-]/, "");
}

function scanChatSessions(since: Date, until: Date): RawRequest[] {
  const requests: RawRequest[] = [];

  const scanDir = (dir: string) => {
    if (!existsSync(dir)) return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        try {
          const content = readFileSync(join(dir, entry.name), "utf-8");
          const session = JSON.parse(content);
          const sessionId: string = session.sessionId ?? entry.name.replace(/\.json$/, "");
          const fallbackModel: string | undefined = session.selectedModel?.metadata?.id;

          if (!Array.isArray(session.requests)) continue;
          for (const req of session.requests) {
            if (!req.timestamp) continue;
            const ts = new Date(req.timestamp);
            if (isNaN(ts.getTime()) || ts < since || ts >= until) continue;

            const rawModelId = req.modelId ?? fallbackModel;
            if (!rawModelId) continue;

            requests.push({
              model: normalizeModelId(rawModelId),
              timestamp: ts,
              sessionId,
            });
          }
        } catch { /* skip unreadable session files */ }
      }
    } catch { /* skip unreadable directories */ }
  };

  // Scan workspaceStorage/<hash>/chatSessions/*.json
  if (existsSync(WORKSPACE_STORAGE)) {
    try {
      for (const wsEntry of readdirSync(WORKSPACE_STORAGE, { withFileTypes: true })) {
        if (!wsEntry.isDirectory()) continue;
        scanDir(join(WORKSPACE_STORAGE, wsEntry.name, "chatSessions"));
      }
    } catch { /* ignore */ }
  }

  // Scan globalStorage/emptyWindowChatSessions/*.json
  scanDir(join(GLOBAL_STORAGE, "emptyWindowChatSessions"));

  return requests;
}

interface GlobalModelStats {
  tokens: number;
  requests: number;
}

function readGlobalTokenStats(): Map<string, GlobalModelStats> {
  const stats = new Map<string, GlobalModelStats>();
  const dbPath = join(GLOBAL_STORAGE, "state.vscdb");
  if (!existsSync(dbPath)) return stats;

  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = db.prepare("SELECT key, value FROM ItemTable WHERE key LIKE 'languageModelStats.%'").all() as { key: string; value: string }[];
      for (const row of rows) {
        const model = normalizeModelId(row.key.replace(/^languageModelStats\./, ""));
        try {
          const data = JSON.parse(row.value);
          let totalTokens = 0;
          let totalRequests = 0;
          // Extension-level and participant-level counts are additive (not nested).
          // Some models only have participant counts, others only extension counts.
          if (Array.isArray(data.extensions)) {
            for (const ext of data.extensions) {
              totalTokens += ext.tokenCount ?? 0;
              totalRequests += ext.requestCount ?? 0;
              if (Array.isArray(ext.participants)) {
                for (const p of ext.participants) {
                  totalTokens += p.tokenCount ?? 0;
                  totalRequests += p.requestCount ?? 0;
                }
              }
            }
          }
          const existing = stats.get(model);
          stats.set(model, {
            tokens: (existing?.tokens ?? 0) + totalTokens,
            requests: (existing?.requests ?? 0) + totalRequests,
          });
        } catch { /* skip malformed JSON */ }
      }
    } finally {
      db.close();
    }
  } catch { /* ignore db errors */ }

  return stats;
}

export default {
  name: "github-copilot",
  displayName: "GitHub Copilot",

  async detect(): Promise<boolean> {
    return existsSync(join(GLOBAL_STORAGE, "github.copilot-chat"));
  },

  async collect(since: Date, until: Date): Promise<UsageRecord[]> {
    const records: UsageRecord[] = [];
    try {
      const rawRequests = scanChatSessions(since, until);
      const globalStats = readGlobalTokenStats();

      // Distribute global all-time tokens evenly across all-time requests.
      // Only in-window requests get emitted, but the per-request average
      // uses the all-time denominator so totals stay proportional.
      for (const req of rawRequests) {
        const stats = globalStats.get(req.model);
        const perRequestTokens = stats && stats.requests > 0
          ? Math.round(stats.tokens / stats.requests)
          : 0;

        records.push({
          agent: "github-copilot",
          model: req.model,
          provider: "copilot",
          timestamp: req.timestamp,
          tokens: { input: 0, output: perRequestTokens },
          sessionId: req.sessionId,
        });
      }
    } catch {
      // return what we have
    }
    return records;
  },

  async config(): Promise<AgentConfig> {
    return { mcpServers: [], plugins: [], models: [], skills: [] };
  },
} satisfies AgentAdapter;
