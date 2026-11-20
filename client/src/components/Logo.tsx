import { clsx } from "clsx";

/**
 * SaveFirst logo (design handoff v2, navbar): the stacked-bars mark plus the "save" + "first"
 * wordmark. Colours come from the theme tokens, so it follows dark and light mode.
 *
 * `size` is the font size of "save" (32px in headers); "first" is 29/32 of it. The mark is
 * cropped to its bars (viewBox 6 6 52 50) at 22×21, so it is as tall as the lettering, and
 * sits on the text baseline 8px from the word. `wordClassName` can hide the word (e.g. on phones).
 */
export default function Logo({ size = 32, wordClassName }: { size?: number; wordClassName?: string }) {
  return (
    <span className="inline-flex items-baseline gap-[0.25em] leading-none text-ink" style={{ fontSize: size }}>
      <svg
        viewBox="6 6 52 50"
        aria-hidden
        className="block flex-none"
        style={{ width: "0.6875em", height: "0.65625em" }}
      >
        <rect x="14" y="6" width="36" height="10" rx="5" fill="var(--lime)" />
        <rect x="6" y="21" width="52" height="15" rx="7.5" fill="var(--ink)" />
        <rect x="6" y="41" width="52" height="15" rx="7.5" fill="var(--ink)" opacity=".45" />
      </svg>
      <span
        role="img"
        aria-label="SaveFirst"
        className={clsx("inline-flex items-baseline leading-none", wordClassName)}
      >
        <span className="font-serif font-normal tracking-[-0.01em]">save</span>
        <span className="font-sans text-[0.90625em] font-bold tracking-[-0.035em] text-lime-text">first</span>
      </span>
    </span>
  );
}
