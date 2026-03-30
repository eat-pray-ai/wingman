import type { RenderOptions, ShowcaseData, ThemeRenderer } from "../../types.js";
import { svgRect } from "../../svg/components.js";
import { createContext } from "../shared/context.js";
import type { RenderContext } from "../shared/context.js";
import { ALL_SECTIONS } from "../shared/sections.js";
import { computeCardWidth, computePeriodSize } from "../shared/helpers.js";
import { renderEmpty } from "../shared/footer.js";
import { palette } from "./palette.js";

function wrapSvg(ctx: RenderContext, body: string, height: number): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ctx.cardWidth}" height="${height}" viewBox="0 0 ${ctx.cardWidth} ${height}">`,
    svgRect(0, 0, ctx.cardWidth, height, { fill: ctx.colors.bg, rx: 12, stroke: ctx.colors.border }),
    body,
    `</svg>`,
  ].join("\n");
}

function render(data: ShowcaseData, opts?: RenderOptions): string {
  if (data.agents.length === 0 || data.totals.tokens === 0) {
    const ctx = createContext(660, palette);
    return renderEmpty(ctx, data);
  }

  const { numWeeks, numDays } = computePeriodSize(data);
  const ctx = createContext(computeCardWidth(numWeeks, numDays), palette);

  const sections = opts?.sections
    ? ALL_SECTIONS.filter((s) => opts.sections!.includes(s.name))
    : ALL_SECTIONS;

  let y = 0;
  const parts: string[] = [];
  for (const section of sections) {
    const result = section.render(ctx, data, y);
    parts.push(result.svg);
    y += result.height;
  }

  return wrapSvg(ctx, parts.join("\n"), y);
}

export default {
  name: "onedark",
  render,
} satisfies ThemeRenderer;
