/**
 * SaveFirst logo: the stacked-bars mark plus the "save" + "first" wordmark.
 * Colours come from the theme tokens, so it follows dark and light mode.
 *
 * `size` is the wordmark's font size. The mark is sized so its bars are as tall as the
 * letters of "first". At the default 39.5 the mark's box is 32px tall. Everything is in em
 * off that size, so it shrinks to 70% on phones (≤480px).
 */
export default function Logo({ size = 39.5, markOnly = false }: { size?: number; markOnly?: boolean }) {
  const mark = (
    <svg
      viewBox="0 0 64 64"
      className="h-[0.81em] w-[0.81em] shrink-0"
      // Centred boxes leave the bars ~1px above the letters; this lines up their tops and bottoms.
      style={markOnly ? undefined : { transform: "translateY(0.03em)" }}
      {...(markOnly ? { role: "img", "aria-label": "SaveFirst" } : { "aria-hidden": true })}
    >
      <rect x="14" y="6" width="36" height="10" rx="5" fill="var(--lime)" />
      <rect x="6" y="21" width="52" height="15" rx="7.5" fill="var(--ink)" />
      <rect x="6" y="41" width="52" height="15" rx="7.5" fill="var(--ink)" opacity=".45" />
    </svg>
  );

  return (
    <span
      className="inline-flex items-center gap-[10px] text-[length:var(--logo-size)] leading-none max-[480px]:text-[length:calc(var(--logo-size)*0.7)]"
      style={{ "--logo-size": `${size}px` } as React.CSSProperties}
    >
      {markOnly ? (
        mark
      ) : (
        <>
          {mark}
          <span role="img" aria-label="SaveFirst" className="inline-flex items-baseline leading-none">
            <span className="font-serif font-normal text-ink">save</span>
            <span className="font-sans text-[0.89em] font-bold tracking-[-0.035em] text-lime-text">first</span>
          </span>
        </>
      )}
    </span>
  );
}
