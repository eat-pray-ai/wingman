/**
 * Reusable SVG helper functions for rendering card components.
 * All functions are pure and return SVG string fragments.
 */

const MONO_FONT = `"ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, monospace"`;

export function formatNumber(n: number): string {
  if (n >= 1_000_000_000_000) {
    return `${(n / 1_000_000_000_000).toFixed(1)}T`;
  }
  if (n >= 1_000_000_000) {
    return `${(n / 1_000_000_000).toFixed(1)}B`;
  }
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  return n.toLocaleString("en-US");
}

export function formatCost(n: number): string {
  if (n >= 1000) {
    return `$${Math.round(n).toLocaleString("en-US")}`;
  }
  return `$${n.toFixed(2)}`;
}

export function formatDate(d: Date): string {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function svgText(
  x: number,
  y: number,
  text: string,
  opts: {
    fill?: string;
    size?: number;
    weight?: string;
    anchor?: string;
    font?: string;
  } = {},
): string {
  const fill = opts.fill ?? "#e6edf3";
  const size = opts.size ?? 14;
  const weight = opts.weight ?? "normal";
  const anchor = opts.anchor ?? "start";
  const font = opts.font ?? MONO_FONT;
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" font-family=${font}>${escapeXml(text)}</text>`;
}

export function svgRect(
  x: number,
  y: number,
  w: number,
  h: number,
  opts: {
    fill?: string;
    rx?: number;
    opacity?: number;
    stroke?: string;
  } = {},
): string {
  const fill = opts.fill ?? "none";
  const rx = opts.rx ?? 0;
  const parts = [`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" rx="${rx}"`];
  if (opts.opacity !== undefined) {
    parts.push(` opacity="${opts.opacity}"`);
  }
  if (opts.stroke) {
    parts.push(` stroke="${opts.stroke}" stroke-width="1"`);
  }
  parts.push(`/>`);
  return parts.join("");
}

export function svgLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  opts: {
    stroke?: string;
    width?: number;
  } = {},
): string {
  const stroke = opts.stroke ?? "#21262d";
  const width = opts.width ?? 1;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}"/>`;
}

export function svgCircle(
  cx: number,
  cy: number,
  r: number,
  opts: {
    fill?: string;
  } = {},
): string {
  const fill = opts.fill ?? "#e6edf3";
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
}

export function svgSparkline(
  points: number[],
  x: number,
  y: number,
  width: number,
  height: number,
  opts: {
    stroke?: string;
    gradientId?: string;
  } = {},
): string {
  if (points.length === 0) return "";

  const stroke = opts.stroke ?? "#58a6ff";
  const max = Math.max(...points, 1);
  const step = points.length > 1 ? width / (points.length - 1) : 0;

  const coords = points.map((v, i) => {
    const px = x + i * step;
    const py = y + height - (v / max) * height;
    return { px, py };
  });

  const polylinePoints = coords.map((c) => `${c.px.toFixed(1)},${c.py.toFixed(1)}`).join(" ");

  const parts: string[] = [];

  // Gradient fill polygon (area under the line)
  if (opts.gradientId) {
    const polygonPoints = [
      `${coords[0].px.toFixed(1)},${(y + height).toFixed(1)}`,
      ...coords.map((c) => `${c.px.toFixed(1)},${c.py.toFixed(1)}`),
      `${coords[coords.length - 1].px.toFixed(1)},${(y + height).toFixed(1)}`,
    ].join(" ");
    parts.push(
      `<polygon points="${polygonPoints}" fill="url(#${opts.gradientId})" opacity="0.3"/>`,
    );
  }

  // The sparkline itself
  parts.push(
    `<polyline points="${polylinePoints}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  );

  return parts.join("\n");
}

/**
 * Render a donut/pie chart with labeled slices.
 * Returns SVG string fragment.
 */
export function svgDonut(
  cx: number,
  cy: number,
  radius: number,
  innerRadius: number,
  slices: { value: number; color: string }[],
  opts: { bgFill?: string } = {},
): string {
  const total = slices.reduce((s, sl) => s + sl.value, 0);
  if (total === 0) return "";

  const parts: string[] = [];
  let startAngle = -Math.PI / 2; // start at top

  for (const slice of slices) {
    const pct = slice.value / total;
    if (pct === 0) continue;

    const endAngle = startAngle + pct * 2 * Math.PI;
    const largeArc = pct > 0.5 ? 1 : 0;

    // Outer arc
    const ox1 = cx + radius * Math.cos(startAngle);
    const oy1 = cy + radius * Math.sin(startAngle);
    const ox2 = cx + radius * Math.cos(endAngle);
    const oy2 = cy + radius * Math.sin(endAngle);
    // Inner arc (reverse)
    const ix1 = cx + innerRadius * Math.cos(endAngle);
    const iy1 = cy + innerRadius * Math.sin(endAngle);
    const ix2 = cx + innerRadius * Math.cos(startAngle);
    const iy2 = cy + innerRadius * Math.sin(startAngle);

    // Handle full circle (100% single slice)
    if (pct >= 0.9999) {
      const bg = opts.bgFill ?? "#0d1117";
      parts.push(
        `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${slice.color}"/>`,
        `<circle cx="${cx}" cy="${cy}" r="${innerRadius}" fill="${bg}"/>`,
      );
    } else {
      const d = [
        `M ${ox1.toFixed(1)} ${oy1.toFixed(1)}`,
        `A ${radius} ${radius} 0 ${largeArc} 1 ${ox2.toFixed(1)} ${oy2.toFixed(1)}`,
        `L ${ix1.toFixed(1)} ${iy1.toFixed(1)}`,
        `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix2.toFixed(1)} ${iy2.toFixed(1)}`,
        `Z`,
      ].join(" ");
      parts.push(`<path d="${d}" fill="${slice.color}"/>`);
    }

    startAngle = endAngle;
  }

  return parts.join("\n");
}

export function svgPill(
  x: number,
  y: number,
  text: string,
  opts: {
    fill?: string;
    textFill?: string;
    height?: number;
    badges?: string[];   // colored squares rendered inside pill before text
  } = {},
): { svg: string; width: number } {
  const fill = opts.fill ?? "#21262d";
  const textFill = opts.textFill ?? "#8b949e";
  const height = opts.height ?? 20;
  const charWidth = 7;
  const padding = 12;
  const badges = opts.badges ?? [];
  const badgeSize = 6;
  const badgeGap = 3;
  const badgesW = badges.length > 0 ? badges.length * (badgeSize + badgeGap) + 2 : 0;
  const textWidth = text.length * charWidth;
  const pillWidth = textWidth + padding * 2 + badgesW;
  const rx = height / 2;

  const parts = [
    svgRect(x, y, pillWidth, height, { fill, rx }),
  ];

  // Render badge squares inside pill
  const badgeCy = y + height / 2;
  let bx = x + padding;
  for (const color of badges) {
    parts.push(svgRect(bx, badgeCy - badgeSize / 2, badgeSize, badgeSize, { fill: color, rx: 1 }));
    bx += badgeSize + badgeGap;
  }

  parts.push(
    svgText(x + padding + badgesW + textWidth / 2, y + height / 2 + 4, text, {
      fill: textFill,
      size: 11,
      anchor: "middle",
    }),
  );

  return { svg: parts.join("\n"), width: pillWidth };
}
