import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { parse as parseJsonc } from "jsonc-parser";
import type { AgentAdapter, AgentConfig, UsageRecord } from "../types.js";
import { scanSkillDir } from "./skills.js";

const DB_PATH = join(homedir(), ".local", "share", "opencode", "opencode.db");
const CONFIG_PATH = join(homedir(), ".config", "opencode", "opencode.jsonc");
const SKILLS_DIR = join(homedir(), ".config", "opencode", "skills");
const SHARED_SKILLS_DIR = join(homedir(), ".agents", "skills");

export default {
  name: "opencode",
  displayName: "opencode",

  async detect(): Promise<boolean> {
    return existsSync(DB_PATH);
  },

  async collect(since: Date, until: Date): Promise<UsageRecord[]> {
    const records: UsageRecord[] = [];
    try {
      if (!existsSync(DB_PATH)) return records;

      const db = new Database(DB_PATH, { readonly: true });
      try {
        const sinceMs = since.getTime();
        const untilMs = until.getTime();

        const rows = db
          .prepare(
            "SELECT id, session_id, data FROM message WHERE time_created >= ? AND time_created <= ?",
          )
          .all(sinceMs, untilMs) as Array<{
          id: string;
          session_id: string;
          data: string;
        }>;

        for (const row of rows) {
          try {
            const data = JSON.parse(row.data);
            if (data.role !== "assistant") continue;

            const ts = data.time?.created
              ? new Date(data.time.created)
              : new Date(sinceMs);

            records.push({
              agent: "opencode",
              model: data.modelID ?? "unknown",
              provider: data.providerID,
              timestamp: ts,
              tokens: {
                input: data.tokens?.input ?? 0,
                output: data.tokens?.output ?? 0,
                cacheRead: data.tokens?.cache?.read ?? 0,
                cacheWrite: data.tokens?.cache?.write ?? 0,
                reasoning: data.tokens?.reasoning ?? 0,
              },
              sessionId: row.session_id,
            });
          } catch {
            // skip malformed rows
          }
        }
      } finally {
        db.close();
      }
    } catch {
      // return what we have
    }
    return records;
  },

  async config(): Promise<AgentConfig> {
    const cfg: AgentConfig = { mcpServers: [], plugins: [], models: [], skills: [] };

    try {
      if (!existsSync(CONFIG_PATH)) return cfg;

      const content = readFileSync(CONFIG_PATH, "utf-8");
      const parsed = parseJsonc(content);

      if (parsed.mcp && typeof parsed.mcp === "object") {
        cfg.mcpServers = Object.keys(parsed.mcp);
      }

      if (Array.isArray(parsed.plugin)) {
        for (const p of parsed.plugin) {
          const raw = typeof p === "string" ? p : String(p);
          // Strip version/git specifiers: "oh-my-opencode@latest" → "oh-my-opencode"
          const atIdx = raw.indexOf("@");
          const name = atIdx > 0 ? raw.slice(0, atIdx) : raw;
          cfg.plugins.push({ name, skills: [], agents: [], commands: [], sources: [] });
        }
      }

      if (parsed.provider && typeof parsed.provider === "object") {
        for (const providerKey of Object.keys(parsed.provider)) {
          const provider = parsed.provider[providerKey];
          if (provider.models && typeof provider.models === "object") {
            cfg.models.push(...Object.keys(provider.models));
          }
        }
      }
    } catch {
      // ignore
    }

    cfg.skills.push(...scanSkillDir(SKILLS_DIR), ...scanSkillDir(SHARED_SKILLS_DIR));

    return cfg;
  },
} satisfies AgentAdapter;
