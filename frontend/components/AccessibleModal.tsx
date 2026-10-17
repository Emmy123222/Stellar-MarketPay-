import { ReactNode, useEffect, useRef } from "react";
import clsx from "clsx";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

interface AccessibleModalProps {
  children: ReactNode;
  titleId: string;
  description: string;
  onClose: () => void;
  className?: string;
  panelClassName?: string;
  labelledBy?: string;
  /** id of the sr-only description node; override when two modals can be mounted at once. */
  descriptionId?: string;
  /**
   * When false the dialog ignores Escape and backdrop clicks (for flows that
   * must be completed, e.g. mandatory admin 2FA). Focus is still trapped.
   */
  dismissible?: boolean;
}

export default function AccessibleModal({
  children,
  titleId,
  description,
  onClose,
  className,
  panelClassName,
  labelledBy = titleId,
  descriptionId = "modal-description",
  dismissible = true,
}: AccessibleModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  // Keep the latest callbacks in refs so the trap is set up once per mount.
  // An inline `onClose` would otherwise re-run the effect on every parent
  // render, stealing focus back to the first control and losing the trigger.
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  onCloseRef.current = onClose;
  dismissibleRef.current = dismissible;

  useEffect(() => {
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const panel = panelRef.current;
    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
      ).filter(
        (element) =>
          !element.hasAttribute("disabled") && element.tabIndex !== -1,
      );

    const focusables = focusable();
    (focusables[0] ?? panel)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!dismissibleRef.current) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const elements = focusable();
      if (elements.length === 0) {
        event.preventDefault();
        panel?.focus();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocusedRef.current?.focus?.();
    };
  }, []);

  return (
    <div
      className={clsx(
        "fixed inset-0 z-50 flex items-center justify-center p-4",
        className,
      )}
    >
      {dismissible ? (
        <button
          type="button"
          tabIndex={-1}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          aria-label="Close dialog"
          onClick={onClose}
        />
      ) : (
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          aria-hidden="true"
        />
      )}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={clsx("relative", panelClassName)}
      >
        <p id={descriptionId} className="sr-only">
          {description}
        </p>
        {children}
      </div>
    </div>
  );
}
