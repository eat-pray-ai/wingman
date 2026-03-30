import type {
  UsageRecord,
  AgentConfig,
  AgentSummary,
  ShowcaseData,
  PricingEngine,
} from "./types.js";
import { buildInventory } from "./inventory.js";

function sumTokens(record: UsageRecord): number {
  const t = record.tokens;
  return t.input + t.output + (t.cacheRead ?? 0) + (t.cacheWrite ?? 0) + (t.reasoning ?? 0);
}

function formatDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function aggregate(
  records: UsageRecord[],
  configs: Map<string, { displayName: string; config: AgentConfig }>,
  pricing: PricingEngine,
  since: Date,
  until: Date,
): ShowcaseData {
  // 1. Group records by agent
  const grouped = new Map<string, UsageRecord[]>();
  for (const record of records) {
    let list = grouped.get(record.agent);
    if (!list) {
      list = [];
      grouped.set(record.agent, list);
    }
    list.push(record);
  }

  // 2. Build AgentSummary for each agent
  const agents: AgentSummary[] = [];

  for (const [agent, agentRecords] of grouped) {
    let totalTokens = 0;
    let totalCost = 0;
    let unknownCost = false;
    const sessions = new Set<string>();
    const models: Record<string, { tokens: number; cost: number }> = {};
    const dailyActivity: Record<string, number> = {};

    for (const record of agentRecords) {
      const tokens = sumTokens(record);
      const cost = pricing.calculateCost(record);

      if (pricing.resolve(record.model, record.provider) === null) {
        unknownCost = true;
      }

      totalTokens += tokens;
      totalCost += cost;

      if (record.sessionId) {
        sessions.add(record.sessionId);
      }

      // Per-model aggregation
      if (!models[record.model]) {
        models[record.model] = { tokens: 0, cost: 0 };
      }
      models[record.model].tokens += tokens;
      models[record.model].cost += cost;

      // Daily activity
      const day = formatDay(record.timestamp);
      dailyActivity[day] = (dailyActivity[day] ?? 0) + tokens;
    }

    const entry = configs.get(agent);
    const displayName = entry?.displayName ?? agent;
    const config = entry?.config ?? { mcpServers: [], plugins: [], models: [], skills: [] };

    agents.push({
      agent,
      displayName,
      totalTokens,
      totalCost,
      unknownCost,
      sessionCount: sessions.size,
      models,
      dailyActivity,
      config,
    });
  }

  // 3. Sort by totalTokens descending
  agents.sort((a, b) => b.totalTokens - a.totalTokens);

  // 4. Calculate totals (with token breakdown)
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  for (const record of records) {
    totalInput += record.tokens.input;
    totalOutput += record.tokens.output;
    totalCacheRead += record.tokens.cacheRead ?? 0;
    totalCacheWrite += record.tokens.cacheWrite ?? 0;
  }

  const totals = {
    tokens: agents.reduce((sum, a) => sum + a.totalTokens, 0),
    inputTokens: totalInput,
    outputTokens: totalOutput,
    cacheReadTokens: totalCacheRead,
    cacheWriteTokens: totalCacheWrite,
    cost: agents.reduce((sum, a) => sum + a.totalCost, 0),
    sessions: agents.reduce((sum, a) => sum + a.sessionCount, 0),
  };

  // 5. Per-model daily activity (across all agents)
  const modelDailyActivity: Record<string, Record<string, number>> = {};
  for (const record of records) {
    const day = formatDay(record.timestamp);
    const tokens = sumTokens(record);
    if (!modelDailyActivity[record.model]) {
      modelDailyActivity[record.model] = {};
    }
    modelDailyActivity[record.model][day] = (modelDailyActivity[record.model][day] ?? 0) + tokens;
  }

  // 6. Build hierarchical inventory
  const inventory = buildInventory(agents);

  // 7. Return ShowcaseData
  return {
    period: { since, until },
    agents,
    totals,
    modelDailyActivity,
    inventory,
  };
}
