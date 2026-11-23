"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";
import { Check, CircleAlert, X } from "lucide-react";
import Button from "./Button";
import { useModalBehavior } from "./useModalBehavior";
import { useKeyboardInset } from "./useKeyboardInset";

const WIDTHS = { sm: "max-w-[440px]", md: "max-w-[540px]", lg: "max-w-[620px]" } as const;
/** Dragging the sheet down further than this closes it (design handoff v3, Mobile). */
const DRAG_CLOSE_PX = 110;

export type DialogProps = {
  open: boolean;
  /** Called to close: Esc, the X, Cancel, a click outside (after "Discard?" when dirty). */
  onClose: () => void;
  eyebrow: string;
  title: ReactNode;
  /** sm 440px (confirms), md 540px (default), lg 620px (Log expense, Bonus split, Categories). */
  size?: keyof typeof WIDTHS;
  /** Half-filled form: closing asks "Discard what you've entered?" first. */
  dirty?: boolean;
  /** Inline save error shown above the actions, e.g. "Couldn't save. …". */
  error?: string | null;
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  submitLabel?: string;
  submitTone?: "primary" | "danger" | "ink";
  busy?: boolean;
  showCancel?: boolean;
  /** Footer hint on wide screens. */
  hint?: string;
  /** Bottom sheet only: replaces the eyebrow and title (kept for screen readers), e.g. Expense | Income. */
  sheetHeader?: ReactNode;
  children: ReactNode;
};

/**
 * Popup shell from the handoff: centred dialog, bottom sheet under 640px. The sheet has a
 * drag handle (drag down to close), a full-width save button and no Cancel, and sits above
 * the on-screen keyboard. The whole popup is a <form>, so Enter saves.
 */
export default function Dialog({
  open,
  onClose,
  eyebrow,
  title,
  size = "md",
  dirty = false,
  error,
  onSubmit,
  submitLabel = "Save",
  submitTone = "primary",
  busy = false,
  showCancel = true,
  hint = "Enter to save · Esc to close",
  sheetHeader,
  children,
}: DialogProps) {
  const titleId = useId();
  const [discard, setDiscard] = useState(false);
  const requestClose = () => (dirty && !discard ? setDiscard(true) : onClose());
  const { ref, mounted, shown } = useModalBehavior<HTMLFormElement>(open, requestClose);
  const keyboard = useKeyboardInset();
  const [dragY, setDragY] = useState<number | null>(null);
  const dragFrom = useRef<number | null>(null);

  useEffect(() => {
    if (!open) setDiscard(false);
  }, [open]);

  if (!mounted) return null;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!busy) onSubmit?.(e);
  };
  const endDrag = () => {
    const y = dragY ?? 0;
    dragFrom.current = null;
    setDragY(null);
    if (y > DRAG_CLOSE_PX) requestClose();
  };

  return createPortal(
    <div
      onClick={(e) => e.target === e.currentTarget && requestClose()}
      className={clsx(
        "fixed inset-0 z-60 flex items-center justify-center bg-scrim p-6 transition-opacity duration-[220ms] max-[640px]:items-end max-[640px]:p-0",
        shown ? "opacity-100" : "opacity-0",
      )}
      style={keyboard ? { paddingBottom: keyboard } : undefined}
    >
      <form
        ref={ref}
        onSubmit={submit}
        onInput={() => setDiscard(false)}
        noValidate
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={clsx(
          "flex max-h-[calc(100vh-48px)] w-full flex-col overflow-hidden rounded-[22px] border border-line-2 bg-tile shadow-[0_40px_100px_-30px_rgba(0,0,0,.7)] max-[640px]:max-h-[calc(100dvh-env(safe-area-inset-top)-12px)] max-[640px]:rounded-b-none",
          dragY === null && "transition-transform duration-[340ms] ease-sheet",
          WIDTHS[size],
          !shown && "translate-y-4 scale-[.98] max-[640px]:translate-y-12 max-[640px]:scale-100",
        )}
        style={{
          ...(dragY ? { transform: `translateY(${dragY}px)` } : null),
          ...(keyboard ? { maxHeight: `calc(100dvh - ${keyboard}px - env(safe-area-inset-top) - 8px)` } : null),
        }}
      >
        <div
          aria-hidden
          onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
            dragFrom.current = e.clientY;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            setDragY(0);
          }}
          onPointerMove={(e) => dragFrom.current !== null && setDragY(Math.max(0, e.clientY - dragFrom.current))}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="hidden h-[26px] flex-none cursor-grab touch-none items-center justify-center max-[640px]:flex"
        >
          <span className="h-[5px] w-10 rounded-full bg-line-2" />
        </div>
        <div className="flex items-start gap-3 border-b border-line pt-5 pr-[22px] pb-4 pl-[26px] max-[640px]:pt-1.5 max-[640px]:pr-4 max-[640px]:pb-3.5 max-[640px]:pl-[18px]">
          {sheetHeader && <div className="hidden min-w-0 flex-1 max-[640px]:flex">{sheetHeader}</div>}
          <div className={clsx("flex min-w-0 flex-1 flex-col gap-1.5", sheetHeader && "max-[640px]:sr-only")}>
            <span className="eyebrow">{eyebrow}</span>
            <h2 id={titleId} className="m-0 font-serif text-[34px] leading-none font-normal">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="relative flex h-[38px] w-[38px] flex-none cursor-pointer items-center justify-center rounded-full border border-line bg-transparent text-ink-2 transition-[color,transform] duration-[250ms] after:absolute after:-inset-1 after:rounded-full after:content-[''] hover:rotate-90 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-[26px] pt-[22px] pb-6 max-[640px]:gap-5 max-[640px]:px-[18px] max-[640px]:pt-[18px] max-[640px]:pb-5">
          {children}
        </div>

        <div
          className="flex flex-wrap items-center gap-2.5 border-t border-line pt-3.5 pr-[22px] pb-[calc(14px+env(safe-area-inset-bottom))] pl-[26px] max-[640px]:px-4 max-[640px]:pt-3 max-[640px]:pb-[calc(12px+env(safe-area-inset-bottom))]"
          style={keyboard ? { paddingBottom: 12 } : undefined}
        >
          {error && (
            <span role="alert" className="flex basis-full items-center gap-2 text-[13px] font-semibold text-danger">
              <CircleAlert size={14} className="flex-none" />
              {error}
            </span>
          )}
          {discard && (
            <div
              role="alertdialog"
              aria-label="Discard changes"
              className="flex basis-full flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-warn-soft px-3.5 py-2.5 text-sm"
            >
              <span className="flex-[1_1_200px] font-semibold text-warn">Discard what you’ve entered?</span>
              <Button variant="ink" size="sm" onClick={onClose}>
                Discard
              </Button>
              <Button variant="ghost" size="sm" className="px-3" onClick={() => setDiscard(false)}>
                Keep editing
              </Button>
            </div>
          )}
          <span className="flex-[1_1_120px] text-xs text-muted max-[640px]:hidden">{hint}</span>
          {showCancel && (
            <Button size="xl" className="border-line-2 px-5 text-sm max-[640px]:hidden" onClick={requestClose}>
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            variant={submitTone}
            size="xl"
            disabled={busy}
            aria-busy={busy}
            className="min-w-40 max-[640px]:h-[52px] max-[640px]:flex-[1_1_100%]"
          >
            {busy ? (
              <span
                aria-hidden
                className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent"
              />
            ) : (
              <Check size={16} className="flex-none" />
            )}
            {submitLabel}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
