/**
 * components/ApplicationForm.tsx
 * Freelancer applies to a job with a proposal and bid amount.
 */
import { useState, useEffect } from "react";
import { submitApplication, fetchProposalTemplates } from "@/lib/api";
import type { Job } from "@/utils/types";
import { formatXLM } from "@/utils/format";
import { useToast } from "./Toast";
import clsx from "clsx";

interface ApplicationFormProps {
  job: Job;
  publicKey: string;
  prefillData?: {
    bidAmount?: string;
    message?: string;
  };
  onSuccess: () => void;
}

export default function ApplicationForm({ job, publicKey, prefillData, onSuccess }: ApplicationFormProps) {
  const [proposal, setProposal] = useState(prefillData?.message || "");
  const toast = useToast();
  const [bidAmount, setBidAmount] = useState(prefillData?.bidAmount || job.budget);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [screeningAnswers, setScreeningAnswers] = useState<Record<string, string>>({});
  const [templates, setTemplates] = useState<{ id: string; name: string; content: string }[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  // Issue #152 — enforce 50-word minimum on the proposal.
  const wordCount = proposal.trim() === "" ? 0 : proposal.trim().split(/\s+/).length;
  const MIN_WORDS = 50;
  const wordsRemaining = Math.max(0, MIN_WORDS - wordCount);
  const meetsWordMinimum = wordCount >= MIN_WORDS;

  const isValid = meetsWordMinimum && parseFloat(bidAmount) > 0;

  // Initialize screening answers when job changes
  useEffect(() => {
    if (job.screeningQuestions && job.screeningQuestions.length > 0) {
      const initialAnswers: Record<string, string> = {};
      job.screeningQuestions.forEach(q => {
        initialAnswers[q] = "";
      });
      setScreeningAnswers(initialAnswers);
    }
  }, [job.screeningQuestions]);

  useEffect(() => {
    fetchProposalTemplates().then(setTemplates).catch(() => {});
  }, []);

  const allScreeningQuestionsAnswered = job.screeningQuestions && job.screeningQuestions.length > 0
    ? job.screeningQuestions.every(q => screeningAnswers[q] && screeningAnswers[q].trim().length > 0)
    : true;

  const isFormValid = isValid && allScreeningQuestionsAnswered;

  const handleSubmit = () => {
    if (!isFormValid) return;
    setShowConfirm(true);
  };

  const handleConfirmSubmit = async () => {
    setShowConfirm(false);
    setLoading(true);
    setError(null);
    try {
      const referredBy = typeof window !== "undefined" ? localStorage.getItem(`referral_${job.id}`) : null;
      await submitApplication({
        jobId: job.id,
        freelancerAddress: publicKey,
        proposal: proposal.trim(),
        bidAmount: parseFloat(bidAmount).toFixed(7),
        screeningAnswers: job.screeningQuestions && job.screeningQuestions.length > 0 ? screeningAnswers : undefined,
        referredBy: referredBy || undefined,
      });
      toast.success("Proposal submitted successfully!");
      onSuccess();
    } catch {
      toast.error("Failed to submit application. Please try again.");
      setLoading(false);
    }
  };

  return (
    <>
      <div className="card animate-slide-up">
        <h3 className="font-display text-lg font-bold text-amber-100 mb-1">Submit Proposal</h3>
        <p className="text-amber-800 text-sm mb-6">
          Client budget: <span className="text-market-400 font-mono font-medium">{formatXLM(job.budget)}</span>
        </p>

        <div className="space-y-5">
          <div>
            <label className="label">Use Template</label>
            <select
              value={selectedTemplateId}
              onChange={(e) => {
                const templateId = e.target.value;
                setSelectedTemplateId(templateId);
                const template = templates.find((item) => item.id === templateId);
                if (template) setProposal(template.content);
              }}
              className="input-field appearance-none cursor-pointer"
            >
              <option value="">Select a template...</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>

          {/* Cover letter */}
          <div>
            <label className="label">Cover Letter</label>
            <textarea
              value={proposal} onChange={(e) => setProposal(e.target.value)}
              rows={6}
              placeholder="Describe your relevant experience, your approach to this project, and why you're the best fit..."
              className={clsx(
                "textarea-field",
                proposal.length > 0 && !meetsWordMinimum && "border-red-500/40"
              )}
              aria-invalid={proposal.length > 0 && !meetsWordMinimum}
              aria-describedby="proposal-word-count"
            />
            <p
              id="proposal-word-count"
              className={clsx(
                "mt-1 text-xs font-medium",
                meetsWordMinimum ? "text-green-400" : "text-red-400"
              )}
            >
              {wordCount} {wordCount === 1 ? "word" : "words"} (minimum {MIN_WORDS})
              {!meetsWordMinimum && (
                <span className="ml-1 text-amber-800/80 font-normal">
                  — {wordsRemaining} more {wordsRemaining === 1 ? "word" : "words"} needed
                </span>
              )}
            </p>
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

          {/* Screening Questions */}
          {job.screeningQuestions && job.screeningQuestions.length > 0 && (
            <div>
              <label className="label">Screening Questions <span className="text-red-400">*</span></label>
              <p className="text-xs text-amber-800/50 mb-3">Please answer all questions to submit your application.</p>
              <div className="space-y-4">
                {job.screeningQuestions.map((question, index) => (
                  <div key={index}>
                    <label className="text-sm text-amber-200 mb-1.5 block">
                      {index + 1}. {question}
                    </label>
                    <textarea
                      value={screeningAnswers[question] || ""}
                      onChange={(e) => setScreeningAnswers({ ...screeningAnswers, [question]: e.target.value })}
                      rows={3}
                      placeholder="Your answer..."
                      className="textarea-field"
                    />
                  </div>
                ))}
              </div>
              {!allScreeningQuestionsAnswered && (
                <p className="mt-2 text-xs text-red-400">All screening questions must be answered</p>
              )}
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
          )}

          <button onClick={handleSubmit} disabled={!isFormValid || loading} className="btn-primary w-full flex items-center justify-center gap-2">
            {loading ? <><Spinner />Submitting...</> : "Submit Proposal"}
          </button>
        </div>
      </div>

      {showConfirm && (
        <ConfirmModal
          jobTitle={job.title}
          bidAmount={bidAmount}
          proposal={proposal}
          onConfirm={handleConfirmSubmit}
          onClose={() => setShowConfirm(false)}
        />
      )}
    </>
  );
}

interface ConfirmModalProps {
  jobTitle: string;
  bidAmount: string;
  proposal: string;
  onConfirm: () => void;
  onClose: () => void;
}

function ConfirmModal({ jobTitle, bidAmount, proposal, onConfirm, onClose }: ConfirmModalProps) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0c0a06]/90 backdrop-blur-sm animate-fade-in">
      <div className="card w-full max-w-lg gold-glow border-market-500/30 animate-scale-up" role="dialog" aria-modal="true">
        <h3 className="font-display text-xl font-bold text-amber-100 mb-4">Confirm Your Application</h3>
        
        <div className="space-y-4 mb-6">
          <div>
            <span className="text-amber-800 text-xs uppercase tracking-wider font-semibold block mb-1">Job</span>
            <p className="text-amber-100 font-medium">{jobTitle}</p>
          </div>
          
          <div>
            <span className="text-amber-800 text-xs uppercase tracking-wider font-semibold block mb-1">Your Bid</span>
            <p className="text-market-400 font-mono font-bold text-lg">{formatXLM(bidAmount)}</p>
          </div>
          
          <div>
            <span className="text-amber-800 text-xs uppercase tracking-wider font-semibold block mb-1">Proposal Preview</span>
            <p className="text-amber-100/70 text-sm line-clamp-3 italic">
              {'\u201c'}
              {proposal.slice(0, 100)}
              {proposal.length > 100 ? "..." : ""}
              {'\u201d'}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <p className="text-amber-500 text-xs font-semibold flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Warning: Applications cannot be withdrawn
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <button onClick={onConfirm} className="btn-primary flex-1">Confirm & Submit</button>
          <button onClick={onClose} className="btn-secondary flex-1">Go back</button>
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>;
}
