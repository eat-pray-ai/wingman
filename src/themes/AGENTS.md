# AGENTS.md — Themes (`src/themes/`)

Each theme implements `ThemeRenderer` and converts `ShowcaseData` into an SVG string.

## Structure

```
themes/
  registry.ts               # imports all themes, exports getTheme() / getAvailableThemes()
  shared/
    context.ts               # Palette type, RenderContext, SectionEntry, createContext()
    helpers.ts               # pure utility functions (date formatting, topModels, card sizing)
    sections.ts              # ALL_SECTIONS: named registry of section renderers
    header.ts                # section: title + date range
    stats.ts                 # section: token/cost/session stats
    legend.ts                # section: agent–model flow lines + labels
    charts.ts                # section: donut chart + model bars
    heatmap.ts               # section: GitHub-style activity heatmap
    inventory.ts             # section: plugins, MCP servers, skills pills
    footer.ts                # section: branding footer + renderEmpty()
  github-dark/
    index.ts                 # theme entry — creates context with dark palette, composes sections
    palette.ts               # dark color constants (COLORS, AGENT_COLORS, MODEL_COLORS)
  github-light/
    index.ts                 # theme entry — creates context with light palette, composes sections
    palette.ts               # light color constants
```

## Adding a New Theme

1. Create `src/themes/my-theme/palette.ts` exporting a `Palette` object
2. Create `src/themes/my-theme/index.ts` — import palette + `ALL_SECTIONS` from `shared/`, compose and wrap SVG
3. Default export `{ name: "my-theme", render } satisfies ThemeRenderer`
4. Add import + map entry in `registry.ts`

## Section Pattern

Every section is a separate file in `shared/` exporting a `SectionFn`:

```typescript
export function renderMySection(ctx: RenderContext, data: ShowcaseData, y: number): SectionResult {
  const parts: string[] = [];
  let currentY = y + PADDING;
  // ... build SVG fragments via svg/components helpers
  // ... push to parts[], advance currentY
  return { svg: parts.join("\n"), height: currentY - y };
}
```

Sections are registered by name in `shared/sections.ts` as `SectionEntry[]` for `--sections` filtering.

Theme `index.ts` files compose sections by iterating the registry, accumulating `y` offsets.

## Key Conventions

- **Pure string concatenation** — no DOM, no SVG libraries
- **Coordinate system**: top-left origin, `y` accumulates downward
- **Colors**: centralized per-theme in `palette.ts` as a `Palette` object; shared code accesses colors via `RenderContext`
- **Card width**: dynamically computed from period length in `helpers.ts`
- **SVG primitives**: import from `../../svg/components.js` — never inline raw SVG tags when a helper exists
