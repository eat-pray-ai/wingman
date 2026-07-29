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
  inputTokens: number;
  outputTokens: number;
}

/** Normalize model IDs from different sources to a common key.
 *  Session JSON uses "copilot/gpt-4.1", SQLite keys use "copilot-gpt-4o". */
function normalizeModelId(raw: string): string {
  return raw.replace(/^copilot[\/-]/, "");
}

/** Parse old-format .json session files (VS Code < 1.100). No per-request token data. */
function parseJsonSession(content: string, fileName: string, since: Date, until: Date): RawRequest[] {
  const session = JSON.parse(content);
  const sessionId: string = session.sessionId ?? fileName.replace(/\.json$/, "");
  const fallbackModel: string | undefined = session.selectedModel?.metadata?.id;
  const results: RawRequest[] = [];

  if (!Array.isArray(session.requests)) return results;
  for (const req of session.requests) {
    if (!req.timestamp) continue;
    const ts = new Date(req.timestamp);
    if (isNaN(ts.getTime()) || ts < since || ts >= until) continue;

    const rawModelId = req.modelId ?? fallbackModel;
    if (!rawModelId) continue;

    const usage = req.result?.usage;
    results.push({
      model: normalizeModelId(rawModelId),
      timestamp: ts,
      sessionId,
      inputTokens: usage?.promptTokens ?? 0,
      outputTokens: usage?.completionTokens ?? 0,
    });
  }
  return results;
}

/** Parse new-format .jsonl session files (VS Code >= 1.100).
 *  These are newline-delimited JSON with kind markers:
 *  kind=0: session init (has sessionId, selectedModel)
 *  kind=2 with k=["requests"]: array of request objects with usage data */
function parseJsonlSession(content: string, fileName: string, since: Date, until: Date): RawRequest[] {
  const results: RawRequest[] = [];
  let sessionId = fileName.replace(/\.jsonl$/, "");
  let fallbackModel: string | undefined;

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.kind === 0) {
        sessionId = entry.v?.sessionId ?? sessionId;
        fallbackModel = entry.v?.inputState?.selectedModel?.metadata?.id;
      }
      if (entry.kind === 2 && Array.isArray(entry.k) && entry.k.includes("requests")) {
        for (const req of entry.v ?? []) {
          if (!req.timestamp) continue;
          const ts = new Date(req.timestamp);
          if (isNaN(ts.getTime()) || ts < since || ts >= until) continue;

          const rawModelId = req.modelId ?? fallbackModel;
          if (!rawModelId) continue;

          const usage = req.result?.usage;
          results.push({
            model: normalizeModelId(rawModelId),
            timestamp: ts,
            sessionId,
            inputTokens: usage?.promptTokens ?? 0,
            outputTokens: usage?.completionTokens ?? 0,
          });
        }
      }
    } catch { /* skip malformed lines */ }
  }
  return results;
}

function scanChatSessions(since: Date, until: Date): RawRequest[] {
  const requests: RawRequest[] = [];

  const scanDir = (dir: string) => {
    if (!existsSync(dir)) return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        try {
          const filePath = join(dir, entry.name);
          const content = readFileSync(filePath, "utf-8");

          if (entry.name.endsWith(".jsonl")) {
            requests.push(...parseJsonlSession(content, entry.name, since, until));
          } else if (entry.name.endsWith(".json")) {
            requests.push(...parseJsonSession(content, entry.name, since, until));
          }
        } catch { /* skip unreadable session files */ }
      }
    } catch { /* skip unreadable directories */ }
  };

  // Scan workspaceStorage/<hash>/chatSessions/*.json and *.jsonl
  if (existsSync(WORKSPACE_STORAGE)) {
    try {
      for (const wsEntry of readdirSync(WORKSPACE_STORAGE, { withFileTypes: true })) {
        if (!wsEntry.isDirectory()) continue;
        scanDir(join(WORKSPACE_STORAGE, wsEntry.name, "chatSessions"));
      }
    } catch { /* ignore */ }
  }

  // Scan globalStorage/emptyWindowChatSessions
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

      // Track how many tokens we've accounted for per model from session files
      const sessionTokensByModel = new Map<string, number>();

      for (const req of rawRequests) {
        let inputTokens = req.inputTokens;
        let outputTokens = req.outputTokens;

        // Fall back to global stats average only when session has no token data
        if (inputTokens === 0 && outputTokens === 0) {
          const stats = globalStats.get(req.model);
          if (stats && stats.requests > 0) {
            outputTokens = Math.round(stats.tokens / stats.requests);
          }
        }

        sessionTokensByModel.set(
          req.model,
          (sessionTokensByModel.get(req.model) ?? 0) + inputTokens + outputTokens,
        );

        records.push({
          agent: "github-copilot",
          model: req.model,
          provider: "copilot",
          timestamp: req.timestamp,
          tokens: { input: inputTokens, output: outputTokens },
          sessionId: req.sessionId,
        });
      }

      // For models in global stats that had no session coverage or were
      // undercounted, emit a synthetic record with the remaining tokens.
      // Use the midpoint of the date range as the timestamp since global
      // stats are not date-bucketed.
      const midpoint = new Date((since.getTime() + until.getTime()) / 2);
      for (const [model, stats] of globalStats) {
        const sessionTokens = sessionTokensByModel.get(model) ?? 0;
        const remainder = stats.tokens - sessionTokens;
        if (remainder > 0) {
          records.push({
            agent: "github-copilot",
            model,
            provider: "copilot",
            timestamp: midpoint,
            tokens: { input: 0, output: remainder },
          });
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("NODE_MODULE_VERSION")) throw err;
    }
    return records;
  },

  async config(): Promise<AgentConfig> {
    return { mcpServers: [], plugins: [], models: [], skills: [] };
  },
} satisfies AgentAdapter;
