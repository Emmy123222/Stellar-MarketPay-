/**
 * components/ExtendJobModal.tsx
 * Modal for extending a job's expiry with XLM fee payment.
 */
import { useState } from "react";
import { extendJobExpiry } from "@/lib/api";
import { formatXLM } from "@/utils/format";
import type { Job } from "@/utils/types";

const EXTENSION_OPTIONS = [
  { days: 7, feeXlm: 0.5, label: "7 days — 0.5 XLM" },
  { days: 14, feeXlm: 1.0, label: "14 days — 1.0 XLM" },
  { days: 30, feeXlm: 2.0, label: "30 days — 2.0 XLM" },
];

interface Props {
  job: Job;
  onClose: () => void;
  onExtended: (updated: Job) => void;
}

export default function ExtendJobModal({ job, onClose, onExtended }: Props) {
  const [selectedDays, setSelectedDays] = useState(30);
  const [extending, setExtending] = useState(false);
  const [error, setError] = useState("");

  const handleExtend = async () => {
    setExtending(true);
    setError("");
    try {
      const updated = await extendJobExpiry(job.id, selectedDays);
      onExtended(updated);
      onClose();
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Failed to extend job",
      );
    } finally {
      setExtending(false);
    }
  };

  const option = EXTENSION_OPTIONS.find((o) => o.days === selectedDays);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="card max-w-md w-full border-market-500/20 animate-in fade-in zoom-in duration-200">
        <h2 className="font-display text-xl font-bold text-amber-100 mb-2">
          Extend Job Expiry
        </h2>
        <p className="text-amber-700/90 text-sm mb-4">
          Extend the duration of <span className="font-semibold text-amber-300">{job.title}</span>
        </p>

        {job.expiresAt && (
          <p className="text-xs text-amber-800 mb-4">
            Current expiry:{" "}
            <span className="text-amber-300">
              {new Date(job.expiresAt).toLocaleDateString()}
            </span>
          </p>
        )}

        <div className="space-y-2 mb-6">
          {EXTENSION_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              onClick={() => setSelectedDays(opt.days)}
              className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors ${
                selectedDays === opt.days
                  ? "border-market-400/60 bg-market-500/15 text-market-300"
                  : "border-market-500/15 bg-ink-900/40 text-amber-700/90 hover:border-market-400/30"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {option && (
          <div className="rounded-xl bg-ink-900/50 border border-market-500/10 p-3 mb-4">
            <p className="text-xs text-amber-800 mb-1">Extension fee</p>
            <p className="font-mono font-semibold text-market-400">
              {formatXLM(option.feeXlm.toString())}
            </p>
          </div>
        )}

        {error && (
          <p className="text-red-400/90 text-xs mb-3">{error}</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="btn-secondary text-sm flex-1"
            disabled={extending}
          >
            Cancel
          </button>
          <button
            onClick={handleExtend}
            disabled={extending}
            className="btn-primary text-sm flex-1 disabled:opacity-50"
          >
            {extending ? "Extending..." : `Extend (${formatXLM((option?.feeXlm || 0).toString())})`}
          </button>
        </div>
      </div>
    </div>
  );
}
