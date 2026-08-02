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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div
        className={`relative w-full max-w-md mx-4 rounded-xl border ${borderColor} bg-market-900 shadow-2xl`}
      >
        <div className={`rounded-t-xl px-6 py-4 ${headerBg}`}>
          <div className="flex items-center gap-3">
            <span className={`text-xl ${iconColor}`}>
              {variant === "danger" ? "⚠" : "!"}
            </span>
            <h3 className="font-display text-lg font-bold text-amber-100">
              {title}
            </h3>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-amber-200/80 leading-relaxed">
            {description}
          </p>

          {actionDetails && (
            <div className="rounded-lg border border-market-500/20 bg-market-900/50 p-3">
              <p className="text-xs text-amber-300 font-mono">{actionDetails}</p>
            </div>
          )}

          {requireTypedConfirm && (
            <div className="space-y-2">
              <label className="text-xs text-amber-800/70 uppercase tracking-wider">
                Type <span className="font-mono text-amber-300">{typedConfirmText}</span> to confirm
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

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-market-500/20">
          <button
            type="button"
            onClick={onCancel}
            className="btn-secondary px-4 py-2 text-sm"
            disabled={loading}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 text-sm rounded-lg font-medium text-white transition-opacity ${buttonBg} ${canConfirm ? "opacity-100" : "opacity-50 cursor-not-allowed"}`}
            disabled={!canConfirm}
          >
            {loading ? "Processing..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
