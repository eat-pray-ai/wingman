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
| `cursor.ts` | Cursor | `usage-events*.csv` (recommended); `state.vscdb` fallback |
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
  async collect(since, until) {
    const records: UsageRecord[] = [];
    try {
      // 1. Check data source exists
      // 2. Read/query data, filter by [since, until) range
      // 3. Push UsageRecord for each assistant message with usage data
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

### Recommended: usage-events CSV

Cursor does not persist reliable per-request token totals in local storage. For accurate in/out/cache numbers, export **Usage Events** from https://cursor.com/dashboard/usage and feed the CSV to Wingman. Local `state.vscdb` is only a fallback.

Resolution lives in `prepareCursorUsageCsv()` in `cursor.ts` (CLI calls it after detect; when Cursor is **detected** or named in `--agents` — no CSV warnings otherwise):

1. `--cursor-usage-csv <path>` if provided
2. Else a single `usage-events*.csv` in the **working directory** (announced to the user)
3. Else if multiple `usage-events*.csv` in cwd → **fail** and ask the user to pass `--cursor-usage-csv` or delete unneeded files
4. Else **warn** and fall back to `state.vscdb`. The warning explains that local figures are usually much smaller/inaccurate (per-chat context snapshots, not cumulative billed usage), that the whole snapshot is mapped to `in` with `out`/`read`/`write` left at 0, and **strongly recommends** the dashboard CSV.

`~/.cursor/usage-events*.csv` is **not** scanned — that is not a conventional location for these exports.

If a resolved CSV’s newest event date (UTC) is older than `--until` / today, Wingman warns that the export may be stale.

Adapter collect priority:

1. Resolved usage-events CSV (full in/out/cache columns)
2. Else non-zero `bubbleId` `tokenCount` rows from `state.vscdb` (rare — usually `{0,0}`)
3. Else each composer’s `promptTokenBreakdown.totalUsedTokens` / `contextTokensUsed` (context-window snapshot → `input` only)

### Config inventory

Config reads skills (`skills-cursor` / `skills`), plugins (`plugins/cache` + `local`), MCP (`mcp.json` + plugin `.mcp.json`), and models from `cli-config.json`.
