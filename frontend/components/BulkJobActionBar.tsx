/**
 * components/BulkJobActionBar.tsx
 *
 * Floating action bar that appears once 2+ job cards are selected via
 * checkboxes (see PostedJobsTab). Shows the selection count and action
 * buttons: Close Selected, Delete Selected, Boost Selected.
 * Close and Delete are destructive and require confirmation before
 * proceeding; Delete is irreversible.
 */
import { useState } from "react";
import clsx from "clsx";
import type { BulkActionResponse } from "@/utils/types";

interface BulkJobActionBarProps {
  selectedCount: number;
  onClose: () => Promise<BulkActionResponse>;
  onDelete: () => Promise<BulkActionResponse>;
  onBoost: () => Promise<BulkActionResponse>;
  onClearSelection: () => void;
  loading: boolean;
}

type ActiveAction = "close" | "delete" | "boost" | null;
type ConfirmAction = "close" | "delete" | null;

export default function BulkJobActionBar({
  selectedCount,
  onClose,
  onDelete,
  onBoost,
  onClearSelection,
  loading,
}: BulkJobActionBarProps) {
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [result, setResult] = useState<BulkActionResponse | null>(null);

  // Only shown once 2+ jobs are selected — a single job already has
  // per-row actions (Extend, Repost, etc.) in PostedJobsTab.
  if (selectedCount < 2) return null;

  const handleAction = async (action: ActiveAction) => {
    if (!action) return;
    setResult(null);

    let res: BulkActionResponse;
    if (action === "close") res = await onClose();
    else if (action === "delete") res = await onDelete();
    else res = await onBoost();

    setResult(res);
    setConfirmAction(null);
  };

  const confirmCopy = (a: ConfirmAction) => {
    if (a === "delete") {
      return {
        title: `Delete ${selectedCount} job${selectedCount !== 1 ? "s" : ""}?`,
        warning: "This cannot be undone.",
        body: (
          <>
            Deleted jobs are removed from your dashboard permanently. Jobs
            that are <span className="text-amber-300 font-medium">in progress</span>{" "}
            will be skipped.
          </>
        ),
        confirmLabel: "Yes, Delete",
        confirmingLabel: "Deleting…",
      };
    }
    return {
      title: `Close ${selectedCount} job${selectedCount !== 1 ? "s" : ""}?`,
      warning: "This cannot be undone.",
      body: (
        <>
          Only <span className="text-amber-300 font-medium">open</span> jobs
          will be closed. Jobs that are in progress, completed, or already
          closed will be skipped.
        </>
      ),
      confirmLabel: "Yes, Close",
      confirmingLabel: "Closing…",
    };
  };

  return (
    <>
      {/* ── Floating action bar ─────────────────────────────────────────── */}
      <div
        className={clsx(
          "fixed bottom-6 left-1/2 -translate-x-1/2 z-40",
          "flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl",
          "bg-ink-800 border border-market-500/30 backdrop-blur-sm",
          "transition-all duration-200",
          selectedCount > 0
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-4 pointer-events-none",
        )}
        role="toolbar"
        aria-label="Bulk job actions"
      >
        {/* Selection count + clear */}
        <div className="flex items-center gap-2 pr-3 border-r border-market-500/20">
          <span className="w-6 h-6 rounded-lg bg-market-500/20 flex items-center justify-center text-xs font-bold text-market-400">
            {selectedCount}
          </span>
          <span className="text-sm text-amber-200 font-medium whitespace-nowrap">
            job{selectedCount !== 1 ? "s" : ""} selected
          </span>
          <button
            onClick={onClearSelection}
            className="ml-1 text-amber-700 hover:text-amber-400 transition-colors"
            title="Clear selection"
            aria-label="Clear selection"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Close — destructive, requires confirmation */}
        <button
          onClick={() => setConfirmAction("close")}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium bg-ink-700 border border-market-500/20 text-amber-200 hover:border-market-400 hover:text-market-300 transition-all disabled:opacity-50"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
          Close Selected
        </button>

        {/* Boost */}
        <button
          onClick={() => handleAction("boost")}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium bg-ink-700 border border-amber-500/20 text-amber-300 hover:border-amber-400 hover:text-amber-200 transition-all disabled:opacity-50"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
          Boost Selected
        </button>

        {/* Delete — destructive & irreversible, requires confirmation */}
        <button
          onClick={() => setConfirmAction("delete")}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium bg-red-500/10 border border-red-500/20 text-red-400 hover:border-red-400 hover:bg-red-500/15 transition-all disabled:opacity-50"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16"
            />
          </svg>
          Delete Selected
        </button>
      </div>

      {/* ── Confirmation modal ──────────────────────────────────────────── */}
      {confirmAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-950/80 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-confirm-title"
        >
          <div className="bg-ink-800 border border-red-500/20 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
                <svg
                  className="w-5 h-5 text-red-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <div>
                <h3
                  id="bulk-confirm-title"
                  className="font-display font-semibold text-amber-100"
                >
                  {confirmCopy(confirmAction).title}
                </h3>
                <p className="text-xs text-amber-700 mt-0.5">
                  {confirmCopy(confirmAction).warning}
                </p>
              </div>
            </div>
            <p className="text-sm text-amber-700 mb-6">
              {confirmCopy(confirmAction).body}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmAction(null)}
                className="flex-1 btn-secondary text-sm"
                disabled={loading}
              >
                Keep Jobs
              </button>
              <button
                onClick={() => handleAction(confirmAction)}
                disabled={loading}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 transition-all disabled:opacity-50"
              >
                {loading
                  ? confirmCopy(confirmAction).confirmingLabel
                  : confirmCopy(confirmAction).confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Result toast ────────────────────────────────────────────────── */}
      {result && (
        <BulkResultToast result={result} onDismiss={() => setResult(null)} />
      )}
    </>
  );
}

function BulkResultToast({
  result,
  onDismiss,
}: {
  result: BulkActionResponse;
  onDismiss: () => void;
}) {
  const allOk = result.failed === 0;
  const failures = result.results.filter((r) => !r.success);

  return (
    <div
      className={clsx(
        "fixed bottom-24 left-1/2 -translate-x-1/2 z-50",
        "max-w-sm w-full mx-4 rounded-2xl border p-4 shadow-2xl",
        allOk
          ? "bg-emerald-500/10 border-emerald-500/30"
          : "bg-amber-500/10 border-amber-500/30",
      )}
      role="status"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {allOk ? (
            <svg
              className="w-5 h-5 text-emerald-400 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          ) : (
            <svg
              className="w-5 h-5 text-amber-400 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          )}
          <div>
            <p
              className={clsx(
                "text-sm font-semibold",
                allOk ? "text-emerald-400" : "text-amber-300",
              )}
            >
              {result.succeeded} succeeded
              {result.failed > 0 ? `, ${result.failed} failed` : ""}
            </p>
            {failures.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {failures.slice(0, 3).map((f) => (
                  <li key={f.id} className="text-xs text-amber-700">
                    {f.id.slice(0, 8)}… — {f.error}
                  </li>
                ))}
                {failures.length > 3 && (
                  <li className="text-xs text-amber-800">
                    +{failures.length - 3} more
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="text-amber-700 hover:text-amber-400 transition-colors flex-shrink-0"
          aria-label="Dismiss"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
