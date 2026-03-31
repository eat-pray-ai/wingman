import type { SectionResult, ShowcaseData } from "../../types.js";
import { escapeXml, svgCircle, svgRect, svgText } from "../../svg/components.js";
import type { RenderContext } from "./context.js";
import { separator, topModels } from "./helpers.js";

const OTHERS_ID = "__others__";

export function renderLegend(ctx: RenderContext, data: ShowcaseData, y: number): SectionResult {
  const startY = y + 8;
  const parts: string[] = [];
  const agents = data.agents.slice(0, 6);
  const top5 = topModels(data, 5);
  const topIds = new Set(top5.map((m) => m.id));

  // Check if any displayed agent has tokens in models outside the top 5
  let hasOthers = false;
  for (const agent of agents) {
    for (const [modelId, stats] of Object.entries(agent.models)) {
      if (stats.tokens > 0 && !topIds.has(modelId)) {
        hasOthers = true;
        break;
      }
    }
    if (hasOthers) break;
  }

  const models = hasOthers
    ? [...top5, { id: OTHERS_ID, tokens: 0, cost: 0 }]
    : top5;

  const agentRowH = 22;
  const modelRowH = 22;
  const agentCount = agents.length;
  const modelCount = models.length;

  const squareX = 200;
  const circleX = ctx.cardWidth - 200;
  const agentTextX = squareX - 10;
  const modelTextX = circleX + 14;

  const totalH = Math.max(agentCount, modelCount) * agentRowH;
  const agentStartY = startY + (totalH - agentCount * agentRowH) / 2;
  const modelStartY = startY + (totalH - modelCount * modelRowH) / 2;

  const modelYMap = new Map<string, number>();
  models.forEach((m, i) => {
    modelYMap.set(m.id, modelStartY + i * modelRowH + modelRowH / 2);
  });

  let maxPairTokens = 1;
  for (const agent of agents) {
    for (const [, stats] of Object.entries(agent.models)) {
      if (stats.tokens > maxPairTokens) maxPairTokens = stats.tokens;
    }
  }

  // Flow lines (behind labels)
  for (let ai = 0; ai < agents.length; ai++) {
    const agent = agents[ai];
    const agentColor = ctx.agentColors[ai % ctx.agentColors.length];
    const ay = agentStartY + ai * agentRowH + agentRowH / 2;
    const sx = squareX + 12;

    for (const [modelId, stats] of Object.entries(agent.models)) {
      if (stats.tokens <= 0) continue;
      const my = modelYMap.get(modelId) ?? modelYMap.get(OTHERS_ID);
      if (my === undefined) continue;

      const lineW = Math.max(0.5, (stats.tokens / maxPairTokens) * 8);
      const cx = circleX - 6;
      const midX = (sx + cx) / 2;
      parts.push(
        `<path d="M ${sx} ${ay} C ${midX} ${ay}, ${midX} ${my}, ${cx} ${my}" ` +
        `fill="none" stroke="${agentColor}" stroke-width="${lineW.toFixed(1)}" opacity="0.35"/>`,
      );
    }
  }

  // Agent labels + squares
  agents.forEach((agent, i) => {
    const cy = agentStartY + i * agentRowH + agentRowH / 2;
    const color = ctx.agentColors[i % ctx.agentColors.length];
    parts.push(svgRect(squareX, cy - 5, 10, 10, { fill: color, rx: 2 }));
    parts.push(
      svgText(agentTextX, cy + 4, escapeXml(agent.displayName), {
        fill: ctx.colors.primary,
        size: 11,
        anchor: "end",
      }),
    );
  });

  // Model labels + circles
  models.forEach((model, i) => {
    const cy = modelStartY + i * modelRowH + modelRowH / 2;
    const isOthers = model.id === OTHERS_ID;
    const color = isOthers ? ctx.colors.secondary : ctx.modelColors[i % ctx.modelColors.length];
    const label = isOthers
      ? "Others"
      : model.id.length > 24 ? model.id.slice(0, 24) + "\u2026" : model.id;
    parts.push(svgCircle(circleX, cy, 5, { fill: color }));
    parts.push(
      svgText(modelTextX, cy + 4, label, {
        fill: isOthers ? ctx.colors.secondary : ctx.colors.primary,
        size: 11,
      }),
    );
  });

  const endY = startY + totalH + 8;
  parts.push(separator(ctx, endY));

  return { svg: parts.join("\n"), height: endY - y };
}
