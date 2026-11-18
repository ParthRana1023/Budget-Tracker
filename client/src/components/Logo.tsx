/**
 * SaveFirst logo: the stacked-bars mark plus the "save" + "first" wordmark.
 * Colours come from the theme tokens, so it follows dark and light mode.
 */
export default function Logo({ size = 24, markOnly = false }: { size?: number; markOnly?: boolean }) {
  const markSize = Math.round(size * 0.93);
  const mark = (
    <svg
      width={markSize}
      height={markSize}
      viewBox="0 0 64 64"
      className="shrink-0"
      {...(markOnly ? { role: "img", "aria-label": "SaveFirst" } : { "aria-hidden": true })}
    >
      <rect x="14" y="6" width="36" height="10" rx="5" fill="var(--lime)" />
      <rect x="6" y="21" width="52" height="15" rx="7.5" fill="var(--ink)" />
      <rect x="6" y="41" width="52" height="15" rx="7.5" fill="var(--ink)" opacity=".45" />
    </svg>
  );
  if (markOnly) return mark;

  return (
    <span className="inline-flex items-center gap-[10px] leading-none">
      {mark}
      <span role="img" aria-label="SaveFirst" className="inline-flex items-baseline leading-none">
        <span className="font-serif font-normal text-ink" style={{ fontSize: size }}>
          save
        </span>
        <span
          className="font-sans font-bold text-lime-text"
          style={{ fontSize: size * 0.89, letterSpacing: "-0.035em" }}
        >
          first
        </span>
      </span>
    </span>
  );
}
