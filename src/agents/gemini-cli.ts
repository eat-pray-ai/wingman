import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { AgentAdapter, AgentConfig, UsageRecord } from "../types.js";
import { scanSkillDir } from "./skills.js";

const GEMINI_DIR = join(homedir(), ".gemini");
const TMP_DIR = join(GEMINI_DIR, "tmp");
const SKILLS_DIR = join(GEMINI_DIR, "skills");
const SHARED_SKILLS_DIR = join(homedir(), ".agents", "skills");

export default {
  name: "gemini-cli",
  displayName: "Gemini CLI",

  async detect(): Promise<boolean> {
    return existsSync(GEMINI_DIR);
  },

  async collect(since: Date, until: Date): Promise<UsageRecord[]> {
    const records: UsageRecord[] = [];
    try {
      if (!existsSync(TMP_DIR)) return records;

      const tmpDirs = readdirSync(TMP_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory());

      for (const tmpDir of tmpDirs) {
        const chatsDir = join(TMP_DIR, tmpDir.name, "chats");
        if (!existsSync(chatsDir)) continue;

        const sessionFiles = readdirSync(chatsDir, { withFileTypes: true })
          .filter(
            (f) =>
              f.isFile() &&
              f.name.startsWith("session-") &&
              f.name.endsWith(".json"),
          );

        for (const file of sessionFiles) {
          try {
            const content = readFileSync(join(chatsDir, file.name), "utf-8");
            const session = JSON.parse(content);
            const sessionId = session.sessionId;

            if (!Array.isArray(session.messages)) continue;

            for (const msg of session.messages) {
              if (msg.type !== "gemini") continue;

              const ts = new Date(msg.timestamp);
              if (ts < since || ts >= until) continue;

              records.push({
                agent: "gemini-cli",
                model: msg.model ?? "unknown",
                provider: "google",
                timestamp: ts,
                tokens: {
                  input: msg.tokens?.input ?? 0,
                  output: msg.tokens?.output ?? 0,
                  cacheRead: msg.tokens?.cached ?? 0,
                  reasoning: msg.tokens?.thoughts ?? 0,
                },
                sessionId,
              });
            }
          } catch {
            // skip unreadable files
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("NODE_MODULE_VERSION")) throw err;
    }
    return records;
  },

  async config(): Promise<AgentConfig> {
    const cfg: AgentConfig = { mcpServers: [], plugins: [], models: [], skills: [] };

    try {
      const settingsPath = join(GEMINI_DIR, "settings.json");
      if (!existsSync(settingsPath)) return cfg;

      const content = readFileSync(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      if (settings.mcpServers && typeof settings.mcpServers === "object") {
        cfg.mcpServers = Object.keys(settings.mcpServers);
      }
    } catch {
      // ignore
    }

    cfg.skills.push(...scanSkillDir(SKILLS_DIR), ...scanSkillDir(SHARED_SKILLS_DIR));

    return cfg;
  },
} satisfies AgentAdapter;
