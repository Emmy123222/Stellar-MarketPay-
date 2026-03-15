/**
 * components/ApplicationForm.tsx
 * Freelancer applies to a job with a proposal and bid amount.
 */
import { useState } from "react";
import { submitApplication } from "@/lib/api";
import type { Job } from "@/utils/types";
import { formatXLM } from "@/utils/format";

interface ApplicationFormProps {
  job: Job;
  publicKey: string;
  onSuccess: () => void;
}

export default function ApplicationForm({ job, publicKey, onSuccess }: ApplicationFormProps) {
  const [proposal, setProposal] = useState("");
  const [bidAmount, setBidAmount] = useState(job.budget);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValid = proposal.trim().length >= 50 && parseFloat(bidAmount) > 0;

  const handleSubmit = async () => {
    if (!isValid) return;
    setLoading(true);
    setError(null);
    try {
      await submitApplication({
        jobId: job.id,
        freelancerAddress: publicKey,
        proposal: proposal.trim(),
        bidAmount: parseFloat(bidAmount).toFixed(7),
      });
      onSuccess();
    } catch {
      setError("Failed to submit application. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="card animate-slide-up">
      <h3 className="font-display text-lg font-bold text-amber-100 mb-1">Submit Proposal</h3>
      <p className="text-amber-800 text-sm mb-6">
        Client budget: <span className="text-market-400 font-mono font-medium">{formatXLM(job.budget)}</span>
      </p>

      <div className="space-y-5">
        {/* Cover letter */}
        <div>
          <label className="label">Cover Letter</label>
          <textarea
            value={proposal} onChange={(e) => setProposal(e.target.value)}
            rows={6}
            placeholder="Describe your relevant experience, your approach to this project, and why you're the best fit..."
            className="textarea-field"
          />
          <p className="mt-1 text-xs text-amber-800/50">{proposal.length} chars (min 50)</p>
        </div>

        {/* Bid amount */}
        <div>
          <label className="label">Your Bid (XLM)</label>
          <input
            type="number" value={bidAmount} onChange={(e) => setBidAmount(e.target.value)}
            min="1" step="1" className="input-field"
            placeholder="Enter your bid amount"
          />
          <p className="mt-1 text-xs text-amber-800/50">
            If accepted, this amount will be released from escrow to you on completion.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        <button onClick={handleSubmit} disabled={!isValid || loading} className="btn-primary w-full flex items-center justify-center gap-2">
          {loading ? <><Spinner />Submitting...</> : "Submit Proposal"}
        </button>
      </div>
    </div>
  );
}

function Spinner() {
  return <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>;
}
