# Code Style & Architecture — Wingman

Detailed conventions for AI coding agents working in this codebase. For quick reference and module index, see the root [AGENTS.md](../AGENTS.md).

---

## Code Style

### Imports

1. Node builtins first (`node:fs`, `node:path`, `node:os`) — always `node:` prefixed
2. External deps second (`commander`, `better-sqlite3`, `jsonc-parser`, `smol-toml`)
3. Internal imports last (`./types.js`, `../types.js`, `../../svg/components.js`)
4. Type-only imports use `import type { ... }` — always separate from value imports
5. All internal paths use `.js` extensions (ESM resolution)
6. No path aliases — relative paths only

```typescript
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import Database from "better-sqlite3";
import type { AgentAdapter, AgentConfig, UsageRecord } from "../types.js";
```

### Exports

- **Agent adapters**: `export default { ... } satisfies AgentAdapter` (object literal, no class)
- **Theme renderers**: `export default { name, render } satisfies ThemeRenderer`
- **Registries**: named function exports (`getAllAdapters()`, `getTheme()`)
- **Utility modules**: named exports (`export function formatNumber(...)`)
- **Types**: all in `src/types.ts`, exported individually with `export interface`
- **Re-exports via index files**: only in `src/themes/github-dark/index.ts`

### Types & Interfaces

- Use `interface` for all data shapes (not `type` aliases for objects)
- Centralized in `src/types.ts` — core domain types only
- Theme-local types live in their own module (e.g. `context.ts` has `RenderContext`)
- Optional fields use `?` — never `| undefined`
- Const assertions for color palettes: `as const`
- Use `Record<string, T>` for dynamic string-keyed objects
- Use `satisfies` for type-safe object literals that export default

### Functions

- Prefer `function` declarations for top-level named exports
- Arrow functions for callbacks, inline closures, and short helpers
- Module-scoped unexported helpers use `function` declarations
- Async only where needed (adapter methods that do I/O)

### Naming

- `camelCase`: functions, variables, parameters
- `PascalCase`: interfaces, type aliases
- `UPPER_SNAKE_CASE`: module-level constants (`CLAUDE_DIR`, `CACHE_TTL_MS`, `COLORS`)
- Files: `kebab-case.ts` (e.g. `claude-code.ts`, `gemini-cli.ts`, `models-dev.ts`)
- Directories: `kebab-case/`

### Strings

- Double quotes everywhere (`"string"`) — no single quotes
- Template literals only when interpolating (`\`${var}\``)
- Use numeric separators for large numbers: `1_000_000`

### Error Handling

- Silent failures with `catch { /* ignore */ }` or `catch { /* skip */ }` — agent data is best-effort
- Outer try/catch per adapter returns partial data ("return what we have" pattern)
- Inner try/catch per-record: skip malformed lines/rows, continue processing
- No custom error classes — use `Error` with message only
- SQLite databases always opened `{ readonly: true }` to avoid lock conflicts
- CLI-level errors: `console.error()` + `process.exit(1)`

### Comments

- JSDoc `/** ... */` for public API functions (brief, one-line preferred)
- Inline `// comments` for numbered steps inside long functions
- Numbered-step pattern in complex functions: `// 1. Group records`, `// 2. Build summary`
- `// To add a new X: 1) create file 2) add to registry` in registry files
- No redundant comments on self-explanatory code

### SVG Rendering

- All SVG is pure string concatenation — no DOM, no libraries
- Helper functions return SVG string fragments
- Coordinate system: top-left origin, `y` accumulates downward through sections
- Each section function returns `{ svg: string; height: number }`
- Theme colors centralized in `context.ts` COLORS object

---

## Git Conventions

### Commits — Gitmoji

Commit messages use [gitmoji](https://gitmoji.dev/) `:shortcode:` prefixes. Commit directly with `git commit` — do **not** use the interactive `gitmoji -c` (that's for human use).

```bash
git commit -m ":sparkles: Add new feature"
git commit -m ":bug: Fix off-by-one in aggregator"
git commit -m ":memo: Update AGENTS.md"
```

Common shortcodes: `:sparkles:` new features · `:bug:` bug fixes · `:recycle:` refactor · `:white_check_mark:` tests · `:memo:` docs · `:heavy_plus_sign:`/`:heavy_minus_sign:` deps · `:wrench:` config · `:art:` structure/format · `:tada:` init · `:fire:` remove code/files

Run `gitmoji list` for the full catalog.

---

## Architecture

### Pipeline

```
Agent Adapters → UsageRecord[] → Aggregator → ShowcaseData → Renderer → SVG / YAML
```

Two commands share the pipeline up to `ShowcaseData`:
- `card` → Theme Renderer → SVG
- `resume` → Resume Renderer → rendercv YAML (render at [rendercv.com](https://rendercv.com/))

### Dependencies

- `commander` — CLI parsing
- `better-sqlite3` — read opencode/codex SQLite DBs (readonly)
- `jsonc-parser` — parse opencode JSONC config
- `smol-toml` — parse codex TOML config
- `bootstrap-icons` — SVG icon data
- No SVG libraries — pure string templating
- No YAML libraries — resume YAML is pure string concatenation with smart quoting

---

## Common Patterns

### Registry Pattern

Both agents and themes use a registry: a file that imports all implementations and exports lookup functions. When adding new entries, modify the registry file — the `// To add a new ...` comment shows how.

### Adapter Pattern (collect)

```typescript
export default {
  name: "my-agent",
  displayName: "My Agent",
  async detect() { return existsSync(SOME_PATH); },
  async collect(since, until) {
    const records: UsageRecord[] = [];
    try {
      // read data source, filter by date range, push to records
    } catch { /* return what we have */ }
    return records;
  },
  async config() {
    const cfg: AgentConfig = { mcpServers: [], plugins: [], models: [], skills: [] };
    // populate from config files
    return cfg;
  },
} satisfies AgentAdapter;
```

### Theme Section Pattern

```typescript
export function renderMySection(ctx: RenderContext, data: ShowcaseData, y: number): SectionResult {
  const parts: string[] = [];
  let currentY = y + 16; // top padding
  // ... build SVG fragments, push to parts, advance currentY
  return { svg: parts.join("\n"), height: currentY - y };
}
```
