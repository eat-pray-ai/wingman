import type { ShowcaseData, AgentSummary } from "../types.js";
import { type ModelInfo, modelLab } from "../pricing/models-dev.js";

export interface ResumeOptions {
  name: string;
  headline: string;
}

/**
 * Quote a YAML string only when necessary.
 * Uses single quotes when quoting is needed (just double any embedded ').
 * Matches rendercv example style: bare strings for simple values.
 */
function yamlValue(s: string): string {
  if (s.length === 0) return '""';
  const reserved = /^(true|false|null|yes|no|on|off)$/i;
  if (reserved.test(s)) return `'${s}'`;
  // Must quote if: starts with special YAML indicator, or contains chars that
  // break YAML flow: colon-space, hash-space, commas, braces, etc.
  // Note: * is allowed when followed by another * (markdown bold/italic)
  if (
    /^[\s&?|>'"{}\[\]]/.test(s) ||
    /^\*[^*]/.test(s) ||
    /^-\s/.test(s) ||
    s.includes(": ") ||
    s.includes(" #") ||
    s.includes(", ") ||
    s.includes("\n")
  ) {
    return `'${s.replace(/'/g, "''")}'`;
  }
  return s;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

function formatDateYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}


function agentDateRange(
  agent: AgentSummary,
  fallbackSince: Date,
  fallbackUntil: Date,
): { start: string; end: string } {
  const days = Object.keys(agent.dailyActivity).sort();
  if (days.length === 0) {
    return { start: formatDateYMD(fallbackSince), end: formatDateYMD(fallbackUntil) };
  }
  return { start: days[0], end: days[days.length - 1] };
}

function positionLabel(index: number, pct: string): string {
  if (index === 0) return `Primary Agent (${pct}%)`;
  if (index === 1) return `Secondary Agent (${pct}%)`;
  return `Supporting Agent (${pct}%)`;
}

const MIN_MODEL_TOKENS = 3_000_000;
const MIN_MODEL_COST = 1.0;

function isSignificantModel(tokens: number, cost: number): boolean {
  return tokens > MIN_MODEL_TOKENS && cost > MIN_MODEL_COST;
}

/** Collect all unique models across all agents, sorted by total tokens desc */
function collectModels(
  data: ShowcaseData,
): { modelId: string; tokens: number; cost: number }[] {
  const map = new Map<string, { tokens: number; cost: number }>();
  for (const agent of data.agents) {
    for (const [modelId, stats] of Object.entries(agent.models)) {
      const existing = map.get(modelId);
      if (existing) {
        existing.tokens += stats.tokens;
        existing.cost += stats.cost;
      } else {
        map.set(modelId, { tokens: stats.tokens, cost: stats.cost });
      }
    }
  }
  return [...map.entries()]
    .map(([modelId, s]) => ({ modelId, ...s }))
    .filter((m) => isSignificantModel(m.tokens, m.cost))
    .sort((a, b) => b.tokens - a.tokens);
}

function renderSummary(data: ShowcaseData, indent: string): string[] {
  const lines: string[] = [];
  const agentCount = data.agents.length;
  const totalTokens = formatTokens(data.totals.tokens);
  const sessions = data.totals.sessions;
  const since = formatDateYMD(data.period.since);
  const until = formatDateYMD(data.period.until);
  const cost = formatCost(data.totals.cost);

  lines.push(`${indent}summary:`);
  lines.push(`${indent}  - ${yamlValue(`AI agent team of **${agentCount} agents**, processing **${totalTokens} tokens** across **${sessions} sessions** from ${since} to ${until}. Total cost: **${cost}**.`)}`);
  return lines;
}

function renderExperience(data: ShowcaseData, indent: string): string[] {
  const lines: string[] = [];
  lines.push(`${indent}experience:`);

  const totalTokens = data.totals.tokens;
  let rank = 0;

  for (let i = 0; i < data.agents.length; i++) {
    const agent = data.agents[i];
    const pctNum = totalTokens > 0 ? (agent.totalTokens / totalTokens) * 100 : 0;
    if (pctNum <= 1) continue;
    const pct = pctNum.toFixed(1);
    const position = positionLabel(rank++, pct);
    const { start, end } = agentDateRange(agent, data.period.since, data.period.until);

    lines.push(`${indent}  - company: ${yamlValue(agent.displayName)}`);
    lines.push(`${indent}    position: ${yamlValue(position)}`);
    lines.push(`${indent}    start_date: ${yamlValue(start)}`);
    lines.push(`${indent}    end_date: ${yamlValue(end)}`);
    lines.push(`${indent}    highlights:`);
    lines.push(`${indent}      - ${yamlValue(`Processed **${formatTokens(agent.totalTokens)} tokens** across **${agent.sessionCount} sessions**, **${formatCost(agent.totalCost)}** total`)}`);

    // Model breakdown (only significant models)
    const modelEntries = Object.entries(agent.models)
      .filter(([, s]) => isSignificantModel(s.tokens, s.cost))
      .sort(([, a], [, b]) => b.tokens - a.tokens);
    if (modelEntries.length > 0) {
      const modelParts = modelEntries.map(([id, s]) => `**${id}** (${formatTokens(s.tokens)})`);
      lines.push(`${indent}      - ${yamlValue(`Models: ${modelParts.join(", ")}`)}`);
    }
  }

  return lines;
}

function renderEducation(
  data: ShowcaseData,
  modelInfo: Map<string, ModelInfo>,
  indent: string,
): string[] {
  const lines: string[] = [];
  const models = collectModels(data);

  if (models.length === 0) return [];

  // Group models by AI lab
  const groups = new Map<string, typeof models>();
  for (const m of models) {
    const info = modelInfo.get(m.modelId);
    const lab = info?.lab ?? modelLab(m.modelId);
    const group = groups.get(lab) ?? [];
    group.push(m);
    groups.set(lab, group);
  }

  lines.push(`${indent}education:`);

  for (const [company, groupModels] of groups) {
    // Merge modalities across all models in the group
    const allInputs = new Set<string>();
    const allOutputs = new Set<string>();
    let earliestKnowledge: string | undefined;
    let latestRelease: string | undefined;

    for (const m of groupModels) {
      const info = modelInfo.get(m.modelId);
      if (info?.modalities) {
        for (const i of info.modalities.input) allInputs.add(i);
        for (const o of info.modalities.output) allOutputs.add(o);
      }
      if (info?.knowledge && (!earliestKnowledge || info.knowledge < earliestKnowledge)) {
        earliestKnowledge = info.knowledge;
      }
      if (info?.releaseDate && (!latestRelease || info.releaseDate > latestRelease)) {
        latestRelease = info.releaseDate;
      }
    }

    const area = allInputs.size > 0
      ? [...allInputs].join(", ")
      : "Language Models";

    // Most expensive model (highest per-token cost) as degree — represents the most capable model
    const premium = [...groupModels].sort((a, b) =>
      (b.tokens > 0 ? b.cost / b.tokens : 0) - (a.tokens > 0 ? a.cost / a.tokens : 0)
    )[0];
    const primaryInfo = modelInfo.get(premium.modelId);
    const degree = primaryInfo ? primaryInfo.name : premium.modelId;

    lines.push(`${indent}  - institution: ${yamlValue(company)}`);
    lines.push(`${indent}    area: ${yamlValue(area)}`);
    lines.push(`${indent}    degree: ${yamlValue(degree)}`);
    if (earliestKnowledge) {
      lines.push(`${indent}    start_date: ${yamlValue(earliestKnowledge)}`);
    }
    if (latestRelease) {
      lines.push(`${indent}    end_date: ${yamlValue(latestRelease)}`);
    } else {
      lines.push(`${indent}    end_date: present`);
    }

    lines.push(`${indent}    highlights:`);
    for (const m of groupModels) {
      const info = modelInfo.get(m.modelId);
      const name = info ? info.name : m.modelId;
      lines.push(`${indent}      - ${yamlValue(`**${name}**: ${formatTokens(m.tokens)} tokens, ${formatCost(m.cost)}`)}`);
    }
  }

  return lines;
}

function renderTechnologies(data: ShowcaseData, indent: string): string[] {
  const lines: string[] = [];
  const categories: { label: string; items: string[] }[] = [];

  if (data.inventory.plugins.length > 0) {
    const items = data.inventory.plugins.map((p) =>
      p.version ? `${p.name} v${p.version}` : p.name
    );
    categories.push({ label: "Plugins", items });
  }

  if (data.inventory.mcpServers.length > 0) {
    categories.push({
      label: "MCP Servers",
      items: data.inventory.mcpServers.map((s) => s.name),
    });
  }

  if (data.inventory.skills.length > 0) {
    categories.push({
      label: "Skills",
      items: data.inventory.skills.map((s) => s.name),
    });
  }

  if (categories.length === 0) return [];

  lines.push(`${indent}technologies:`);
  for (const cat of categories) {
    lines.push(`${indent}  - label: ${yamlValue(cat.label)}`);
    lines.push(`${indent}    details: ${yamlValue(cat.items.join(", "))}`);
  }

  return lines;
}

export function generateResumeYaml(
  data: ShowcaseData,
  modelInfo: Map<string, ModelInfo>,
  opts: ResumeOptions,
): string {
  const { name, headline } = opts;
  const indent = "    ";

  const lines: string[] = [];
  lines.push("cv:");
  lines.push(`  name: ${yamlValue(name)}`);
  lines.push(`  headline: ${yamlValue(headline)}`);
  lines.push("  sections:");

  lines.push(...renderSummary(data, indent));
  lines.push(...renderExperience(data, indent));
  lines.push(...renderEducation(data, modelInfo, indent));
  lines.push(...renderTechnologies(data, indent));

  return lines.join("\n") + "\n";
}
