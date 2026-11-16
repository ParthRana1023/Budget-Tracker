// Shared chart colours and money formatting for axes/tooltips.
//
// Colours are CSS variables defined in app/globals.css (light + html.dark), so a
// chart follows the theme toggle without re-rendering. SVG presentation
// attributes accept var(), which is how Recharts passes fill/stroke through.

/** Categorical series slots, in their fixed validated order. Never cycle these. */
export const SERIES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

/** Reserved status colours. Always pair with an icon + label, never colour alone. */
export const STATUS = {
  good: "var(--chart-good)",
  warning: "var(--chart-warning)",
  serious: "var(--chart-serious)",
  critical: "var(--chart-critical)",
};

/** Ink, grid and axis colours for chart chrome. */
export const CHROME = {
  ink: "var(--chart-ink)",
  muted: "var(--chart-muted)",
  grid: "var(--chart-grid)",
  axis: "var(--chart-axis)",
  surface: "var(--chart-surface)",
};

/**
 * Short INR label for chart axes, from paise. Indian units: k (thousand),
 * L (lakh = 1,00,000), Cr (crore = 1,00,00,000).
 * @param {number} paise
 * @returns {string}
 */
export function formatINRCompact(paise) {
  const rupees = Number(paise) / 100;
  const abs = Math.abs(rupees);
  const sign = rupees < 0 ? "-" : "";
  const trim = (/** @type {number} */ n) => String(Number(n.toFixed(1)));
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7)}Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5)}L`;
  if (abs >= 1e3) return `${sign}₹${trim(abs / 1e3)}k`;
  return `${sign}₹${Math.round(abs)}`;
}
