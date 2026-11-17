"use client";

import { useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";
import { X } from "lucide-react";
import { useModalBehavior } from "./useModalBehavior";

export type DrawerProps = {
  open: boolean;
  onClose: () => void;
  eyebrow: string;
  title: ReactNode;
  /** Pinned below the scrolling body, e.g. the Reports "Total" row. */
  footer?: ReactNode;
  children: ReactNode;
};

/** Right-hand side panel (Reports drill-down); bottom sheet under 640px. */
export default function Drawer({ open, onClose, eyebrow, title, footer, children }: DrawerProps) {
  const titleId = useId();
  const { ref, mounted, shown } = useModalBehavior<HTMLElement>(open, onClose);
  if (!mounted) return null;

  return createPortal(
    <>
      <div
        onClick={onClose}
        className={clsx("fixed inset-0 z-55 bg-scrim transition-opacity duration-[250ms]", shown ? "opacity-100" : "opacity-0")}
      />
      <aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={clsx(
          "fixed top-3 right-3 bottom-3 z-56 flex w-[min(420px,calc(100vw-24px))] flex-col rounded-[22px] border border-line-2 bg-tile shadow-[0_30px_80px_-20px_rgba(0,0,0,.7)] transition-transform duration-[340ms] ease-sheet",
          "max-[640px]:top-auto max-[640px]:right-0 max-[640px]:bottom-0 max-[640px]:left-0 max-[640px]:max-h-[82vh] max-[640px]:w-auto max-[640px]:rounded-b-none",
          !shown && "translate-x-[calc(100%+24px)] max-[640px]:translate-x-0 max-[640px]:translate-y-full",
        )}
      >
        <div className="flex items-start gap-3 border-b border-line pt-[22px] pr-5 pb-4 pl-6">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="eyebrow">{eyebrow}</span>
            <h2 id={titleId} className="m-0 font-serif text-[32px] leading-none font-normal">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-[38px] w-[38px] flex-none cursor-pointer items-center justify-center rounded-full border border-line bg-transparent text-ink-2 transition-transform duration-[250ms] hover:rotate-90"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-1.5 pb-3">{children}</div>
        {footer && (
          <div className="flex items-baseline justify-between gap-3 border-t border-line px-6 pt-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </aside>
    </>,
    document.body,
  );
}
