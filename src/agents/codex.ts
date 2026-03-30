import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import Database from "better-sqlite3";
import { parse as parseToml } from "smol-toml";
import type { AgentAdapter, AgentConfig, PluginInfo, UsageRecord } from "../types.js";
import { scanSkillDir } from "./skills.js";

const CODEX_DIR = join(homedir(), ".codex");
const DB_PATH = join(CODEX_DIR, "state_5.sqlite");
const CONFIG_PATH = join(CODEX_DIR, "config.toml");
const SKILLS_DIR = join(CODEX_DIR, "skills");
const PLUGINS_CACHE_DIR = join(CODEX_DIR, "plugins", "cache");
const SHARED_SKILLS_DIR = join(homedir(), ".agents", "skills");

function parseCodexPlugin(pluginDir: string): PluginInfo | null {
  const manifestPath = join(pluginDir, ".codex-plugin", "plugin.json");
  if (!existsSync(manifestPath)) return null;

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
    const name = (manifest.name as string) || pluginDir.split("/").pop() || "unknown";
    const version = manifest.version as string | undefined;
    const info: PluginInfo = { name, version, skills: [], agents: [], commands: [], sources: [] };

    // Scan skills directory if declared in manifest
    const skillsRel = manifest.skills as string | undefined;
    const skillsDir = skillsRel ? join(pluginDir, skillsRel) : join(pluginDir, "skills");
    if (existsSync(skillsDir)) {
      info.skills.push(...scanSkillDir(skillsDir));
    }

    return info;
  } catch {
    return null;
  }
}

function discoverPlugins(): PluginInfo[] {
  if (!existsSync(PLUGINS_CACHE_DIR)) return [];
  const plugins: PluginInfo[] = [];

  try {
    // Structure: cache/$MARKETPLACE/$PLUGIN/$VERSION/
    for (const marketplace of readdirSync(PLUGINS_CACHE_DIR, { withFileTypes: true })) {
      if (!marketplace.isDirectory()) continue;
      const marketDir = join(PLUGINS_CACHE_DIR, marketplace.name);
      for (const plugin of readdirSync(marketDir, { withFileTypes: true })) {
        if (!plugin.isDirectory()) continue;
        const pluginDir = join(marketDir, plugin.name);
        // Use the latest version (last entry alphabetically)
        const versions = readdirSync(pluginDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          .sort();
        const latest = versions[versions.length - 1];
        if (!latest) continue;
        const info = parseCodexPlugin(join(pluginDir, latest));
        if (info) plugins.push(info);
      }
    }
  } catch { /* ignore */ }

  return plugins;
}

export default {
  name: "codex",
  displayName: "Codex",

  async detect(): Promise<boolean> {
    return existsSync(CODEX_DIR);
  },

  async collect(since: Date, until: Date): Promise<UsageRecord[]> {
    const records: UsageRecord[] = [];
    try {
      if (!existsSync(DB_PATH)) return records;

      const db = new Database(DB_PATH, { readonly: true });
      try {
        // created_at is epoch seconds
        const sinceSec = Math.floor(since.getTime() / 1000);
        const untilSec = Math.floor(until.getTime() / 1000);

        const rows = db
          .prepare(
            "SELECT id, model, model_provider, tokens_used, created_at FROM threads WHERE created_at >= ? AND created_at <= ?",
          )
          .all(sinceSec, untilSec) as Array<{
          id: string;
          model: string;
          model_provider: string;
          tokens_used: number;
          created_at: number;
        }>;

        for (const row of rows) {
          try {
            records.push({
              agent: "codex",
              model: row.model ?? "unknown",
              provider: row.model_provider,
              timestamp: new Date(row.created_at * 1000),
              tokens: {
                input: 0,
                output: row.tokens_used ?? 0,
              },
              sessionId: row.id,
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
      const parsed = parseToml(content);

      if (
        parsed.mcp_servers &&
        typeof parsed.mcp_servers === "object" &&
        !Array.isArray(parsed.mcp_servers)
      ) {
        cfg.mcpServers = Object.keys(parsed.mcp_servers);
      }

      // Collect model from top-level `model` field
      if (typeof parsed.model === "string" && parsed.model) {
        cfg.models.push(parsed.model);
      }

      // Collect models from provider configs
      if (
        parsed.provider &&
        typeof parsed.provider === "object" &&
        !Array.isArray(parsed.provider)
      ) {
        for (const providerKey of Object.keys(
          parsed.provider as Record<string, unknown>,
        )) {
          const provider = (parsed.provider as Record<string, unknown>)[
            providerKey
          ] as Record<string, unknown> | undefined;
          if (provider?.models && typeof provider.models === "object") {
            cfg.models.push(
              ...Object.keys(provider.models as Record<string, unknown>),
            );
          }
        }
      }
    } catch {
      // ignore
    }

    cfg.plugins.push(...discoverPlugins());
    cfg.skills.push(...scanSkillDir(SKILLS_DIR), ...scanSkillDir(SHARED_SKILLS_DIR));

    return cfg;
  },
} satisfies AgentAdapter;
