/**
 * components/dashboard-tabs/SavedSearchesTab.tsx
 * Tab for viewing and managing saved job searches
 */
import StateMessage from "@/components/StateMessage";
import ConfirmDialog from "@/components/ConfirmDialog";

export interface SavedSearchItem {
  id: string;
  query_params: Record<string, string>;
  notify_in_app: boolean;
  notify_email: boolean;
  created_at: string;
}

interface Props {
  savedSearches: SavedSearchItem[];
  savedSearchesLoading: boolean;
  onBrowse: () => void;
  onToggleInApp: (id: string) => Promise<void> | void;
  confirmDeleteSearch: string | null;
  onRequestRemove: (id: string) => void;
  onCancelRemove: () => void;
  onConfirmRemove: () => Promise<void> | void;
}

export default function SavedSearchesTab({
  savedSearches,
  savedSearchesLoading,
  onBrowse,
  onToggleInApp,
  confirmDeleteSearch,
  onRequestRemove,
  onCancelRemove,
  onConfirmRemove,
}: Props) {
  return (
    <>
      {savedSearchesLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card animate-pulse h-20" />
          ))}
        </div>
      ) : savedSearches.length === 0 ? (
        <StateMessage
          type="empty"
          title="No saved searches"
          description="Save a search on the Jobs page to get notified when matching jobs are posted"
          ctaLabel="Browse Jobs"
          onCta={onBrowse}
        />
      ) : (
        <>
          <div className="space-y-3">
            {savedSearches.map((s) => (
              <div key={s.id} className="card flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {Object.entries(s.query_params).map(([key, val]) => (
                      <span
                        key={key}
                        className="text-xs bg-market-500/10 text-market-400 border border-market-500/20 px-2 py-0.5 rounded-md"
                      >
                        {key}: {val}
                      </span>
                    ))}
                    {Object.keys(s.query_params).length === 0 && (
                      <span className="text-xs text-amber-700">All jobs</span>
                    )}
                  </div>
                  <p className="text-xs text-amber-800">
                    Saved {new Date(s.created_at).toLocaleDateString()} ·
                    In-app: {s.notify_in_app ? "\u2713" : "\u2715"} ·
                    Email: {s.notify_email ? "\u2713" : "\u2715"}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => onToggleInApp(s.id)}
                    className={`text-xs px-3 py-2 rounded-lg border min-h-[44px] transition-colors ${
                      s.notify_in_app
                        ? "bg-market-500/15 text-market-300 border-market-500/30"
                        : "bg-ink-800 text-amber-700 border-market-500/10"
                    }`}
                  >
                    In-app
                  </button>
                  <button
                    onClick={() => onRequestRemove(s.id)}
                    className="text-xs px-3 py-2 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 min-h-[44px] transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <ConfirmDialog
            open={confirmDeleteSearch !== null}
            title="Remove Saved Search"
            description="Are you sure you want to remove this saved search? This action cannot be undone."
            confirmLabel="Yes, Remove"
            onConfirm={onConfirmRemove}
            onCancel={onCancelRemove}
          />
        </>
      )}
    </>
  );
}
