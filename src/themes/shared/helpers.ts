import type { ShowcaseData } from "../../types.js";
import { formatDate, svgLine } from "../../svg/components.js";
import type { RenderContext } from "./context.js";

const MIN_CARD_WIDTH = 660;
const MAX_CARD_WIDTH = 1200;

export function separator(ctx: RenderContext, y: number): string {
  return svgLine(ctx.padX, y, ctx.cardWidth - ctx.padX, y, { stroke: ctx.colors.separator });
}

export function shortMonth(d: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return months[d.getMonth()];
}

export function formatDateRange(since: Date, until: Date): string {
  const sameYear = since.getFullYear() === until.getFullYear();
  const sameMonth = sameYear && since.getMonth() === until.getMonth();

  if (sameMonth) {
    return `${shortMonth(since)} ${since.getDate()} \u2013 ${until.getDate()}, ${until.getFullYear()}`;
  }
  if (sameYear) {
    return `${shortMonth(since)} ${since.getDate()} \u2013 ${shortMonth(until)} ${until.getDate()}, ${until.getFullYear()}`;
  }
  return `${formatDate(since)} \u2013 ${formatDate(until)}`;
}

export function collectSortedDays(data: ShowcaseData): string[] {
  const days = new Set<string>();
  for (const agent of data.agents) {
    for (const day of Object.keys(agent.dailyActivity)) {
      days.add(day);
    }
  }
  return [...days].sort();
}

export function topModels(data: ShowcaseData, limit: number): { id: string; tokens: number; cost: number }[] {
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
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, limit);
}

export function computePeriodSize(data: ShowcaseData): { numWeeks: number; numDays: number } {
  const periodStart = new Date(data.period.since);
  periodStart.setHours(0, 0, 0, 0);
  const end = new Date(data.period.until);
  end.setHours(23, 59, 59, 999);
  const numDays = Math.round((end.getTime() - periodStart.getTime()) / 86400000) + 1;

  const MIN_HEATMAP_DAYS = 60;
  const heatmapStart = new Date(periodStart);
  if (numDays < MIN_HEATMAP_DAYS) {
    heatmapStart.setDate(heatmapStart.getDate() - (MIN_HEATMAP_DAYS - numDays));
  }
  heatmapStart.setHours(0, 0, 0, 0);

  const firstDow = (heatmapStart.getDay() + 6) % 7;
  const cursor = new Date(heatmapStart);
  const startTime = cursor.getTime();
  let maxCol = 0;
  while (cursor <= end) {
    const daysSinceStart = Math.round((cursor.getTime() - startTime) / 86400000) + firstDow;
    maxCol = Math.floor(daysSinceStart / 7);
    cursor.setDate(cursor.getDate() + 1);
  }
  return { numWeeks: maxCol + 1, numDays };
}

export function computeCardWidth(numWeeks: number, numDays: number): number {
  const cellW = Math.min(16, Math.max(6, 12));
  const colStep = cellW + 2;
  const effectiveWeeks = Math.max(numWeeks, Math.ceil(60 / 7) + 1);
  const heatmapW = effectiveWeeks * colStep - 2;
  const labelColW = 28;
  const ratioColW = 38;
  const gapLR = 8;
  const padX = 24;

  if (numDays <= 182) {
    const minBarW = 80;
    const barGap = 4;
    const needed = padX + heatmapW + gapLR + labelColW + ratioColW + barGap + minBarW + padX;
    return Math.max(MIN_CARD_WIDTH, Math.min(MAX_CARD_WIDTH, needed));
  }
  const needed = padX + heatmapW + gapLR + labelColW + ratioColW + padX;
  return Math.max(MIN_CARD_WIDTH, Math.min(MAX_CARD_WIDTH, needed));
}
