import type { HTMLAttributes } from "react";
import { clsx } from "clsx";

type CardProps = HTMLAttributes<HTMLElement> & {
  /** Entrance stagger in seconds (cards fade/slide in on load). Omit for no entrance. */
  delay?: number;
};

/** Surface card: --tile background, 1px --line border, 18px radius, 18–24px padding. */
export default function Card({ delay, className, style, ...rest }: CardProps) {
  return (
    <section
      className={clsx(
        "min-w-0 rounded-[18px] border border-line bg-tile p-[clamp(18px,5vw,24px)]",
        delay !== undefined && "sf-rise",
        className,
      )}
      style={delay !== undefined ? { animationDelay: `${delay}s`, ...style } : style}
      {...rest}
    />
  );
}
