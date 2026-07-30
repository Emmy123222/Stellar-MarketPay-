import { useState, useEffect, useRef } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning";
  requireTypedConfirm?: boolean;
  typedConfirmText?: string;
  actionDetails?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  requireTypedConfirm = false,
  typedConfirmText = "CONFIRM",
  actionDetails,
  onConfirm,
  onCancel,
  loading = false,
}: ConfirmDialogProps) {
  const [typedValue, setTypedValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTypedValue("");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  if (!open) return null;

  const canConfirm = requireTypedConfirm
    ? typedValue === typedConfirmText && !loading
    : !loading;

  const borderColor =
    variant === "danger" ? "border-red-500/40" : "border-amber-500/40";
  const headerBg =
    variant === "danger" ? "bg-red-500/10" : "bg-amber-500/10";
  const iconColor =
    variant === "danger" ? "text-red-400" : "text-amber-400";
  const buttonBg =
    variant === "danger"
      ? "bg-red-600 hover:bg-red-500"
      : "bg-amber-600 hover:bg-amber-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className={`card max-w-md w-full border-2 ${borderColor}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`rounded-t-xl -m-6 mb-0 p-4 ${headerBg}`}>
          <div className="flex items-center gap-3">
            <span className={`text-lg ${iconColor}`}>
              {variant === "danger" ? "\u26A0" : "\u0021"}
            </span>
            <h3 className="font-display text-lg font-bold text-amber-100">{title}</h3>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <p className="text-sm text-amber-700">{description}</p>

          {actionDetails && (
            <div className="rounded-lg bg-ink-700/50 border border-market-500/10 p-3 text-sm text-amber-300">
              {actionDetails}
            </div>
          )}

          {requireTypedConfirm && (
            <div>
              <label className="block text-xs text-amber-800 mb-1">
                Type <span className="font-mono font-bold">{typedConfirmText}</span> to confirm
              </label>
              <input
                ref={inputRef}
                type="text"
                value={typedValue}
                onChange={(e) => setTypedValue(e.target.value)}
                placeholder={typedConfirmText}
                className="input-field font-mono text-sm"
                autoComplete="off"
              />
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            type="button"
            onClick={onCancel}
            className="btn-ghost text-sm flex-1 py-2.5 px-4"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className={`text-sm flex-1 py-2.5 px-4 rounded-xl text-white font-medium transition-all disabled:opacity-50 ${buttonBg}`}
          >
            {loading ? "Processing..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
