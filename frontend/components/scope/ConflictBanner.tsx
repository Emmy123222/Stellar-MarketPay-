import React from "react";

interface ConflictBannerProps {
  onDismiss: () => void;
  onReload: () => void;
  serverUpdatedAt?: string | null;
  className?: string;
}

export default function ConflictBanner({
  onDismiss,
  onReload,
  serverUpdatedAt,
  className = "",
}: ConflictBannerProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="conflict-warning-banner"
      className={`rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-3 transition-all ${className}`}
    >
      <div className="flex items-start gap-3">
        <span className="text-amber-400 text-xl font-bold" aria-hidden="true">
          ⚠
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-amber-200">
            Conflict detected — your changes may have been overwritten
          </p>
          <p className="text-xs text-amber-400/90 mt-1 leading-relaxed">
            Another collaborator has submitted newer changes to this scope
            document
            {serverUpdatedAt
              ? ` (last updated at ${new Date(serverUpdatedAt).toLocaleTimeString()})`
              : ""}
            . Your local unsaved changes may conflict with the latest server
            version.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={onReload}
          data-testid="conflict-reload-btn"
          className="btn-primary px-3.5 py-1.5 text-xs font-medium"
        >
          Reload latest server content
        </button>
        <button
          type="button"
          onClick={onDismiss}
          data-testid="conflict-dismiss-btn"
          className="btn-secondary px-3.5 py-1.5 text-xs font-medium"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
