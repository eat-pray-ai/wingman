import type { SectionResult, ShowcaseData } from "../../types.js";
import { formatCost, formatNumber, svgDonut, svgRect, svgText } from "../../svg/components.js";
import { ICONS, svgIcon } from "../../svg/icons.js";
import type { RenderContext } from "./context.js";
import { separator, topModels } from "./helpers.js";

export function renderCharts(ctx: RenderContext, data: ShowcaseData, y: number): SectionResult {
  const startY = y;
  const parts: string[] = [];
  const agents = data.agents.slice(0, 6);
  const models = topModels(data, 5);

  // Left: Agent donut chart
  const donutRadius = 60;
  const donutInner = 38;
  const donutCx = ctx.padX + 16 + donutRadius;
  const donutCy = startY + 16 + donutRadius;

  parts.push(svgIcon(ctx.padX, startY + 5, ICONS.people, { fill: ctx.colors.secondary, size: 11 }));
  parts.push(
    svgText(ctx.padX + 14, startY + 16, "AGENTS", { fill: ctx.colors.secondary, size: 11 }),
  );

  const slices = agents.map((agent, i) => ({
    value: agent.totalTokens,
    color: ctx.agentColors[i % ctx.agentColors.length],
  }));
  parts.push(svgDonut(donutCx, donutCy, donutRadius, donutInner, slices, { bgFill: ctx.colors.bg }));

  parts.push(
    svgText(donutCx, donutCy - 6, formatNumber(data.totals.tokens), {
      fill: ctx.colors.primary,
      size: 14,
      weight: "bold",
      anchor: "middle",
    }),
  );
  parts.push(
    svgText(donutCx, donutCy + 10, "tokens", {
      fill: ctx.colors.secondary,
      size: 10,
      anchor: "middle",
    }),
  );

  // Agent legend (right of donut)
  const legendX = donutCx + donutRadius + 16;
  const legendRowH = 18;
  const totalTokens = data.totals.tokens || 1;
  const legendTopY = donutCy - (agents.length * legendRowH) / 2;
  agents.forEach((agent, i) => {
    const ly = legendTopY + i * legendRowH;
    const color = ctx.agentColors[i % ctx.agentColors.length];
    const pct = (agent.totalTokens / totalTokens * 100).toFixed(0);
    parts.push(svgRect(legendX, ly, 8, 8, { fill: color, rx: 2 }));
    parts.push(
      svgText(legendX + 14, ly + 8, `${pct}%  ${formatNumber(agent.totalTokens)}  ${formatCost(agent.totalCost)}`, {
        fill: ctx.colors.primary,
        size: 10,
      }),
    );
  });

  // Right: Top models bar chart
  const barAreaX = ctx.cardWidth / 2 + 20;
  const barMaxWidth = ctx.cardWidth - ctx.padX - barAreaX;
  const maxModelTokens = models.length > 0 ? models[0].tokens : 1;
  const barH = 18;
  const barGap = 6;

  parts.push(svgIcon(barAreaX, startY + 5, ICONS.trophy, { fill: ctx.colors.secondary, size: 11 }));
  parts.push(
    svgText(barAreaX + 14, startY + 16, "TOP MODELS", { fill: ctx.colors.secondary, size: 11 }),
  );

  models.forEach((model, i) => {
    const barY = startY + 28 + i * (barH + barGap);
    const color = ctx.modelColors[i % ctx.modelColors.length];
    const barW = Math.max(6, (Math.sqrt(model.tokens) / Math.sqrt(maxModelTokens)) * barMaxWidth);

    parts.push(svgRect(barAreaX, barY, barW, barH, { fill: color, rx: 4, opacity: 0.85 }));

    const statsLabel = `${formatNumber(model.tokens)}  ${formatCost(model.cost)}`;
    const statsCharW = 6.5;
    const statsW = statsLabel.length * statsCharW + 12;

    if (barW > statsW) {
      parts.push(
        svgText(barAreaX + 8, barY + 13, statsLabel, {
          fill: ctx.colors.bg,
          size: 11,
          weight: "bold",
        }),
      );
    } else {
      parts.push(
        svgText(barAreaX + barW + 6, barY + 13, statsLabel, {
          fill: ctx.colors.primary,
          size: 11,
        }),
      );
    }
  });

  const donutWithLegendH = donutRadius * 2 + 20;
  const modelsH = models.length * (barH + barGap) + 30;
  const chartH = Math.max(donutWithLegendH, modelsH);
  const endY = startY + chartH;
  parts.push(separator(ctx, endY));

  return { svg: parts.join("\n"), height: endY - startY };
}
