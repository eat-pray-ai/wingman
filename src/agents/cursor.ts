import { homedir, platform } from "node:os";
import { basename, join, resolve } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import Database from "better-sqlite3";
import type { AgentAdapter, AgentConfig, CollectOptions, PluginInfo, UsageRecord } from "../types.js";
import { scanSkillDir } from "./skills.js";

function getCursorUserDir(): string {
  switch (platform()) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", "Cursor", "User");
    case "win32":
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Cursor", "User");
    default: // linux and others
      return join(homedir(), ".config", "Cursor", "User");
  }
}

const CURSOR_DIR = join(homedir(), ".cursor");
const CURSOR_USER = getCursorUserDir();
const GLOBAL_STORAGE = join(CURSOR_USER, "globalStorage");
const STATE_DB = join(GLOBAL_STORAGE, "state.vscdb");
const SKILLS_CURSOR_DIR = join(CURSOR_DIR, "skills-cursor");
const SKILLS_DIR = join(CURSOR_DIR, "skills");
const SHARED_SKILLS_DIR = join(homedir(), ".agents", "skills");
const PLUGINS_CACHE_DIR = join(CURSOR_DIR, "plugins", "cache");
const PLUGINS_LOCAL_DIR = join(CURSOR_DIR, "plugins", "local");
const CLI_CONFIG_PATH = join(CURSOR_DIR, "cli-config.json");
const MCP_JSON_PATH = join(CURSOR_DIR, "mcp.json");

/** Parse createdAt that may be ISO-8601 or epoch milliseconds. */
function parseTimestamp(raw: unknown): Date | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === "string" && raw) {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function sumTokens(tokens: UsageRecord["tokens"]): number {
  return tokens.input + tokens.output + (tokens.cacheRead ?? 0) + (tokens.cacheWrite ?? 0) + (tokens.reasoning ?? 0);
}

const USAGE_EVENTS_CSV_RE = /^usage-events.*\.csv$/i;

/** List `usage-events*.csv` files in a directory (absolute paths, sorted). */
export function findUsageEventsCsvFiles(dir: string = process.cwd()): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((name) => USAGE_EVENTS_CSV_RE.test(name))
      .sort()
      .map((name) => resolve(dir, name));
  } catch {
    return [];
  }
}

/** Newest event timestamp in a usage-events CSV, or null if none/unreadable. */
export function peekUsageEventsCsvNewest(filePath: string): Date | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return null;

    const headers = parseCsvLine(lines[0]).map((h) => h.trim());
    const dateIdx = headers.findIndex((h) => /^date$/i.test(h));
    if (dateIdx < 0) return null;

    let newest: Date | null = null;
    for (const line of lines.slice(1)) {
      try {
        const ts = parseTimestamp(parseCsvLine(line)[dateIdx]);
        if (!ts) continue;
        if (!newest || ts > newest) newest = ts;
      } catch {
        /* skip malformed rows */
      }
    }
    return newest;
  } catch {
    return null;
  }
}

/** Parse a Cursor dashboard usage-events CSV export into usage records. */
export function parseUsageEventsCsv(filePath: string, since: Date, until: Date): UsageRecord[] {
  const records: UsageRecord[] = [];
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return records;

    const headers = parseCsvLine(lines[0]).map((h) => h.trim());
    const idx = {
      date: headers.findIndex((h) => /^date$/i.test(h)),
      model: headers.findIndex((h) => /^model$/i.test(h)),
      inputWithCache: headers.findIndex((h) => /input.*cache write/i.test(h)),
      inputWithoutCache: headers.findIndex((h) => /input.*w\/o cache/i.test(h)),
      cacheRead: headers.findIndex((h) => /cache read/i.test(h)),
      output: headers.findIndex((h) => /output tokens/i.test(h)),
    };
    if (idx.date < 0 || idx.model < 0) return records;

    for (const line of lines.slice(1)) {
      try {
        const cols = parseCsvLine(line);
        const ts = parseTimestamp(cols[idx.date]);
        if (!ts || ts < since || ts >= until) continue;

        const model = (cols[idx.model] || "unknown").trim() || "unknown";
        const cacheWrite = numCol(cols, idx.inputWithCache);
        const input = numCol(cols, idx.inputWithoutCache);
        const cacheRead = numCol(cols, idx.cacheRead);
        const output = numCol(cols, idx.output);

        records.push({
          agent: "cursor",
          model,
          provider: "cursor",
          timestamp: ts,
          tokens: {
            input,
            output,
            cacheRead,
            cacheWrite,
          },
        });
      } catch {
        /* skip malformed rows */
      }
    }
  } catch {
    /* unreadable file */
  }
  return records;
}

function numCol(cols: string[], index: number): number {
  if (index < 0) return 0;
  const n = Number(String(cols[index] ?? "").replace(/[",]/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

/** Minimal RFC4180-ish CSV line parser (handles quoted fields). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

interface BubbleRow {
  composerId: string;
  model: string;
  timestamp: Date;
  tokens: UsageRecord["tokens"];
}

function collectFromStateDb(since: Date, until: Date): UsageRecord[] {
  const records: UsageRecord[] = [];
  if (!existsSync(STATE_DB)) return records;

  const db = new Database(STATE_DB, { readonly: true });
  try {
    // 1. Per-bubble token rows (often zero on recent Cursor builds)
    const bubblesByComposer = new Map<string, BubbleRow[]>();
    const composersWithBubbleTokens = new Set<string>();

    const bubbleRows = db
      .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'")
      .all() as { key: string; value: string | Buffer }[];

    for (const row of bubbleRows) {
      try {
        const value = typeof row.value === "string" ? row.value : row.value.toString("utf-8");
        const entry = JSON.parse(value) as Record<string, unknown>;
        const parts = row.key.split(":");
        const composerId = parts[1] ?? "unknown";
        const ts = parseTimestamp(entry.createdAt);
        if (!ts || ts < since || ts >= until) continue;

        const modelInfo = entry.modelInfo as { modelName?: string } | undefined;
        const tokenCount = entry.tokenCount as {
          inputTokens?: number;
          outputTokens?: number;
        } | undefined;
        const input = tokenCount?.inputTokens ?? 0;
        const output = tokenCount?.outputTokens ?? 0;
        const model = modelInfo?.modelName;
        if (!model && input === 0 && output === 0) continue;

        const bubble: BubbleRow = {
          composerId,
          model: model || "unknown",
          timestamp: ts,
          tokens: { input, output },
        };
        let list = bubblesByComposer.get(composerId);
        if (!list) {
          list = [];
          bubblesByComposer.set(composerId, list);
        }
        list.push(bubble);
        if (input > 0 || output > 0) composersWithBubbleTokens.add(composerId);
      } catch {
        /* skip malformed bubbles */
      }
    }

    for (const [composerId, bubbles] of bubblesByComposer) {
      if (!composersWithBubbleTokens.has(composerId)) continue;
      for (const bubble of bubbles) {
        if (sumTokens(bubble.tokens) === 0) continue;
        records.push({
          agent: "cursor",
          model: bubble.model,
          provider: "cursor",
          timestamp: bubble.timestamp,
          tokens: bubble.tokens,
          sessionId: composerId,
        });
      }
    }

    // 2. Fallback: composer context-window snapshots when per-bubble tokens are missing.
    //    Latest context size in promptTokenBreakdown / contextTokensUsed (not cumulative billed tokens).
    const composerRows = db
      .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
      .all() as { key: string; value: string | Buffer }[];

    for (const row of composerRows) {
      try {
        const composerId = row.key.slice("composerData:".length);
        if (composersWithBubbleTokens.has(composerId)) continue;

        const value = typeof row.value === "string" ? row.value : row.value.toString("utf-8");
        const entry = JSON.parse(value) as Record<string, unknown>;
        const ts = parseTimestamp(entry.lastUpdatedAt) ?? parseTimestamp(entry.createdAt);
        if (!ts || ts < since || ts >= until) continue;

        const breakdown = entry.promptTokenBreakdown as { totalUsedTokens?: number } | undefined;
        const input =
          breakdown?.totalUsedTokens ??
          (typeof entry.contextTokensUsed === "number" ? entry.contextTokensUsed : 0);
        if (input <= 0) continue;

        const modelConfig = entry.modelConfig as {
          modelName?: string;
          selectedModels?: Array<{ modelId?: string }>;
        } | undefined;
        const model =
          modelConfig?.modelName ||
          modelConfig?.selectedModels?.[0]?.modelId ||
          "unknown";

        records.push({
          agent: "cursor",
          model,
          provider: "cursor",
          timestamp: ts,
          tokens: { input, output: 0 },
          sessionId: composerId,
        });
      } catch {
        /* skip malformed composers */
      }
    }
  } finally {
    db.close();
  }

  return records;
}

function readPluginManifest(pluginDir: string, fallbackName?: string): PluginInfo | null {
  const cursorManifest = join(pluginDir, ".cursor-plugin", "plugin.json");
  const claudeManifest = join(pluginDir, ".claude-plugin", "plugin.json");
  const manifestPath = existsSync(cursorManifest)
    ? cursorManifest
    : existsSync(claudeManifest)
      ? claudeManifest
      : null;

  let name = fallbackName || basename(pluginDir);
  let version: string | undefined;

  if (manifestPath) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
      if (typeof manifest.name === "string" && manifest.name) name = manifest.name;
      if (typeof manifest.version === "string") version = manifest.version;
    } catch {
      /* use dirname fallback */
    }
  }

  const info: PluginInfo = { name, version, skills: [], agents: [], commands: [], sources: [] };

  const skillsDir = join(pluginDir, "skills");
  if (existsSync(skillsDir)) {
    info.skills.push(...scanSkillDir(skillsDir));
  }

  const agentsDir = join(pluginDir, "agents");
  if (existsSync(agentsDir)) {
    try {
      for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          info.agents.push(entry.name.replace(/\.md$/, ""));
        }
      }
    } catch {
      /* ignore */
    }
  }

  const commandsDir = join(pluginDir, "commands");
  if (existsSync(commandsDir)) {
    try {
      for (const entry of readdirSync(commandsDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          info.commands.push(entry.name.replace(/\.md$/, ""));
        }
      }
    } catch {
      /* ignore */
    }
  }

  return info;
}

function collectMcpFromPluginDir(pluginDir: string, mcpNames: Set<string>): void {
  for (const rel of [".mcp.json", "mcp.json"]) {
    const path = join(pluginDir, rel);
    if (!existsSync(path)) continue;
    try {
      const data = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
      if (data.mcpServers && typeof data.mcpServers === "object") {
        for (const name of Object.keys(data.mcpServers as object)) mcpNames.add(name);
      }
    } catch {
      /* ignore */
    }
  }
}

function discoverPlugins(): { plugins: PluginInfo[]; mcpServers: string[] } {
  const plugins: PluginInfo[] = [];
  const mcpNames = new Set<string>();
  const seen = new Set<string>();

  const addPlugin = (dir: string, fallbackName?: string) => {
    const info = readPluginManifest(dir, fallbackName);
    if (!info) return;
    if (seen.has(info.name)) return;
    seen.add(info.name);
    plugins.push(info);
    collectMcpFromPluginDir(dir, mcpNames);
  };

  // cache/$MARKETPLACE/$PLUGIN/$VERSION/
  if (existsSync(PLUGINS_CACHE_DIR)) {
    try {
      for (const marketplace of readdirSync(PLUGINS_CACHE_DIR, { withFileTypes: true })) {
        if (!marketplace.isDirectory()) continue;
        const marketDir = join(PLUGINS_CACHE_DIR, marketplace.name);
        for (const plugin of readdirSync(marketDir, { withFileTypes: true })) {
          if (!plugin.isDirectory()) continue;
          const pluginDir = join(marketDir, plugin.name);
          const versions = readdirSync(pluginDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name)
            .sort();
          const latest = versions[versions.length - 1];
          if (!latest) continue;
          addPlugin(join(pluginDir, latest), plugin.name);
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (existsSync(PLUGINS_LOCAL_DIR)) {
    try {
      for (const entry of readdirSync(PLUGINS_LOCAL_DIR, { withFileTypes: true })) {
        if (entry.isDirectory()) addPlugin(join(PLUGINS_LOCAL_DIR, entry.name), entry.name);
      }
    } catch {
      /* ignore */
    }
  }

  return { plugins, mcpServers: [...mcpNames] };
}

export default {
  name: "cursor",
  displayName: "Cursor",

  async detect(): Promise<boolean> {
    return existsSync(CURSOR_DIR) || existsSync(STATE_DB);
  },

  async collect(since: Date, until: Date, options?: CollectOptions): Promise<UsageRecord[]> {
    const records: UsageRecord[] = [];
    try {
      // Recommended: usage-events CSV resolved by the CLI; state.vscdb is fallback only
      if (options?.cursorUsageCsv) {
        const csvRecords = parseUsageEventsCsv(options.cursorUsageCsv, since, until);
        if (csvRecords.length > 0) return csvRecords;
      }

      records.push(...collectFromStateDb(since, until));
    } catch {
      // return what we have
    }
    return records;
  },

  async config(): Promise<AgentConfig> {
    const cfg: AgentConfig = { mcpServers: [], plugins: [], models: [], skills: [] };
    const mcpNames = new Set<string>();

    try {
      if (existsSync(MCP_JSON_PATH)) {
        const data = JSON.parse(readFileSync(MCP_JSON_PATH, "utf-8")) as Record<string, unknown>;
        if (data.mcpServers && typeof data.mcpServers === "object") {
          for (const name of Object.keys(data.mcpServers as object)) mcpNames.add(name);
        }
      }
    } catch {
      /* ignore */
    }

    try {
      const discovered = discoverPlugins();
      cfg.plugins.push(...discovered.plugins);
      for (const name of discovered.mcpServers) mcpNames.add(name);
    } catch {
      /* ignore */
    }

    cfg.mcpServers = [...mcpNames];

    try {
      if (existsSync(CLI_CONFIG_PATH)) {
        const cli = JSON.parse(readFileSync(CLI_CONFIG_PATH, "utf-8")) as Record<string, unknown>;
        const models = new Set<string>();
        if (cli.model && typeof cli.model === "object") {
          const modelId = (cli.model as { modelId?: string }).modelId;
          if (modelId) models.add(modelId);
        }
        if (typeof cli.selectedModel === "object" && cli.selectedModel) {
          const modelId = (cli.selectedModel as { modelId?: string }).modelId;
          if (modelId) models.add(modelId);
        }
        if (Array.isArray(cli.modelSelectionHistory)) {
          for (const id of cli.modelSelectionHistory) {
            if (typeof id === "string" && id) models.add(id);
          }
        }
        if (cli.modelParameters && typeof cli.modelParameters === "object") {
          for (const id of Object.keys(cli.modelParameters as object)) models.add(id);
        }
        cfg.models.push(...models);
      }
    } catch {
      /* ignore */
    }

    cfg.skills.push(
      ...scanSkillDir(SKILLS_CURSOR_DIR),
      ...scanSkillDir(SKILLS_DIR),
      ...scanSkillDir(SHARED_SKILLS_DIR),
    );

    return cfg;
  },
} satisfies AgentAdapter;
