export interface UsageRecord {
  agent: string;
  model: string;
  provider?: string;
  timestamp: Date;
  tokens: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
    reasoning?: number;
  };
  sessionId?: string;
}

export interface AgentConfig {
  mcpServers: string[];
  plugins: PluginInfo[];
  models: string[];
  skills: string[];
}

export interface PluginInfo {
  name: string;
  version?: string;
  skills: string[];
  agents: string[];
  commands: string[];
  sources: string[];   // which agent adapters have this plugin
}

export interface InventoryItem {
  name: string;
  sources: string[];   // which agent adapters have this item
}

/** Optional knobs passed from the CLI into adapter.collect(). */
export interface CollectOptions {
  /** Path to a Cursor dashboard usage-events CSV export */
  cursorUsageCsv?: string;
}

export interface AgentAdapter {
  name: string;
  displayName: string;
  detect(): Promise<boolean>;
  collect(since: Date, until: Date, options?: CollectOptions): Promise<UsageRecord[]>;
  config(): Promise<AgentConfig>;
}

export interface ModelPricing {
  modelId: string;
  provider: string;
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion?: number;
  cacheWritePerMillion?: number;
}

export interface PricingEngine {
  resolve(modelId: string, provider?: string): ModelPricing | null;
  calculateCost(record: UsageRecord): number;
}

export interface AgentSummary {
  agent: string;
  displayName: string;
  totalTokens: number;
  totalCost: number;
  unknownCost: boolean;
  sessionCount: number;
  models: Record<string, { tokens: number; cost: number }>;
  dailyActivity: Record<string, number>;
  config: AgentConfig;
}

export interface ShowcaseData {
  period: { since: Date; until: Date };
  agents: AgentSummary[];
  totals: {
    tokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    cost: number;
    sessions: number;
  };
  /** Per-model daily activity: modelId → date → token count */
  modelDailyActivity: Record<string, Record<string, number>>;
  inventory: Inventory;
}

export interface Inventory {
  plugins: PluginInfo[];
  mcpServers: InventoryItem[];   // dangling (not bundled by a plugin)
  skills: InventoryItem[];       // dangling (not bundled by a plugin)
}

export interface RenderOptions {
  sections?: string[];
}

export interface ThemeRenderer {
  name: string;
  render(data: ShowcaseData, opts?: RenderOptions): string;
}

export interface SectionResult {
  svg: string;
  height: number;
}
