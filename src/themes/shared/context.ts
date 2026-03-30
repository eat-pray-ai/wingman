import type { SectionResult, ShowcaseData } from "../../types.js";

export interface Palette {
  colors: {
    bg: string;
    border: string;
    separator: string;
    primary: string;
    secondary: string;
    muted: string;
    blue: string;
    green: string;
    purple: string;
    orange: string;
    red: string;
  };
  agentColors: string[];
  modelColors: string[];
}

export interface RenderContext {
  cardWidth: number;
  contentWidth: number;
  padX: number;
  colors: Palette["colors"];
  agentColors: string[];
  modelColors: string[];
}

export type SectionFn = (ctx: RenderContext, data: ShowcaseData, y: number) => SectionResult;

export interface SectionEntry {
  name: string;
  render: SectionFn;
}

export function createContext(cardWidth: number, palette: Palette): RenderContext {
  const padX = 24;
  return {
    cardWidth,
    contentWidth: cardWidth - padX * 2,
    padX,
    colors: palette.colors,
    agentColors: palette.agentColors,
    modelColors: palette.modelColors,
  };
}
