/**
 * components/PriceAlertModal.tsx
 * Modal for setting up XLM price alerts with condition (above/below) and threshold.
 * Issue #887
 */
import { useState, useEffect } from "react";
import { useToast } from "./Toast";
import { createPriceAlert, fetchPriceAlerts, deletePriceAlert, getApiErrorMessage } from "@/lib/api";
import type { PriceAlert } from "@/utils/types";

interface PriceAlertModalProps {
  open: boolean;
  onClose: () => void;
  currentPriceUsd: number | null;
}

export default function PriceAlertModal({
  open,
  onClose,
  currentPriceUsd,
}: PriceAlertModalProps) {
  const { success, error } = useToast();
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [condition, setCondition] = useState<"above" | "below">("above");
  const [threshold, setThreshold] = useState("");
  const [oneTime, setOneTime] = useState(true);

  useEffect(() => {
    if (open) {
      loadAlerts();
    }
  }, [open]);

  async function loadAlerts() {
    setLoading(true);
    try {
      const data = await fetchPriceAlerts();
      setAlerts(data);
    } catch {
      // silently fail — the list is not critical
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    const thresholdNum = parseFloat(threshold);
    if (Number.isNaN(thresholdNum) || thresholdNum <= 0) {
      error("Please enter a valid positive threshold.");
      return;
    }

    setSaving(true);
    try {
      await createPriceAlert({ condition, threshold: thresholdNum, oneTime });
      success("Price alert created! You'll be notified when the threshold is crossed.");
      setThreshold("");
      await loadAlerts();
    } catch (err) {
      error(getApiErrorMessage(err, "Failed to create price alert."));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(alertId: string) {
    try {
      await deletePriceAlert(alertId);
      success("Price alert deleted.");
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    } catch (err) {
      error(getApiErrorMessage(err, "Failed to delete price alert."));
    }
  }

  function suggestedThreshold(): string {
    if (!currentPriceUsd) return "";
    if (condition === "above") {
      return (currentPriceUsd * 1.1).toFixed(4);
    }
    return (currentPriceUsd * 0.9).toFixed(4);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 w-full bg-black/60 backdrop-blur-sm cursor-default"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md rounded-2xl border border-market-500/20 bg-gradient-to-b from-ink-800 to-ink-900 shadow-2xl shadow-black/40 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-market-500/15">
          <div>
            <h2 className="text-lg font-bold text-amber-100">⚡ XLM Price Alert</h2>
            <p className="text-xs text-amber-700 mt-0.5">
              {currentPriceUsd !== null
                ? `Current price: $${currentPriceUsd.toFixed(4)} USD`
                : "Fetching current price..."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-amber-700 hover:text-amber-300 hover:bg-market-500/10 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Create Alert Form */}
        <div className="px-6 py-5 space-y-4">
          <div>
            <span id="alert-direction" className="block text-sm font-medium text-amber-200 mb-2">
              Notify me when XLM goes…
            </span>
            <div className="flex gap-2" role="group" aria-labelledby="alert-direction">
              <button
                type="button"
                onClick={() => setCondition("above")}
                className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all ${
                  condition === "above"
                    ? "bg-emerald-600/30 text-emerald-300 ring-2 ring-emerald-500/50"
                    : "bg-market-500/10 text-amber-600 hover:text-amber-400 hover:bg-market-500/20"
                }`}
              >
                ⬆ Above
              </button>
              <button
                type="button"
                onClick={() => setCondition("below")}
                className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all ${
                  condition === "below"
                    ? "bg-rose-600/30 text-rose-300 ring-2 ring-rose-500/50"
                    : "bg-market-500/10 text-amber-600 hover:text-amber-400 hover:bg-market-500/20"
                }`}
              >
                ⬇ Below
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="threshold" className="block text-sm font-medium text-amber-200 mb-1.5">
              Price threshold (USD)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-600 font-mono text-sm">
                $
              </span>
              <input
                id="threshold"
                type="number"
                step="0.0001"
                min="0.0001"
                placeholder={suggestedThreshold() || "0.1500"}
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className="w-full pl-7 pr-4 py-2.5 rounded-xl bg-ink-900 border border-market-500/25 text-amber-100 text-sm font-mono placeholder:text-amber-800 focus:outline-none focus:ring-2 focus:ring-market-400/50 focus:border-market-400/50"
              />
            </div>
            {currentPriceUsd !== null && (
              <p className="text-[11px] text-amber-700 mt-1.5">
                Suggestion: {condition === "above" ? "10% above current" : "10% below current"} → <strong className="text-amber-500">${suggestedThreshold()}</strong>
              </p>
            )}
          </div>

          <label className="flex items-center gap-3 cursor-pointer group">
            <div className="relative">
              <input
                type="checkbox"
                checked={oneTime}
                onChange={(e) => setOneTime(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 rounded-full bg-ink-900 border border-market-500/25 peer-checked:bg-market-500/30 peer-checked:border-market-400/50 transition-colors" />
              <div className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-amber-700 peer-checked:bg-market-400 peer-checked:translate-x-4 transition-all" />
            </div>
            <span className="text-sm text-amber-300 group-hover:text-amber-200 transition-colors">
              One-time alert <span className="text-amber-700">(auto-deletes after triggering)</span>
            </span>
          </label>

          <button
            type="button"
            onClick={handleCreate}
            disabled={saving || !threshold}
            className="w-full py-2.5 rounded-xl bg-market-500/20 hover:bg-market-500/30 text-market-300 font-semibold text-sm border border-market-500/30 hover:border-market-400/40 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Creating...
              </span>
            ) : (
              "Create Alert"
            )}
          </button>
        </div>

        {/* Active Alerts List */}
        <div className="px-6 pb-6">
          <h3 className="text-sm font-semibold text-amber-200 mb-3">
            Active Alerts {alerts.length > 0 && <span className="text-amber-700 font-normal">({alerts.length})</span>}
          </h3>

          {loading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-12 rounded-xl bg-market-500/10 animate-pulse" />
              ))}
            </div>
          ) : alerts.length === 0 ? (
            <p className="text-xs text-amber-700 text-center py-4 bg-market-500/5 rounded-xl border border-dashed border-market-500/15">
              No active alerts. Create one above.
            </p>
          ) : (
            <div              className="space-y-2 max-h-48 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-market-500/20 scrollbar-track-transparent">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-center justify-between px-4 py-3 rounded-xl bg-market-500/8 border border-market-500/15"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-bold ${
                        alert.condition === "above" ? "text-emerald-400" : "text-rose-400"
                      }`}>
                        {alert.condition === "above" ? "⬆" : "⬇"} {alert.condition === "above" ? "Above" : "Below"}
                      </span>
                      <span className="text-sm font-mono text-amber-100">
                        ${Number(alert.threshold).toFixed(4)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {alert.oneTime && (
                        <span className="text-[10px] text-amber-800 bg-amber-500/10 px-1.5 py-0.5 rounded">
                          One-time
                        </span>
                      )}
                      {alert.triggered && (
                        <span className="text-[10px] text-emerald-800 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                          Triggered
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(alert.id)}
                    className="p-1.5 rounded-lg text-rose-700 hover:text-rose-400 hover:bg-rose-500/10 transition-colors flex-shrink-0"
                    aria-label="Delete alert"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
