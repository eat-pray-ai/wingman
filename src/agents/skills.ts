import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Scan a skills directory for SKILL.md files and return skill names.
 * Handles both flat and nested layouts:
 *   skills/my-skill/SKILL.md  → extracts `name` from frontmatter, falls back to dir name
 *   skills/.system/foo/SKILL.md → same, under .system prefix
 *   skills/.curated/foo/SKILL.md → same
 */
export function scanSkillDir(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const skills: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // Could be a skill dir (has SKILL.md) or a category dir (.system, .curated, etc.)
        const skillMd = join(dir, entry.name, "SKILL.md");
        if (existsSync(skillMd)) {
          skills.push(parseSkillName(skillMd, entry.name));
        } else {
          // Check nested subdirs (e.g. .system/foo/SKILL.md)
          try {
            for (const sub of readdirSync(join(dir, entry.name), { withFileTypes: true })) {
              if (sub.isDirectory()) {
                const nestedMd = join(dir, entry.name, sub.name, "SKILL.md");
                if (existsSync(nestedMd)) {
                  skills.push(parseSkillName(nestedMd, sub.name));
                }
              }
            }
          } catch { /* ignore */ }
        }
      }
    }
  } catch { /* ignore */ }
  return skills;
}

/** Extract `name` from SKILL.md YAML frontmatter, fallback to dirName */
function parseSkillName(path: string, dirName: string): string {
  try {
    const content = readFileSync(path, "utf-8");
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (match) {
      const nameMatch = match[1].match(/^name:\s*(.+)$/m);
      if (nameMatch) return nameMatch[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* ignore */ }
  return dirName;
}
