# AGENTS.md — SVG Components (`src/svg/`)

Pure SVG string-building primitives. No DOM, no external libraries.

## Files

| File | Purpose |
|---|---|
| `components.ts` | Reusable SVG helpers: `svgText`, `svgRect`, `svgLine`, `svgCircle`, `svgSparkline`, `svgDonut`, `svgPill` |
| `icons.ts` | SVG path data from bootstrap-icons for inline icon rendering |

## Conventions

- All functions are **pure** — take parameters, return SVG string fragments
- Use the `opts` pattern with inline type + `= {}` default for optional config:
  ```typescript
  export function svgText(x: number, y: number, text: string, opts: { fill?: string; size?: number } = {}): string
  ```
- Defaults applied via `??` inside the function body, not in the parameter
- `formatNumber()` and `formatCost()` are display formatters (also in this module)
- `escapeXml()` must be called on all user-facing text before embedding in SVG
- `svgPill()` returns `{ svg: string; width: number }` (not `SectionResult`) for layout flow
