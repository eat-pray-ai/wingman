# AGENTS.md — Source (`src/`)

Top-level source modules and how they connect. For code style and patterns, see [docs/AGENTS.md](../docs/AGENTS.md).

## Pipeline

```
CLI (cli.ts) → Agent Adapters → UsageRecord[] → Aggregator → ShowcaseData → Renderer → SVG / YAML
```

Two commands share the same pipeline up to `ShowcaseData`:
- `card` → Theme Renderer → SVG
- `resume` → Resume Renderer → rendercv YAML

## Modules

| File | Purpose |
|---|---|
| `types.ts` | All shared interfaces — single source of truth for data shapes |
| `cli.ts` | Commander entry point, orchestrates `card` and `resume` commands |
| `aggregator.ts` | Groups `UsageRecord[]` by agent, computes totals → `ShowcaseData` |
| `inventory.ts` | Merges plugin/skill/MCP data across agents into `Inventory` |

## Sub-modules

| Directory | Guide | Purpose |
|---|---|---|
| `agents/` | [AGENTS.md](agents/AGENTS.md) | One adapter per AI agent (Claude Code, opencode, Gemini CLI, Codex) |
| `themes/` | [AGENTS.md](themes/AGENTS.md) | Theme renderers — converts `ShowcaseData` → SVG string |
| `svg/` | [AGENTS.md](svg/AGENTS.md) | Reusable SVG primitives (text, rect, sparkline, donut, pill) |
| `pricing/` | [AGENTS.md](pricing/AGENTS.md) | Model cost resolution and metadata via models.dev API |
| `resume/` | — | Resume YAML renderer — converts `ShowcaseData` → rendercv YAML |

## Extension Points

**Add an agent**: Create `agents/my-agent.ts` → register in `agents/registry.ts`. See [agents/AGENTS.md](agents/AGENTS.md).

**Add a theme**: Create `themes/my-theme/index.ts` → register in `themes/registry.ts`. See [themes/AGENTS.md](themes/AGENTS.md).

## Key Types (from `types.ts`)

| Interface | Role |
|---|---|
| `UsageRecord` | Normalized per-interaction record from any agent adapter |
| `AgentAdapter` | Contract: `detect()`, `collect()`, `config()` |
| `AgentConfig` | MCP servers, plugins, models, skills for one agent |
| `ShowcaseData` | Aggregated stats consumed by theme renderers |
| `ThemeRenderer` | Contract: `name`, `render(data) → SVG string` |
| `PricingEngine` | `resolve(modelId)` + `calculateCost(record)` |
| `SectionResult` | `{ svg: string; height: number }` — returned by each theme section |
