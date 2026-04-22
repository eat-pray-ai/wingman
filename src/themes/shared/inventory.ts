import type { SectionResult, ShowcaseData } from "../../types.js";
import { svgPill, svgText } from "../../svg/components.js";
import { ICONS, svgIcon } from "../../svg/icons.js";
import type { RenderContext } from "./context.js";

export function renderInventory(ctx: RenderContext, data: ShowcaseData, y: number): SectionResult {
  const inv = data.inventory;
  const hasPlugins = inv.plugins.length > 0;
  const hasMcp = inv.mcpServers.length > 0;
  const hasSkills = inv.skills.length > 0;

  if (!hasPlugins && !hasMcp && !hasSkills) {
    return { svg: "", height: 0 };
  }

  // Build agent → color map (same order as AGENTS section)
  const agentColorMap = new Map<string, string>();
  for (let i = 0; i < data.agents.length; i++) {
    agentColorMap.set(data.agents[i].agent, ctx.agentColors[i % ctx.agentColors.length]);
  }
  const toBadges = (sources: string[]) => sources.map(s => agentColorMap.get(s) ?? ctx.colors.muted);

  const parts: string[] = [];
  const startY = y;
  parts.push(svgIcon(ctx.padX, startY + 5, ICONS.box, { fill: ctx.colors.secondary, size: 11 }));
  parts.push(
    svgText(ctx.padX + 14, startY + 16, "INVENTORY", { fill: ctx.colors.secondary, size: 11 }),
  );

  const pillGap = 6;
  const maxX = ctx.cardWidth - ctx.padX;
  const indent = 20;
  const rowH = 26;
  let curY = startY + 28;

  // ── Plugins ──
  for (const plugin of inv.plugins) {
    const label = plugin.version ? `${plugin.name} v${plugin.version}` : plugin.name;
    parts.push(svgIcon(ctx.padX, curY + 3, ICONS.puzzle, { fill: ctx.colors.blue, size: 12 }));
    const pill = svgPill(ctx.padX + 16, curY, label, {
      fill: "#1f6feb22",
      textFill: ctx.colors.blue,
      badges: toBadges(plugin.sources),
    });
    parts.push(pill.svg);
    curY += rowH;
  }

  // Helper: render a section of InventoryItems with badges inside pills
  const renderItemSection = (
    iconPath: string, iconColor: string, title: string, items: typeof inv.mcpServers,
  ) => {
    parts.push(svgIcon(ctx.padX, curY + 3, iconPath, { fill: iconColor, size: 12 }));
    parts.push(svgText(ctx.padX + 16, curY + 12, title, { fill: ctx.colors.secondary, size: 10 }));
    curY += 18;
    let px = ctx.padX + indent;
    for (const item of items) {
      const badges = toBadges(item.sources);
      const sp = svgPill(px, curY, item.name, { fill: ctx.colors.separator, textFill: ctx.colors.secondary, badges });
      if (px + sp.width > maxX && px > ctx.padX + indent) {
        curY += rowH;
        px = ctx.padX + indent;
        const sp2 = svgPill(px, curY, item.name, { fill: ctx.colors.separator, textFill: ctx.colors.secondary, badges });
        parts.push(sp2.svg);
        px += sp2.width + pillGap;
      } else {
        parts.push(sp.svg);
        px += sp.width + pillGap;
      }
    }
    curY += rowH;
  };

  if (hasMcp) renderItemSection(ICONS.tools, ctx.colors.green, "MCP Servers", inv.mcpServers);
  if (hasSkills) renderItemSection(ICONS.hexagon, ctx.colors.purple, "Skills", inv.skills);

  return { svg: parts.join("\n"), height: curY - startY };
}
