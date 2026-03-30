import type { SectionResult, ShowcaseData } from "../../types.js";
import { formatCost, formatNumber, svgText } from "../../svg/components.js";
import { ICONS, svgIcon } from "../../svg/icons.js";
import type { RenderContext } from "./context.js";
import { separator } from "./helpers.js";

export function renderTopStats(ctx: RenderContext, data: ShowcaseData, y: number): SectionResult {
  const startY = y;
  const parts: string[] = [];
  const colWidth = ctx.contentWidth / 3;

  const col1x = ctx.padX;
  parts.push(svgIcon(col1x, startY + 11, ICONS.hash, { fill: ctx.colors.secondary, size: 11 }));
  parts.push(
    svgText(col1x + 14, startY + 22, "TOTAL TOKENS", { fill: ctx.colors.secondary, size: 11 }),
  );
  parts.push(
    svgText(col1x, startY + 52, formatNumber(data.totals.tokens), {
      fill: ctx.colors.primary,
      size: 28,
      weight: "bold",
    }),
  );

  const breakdown = `${formatNumber(data.totals.inputTokens)} in / ${formatNumber(data.totals.outputTokens)} out / ${formatNumber(data.totals.cacheReadTokens)} read / ${formatNumber(data.totals.cacheWriteTokens)} write`;
  parts.push(
    svgText(col1x, startY + 66, breakdown, { fill: ctx.colors.secondary, size: 10 }),
  );

  const col2x = ctx.padX + colWidth;
  parts.push(svgIcon(col2x, startY + 11, ICONS.currencyDollar, { fill: ctx.colors.secondary, size: 11 }));
  parts.push(
    svgText(col2x + 14, startY + 22, "TOTAL COST", { fill: ctx.colors.secondary, size: 11 }),
  );
  parts.push(
    svgText(col2x, startY + 52, formatCost(data.totals.cost), {
      fill: ctx.colors.green,
      size: 28,
      weight: "bold",
    }),
  );

  const col3x = ctx.padX + colWidth * 2;
  parts.push(svgIcon(col3x, startY + 11, ICONS.terminal, { fill: ctx.colors.secondary, size: 11 }));
  parts.push(
    svgText(col3x + 14, startY + 22, "SESSIONS", { fill: ctx.colors.secondary, size: 11 }),
  );
  parts.push(
    svgText(col3x, startY + 52, formatNumber(data.totals.sessions), {
      fill: ctx.colors.purple,
      size: 28,
      weight: "bold",
    }),
  );

  const endY = startY + 72;
  parts.push(separator(ctx, endY));

  return { svg: parts.join("\n"), height: endY - startY };
}
