import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { AgentAdapter, AgentConfig, PluginInfo, UsageRecord } from "../types.js";
import { scanSkillDir } from "./skills.js";

const CLAUDE_DIR = join(homedir(), ".claude");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");
const GLOBAL_SKILLS_DIR = join(CLAUDE_DIR, "skills");

function parsePluginDir(name: string, installPath?: string, version?: string): PluginInfo {
  const info: PluginInfo = { name, version, skills: [], agents: [], commands: [], sources: [] };
  if (!installPath || !existsSync(installPath)) return info;

  // Scan skills/ directory for SKILL.md frontmatter names
  const skillsDir = join(installPath, "skills");
  if (existsSync(skillsDir)) {
    try {
      for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          info.skills.push(entry.name);
        }
      }
    } catch { /* ignore */ }
  }

  // Scan agents/ directory
  const agentsDir = join(installPath, "agents");
  if (existsSync(agentsDir)) {
    try {
      for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          info.agents.push(entry.name.replace(/\.md$/, ""));
        }
      }
    } catch { /* ignore */ }
  }

  // Scan commands/ directory
  const commandsDir = join(installPath, "commands");
  if (existsSync(commandsDir)) {
    try {
      for (const entry of readdirSync(commandsDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          info.commands.push(entry.name.replace(/\.md$/, ""));
        }
      }
    } catch { /* ignore */ }
  }

  return info;
}

export default {
  name: "claude-code",
  displayName: "Claude Code",

  async detect(): Promise<boolean> {
    return existsSync(CLAUDE_DIR);
  },

  async collect(since: Date, until: Date): Promise<UsageRecord[]> {
    const records: UsageRecord[] = [];
    try {
      if (!existsSync(PROJECTS_DIR)) return records;

      const parseJsonl = (filepath: string, sessionId?: string) => {
        try {
          const content = readFileSync(filepath, "utf-8");
          for (const line of content.split("\n")) {
            if (!line.trim()) continue;
            try {
              const entry = JSON.parse(line);
              if (entry.type !== "assistant") continue;
              if (entry.message?.model === "<synthetic>") continue;

              const ts = new Date(entry.timestamp);
              if (ts < since || ts >= until) continue;

              const usage = entry.message?.usage;
              if (!usage) continue;

              records.push({
                agent: "claude-code",
                model: entry.message.model ?? "unknown",
                provider: "anthropic",
                timestamp: ts,
                tokens: {
                  input: usage.input_tokens ?? 0,
                  output: usage.output_tokens ?? 0,
                  cacheRead: usage.cache_read_input_tokens ?? 0,
                  cacheWrite: usage.cache_creation_input_tokens ?? 0,
                },
                sessionId: sessionId ?? entry.sessionId,
              });
            } catch { /* skip malformed lines */ }
          }
        } catch { /* skip unreadable files */ }
      };

      const projectDirs = readdirSync(PROJECTS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory());

      for (const projectDir of projectDirs) {
        const projectPath = join(PROJECTS_DIR, projectDir.name);

        // Main session JSONL files
        for (const file of readdirSync(projectPath, { withFileTypes: true })) {
          if (file.isFile() && file.name.endsWith(".jsonl")) {
            const sessionId = file.name.replace(/\.jsonl$/, "");
            parseJsonl(join(projectPath, file.name), sessionId);
          }
        }

        // Subagent JSONL files: <session-id>/subagents/*.jsonl
        for (const entry of readdirSync(projectPath, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const subagentsDir = join(projectPath, entry.name, "subagents");
          if (!existsSync(subagentsDir)) continue;
          for (const sub of readdirSync(subagentsDir, { withFileTypes: true })) {
            if (sub.isFile() && sub.name.endsWith(".jsonl")) {
              parseJsonl(join(subagentsDir, sub.name), entry.name);
            }
          }
        }
      }
    } catch {
      // return what we have
    }
    return records;
  },

  async config(): Promise<AgentConfig> {
    const cfg: AgentConfig = { mcpServers: [], plugins: [], models: [], skills: [] };

    // Collect MCP servers from ~/.claude.json (global + per-project mcpServers)
    const mcpNames = new Set<string>();
    try {
      const claudeJsonPath = join(homedir(), ".claude.json");
      if (existsSync(claudeJsonPath)) {
        const data = JSON.parse(readFileSync(claudeJsonPath, "utf-8"));
        // Top-level mcpServers
        if (data.mcpServers && typeof data.mcpServers === "object") {
          for (const name of Object.keys(data.mcpServers)) mcpNames.add(name);
        }
        // Per-project mcpServers
        if (data.projects && typeof data.projects === "object") {
          for (const proj of Object.values(data.projects) as Record<string, unknown>[]) {
            if (proj.mcpServers && typeof proj.mcpServers === "object") {
              for (const name of Object.keys(proj.mcpServers as object)) mcpNames.add(name);
            }
          }
        }
      }
    } catch { /* ignore */ }
    cfg.mcpServers = [...mcpNames];

    try {
      const pluginsPath = join(CLAUDE_DIR, "plugins", "installed_plugins.json");
      if (existsSync(pluginsPath)) {
        const pluginsData = JSON.parse(readFileSync(pluginsPath, "utf-8"));
        if (pluginsData.plugins && typeof pluginsData.plugins === "object") {
          for (const [key, entries] of Object.entries(pluginsData.plugins)) {
            const name = key.replace(/@[^@]+$/, ""); // strip @marketplace-id
            const entry = Array.isArray(entries) ? (entries as Array<Record<string, unknown>>)[0] : undefined;
            const installPath = entry?.installPath as string | undefined;
            const version = entry?.version as string | undefined;
            const info = parsePluginDir(name, installPath, version);
            cfg.plugins.push(info);
          }
        }
      }
    } catch {
      // ignore
    }

    // Standalone skills (vercel-labs/skills system)
    cfg.skills.push(...scanSkillDir(GLOBAL_SKILLS_DIR));

    return cfg;
  },
} satisfies AgentAdapter;
