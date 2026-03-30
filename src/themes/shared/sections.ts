import type { SectionEntry } from "./context.js";
import { renderHeader } from "./header.js";
import { renderTopStats } from "./stats.js";
import { renderLegend } from "./legend.js";
import { renderCharts } from "./charts.js";
import { renderActivityHeatmap } from "./heatmap.js";
import { renderInventory } from "./inventory.js";
import { renderFooter } from "./footer.js";

export const ALL_SECTIONS: SectionEntry[] = [
  { name: "header", render: renderHeader },
  { name: "stats", render: renderTopStats },
  { name: "legend", render: renderLegend },
  { name: "charts", render: renderCharts },
  { name: "heatmap", render: renderActivityHeatmap },
  { name: "inventory", render: renderInventory },
  { name: "footer", render: renderFooter },
];

export const SECTION_NAMES = ALL_SECTIONS.map((s) => s.name);
