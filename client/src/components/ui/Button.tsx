import { forwardRef, type ButtonHTMLAttributes } from "react";
import { clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge the design-token colours; otherwise it reads text-bg / text-lime-ink
// as font sizes and drops them when a size class (text-[13px]) is present.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        "bg",
        "tile",
        "tile-2",
        "line",
        "line-2",
        "ink",
        "ink-2",
        "muted",
        "lime",
        "lime-text",
        "lime-ink",
        "lime-soft",
        "warn",
        "warn-soft",
        "fixed",
        "flex",
        "track",
        "danger",
        "danger-soft",
        "danger-ink",
        "scrim",
      ],
    },
  },
});

type Variant = "primary" | "danger" | "ink" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg" | "xl";

const VARIANTS: Record<Variant, string> = {
  primary: "border-0 bg-lime text-lime-ink font-bold hover:-translate-y-px hover:shadow-[0_8px_24px_-10px_var(--lime)]",
  danger: "border-0 bg-danger text-danger-ink font-bold",
  ink: "border-0 bg-ink text-bg font-bold",
  secondary: "border border-line bg-transparent font-semibold hover:border-ink-2",
  ghost: "border-0 bg-transparent font-semibold text-ink-2 hover:text-ink",
};

// Control heights from the handoff: 34 small pill, 38 secondary, 44 / 48 primary.
const SIZES: Record<Size, string> = {
  sm: "h-[34px] px-3.5 text-[13px]",
  md: "h-[38px] px-4 text-[13px]",
  lg: "h-11 px-5 text-sm",
  xl: "h-12 px-[22px] text-[15px]",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size };

/** Pill button. Defaults to type="button" so it never submits a form by accident. */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", type = "button", className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      // twMerge so a caller's className (e.g. border-line-2) replaces the variant default.
      className={twMerge(
        clsx(
          "inline-flex flex-none cursor-pointer items-center justify-center gap-2 rounded-full transition-[transform,box-shadow,border-color,color,opacity] duration-200 active:scale-[.96] disabled:cursor-default disabled:opacity-75",
          VARIANTS[variant],
          SIZES[size],
          className,
        ),
      )}
      {...rest}
    />
  );
});

export default Button;
