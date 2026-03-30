# AGENTS.md — Pricing (`src/pricing/`)

Resolves model costs and metadata via the [models.dev](https://models.dev) API to estimate spend and enrich model information.

## Files

| File | Purpose |
|---|---|
| `engine.ts` | `createPricingEngine()` — async factory returning a `PricingEngine` with `resolve()` and `calculateCost()` |
| `models-dev.ts` | `fetchModelPricing()` — fetches pricing data; `fetchModelInfo()` — fetches model metadata (`ModelInfo`); 24h disk cache at `~/.cache/wingman/` |

## Key Exports from `models-dev.ts`

| Export | Purpose |
|---|---|
| `fetchModelPricing()` | Returns `ModelPricing[]` for the pricing engine |
| `fetchModelInfo()` | Returns `Map<string, ModelInfo>` — model metadata (name, lab, modalities, capabilities, dates) |
| `modelLab(familyOrId)` | Derives AI lab name from model family prefix via `FAMILY_TO_LAB` mapping |
| `ModelInfo` | Interface: `id`, `name`, `family`, `provider`, `lab`, `releaseDate`, `knowledge`, `modalities`, `capabilities`, `limits` |
| `FAMILY_TO_LAB` | Data-driven mapping from model family prefix → official AI lab (30+ entries: `claude→Anthropic`, `gpt→OpenAI`, `gemini→Google`, etc.) |

## Resolution Priority (4-tier fallback)

1. Caller-supplied overrides (exact `modelId + provider`)
2. Exact match from models.dev catalog (`modelId + provider`)
3. Exact `modelId` match from catalog (any provider)
4. Fuzzy match via `normalizeModelId()` — strips `-preview`, date stamps, version suffixes
5. `null` (unknown — cost reported as 0, `unknownCost` flag set on agent summary)

## Key Conventions

- `normalizeModelId()` is exported for testing — strips `-preview`, `-YYYY-MM-DD`, `-YYYYMMDD`, `-v1`, `:latest`
- Cache uses an envelope: `{ fetchedAt: number; data: ModelsDevResponse }`
- Module-private interfaces (`ModelsDevCost`, `CacheEnvelope`) are not exported
- `createPricingEngine()` is an **async factory** returning a closure-based object (not a class)
- `ModelInfo.lab` is derived from model family prefix via `FAMILY_TO_LAB`, not from the API `provider` field (which gives third-party distributors, not official AI labs)
