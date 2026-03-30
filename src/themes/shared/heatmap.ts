import type { SectionResult, ShowcaseData } from "../../types.js";
import { svgRect, svgText } from "../../svg/components.js";
import { ICONS, svgIcon } from "../../svg/icons.js";
import type { RenderContext } from "./context.js";
import { separator, topModels } from "./helpers.js";

export function renderActivityHeatmap(ctx: RenderContext, data: ShowcaseData, y: number): SectionResult {
  const startY = y;
  const parts: string[] = [];
  const agents = data.agents.slice(0, 6);
  const models = topModels(data, 5);

  // Generate ALL days in the period (since → until), with min 60 days
  const MIN_HEATMAP_DAYS = 60;
  const periodStart = new Date(data.period.since);
  periodStart.setHours(0, 0, 0, 0);
  const periodEnd = new Date(data.period.until);
  periodEnd.setHours(23, 59, 59, 999);
  const periodDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000) + 1;

  // If period < 60 days, extend start backwards
  const heatmapStart = new Date(periodStart);
  if (periodDays < MIN_HEATMAP_DAYS) {
    heatmapStart.setDate(heatmapStart.getDate() - (MIN_HEATMAP_DAYS - periodDays));
  }
  heatmapStart.setHours(0, 0, 0, 0);

  const allDays: string[] = [];
  const cursor = new Date(heatmapStart);
  while (cursor <= periodEnd) {
    const y2 = cursor.getFullYear();
    const m2 = String(cursor.getMonth() + 1).padStart(2, "0");
    const d2 = String(cursor.getDate()).padStart(2, "0");
    allDays.push(`${y2}-${m2}-${d2}`);
    cursor.setDate(cursor.getDate() + 1);
  }

  if (allDays.length === 0) return { svg: "", height: 0 };

  parts.push(svgIcon(ctx.padX, startY + 5, ICONS.calendar3, { fill: ctx.colors.secondary, size: 11 }));
  parts.push(
    svgText(ctx.padX + 14, startY + 16, "ACTIVITY", { fill: ctx.colors.secondary, size: 11 }),
  );

  // ── Map every day to (col=week, row=dow) ──
  const firstDate = new Date(allDays[0] + "T00:00:00");
  const firstDow = (firstDate.getDay() + 6) % 7; // Mon=0..Sun=6

  const dayGrid = new Map<string, { col: number; row: number }>();
  let maxCol = 0;
  for (const day of allDays) {
    const date = new Date(day + "T00:00:00");
    const dow = (date.getDay() + 6) % 7;
    const daysSinceStart = Math.round((date.getTime() - firstDate.getTime()) / 86400000) + firstDow;
    const col = Math.floor(daysSinceStart / 7);
    dayGrid.set(day, { col, row: dow });
    if (col > maxCol) maxCol = col;
  }
  const numWeeks = maxCol + 1;

  // ── Flowing 3-column layout: [heatmap] [labels] [ratio] [bar chart] ──
  const gridX = ctx.padX;
  const cellGap = 2;
  const cellW = Math.min(16, Math.max(6, 12));
  const colStep = cellW + cellGap;
  const heatmapW = numWeeks * colStep - cellGap;

  const gapLR = 8;
  // --days 180 produces 181 allDays (inclusive), so use > 182 to cover that
  const isCompact = periodDays > 182; // N > ~180 days → ratio-only
  const labelColW = isCompact ? 28 : 28; // "Mon" is ~24px, keep tight
  const ratioColW = 38; // "18.4%" right-aligned
  const labelX = gridX + heatmapW + gapLR;
  const labelCenterX = labelX + labelColW / 2;
  const ratioEndX = labelX + labelColW + ratioColW;

  // Bar chart: flowing after ratio, dynamic width
  const barStartX = ratioEndX + 4;
  const availableBarW = ctx.cardWidth - ctx.padX - barStartX;
  // 1x base = 80px, max 2x = 160px, capped by available space
  const baseBarW = 80;
  const barChartW = isCompact ? 0 : Math.max(baseBarW, Math.min(baseBarW * 2, availableBarW));

  const heatLineH = 10;
  const heatLineGap = 2;
  const mainCellH = cellW; // square cells
  const mainCellGap = 2;
  const rowStep = mainCellH + mainCellGap;

  // ── Aggregate weekly totals per agent & model ──
  const agentWeekly = agents.map((agent) => {
    const weekly = Array<number>(numWeeks).fill(0);
    for (const [day, tokens] of Object.entries(agent.dailyActivity)) {
      const pos = dayGrid.get(day);
      if (pos) weekly[pos.col] += tokens;
    }
    return weekly;
  });

  const modelWeekly = models.map((model) => {
    const weekly = Array<number>(numWeeks).fill(0);
    const activity = data.modelDailyActivity[model.id] ?? {};
    for (const day of allDays) {
      const pos = dayGrid.get(day);
      if (pos) weekly[pos.col] += activity[day] ?? 0;
    }
    return weekly;
  });

  // ── Compute DOW totals for bar chart / ratio ──
  const dowTotals = Array<number>(7).fill(0);
  for (const [day] of dayGrid) {
    const date = new Date(day + "T00:00:00");
    const dow = (date.getDay() + 6) % 7;
    let total = 0;
    for (const agent of agents) {
      total += agent.dailyActivity[day] ?? 0;
    }
    dowTotals[dow] += total;
  }
  const maxDowTotal = Math.max(...dowTotals, 1);
  const totalAllDow = dowTotals.reduce((s, v) => s + v, 0) || 1;

  let curY = startY + 28;

  // ── Heat-line row 1: top agent per week (solid fill + people icon) ──
  parts.push(svgIcon(labelX, curY + 1, ICONS.people, { fill: ctx.colors.muted, size: 9 }));
  parts.push(
    svgText(labelX + 12, curY + 9, "Agent", { fill: ctx.colors.muted, size: 9 }),
  );
  for (let w = 0; w < numWeeks; w++) {
    let bestIdx = 0;
    let bestVal = 0;
    agentWeekly.forEach((weekly, i) => {
      if (weekly[w] > bestVal) { bestVal = weekly[w]; bestIdx = i; }
    });
    const color = ctx.agentColors[bestIdx % ctx.agentColors.length];
    const opacity = bestVal === 0 ? 0.08 : 0.85;
    parts.push(svgRect(gridX + w * colStep, curY, cellW, heatLineH, { fill: color, rx: 2, opacity }));
  }
  curY += heatLineH + heatLineGap;

  // ── Heat-line row 2: top model per week (solid fill + stars icon) ──
  parts.push(svgIcon(labelX, curY + 1, ICONS.stars, { fill: ctx.colors.muted, size: 9 }));
  parts.push(
    svgText(labelX + 12, curY + 9, "Model", { fill: ctx.colors.muted, size: 9 }),
  );
  for (let w = 0; w < numWeeks; w++) {
    let bestIdx = 0;
    let bestVal = 0;
    modelWeekly.forEach((weekly, i) => {
      if (weekly[w] > bestVal) { bestVal = weekly[w]; bestIdx = i; }
    });
    const color = ctx.modelColors[bestIdx % ctx.modelColors.length];
    const opacity = bestVal === 0 ? 0.08 : 0.85;
    parts.push(svgRect(gridX + w * colStep, curY, cellW, heatLineH, { fill: color, rx: 2, opacity }));
  }
  curY += heatLineH + 6;

  // ── Main heatmap + labels + DOW bars/ratios (aligned rows) ──
  const dowLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const heatmapStartY = curY;

  // Compute daily totals
  const dayTotals = new Map<string, number>();
  for (const day of allDays) {
    let total = 0;
    for (const agent of agents) {
      total += agent.dailyActivity[day] ?? 0;
    }
    dayTotals.set(day, total);
  }
  const maxDayTotal = Math.max(...dayTotals.values(), 1);

  for (let r = 0; r < 7; r++) {
    const ry = heatmapStartY + r * rowStep;
    const ratio = (dowTotals[r] / totalAllDow * 100).toFixed(1);

    // Label (center column)
    parts.push(
      svgText(labelCenterX, ry + mainCellH / 2 + 3, dowLabels[r], { fill: ctx.colors.muted, size: 9, anchor: "middle" }),
    );

    // Ratio text (left of bar, right-aligned)
    parts.push(
      svgText(ratioEndX, ry + mainCellH / 2 + 3, `${ratio}%`, { fill: ctx.colors.muted, size: 9, anchor: "end" }),
    );

    if (!isCompact) {
      // Bar (N <= 180)
      const barW = (dowTotals[r] / maxDowTotal) * barChartW;
      if (barW > 0) {
        parts.push(svgRect(barStartX, ry + 2, barW, mainCellH - 4, { fill: ctx.colors.green, rx: 3, opacity: 0.7 }));
      }
    }
  }

  // Green heatmap cells
  for (const [day, { col, row }] of dayGrid) {
    const cx = gridX + col * colStep;
    const cy = heatmapStartY + row * rowStep;
    const totalTokens = dayTotals.get(day) ?? 0;

    if (totalTokens === 0) {
      parts.push(svgRect(cx, cy, cellW, mainCellH, { fill: ctx.colors.separator, rx: 3, opacity: 0.2 }));
      continue;
    }

    const strength = 0.15 + (totalTokens / maxDayTotal) * 0.85;
    parts.push(svgRect(cx, cy, cellW, mainCellH, { fill: ctx.colors.green, rx: 3, opacity: strength }));
  }

  // ── "less → more" scale ──
  const gridH = 7 * rowStep - mainCellGap;
  curY = heatmapStartY + gridH + 10;
  parts.push(svgText(gridX, curY, "less", { fill: ctx.colors.muted, size: 9 }));
  const scaleX = gridX + 28;
  const scaleOpacities = [0.15, 0.35, 0.55, 0.75, 1.0];
  for (let si = 0; si < scaleOpacities.length; si++) {
    parts.push(svgRect(scaleX + si * 13, curY - 8, 10, 10, {
      fill: ctx.colors.green, rx: 2, opacity: scaleOpacities[si],
    }));
  }
  parts.push(svgText(scaleX + scaleOpacities.length * 13 + 4, curY, "more", { fill: ctx.colors.muted, size: 9 }));

  curY += 10;
  parts.push(separator(ctx, curY));
  return { svg: parts.join("\n"), height: curY - startY };
}
