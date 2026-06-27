import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";


type ToastVariant = "success" | "error" | "info";

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  /** true once the 3 s timer fires — triggers the slide-out CSS class */
  dismissing: boolean;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Keep a ref to avoid stale closures in setTimeout callbacks
  const toastsRef = useRef(toasts);
  toastsRef.current = toasts;

  const dismiss = useCallback((id: string) => {
    // 1. Mark as dismissing → play slide-out animation (300 ms)
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, dismissing: true } : t))
    );
    // 2. Remove from DOM after animation completes
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 350);
  }, []);

  const add = useCallback(
    (message: string, variant: ToastVariant) => {
      const id = `${Date.now()}-${Math.random()}`;
      setToasts((prev) => [...prev, { id, message, variant, dismissing: false }]);

      // Auto-dismiss after 3 seconds
      setTimeout(() => dismiss(id), 3000);
    },
    [dismiss]
  );

  const value: ToastContextValue = {
    success: (msg) => add(msg, "success"),
    error: (msg) => add(msg, "error"),
    info: (msg) => add(msg, "info"),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// ─── Visual config per variant ────────────────────────────────────────────────

const VARIANT_STYLES: Record<
  ToastVariant,
  { bar: string; icon: React.ReactNode; label: string }
> = {
  success: {
    bar: "bg-emerald-500",
    label: "text-emerald-400",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M5 8.5L7 10.5L11 6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  error: {
    bar: "bg-red-500",
    label: "text-red-400",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M5.5 5.5L10.5 10.5M10.5 5.5L5.5 10.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  info: {
    bar: "bg-sky-500",
    label: "text-sky-400",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M8 7V11M8 5.5V5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
};

// ─── Single toast item ────────────────────────────────────────────────────────

export function ToastSnapshot({
  variant,
  message,
}: {
  variant: ToastVariant;
  message: string;
}) {
  return (
    <ToastItem
      toast={{ id: "snapshot", message, variant, dismissing: false }}
      onDismiss={() => {}}
    />
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
}) {
  const { bar, icon, label } = VARIANT_STYLES[toast.variant];

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className={[
        // Base
        "relative flex items-start gap-3 w-full max-w-sm",
        "rounded-xl border border-white/[0.08] bg-[#111A14]/90 backdrop-blur-xl",
        "px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.5)]",
        "overflow-hidden",
        // Animation
        "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        toast.dismissing
          ? "opacity-0 translate-y-2 scale-95 pointer-events-none"
          : "opacity-100 translate-y-0 scale-100",
      ].join(" ")}
    >
      {/* Coloured left bar */}
      <span
        className={`absolute left-0 top-0 h-full w-[3px] rounded-l-xl ${bar}`}
        aria-hidden="true"
      />

      {/* Icon */}
      <span className={`mt-[1px] shrink-0 ${label}`}>{icon}</span>

      {/* Message */}
      <p className="flex-1 text-[13px] leading-snug text-amber-100/90 pr-2">
        {toast.message}
      </p>

      {/* Dismiss button */}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="shrink-0 text-amber-800/60 hover:text-amber-100 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 rounded"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 3L11 11M11 3L3 11"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

// ─── Container ────────────────────────────────────────────────────────────────

function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-label="Notifications"
      className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[9999] flex flex-col-reverse gap-2 items-center w-full px-4 pointer-events-none sm:left-auto sm:right-5 sm:translate-x-0 sm:items-end"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto w-full sm:w-auto">
          <ToastItem toast={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}