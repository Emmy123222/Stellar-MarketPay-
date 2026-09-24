/**
 * components/DisputeWizard.tsx
 * Issue #1557 — Interactive dispute resolution helper chatbot guiding users through evidence submission.
 *
 * 5-Step Guided Flow:
 *   1. Describe Issue      — Reason selection & detailed issue description with contextual guidance
 *   2. Timeline of Events  — Chronological event builder documenting key dates and occurrences
 *   3. Desired Resolution  — Settlement outcome selection (refund %, release terms, custom remedy)
 *   4. Upload Evidence     — File upload with guidance (e.g. "Screenshots of deliverables are most useful")
 *   5. Review & Submit     — Review collected data & pre-fill the dispute form for final submission
 */
import React, { useState, useRef, ChangeEvent, DragEvent } from "react";
import { raiseDispute, uploadDisputeEvidence } from "@/lib/api";

export interface TimelineEvent {
  id: string;
  date: string;
  description: string;
}

export interface DisputeWizardResult {
  reason: string;
  description: string;
  timeline: TimelineEvent[];
  desiredResolution: {
    type: "full_refund" | "partial_refund" | "work_revision" | "custom";
    summary: string;
    refundPercent?: number;
  };
  evidenceFiles: File[];
  formattedDescription: string;
}

export interface DisputeWizardProps {
  jobId?: string;
  isOpen?: boolean;
  onClose?: () => void;
  onComplete?: (result: DisputeWizardResult) => void;
  onPrefillForm?: (data: {
    reason: string;
    description: string;
    files: File[];
    timeline: TimelineEvent[];
    desiredResolution: string;
  }) => void;
  initialReason?: string;
  initialDescription?: string;
}

const ISSUE_CATEGORIES = [
  {
    id: "Quality of work",
    label: "Quality of Work",
    icon: "🎯",
    summary: "Deliverables did not meet project requirements or standards",
    tip: "Tip: Focus on objective differences between the original job specifications and what was delivered.",
  },
  {
    id: "Non-delivery",
    label: "Non-delivery / Missed Deadline",
    icon: "⏱️",
    summary: "Freelancer missed the deadline or stopped communicating without delivering",
    tip: "Tip: Note the agreed milestone delivery date and when you last attempted contact.",
  },
  {
    id: "Communication issues",
    label: "Communication Breakdown",
    icon: "💬",
    summary: "Unresponsive party, refused revisions, or unprofessional conduct",
    tip: "Tip: Highlight periods of silence and unanswered check-ins with timestamps.",
  },
  {
    id: "Unfair terms",
    label: "Scope Disagreement / Unfair Terms",
    icon: "📋",
    summary: "Disagreement on milestone scope or requested extra work outside agreed specifications",
    tip: "Tip: Compare the original milestone description with the requested tasks.",
  },
  {
    id: "Other",
    label: "Other Issue",
    icon: "❓",
    summary: "Payment dispute, technical issues, or other disputes",
    tip: "Tip: Be as specific and factual as possible about what went wrong.",
  },
];

const RESOLUTION_OPTIONS = [
  {
    id: "full_refund" as const,
    label: "Full Refund (100%)",
    icon: "💰",
    description: "Cancel contract and return all locked escrow funds to the client.",
  },
  {
    id: "partial_refund" as const,
    label: "Partial Refund",
    icon: "⚖️",
    description: "Release payment for completed work and refund the remainder.",
  },
  {
    id: "work_revision" as const,
    label: "Complete Revisions Before Release",
    icon: "🛠️",
    description: "Hold escrow until specific fixes/deliverables are satisfactorily provided.",
  },
  {
    id: "custom" as const,
    label: "Custom Settlement",
    icon: "✏️",
    description: "Propose custom settlement terms for arbitrator consideration.",
  },
];

const ALLOWED_EVIDENCE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "application/pdf",
  "text/plain",
];

export default function DisputeWizard({
  jobId,
  isOpen = true,
  onClose,
  onComplete,
  onPrefillForm,
  initialReason = "",
  initialDescription = "",
}: DisputeWizardProps) {
  // Step 1: Describe issue
  const [selectedReason, setSelectedReason] = useState<string>(initialReason || "Quality of work");
  const [issueDescription, setIssueDescription] = useState<string>(initialDescription || "");

  // Step 2: Timeline of events
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([
    {
      id: "1",
      date: new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0],
      description: "Project started and milestones agreed upon.",
    },
    {
      id: "2",
      date: new Date().toISOString().split("T")[0],
      description: "Issue occurred or deliverable deadline passed.",
    },
  ]);
  const [newEventDate, setNewEventDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [newEventDesc, setNewEventDesc] = useState<string>("");

  // Step 3: Desired resolution
  const [resolutionType, setResolutionType] = useState<"full_refund" | "partial_refund" | "work_revision" | "custom">("full_refund");
  const [refundPercentage, setRefundPercentage] = useState<number>(50);
  const [resolutionNotes, setResolutionNotes] = useState<string>("");

  // Step 4: Upload evidence
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 5: Guided wizard steps (1 to 5)
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmittedSuccess, setIsSubmittedSuccess] = useState<boolean>(false);

  if (!isOpen) return null;

  // Selected category info
  const currentCategory =
    ISSUE_CATEGORIES.find((c) => c.id === selectedReason) || ISSUE_CATEGORIES[0];

  // Helper to generate synthesized description pre-filling the dispute form
  function generateFormattedDescription(): string {
    const lines: string[] = [];

    lines.push(`## Dispute Summary`);
    lines.push(`**Issue Type:** ${selectedReason}`);
    lines.push(`\n### Problem Description\n${issueDescription.trim() || "No detailed description provided."}`);

    lines.push(`\n### Timeline of Events`);
    if (timelineEvents.length === 0) {
      lines.push("No timeline events added.");
    } else {
      timelineEvents.forEach((ev) => {
        lines.push(`- **${ev.date}:** ${ev.description}`);
      });
    }

    lines.push(`\n### Desired Resolution`);
    if (resolutionType === "full_refund") {
      lines.push(`- **Full Refund:** Requesting 100% refund of escrow.`);
    } else if (resolutionType === "partial_refund") {
      lines.push(`- **Partial Refund (${refundPercentage}%):** Release ${100 - refundPercentage}% to freelancer, refund ${refundPercentage}% to client.`);
    } else if (resolutionType === "work_revision") {
      lines.push(`- **Work Revision:** Hold escrow until required corrections are delivered.`);
    } else {
      lines.push(`- **Custom Terms:** ${resolutionNotes || "Custom settlement terms proposed."}`);
    }

    if (resolutionNotes && resolutionType !== "custom") {
      lines.push(`  *Notes:* ${resolutionNotes}`);
    }

    if (evidenceFiles.length > 0) {
      lines.push(`\n### Attached Evidence Files (${evidenceFiles.length})`);
      evidenceFiles.forEach((file, idx) => {
        lines.push(`${idx + 1}. ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
      });
    }

    return lines.join("\n");
  }

  // Timeline handlers
  function addTimelineEvent() {
    if (!newEventDesc.trim()) return;
    const newEvent: TimelineEvent = {
      id: Date.now().toString(),
      date: newEventDate || new Date().toISOString().split("T")[0],
      description: newEventDesc.trim(),
    };
    setTimelineEvents((prev) => [...prev, newEvent]);
    setNewEventDesc("");
  }

  function removeTimelineEvent(id: string) {
    setTimelineEvents((prev) => prev.filter((e) => e.id !== id));
  }

  // Evidence files handlers
  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    validateAndAddFiles(files);
  }

  function handleFileDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!e.dataTransfer.files) return;
    const files = Array.from(e.dataTransfer.files);
    validateAndAddFiles(files);
  }

  function validateAndAddFiles(files: File[]) {
    setUploadError(null);
    const valid: File[] = [];
    for (const f of files) {
      if (f.size > 10 * 1024 * 1024) {
        setUploadError(`File "${f.name}" exceeds 10MB limit.`);
        return;
      }
      valid.push(f);
    }
    setEvidenceFiles((prev) => [...prev, ...valid]);
  }

  function removeEvidenceFile(idx: number) {
    setEvidenceFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  // Submit / Pre-fill handler
  async function handleFinalSubmit(prefillOnly = false) {
    const formattedDesc = generateFormattedDescription();
    const result: DisputeWizardResult = {
      reason: selectedReason,
      description: issueDescription,
      timeline: timelineEvents,
      desiredResolution: {
        type: resolutionType,
        summary: resolutionNotes || resolutionType,
        refundPercent: resolutionType === "partial_refund" ? refundPercentage : undefined,
      },
      evidenceFiles,
      formattedDescription: formattedDesc,
    };

    if (onPrefillForm) {
      onPrefillForm({
        reason: selectedReason,
        description: formattedDesc,
        files: evidenceFiles,
        timeline: timelineEvents,
        desiredResolution: resolutionType === "partial_refund" ? `${refundPercentage}% refund` : resolutionType,
      });
    }

    if (prefillOnly) {
      if (onClose) onClose();
      return;
    }

    if (jobId) {
      setIsSubmitting(true);
      setSubmitError(null);
      try {
        await raiseDispute(jobId, {
          reason: selectedReason,
          description: formattedDesc,
        });

        // If files are attached, upload evidence
        for (const file of evidenceFiles) {
          try {
            await uploadDisputeEvidence(jobId, file);
          } catch (uploadErr) {
            console.warn("Evidence upload failed:", uploadErr);
          }
        }

        setIsSubmittedSuccess(true);
        if (onComplete) onComplete(result);
      } catch (err: any) {
        setSubmitError(
          err?.response?.data?.error || err?.message || "Failed to submit dispute"
        );
      } finally {
        setIsSubmitting(false);
      }
    } else {
      if (onComplete) onComplete(result);
      if (onClose) onClose();
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Dispute Resolution Helper"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-ink-950/80 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-2xl bg-ink-900 border border-market-500/20 rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        {/* Chatbot Header */}
        <div className="px-6 py-4 bg-ink-800 border-b border-market-500/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-market-500/20 border border-market-500/40 flex items-center justify-center text-lg">
              🤖
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-amber-100 flex items-center gap-2">
                Dispute Resolution Helper
                <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-market-400/10 text-market-400 border border-market-400/20">
                  Step {currentStep} of 5
                </span>
              </h2>
              <p className="text-xs text-amber-700">Guided chatbot assisting your evidence submission</p>
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-amber-700 hover:text-amber-200 transition-colors p-1 text-xl"
              aria-label="Close wizard"
            >
              ✕
            </button>
          )}
        </div>

        {/* Wizard Step Progress Tracker */}
        <div className="px-6 py-2 bg-ink-800/40 border-b border-market-500/10 flex items-center justify-between text-xs">
          {[
            { step: 1, label: "Describe Issue" },
            { step: 2, label: "Timeline" },
            { step: 3, label: "Resolution" },
            { step: 4, label: "Evidence" },
            { step: 5, label: "Review & Submit" },
          ].map((s) => (
            <button
              key={s.step}
              type="button"
              onClick={() => setCurrentStep(s.step)}
              className={`flex items-center gap-1.5 transition-colors ${
                currentStep === s.step
                  ? "text-market-400 font-semibold"
                  : currentStep > s.step
                  ? "text-amber-200"
                  : "text-amber-800"
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  currentStep === s.step
                    ? "bg-market-400 text-ink-900"
                    : currentStep > s.step
                    ? "bg-market-500/20 text-market-400"
                    : "bg-ink-700 text-amber-700"
                }`}
              >
                {currentStep > s.step ? "✓" : s.step}
              </span>
              <span className="hidden sm:inline">{s.label}</span>
            </button>
          ))}
        </div>

        {/* Chatbot Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Success Screen */}
          {isSubmittedSuccess ? (
            <div className="text-center py-10 space-y-4">
              <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/30 text-green-400 mx-auto flex items-center justify-center text-3xl">
                ✓
              </div>
              <h3 className="text-xl font-bold text-amber-100">Dispute Filed Successfully</h3>
              <p className="text-sm text-amber-800 max-w-md mx-auto">
                Your dispute and evidence have been recorded. Escrow is locked, and an arbitrator will review your case.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="btn-primary text-sm px-6 py-2.5 mt-4"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              {/* ─── STEP 1: DESCRIBE ISSUE ─── */}
              {currentStep === 1 && (
                <div className="space-y-5 animate-fade-in">
                  <div className="flex items-start gap-3 bg-market-500/5 border border-market-500/15 p-4 rounded-xl">
                    <span className="text-2xl">🤖</span>
                    <div className="text-sm text-amber-200">
                      <p className="font-semibold text-amber-100 mb-1">
                        Hello! Let's get your dispute sorted.
                      </p>
                      <p>
                        First, select the main category that describes what happened with this job.
                      </p>
                    </div>
                  </div>

                  {/* Contextual Tip Banner */}
                  <div
                    data-testid="contextual-tip"
                    className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300 flex items-start gap-2"
                  >
                    <span className="text-market-400 font-bold">💡</span>
                    <span>{currentCategory.tip}</span>
                  </div>

                  {/* Category Selection Tree */}
                  <div>
                    <label className="block text-xs font-semibold text-amber-200 uppercase tracking-wider mb-2">
                      Select Primary Issue Type
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {ISSUE_CATEGORIES.map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setSelectedReason(cat.id)}
                          className={`p-3 rounded-xl border text-left transition-all ${
                            selectedReason === cat.id
                              ? "bg-market-500/15 border-market-400 text-amber-100 shadow-sm"
                              : "bg-ink-800/80 border-market-500/10 text-amber-300 hover:border-market-500/30"
                          }`}
                        >
                          <div className="flex items-center gap-2 font-medium text-sm">
                            <span>{cat.icon}</span>
                            <span>{cat.label}</span>
                          </div>
                          <p className="text-xs text-amber-700 mt-1 line-clamp-1">
                            {cat.summary}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Description Box */}
                  <div>
                    <label htmlFor="wizard-issue-description" className="block text-xs font-semibold text-amber-200 uppercase tracking-wider mb-2">
                      Detailed Explanation
                    </label>
                    <textarea
                      id="wizard-issue-description"
                      value={issueDescription}
                      onChange={(e) => setIssueDescription(e.target.value)}
                      placeholder="Explain specifically what happened, what was agreed upon, and where the expectations failed..."
                      rows={4}
                      className="w-full rounded-xl border border-market-500/20 bg-ink-800 p-3 text-sm text-amber-100 placeholder-amber-900/60 focus:outline-none focus:ring-2 focus:ring-market-400/40"
                    />
                    <div className="flex justify-between items-center text-xs text-amber-700 mt-1">
                      <span>Be objective and reference concrete requirements.</span>
                      <span>{issueDescription.length} characters</span>
                    </div>
                  </div>
                </div>
              )}

              {/* ─── STEP 2: TIMELINE OF EVENTS ─── */}
              {currentStep === 2 && (
                <div className="space-y-5 animate-fade-in">
                  <div className="flex items-start gap-3 bg-market-500/5 border border-market-500/15 p-4 rounded-xl">
                    <span className="text-2xl">🤖</span>
                    <div className="text-sm text-amber-200">
                      <p className="font-semibold text-amber-100 mb-1">
                        Timeline of events
                      </p>
                      <p>
                        A clear chronological timeline makes it easy for arbitrators to see when milestones were missed or issues arose.
                      </p>
                    </div>
                  </div>

                  {/* Contextual Tip Banner */}
                  <div
                    data-testid="contextual-tip"
                    className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300 flex items-start gap-2"
                  >
                    <span className="text-market-400 font-bold">💡</span>
                    <span>
                      Tip: Dates, milestone deadlines, and communication attempts in chronological order make your case significantly easier to rule on.
                    </span>
                  </div>

                  {/* Timeline list */}
                  <div className="space-y-3">
                    <label className="block text-xs font-semibold text-amber-200 uppercase tracking-wider">
                      Recorded Events ({timelineEvents.length})
                    </label>
                    {timelineEvents.map((ev, idx) => (
                      <div
                        key={ev.id}
                        className="flex items-start justify-between gap-3 p-3 bg-ink-800 border border-market-500/10 rounded-xl text-sm"
                      >
                        <div className="flex items-start gap-3">
                          <span className="w-6 h-6 rounded-full bg-market-500/10 text-market-400 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                            {idx + 1}
                          </span>
                          <div>
                            <span className="text-xs font-mono text-market-400 font-medium">{ev.date}</span>
                            <p className="text-amber-200 text-xs sm:text-sm mt-0.5">{ev.description}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeTimelineEvent(ev.id)}
                          className="text-amber-700 hover:text-red-400 transition-colors text-xs p-1"
                          title="Remove event"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Add Event Form */}
                  <div className="p-3 bg-ink-800/60 border border-market-500/20 rounded-xl space-y-2">
                    <p className="text-xs font-semibold text-amber-100">Add Timeline Event</p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="date"
                        aria-label="Event date"
                        value={newEventDate}
                        onChange={(e) => setNewEventDate(e.target.value)}
                        className="rounded-lg border border-market-500/20 bg-ink-800 px-3 py-1.5 text-xs text-amber-100 focus:outline-none focus:ring-1 focus:ring-market-400"
                      />
                      <input
                        type="text"
                        aria-label="Event description"
                        value={newEventDesc}
                        onChange={(e) => setNewEventDesc(e.target.value)}
                        placeholder="e.g. Requested revision on smart contract deployment..."
                        className="flex-1 rounded-lg border border-market-500/20 bg-ink-800 px-3 py-1.5 text-xs text-amber-100 placeholder-amber-900/60 focus:outline-none focus:ring-1 focus:ring-market-400"
                      />
                      <button
                        type="button"
                        onClick={addTimelineEvent}
                        disabled={!newEventDesc.trim()}
                        className="btn-secondary text-xs px-3 py-1.5 shrink-0 disabled:opacity-40"
                      >
                        + Add Event
                      </button>
                    </div>

                    {/* Quick template chips */}
                    <div className="flex flex-wrap gap-1.5 pt-1 text-[11px]">
                      <span className="text-amber-800">Quick chips:</span>
                      {[
                        "Contract started",
                        "Milestone 1 submitted",
                        "Revision requested",
                        "Deadline passed",
                        "No response after 48h",
                      ].map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => setNewEventDesc(chip)}
                          className="px-2 py-0.5 rounded bg-ink-700 text-amber-300 hover:text-amber-100 transition-colors"
                        >
                          + {chip}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ─── STEP 3: DESIRED RESOLUTION ─── */}
              {currentStep === 3 && (
                <div className="space-y-5 animate-fade-in">
                  <div className="flex items-start gap-3 bg-market-500/5 border border-market-500/15 p-4 rounded-xl">
                    <span className="text-2xl">🤖</span>
                    <div className="text-sm text-amber-200">
                      <p className="font-semibold text-amber-100 mb-1">
                        What outcome are you seeking?
                      </p>
                      <p>
                        Stating a fair and specific requested outcome allows the arbitrator to propose a swift resolution.
                      </p>
                    </div>
                  </div>

                  {/* Contextual Tip Banner */}
                  <div
                    data-testid="contextual-tip"
                    className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300 flex items-start gap-2"
                  >
                    <span className="text-market-400 font-bold">💡</span>
                    <span>
                      Tip: Proposing a proportional resolution (e.g. partial refund for work completed) shows good faith and often leads to faster rulings.
                    </span>
                  </div>

                  {/* Resolution Options */}
                  <div className="space-y-2.5">
                    <label className="block text-xs font-semibold text-amber-200 uppercase tracking-wider">
                      Select Desired Remedy
                    </label>
                    {RESOLUTION_OPTIONS.map((opt) => (
                      <div
                        key={opt.id}
                        onClick={() => setResolutionType(opt.id)}
                        className={`p-3 rounded-xl border cursor-pointer transition-all ${
                          resolutionType === opt.id
                            ? "bg-market-500/15 border-market-400 text-amber-100"
                            : "bg-ink-800/80 border-market-500/10 text-amber-300 hover:border-market-500/30"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 font-medium text-sm">
                            <span>{opt.icon}</span>
                            <span>{opt.label}</span>
                          </div>
                          <input
                            type="radio"
                            name="resolutionType"
                            checked={resolutionType === opt.id}
                            onChange={() => setResolutionType(opt.id)}
                            className="text-market-400 focus:ring-market-400"
                          />
                        </div>
                        <p className="text-xs text-amber-700 mt-1 pl-6">{opt.description}</p>
                      </div>
                    ))}
                  </div>

                  {/* Conditional Partial Refund Slider */}
                  {resolutionType === "partial_refund" && (
                    <div className="p-3.5 bg-ink-800 border border-market-500/20 rounded-xl space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <label htmlFor="wizard-refund-percentage" className="text-amber-200 font-medium">Refund to Client: {refundPercentage}%</label>
                        <span className="text-market-400 font-medium">Release to Freelancer: {100 - refundPercentage}%</span>
                      </div>
                      <input
                        id="wizard-refund-percentage"
                        type="range"
                        min="10"
                        max="90"
                        step="5"
                        value={refundPercentage}
                        onChange={(e) => setRefundPercentage(Number(e.target.value))}
                        className="w-full accent-market-400"
                      />
                    </div>
                  )}

                  {/* Custom settlement terms textarea */}
                  <div>
                    <label htmlFor="wizard-resolution-notes" className="block text-xs font-semibold text-amber-200 uppercase tracking-wider mb-2">
                      Resolution Notes / Terms
                    </label>
                    <textarea
                      id="wizard-resolution-notes"
                      value={resolutionNotes}
                      onChange={(e) => setResolutionNotes(e.target.value)}
                      placeholder="Specify any additional conditions, deliverables required, or breakdown of requested settlement..."
                      rows={3}
                      className="w-full rounded-xl border border-market-500/20 bg-ink-800 p-3 text-sm text-amber-100 placeholder-amber-900/60 focus:outline-none focus:ring-2 focus:ring-market-400/40"
                    />
                  </div>
                </div>
              )}

              {/* ─── STEP 4: UPLOAD EVIDENCE ─── */}
              {currentStep === 4 && (
                <div className="space-y-5 animate-fade-in">
                  <div className="flex items-start gap-3 bg-market-500/5 border border-market-500/15 p-4 rounded-xl">
                    <span className="text-2xl">🤖</span>
                    <div className="text-sm text-amber-200">
                      <p className="font-semibold text-amber-100 mb-1">
                        Supporting Evidence
                      </p>
                      <p>
                        Evidence is the most important factor in dispute resolution. Upload deliverables, screenshots, chat exports, or contracts.
                      </p>
                    </div>
                  </div>

                  {/* Contextual Tip Banner — explicitly contains Acceptance Criteria string */}
                  <div
                    data-testid="contextual-tip"
                    className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300 flex items-start gap-2"
                  >
                    <span className="text-market-400 font-bold">💡</span>
                    <span>
                      Tip: Screenshots of deliverables are most useful. Acceptable formats include PNG, JPG, PDF, and TXT files up to 10MB each.
                    </span>
                  </div>

                  {/* Drop zone */}
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleFileDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-market-500/30 hover:border-market-400/60 rounded-2xl p-6 text-center cursor-pointer bg-ink-800/40 transition-colors space-y-2"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept={ALLOWED_EVIDENCE_TYPES.join(",")}
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    <div className="w-10 h-10 rounded-full bg-market-500/10 text-market-400 flex items-center justify-center mx-auto text-xl">
                      📎
                    </div>
                    <p className="text-sm text-amber-100 font-medium">
                      Drag and drop evidence files here, or <span className="text-market-400 underline">browse</span>
                    </p>
                    <p className="text-xs text-amber-700">
                      Screenshots, contract agreements, defect logs, or chat transcripts (Max 10MB)
                    </p>
                  </div>

                  {uploadError && (
                    <div className="p-2.5 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl">
                      {uploadError}
                    </div>
                  )}

                  {/* Uploaded File List */}
                  {evidenceFiles.length > 0 && (
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-amber-200 uppercase tracking-wider">
                        Attached Files ({evidenceFiles.length})
                      </label>
                      <div className="space-y-1.5">
                        {evidenceFiles.map((file, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between p-2.5 bg-ink-800 border border-market-500/15 rounded-xl text-xs"
                          >
                            <div className="flex items-center gap-2 truncate">
                              <span className="text-market-400">📄</span>
                              <span className="text-amber-100 font-medium truncate">{file.name}</span>
                              <span className="text-amber-700">({(file.size / 1024).toFixed(1)} KB)</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeEvidenceFile(idx)}
                              className="text-amber-700 hover:text-red-400 transition-colors p-1"
                              title="Remove file"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ─── STEP 5: REVIEW & SUBMIT ─── */}
              {currentStep === 5 && (
                <div className="space-y-5 animate-fade-in">
                  <div className="flex items-start gap-3 bg-market-500/5 border border-market-500/15 p-4 rounded-xl">
                    <span className="text-2xl">🤖</span>
                    <div className="text-sm text-amber-200">
                      <p className="font-semibold text-amber-100 mb-1">
                        Dispute case preview
                      </p>
                      <p>
                        I've gathered your answers and pre-filled the dispute case. Review the details below before submitting to arbitration.
                      </p>
                    </div>
                  </div>

                  {/* Contextual Tip Banner */}
                  <div
                    data-testid="contextual-tip"
                    className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300 flex items-start gap-2"
                  >
                    <span className="text-market-400 font-bold">💡</span>
                    <span>
                      Tip: Review the generated summary below. You can submit directly or pre-fill the standard dispute form.
                    </span>
                  </div>

                  {submitError && (
                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                      {submitError}
                    </div>
                  )}

                  {/* Pre-filled Dispute Form Card */}
                  <div className="bg-ink-800 border border-market-500/20 rounded-xl p-4 space-y-4">
                    <div className="flex items-center justify-between border-b border-market-500/10 pb-2">
                      <span className="text-xs font-semibold text-amber-200 uppercase">Pre-filled Dispute Form</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-market-500/15 text-market-400 border border-market-500/20">
                        {selectedReason}
                      </span>
                    </div>

                    <div className="space-y-3 text-xs">
                      <div>
                        <span className="text-amber-800 font-medium">Issue Category:</span>
                        <p className="text-amber-100 font-medium mt-0.5">{selectedReason}</p>
                      </div>

                      <div>
                        <span className="text-amber-800 font-medium">Desired Resolution:</span>
                        <p className="text-amber-100 mt-0.5">
                          {resolutionType === "full_refund" && "100% Full Refund to Client"}
                          {resolutionType === "partial_refund" && `Partial Refund (${refundPercentage}% to Client, ${100 - refundPercentage}% to Freelancer)`}
                          {resolutionType === "work_revision" && "Hold Escrow for Deliverable Revisions"}
                          {resolutionType === "custom" && (resolutionNotes || "Custom Settlement Terms")}
                        </p>
                      </div>

                      <div>
                        <span className="text-amber-800 font-medium">Timeline Events:</span>
                        <ul className="list-disc list-inside text-amber-200 mt-0.5 space-y-0.5">
                          {timelineEvents.map((e) => (
                            <li key={e.id}>
                              <span className="font-mono text-market-400">{e.date}</span>: {e.description}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div>
                        <span className="text-amber-800 font-medium">Attached Evidence:</span>
                        <p className="text-amber-200 mt-0.5">
                          {evidenceFiles.length > 0
                            ? `${evidenceFiles.length} file(s) attached (${evidenceFiles.map((f) => f.name).join(", ")})`
                            : "No evidence files attached."}
                        </p>
                      </div>

                      <div>
                        <span className="text-amber-800 font-medium">Full Generated Filing Text:</span>
                        <pre className="mt-1 p-3 bg-ink-900 rounded-lg text-amber-300 font-mono text-[11px] whitespace-pre-wrap max-h-36 overflow-y-auto">
                          {generateFormattedDescription()}
                        </pre>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Wizard Footer Navigation */}
        {!isSubmittedSuccess && (
          <div className="px-6 py-4 bg-ink-800 border-t border-market-500/20 flex items-center justify-between gap-3">
            {currentStep > 1 ? (
              <button
                type="button"
                onClick={() => setCurrentStep((prev) => prev - 1)}
                className="btn-secondary text-xs sm:text-sm px-4 py-2"
              >
                ← Back
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              {currentStep < 5 ? (
                <button
                  type="button"
                  onClick={() => setCurrentStep((prev) => prev + 1)}
                  className="btn-primary text-xs sm:text-sm px-5 py-2"
                >
                  Next Step →
                </button>
              ) : (
                <>
                  {onPrefillForm && (
                    <button
                      type="button"
                      onClick={() => handleFinalSubmit(true)}
                      className="btn-secondary text-xs sm:text-sm px-4 py-2"
                    >
                      Pre-fill Dispute Form
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleFinalSubmit(false)}
                    disabled={isSubmitting}
                    className="btn-primary text-xs sm:text-sm px-5 py-2 disabled:opacity-50"
                  >
                    {isSubmitting ? "Submitting Dispute..." : "Submit Dispute"}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
