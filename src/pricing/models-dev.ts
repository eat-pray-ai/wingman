import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ModelPricing } from "../types.js";

const MODELS_DEV_URL = "https://models.dev/api.json";
const CACHE_DIR = join(homedir(), ".cache", "wingman");
const CACHE_FILE = join(CACHE_DIR, "models.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface ModelInfo {
  id: string;
  name: string;
  family?: string;
  /** The API provider/distributor (e.g., "abacus", "nano-gpt") */
  provider: string;
  /** The official AI lab that created the model (e.g., "Anthropic", "Google") */
  lab: string;
  releaseDate?: string;
  knowledge?: string;
  modalities?: {
    input: string[];
    output: string[];
  };
  capabilities: string[];
  limits?: {
    context?: number;
    output?: number;
  };
}

/** Maps model family prefixes to the official AI lab name */
const FAMILY_TO_LAB: Record<string, string> = {
  claude: "Anthropic",
  gemini: "Google",
  gemma: "Google",
  gpt: "OpenAI",
  o: "OpenAI",
  dall: "OpenAI",
  sora: "OpenAI",
  deepseek: "DeepSeek",
  qwen: "Alibaba",
  llama: "Meta",
  mistral: "Mistral",
  mixtral: "Mistral",
  codestral: "Mistral",
  devstral: "Mistral",
  pixtral: "Mistral",
  ministral: "Mistral",
  magistral: "Mistral",
  command: "Cohere",
  grok: "xAI",
  phi: "Microsoft",
  nova: "Amazon",
  titan: "Amazon",
  imagen: "Google",
  glm: "Zhipu",
  kimi: "Moonshot",
  minimax: "MiniMax",
  ernie: "Baidu",
  hunyuan: "Tencent",
  jamba: "AI21",
  nemotron: "NVIDIA",
  granite: "IBM",
};

/** Derive the official AI lab from a model's family prefix */
export function modelLab(familyOrId: string): string {
  const prefix = familyOrId.split("-")[0];
  return FAMILY_TO_LAB[prefix] ?? "AI";
}

interface ModelsDevCost {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
}

interface ModelsDevModel {
  id: string;
  cost?: ModelsDevCost;
  [key: string]: unknown;
}

interface ModelsDevProvider {
  id: string;
  models: Record<string, ModelsDevModel>;
  [key: string]: unknown;
}

type ModelsDevResponse = Record<string, ModelsDevProvider>;

interface CacheEnvelope {
  fetchedAt: number;
  data: ModelsDevResponse;
}

/**
 * Normalize a model ID for fuzzy matching by stripping preview suffixes,
 * date suffixes (-YYYY-MM-DD or -YYYYMMDD), and trailing version suffixes.
 */
export function normalizeModelId(id: string): string {
  let normalized = id;

  // Strip "-preview" suffix (with optional trailing content like "-preview-2024-01-01")
  normalized = normalized.replace(/-preview(?:-.*)?$/, "");

  // Strip date suffixes: -YYYY-MM-DD or -YYYYMMDD
  normalized = normalized.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  normalized = normalized.replace(/-\d{8}$/, "");

  // Strip trailing version suffixes like -v1, -v2, :latest, :v1.5
  normalized = normalized.replace(/[:-]v[\d.]+$/, "");
  normalized = normalized.replace(/:latest$/, "");

  return normalized;
}

async function readCache(): Promise<ModelsDevResponse | null> {
  try {
    const raw = await readFile(CACHE_FILE, "utf-8");
    const envelope: CacheEnvelope = JSON.parse(raw);
    if (Date.now() - envelope.fetchedAt < CACHE_TTL_MS) {
      return envelope.data;
    }
  } catch {
    // Cache miss or corrupt — fall through
  }
  return null;
}

async function writeCache(data: ModelsDevResponse): Promise<void> {
  const envelope: CacheEnvelope = { fetchedAt: Date.now(), data };
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(envelope), "utf-8");
  } catch {
    // Non-fatal — we can always re-fetch
  }
}

async function fetchFromApi(): Promise<ModelsDevResponse> {
  const res = await fetch(MODELS_DEV_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch models.dev: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as ModelsDevResponse;
}

/**
 * Fetch model pricing data from models.dev (with 24h disk cache).
 *
 * Returns a Map keyed by modelId. Each value is an array of ModelPricing
 * objects — one per provider that offers the model.
 */
export async function fetchModelPricing(): Promise<Map<string, ModelPricing[]>> {
  let data = await readCache();
  if (!data) {
    data = await fetchFromApi();
    await writeCache(data);
  }

  const result = new Map<string, ModelPricing[]>();

  for (const [provider, providerData] of Object.entries(data)) {
    const models = providerData?.models;
    if (!models || typeof models !== "object") continue;

    for (const [modelId, model] of Object.entries(models)) {
      if (!model?.cost) continue;

      const pricing: ModelPricing = {
        modelId,
        provider,
        inputPerMillion: model.cost.input ?? 0,
        outputPerMillion: model.cost.output ?? 0,
        ...(model.cost.cache_read != null && { cacheReadPerMillion: model.cost.cache_read }),
        ...(model.cost.cache_write != null && { cacheWritePerMillion: model.cost.cache_write }),
      };

      const existing = result.get(modelId);
      if (existing) {
        existing.push(pricing);
      } else {
        result.set(modelId, [pricing]);
      }
    }
  }

  return result;
}

/**
 * Fetch model metadata from models.dev (reuses same 24h disk cache).
 *
 * Returns a Map keyed by model ID. Uses the same normalized-ID fallback
 * as the pricing engine for fuzzy matching.
 */
export async function fetchModelInfo(): Promise<Map<string, ModelInfo>> {
  let data = await readCache();
  if (!data) {
    data = await fetchFromApi();
    await writeCache(data);
  }

  const result = new Map<string, ModelInfo>();

  for (const [providerId, providerData] of Object.entries(data)) {
    const models = providerData?.models;
    if (!models || typeof models !== "object") continue;

    for (const [modelId, model] of Object.entries(models)) {
      const raw = model as Record<string, unknown>;
      const family = typeof raw.family === "string" ? raw.family : modelId;
      const info: ModelInfo = {
        id: modelId,
        name: (raw.name as string) ?? modelId,
        provider: providerId,
        lab: modelLab(family),
        capabilities: Array.isArray(raw.capabilities) ? raw.capabilities : [],
      };

      if (typeof raw.family === "string") info.family = raw.family;
      if (typeof raw.release_date === "string") info.releaseDate = raw.release_date;
      if (typeof raw.knowledge === "string") info.knowledge = raw.knowledge;

      const mod = raw.modalities as Record<string, unknown> | undefined;
      if (mod && Array.isArray(mod.input) && Array.isArray(mod.output)) {
        info.modalities = { input: mod.input, output: mod.output };
      }

      const lim = raw.limits as Record<string, unknown> | undefined;
      if (lim && typeof lim === "object") {
        const limits: { context?: number; output?: number } = {};
        if (typeof lim.context === "number") limits.context = lim.context;
        if (typeof lim.output === "number") limits.output = lim.output;
        if (limits.context !== undefined || limits.output !== undefined) {
          info.limits = limits;
        }
      }

      result.set(modelId, info);

      const normalized = normalizeModelId(modelId);
      if (normalized !== modelId && !result.has(normalized)) {
        result.set(normalized, info);
      }
    }
  }

  return result;
}
