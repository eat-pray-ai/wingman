import type { SectionResult, ShowcaseData } from "../../types.js";
import { svgText } from "../../svg/components.js";
import type { RenderContext } from "./context.js";
import { formatDateRange, separator } from "./helpers.js";

export function renderHeader(ctx: RenderContext, data: ShowcaseData, y: number): SectionResult {
  const startY = y;
  const parts: string[] = [];

  parts.push(
    svgText(ctx.padX, startY + 30, "Wingman Stats", {
      fill: ctx.colors.blue,
      size: 16,
      weight: "bold",
    }),
  );
  parts.push(
    svgText(ctx.cardWidth - ctx.padX, startY + 30, formatDateRange(data.period.since, data.period.until), {
      fill: ctx.colors.muted,
      size: 11,
      anchor: "end",
    }),
  );

  const endY = startY + 48;
  parts.push(separator(ctx, endY));

  return { svg: parts.join("\n"), height: endY - startY };
}
