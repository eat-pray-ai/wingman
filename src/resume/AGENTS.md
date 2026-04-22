# AGENTS.md — Resume (`src/resume/`)

Generates [rendercv](https://rendercv.com/)-compatible YAML from `ShowcaseData`.

## Files

| File | Purpose |
|---|---|
| `renderer.ts` | `generateResumeYaml()` — converts `ShowcaseData` + `ModelInfo` → YAML string |

## Key Exports

| Export | Purpose |
|---|---|
| `generateResumeYaml(data, modelInfo, opts)` | Main entry — produces rendercv YAML with `cv:` top-level key |
| `ResumeOptions` | Interface: required `name` and `headline` (defaults owned by Commander in `cli.ts`) |

## Résumé Sections

The YAML output contains four rendercv sections:

1. **summary** — agent count, total tokens, sessions, date range, cost
2. **experience** — one entry per agent (>1% token share), sorted by usage; highlights include model breakdowns
3. **education** — models grouped by AI lab (via `modelLab()`), degree = most expensive per-token model per group
4. **technologies** — inventory: plugins, MCP servers, skills

## Key Conventions

- YAML is built via pure string concatenation — no YAML library
- `yamlValue()` handles smart quoting (bare strings when safe, single-quoted when special chars present)
- `yamlValue()` allows markdown `**bold**` at string start (rendercv text formatting)
- Models with <=3M tokens or <=$1 cost are filtered out (`isSignificantModel()`)
- Agents with <=1% of total tokens are excluded from experience
- Education groups use `modelLab()` from `pricing/models-dev.ts` for lab derivation
