import type { ModelPricing, PricingEngine, UsageRecord } from "../types.js";
import { fetchModelPricing, normalizeModelId } from "./models-dev.js";

/**
 * Create a PricingEngine that resolves model pricing using:
 *   1. Caller-supplied overrides (exact modelId + provider)
 *   2. Exact match from models.dev (modelId + provider)
 *   3. Exact modelId match from models.dev (any provider)
 *   4. Fuzzy (normalized) modelId match from models.dev
 *   5. null
 */
export async function createPricingEngine(
  overrides?: ModelPricing[],
): Promise<PricingEngine> {
  const catalog = await fetchModelPricing();

  // Index overrides by "modelId::provider" for fast exact lookup
  const overrideMap = new Map<string, ModelPricing>();
  if (overrides) {
    for (const o of overrides) {
      overrideMap.set(`${o.modelId}::${o.provider}`, o);
    }
  }

  // Build a normalized-id index for fuzzy fallback
  const normalizedIndex = new Map<string, ModelPricing[]>();
  for (const [modelId, pricings] of catalog) {
    const key = normalizeModelId(modelId);
    const existing = normalizedIndex.get(key);
    if (existing) {
      existing.push(...pricings);
    } else {
      normalizedIndex.set(key, [...pricings]);
    }
  }

  function resolve(modelId: string, provider?: string): ModelPricing | null {
    // 1. Overrides — exact modelId + provider
    if (provider) {
      const override = overrideMap.get(`${modelId}::${provider}`);
      if (override) return override;
    }

    // 2. Exact match from catalog — modelId + provider
    const exactEntries = catalog.get(modelId);
    if (exactEntries && provider) {
      const match = exactEntries.find((p) => p.provider === provider);
      if (match) return match;
    }

    // 3. Exact modelId match — any provider
    if (exactEntries && exactEntries.length > 0) {
      // Prefer the provider match if available, otherwise take the first
      return exactEntries[0];
    }

    // 4. Fuzzy match using normalized model ID
    const normalized = normalizeModelId(modelId);
    const fuzzyEntries = normalizedIndex.get(normalized);
    if (fuzzyEntries && fuzzyEntries.length > 0) {
      if (provider) {
        const match = fuzzyEntries.find((p) => p.provider === provider);
        if (match) return match;
      }
      return fuzzyEntries[0];
    }

    // 5. Not found
    return null;
  }

  function calculateCost(record: UsageRecord): number {
    const pricing = resolve(record.model, record.provider);
    if (!pricing) return 0;

    const { tokens } = record;
    const input = tokens.input * pricing.inputPerMillion;
    const output = tokens.output * pricing.outputPerMillion;
    const cacheRead = (tokens.cacheRead ?? 0) * (pricing.cacheReadPerMillion ?? 0);
    const cacheWrite = (tokens.cacheWrite ?? 0) * (pricing.cacheWritePerMillion ?? 0);

    return (input + output + cacheRead + cacheWrite) / 1_000_000;
  }

  return { resolve, calculateCost };
}
