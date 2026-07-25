# AGENTS.md — Agent Adapters (`src/agents/`)

Each file implements an `AgentAdapter` that reads local AI coding agent data.

## Files

| File | Agent | Data Source |
|---|---|---|
| `claude-code.ts` | Claude Code | `~/.claude/projects/*/*.jsonl` (JSONL) |
| `opencode.ts` | opencode | `~/.local/share/opencode/opencode.db` (SQLite) |
| `gemini-cli.ts` | Gemini CLI | `~/.gemini/tmp/*/chats/session-*.json` (JSON) |
| `codex.ts` | Codex | `~/.codex/state_5.sqlite` (SQLite) |
| `github-copilot.ts` | GitHub Copilot | VS Code `workspaceStorage` chat sessions + `state.vscdb` |
| `cursor.ts` | Cursor | `state.vscdb` composers (context-size estimate); optional `usage-events*.csv` |
| `registry.ts` | — | Imports all adapters, exports `getAllAdapters()` |
| `skills.ts` | — | Shared skill directory scanner used by all adapters |

## Adding a New Adapter

1. Create `src/agents/my-agent.ts`
2. Default export an object `satisfies AgentAdapter`
3. Add import + array entry in `registry.ts`

## Adapter Contract

```typescript
export default {
  name: "my-agent",          // kebab-case identifier
  displayName: "My Agent",   // human-readable
  async detect() { return existsSync(SOME_PATH); },
  async collect(since, until, options?) {
    const records: UsageRecord[] = [];
    try {
      // 1. Check data source exists
      // 2. Read/query data, filter by [since, until) range
      // 3. Push UsageRecord for each assistant message with usage data
      // options may carry CLI knobs (e.g. cursorUsageCsv)
    } catch { /* return what we have */ }
    return records;
  },
  async config() {
    const cfg: AgentConfig = { mcpServers: [], plugins: [], models: [], skills: [] };
    // parse agent's config files
    return cfg;
  },
} satisfies AgentAdapter;
```

## Key Conventions

- **Silent failures**: outer `try/catch` returns partial data, inner `try/catch` skips malformed records
- **SQLite**: always `{ readonly: true }` to avoid lock conflicts with running agents
- **Module-level constants**: `UPPER_SNAKE_CASE` for all file paths (e.g. `CLAUDE_DIR`, `DB_PATH`)
- **Date filtering**: `collect()` receives `since`/`until` as `Date` objects — filter records to `[since, until)`
- **Session tracking**: set `sessionId` on each `UsageRecord` for session-count aggregation

## Cursor notes

### Usage-events CSV (recommended for accurate tokens)

Cursor’s local `state.vscdb` usually lacks a full per-request token split. For accurate in/out/cache numbers, export **Usage Events** from the Cursor dashboard and feed the CSV to Wingman.

Resolution order (CLI, when Cursor is detected):

1. `--cursor-usage-csv <path>` if provided
2. Else a single `usage-events*.csv` in the **working directory** (announced to the user)
3. Else if multiple `usage-events*.csv` in cwd → **fail** and ask the user to pass `--cursor-usage-csv` or delete unneeded files
4. Else warn (with dashboard export steps) and fall back to `state.vscdb` estimates

`~/.cursor/usage-events*.csv` is **not** scanned — that is not a conventional location for these exports.

If a resolved CSV’s newest event date (UTC) is older than `--until` / today, Wingman warns that the export may be stale and points at https://cursor.com/dashboard/usage.

Priority inside the Cursor adapter when collecting:

1. Resolved usage-events CSV (full in/out/cache columns from Cursor’s export)
2. Else non-zero `bubbleId` `tokenCount` rows from `state.vscdb` (rare on recent Cursor builds — usually `{0,0}`)
3. Else each composer’s `promptTokenBreakdown.totalUsedTokens` / `contextTokensUsed`

### Why cards often show `N in / 0 out / 0 read / 0 write`

Wingman’s breakdown means:

| Label | Field | Meaning |
|---|---|---|
| **in** | `tokens.input` | Prompt / context tokens sent to the model |
| **out** | `tokens.output` | Completion tokens the model generated |
| **read** | `tokens.cacheRead` | Prompt-cache **read** (reuse of cached prompt tokens) |
| **write** | `tokens.cacheWrite` | Prompt-cache **write** (tokens written into the cache) |

**out ≠ write:** out is generated text; write is input-side cache bookkeeping.

On the `state.vscdb` path (no CSV), Cursor usually does not persist reliable per-request usage. The composer fallback is a **context-window snapshot** (system + tools + rules + conversation, etc.), mapped entirely to `input`, with `output` / `cacheRead` / `cacheWrite` left at `0`. That total undercounts cumulative billed usage and is not a full in/out/cache split. Accurate out/read/write exist on Cursor’s dashboard / usage CSV / API, not in the local DB fields we use by default.

### Config inventory

Config reads skills (`skills-cursor` / `skills`), plugins (`plugins/cache` + `local`), MCP (`mcp.json` + plugin `.mcp.json`), and models from `cli-config.json`.
