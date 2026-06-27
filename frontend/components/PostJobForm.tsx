/**
 * components/PostJobForm.tsx
 * Issue #494 — Multi-step job posting form with progress indicator.
 *
 * Steps:
 *   1. Basic Info     — title, description, category
 *   2. Budget & Escrow — amount, currency, milestones
 *   3. Requirements   — skills, screening questions, deadline, visibility
 *   4. Review & Publish — summary + submit
 */
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createJob, getJwtToken, updateJobEscrowId, deleteJob, saveDraft, updateDraft } from "@/lib/api";
import { performSEP0010Auth } from "@/lib/wallet";
import { createEscrowOnChain } from "@/lib/stellar";
import { usePriceContext } from "@/contexts/PriceContext";
import type { JobFormData, Milestone, FormStep, SubmitStep } from "@/components/PostJobFormtypes";
import BasicInfoStep from "@/components/post-job-steps/BasicInfoStep";
import BudgetEscrowStep from "@/components/post-job-steps/BudgetEscrowStep";
import RequirementsStep from "@/components/post-job-steps/RequirementsStep";
import ReviewStep from "@/components/post-job-steps/ReviewStep";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PostJobFormProps {
  publicKey: string;
  initialCategory?: string;
  suggestedFreelancer?: string;
}

const DRAFT_STORAGE_KEY = "marketpay_post_job_draft";

// ---------------------------------------------------------------------------
// Multi-step config (Issue #494)
// ---------------------------------------------------------------------------

const FORM_STEPS = [
  { id: 1, label: "Basic Info" },
  { id: 2, label: "Budget & Escrow" },
  { id: 3, label: "Requirements" },
  { id: 4, label: "Review & Publish" },
] as const;

// ---------------------------------------------------------------------------
// Step indicator component
// ---------------------------------------------------------------------------

function StepIndicator({ currentStep, completedSteps }: { currentStep: FormStep; completedSteps: Set<number> }) {
  return (
    <nav aria-label="Form progress" className="w-full mb-8">
      <ol className="flex items-center">
        {FORM_STEPS.map((step, i) => {
          const isDone = completedSteps.has(step.id);
          const isCurrent = currentStep === step.id;
          const isLast = i === FORM_STEPS.length - 1;
          return (
            <li key={step.id} className={`flex items-center ${isLast ? "flex-shrink-0" : "flex-1"}`}>
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={[
                    "w-8 h-8 rounded-full flex items-center justify-center border-2 text-xs font-bold transition-all duration-300",
                    isDone
                      ? "bg-market-400 border-market-400 text-ink-900"
                      : isCurrent
                      ? "bg-ink-900 border-market-400 text-market-400"
                      : "bg-ink-800 border-market-500/20 text-amber-700",
                  ].join(" ")}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  {isDone ? "✓" : step.id}
                </div>
                <span
                  className={[
                    "text-xs font-medium whitespace-nowrap hidden sm:block",
                    isDone ? "text-market-400" : isCurrent ? "text-amber-100" : "text-amber-700",
                  ].join(" ")}
                >
                  {step.label}
                </span>
              </div>
              {!isLast && (
                <div className="flex-1 h-0.5 mx-2 transition-all duration-500"
                  style={{ background: isDone ? "var(--color-market-400, #f59e0b)" : "rgba(245,158,11,0.15)" }}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadLocalDraft(): JobFormData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as JobFormData) : null;
  } catch {
    return null;
  }
}

function hasFormContent(form: JobFormData): boolean {
  return Boolean(
    form.title.trim() || form.description.trim() || form.skills.trim() || form.deadline || form.budget !== "50"
  );
}

function milestoneTotal(milestones: Milestone[]): number {
  return milestones.reduce((sum, m) => sum + (parseFloat(m.amount) || 0), 0);
}

function AnimatedStep({ children, visible }: { children: React.ReactNode; visible: boolean }) {
  return (
    <div
      className={[
        "transition-all duration-300",
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none absolute",
      ].join(" ")}
      aria-hidden={!visible}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PostJobForm({
  publicKey,
  initialCategory = "",
}: PostJobFormProps) {
  const { xlmPriceUsd } = usePriceContext();

  const [form, setForm] = useState<JobFormData>(() => {
    const draft = loadLocalDraft();
    return draft || {
      title: "",
      description: "",
      budget: "50",
      currency: "XLM",
      category: initialCategory || "Smart Contracts",
      skills: "",
      deadline: "",
      milestones: [{ description: "Final delivery", amount: "50" }],
      visibility: "public",
      screeningQuestions: [""],
    };
  });

  const [currentStep, setCurrentStep] = useState<FormStep>(1);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [submitStep, setSubmitStep] = useState<SubmitStep>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(() => {
    const draft = loadLocalDraft();
    return draft?.id || null;
  });
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMockMode = process.env.NEXT_PUBLIC_USE_CONTRACT_MOCK === "true";
  const budgetValue = parseFloat(form.budget) || 0;
  const milestoneSum = milestoneTotal(form.milestones);

  // ── Field validation per step ──────────────────────────────────────────────
  const step1Errors = {
    title: !form.title.trim()
      ? "Title is required"
      : form.title.trim().length < 10
      ? "Must be at least 10 characters"
      : undefined,
    description: !form.description.trim()
      ? "Description is required"
      : form.description.trim().length < 30
      ? "Must be at least 30 characters"
      : undefined,
  };

  const step2Errors = {
    budget: !budgetValue || budgetValue <= 0 ? "Enter a positive budget" : undefined,
    milestones:
      form.milestones.length > 10
        ? "Use 10 milestones or fewer"
        : form.milestones.some((m) => !m.description.trim())
        ? "Every milestone needs a description"
        : form.milestones.some((m) => !parseFloat(m.amount) || parseFloat(m.amount) <= 0)
        ? "Every milestone needs a positive amount"
        : Math.abs(milestoneSum - budgetValue) > 0.000001
        ? `Milestones total ${milestoneSum.toFixed(2)} — must equal budget ${budgetValue.toFixed(2)}`
        : undefined,
  };

  const isStep1Valid = !step1Errors.title && !step1Errors.description;
  const isStep2Valid = !step2Errors.budget && !step2Errors.milestones;
  // step 3 has no required fields

  // ── Persist draft to localStorage ─────────────────────────────────────────
  useEffect(() => {
    if (hasFormContent(form)) {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(form));
    }
  }, [form]);

  // ── Skills autocomplete ────────────────────────────────────────────────────
  useEffect(() => {
    const parts = form.skills.split(",");
    const lastPart = parts[parts.length - 1]?.trim() || "";
    if (lastPart.length < 1) { setSuggestions([]); setShowSuggestions(false); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/skills?q=${encodeURIComponent(lastPart)}`);
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data);
          setShowSuggestions(data.length > 0);
        }
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(timer);
  }, [form.skills]);

  function handleSelectSkill(skill: string) {
    const parts = form.skills.split(",");
    parts.pop();
    parts.push(` ${skill}`);
    setForm((p) => ({ ...p, skills: parts.join(",").trim() + ", " }));
    setSuggestions([]);
    setShowSuggestions(false);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    setForm((p) => ({ ...p, [name]: value }));
    setTouched((p) => ({ ...p, [name]: true }));
  }

  function updateMilestone(index: number, field: "description" | "amount", value: string) {
    setForm((p) => ({ ...p, milestones: p.milestones.map((m, i) => i === index ? { ...m, [field]: value } : m) }));
    setTouched((p) => ({ ...p, milestones: true }));
  }

  function addMilestone() {
    setForm((p) => ({ ...p, milestones: [...p.milestones, { description: "", amount: "" }].slice(0, 10) }));
  }

  function removeMilestone(index: number) {
    if (form.milestones.length <= 1) return;
    setForm((p) => ({ ...p, milestones: p.milestones.filter((_, i) => i !== index) }));
  }

  function updateScreeningQuestion(index: number, value: string) {
    setForm((p) => {
      const q = [...p.screeningQuestions];
      q[index] = value;
      return { ...p, screeningQuestions: q };
    });
  }

  function addScreeningQuestion() {
    if (form.screeningQuestions.length >= 5) return;
    setForm((p) => ({ ...p, screeningQuestions: [...p.screeningQuestions, ""] }));
  }

  function removeScreeningQuestion(index: number) {
    setForm((p) => ({ ...p, screeningQuestions: p.screeningQuestions.filter((_, i) => i !== index) }));
  }

  // ── Navigation ─────────────────────────────────────────────────────────────
  function goNext() {
    if (currentStep === 1) {
      setTouched({ title: true, description: true });
      if (!isStep1Valid) return;
    }
    if (currentStep === 2) {
      setTouched((p) => ({ ...p, budget: true, milestones: true }));
      if (!isStep2Valid) return;
    }
    setCompletedSteps((p) => new Set([...p, currentStep]));
    setCurrentStep((s) => Math.min(s + 1, 4) as FormStep);
  }

  function goBack() {
    setCurrentStep((s) => Math.max(s - 1, 1) as FormStep);
  }

  // ── Auto-save draft with debouncing ───────────────────────────────────
  useEffect(() => {
    if (!hasFormContent(form)) return;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        if (!getJwtToken()) {
          const { error } = await performSEP0010Auth(publicKey);
          if (error) throw new Error(error);
        }

        const skillsArray = form.skills.split(",").map((s) => s.trim()).filter(Boolean);
        const draftData: any = {
          title: form.title,
          description: form.description,
          budget: form.budget,
          category: form.category,
          skills: skillsArray,
          deadline: form.deadline,
        };

        if (draftId) {
          draftData.id = draftId;
          const result = await updateDraft(draftData);
          setDraftId(result.id);
        } else {
          const result = await saveDraft(draftData);
          setDraftId(result.id);
        }

        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 3000);
      } catch {
        setSaveStatus("failed");
        setTimeout(() => setSaveStatus("idle"), 3000);
      }
    }, 2000);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [form, publicKey, draftId]);

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitStep !== "idle") return;

    setSubmitStep("posting");
    setErrorMsg(null);
    let createdJobId: string | null = null;

    try {
      if (!getJwtToken()) {
        const { token, error } = await performSEP0010Auth(publicKey);
        if (error || !token) throw new Error(error || "Authentication required");
      }

      const job = await createJob({
        title: form.title,
        description: form.description,
        budget: form.budget,
        currency: form.currency,
        category: form.category,
        skills: form.skills.split(",").map((s) => s.trim()).filter(Boolean),
        deadline: form.deadline,
        clientAddress: publicKey,
        milestones: form.milestones,
        visibility: form.visibility,
        screeningQuestions: form.screeningQuestions.filter(Boolean),
      });
      createdJobId = job.id as string;
      setJobId(createdJobId);

      setSubmitStep("signing");
      const { txHash: hash } = await createEscrowOnChain({
        clientPublicKey: publicKey,
        jobId: createdJobId,
        budget: budgetValue,
        currency: form.currency,
      });
      await updateJobEscrowId(createdJobId, hash);
      setTxHash(hash);
      setSubmitStep("complete");
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
      if (createdJobId) await deleteJob(createdJobId).catch(() => {});
      setErrorMsg(msg);
      setSubmitStep("error");
    }
  }

  function handleReset() {
    setTouched({});
    setSubmitStep("idle");
    setErrorMsg(null);
    setTxHash(null);
    setJobId(null);
    setCurrentStep(1);
    setCompletedSteps(new Set());
    setForm({
      title: "",
      description: "",
      budget: "50",
      currency: "XLM",
      category: "Smart Contracts",
      skills: "",
      deadline: "",
      visibility: "public",
      milestones: [{ description: "Final delivery", amount: "50" }],
      screeningQuestions: [""],
    });
  }

  // ── Success state ──────────────────────────────────────────────────────────
  if (submitStep === "complete") {
    return (
      <div className="max-w-lg mx-auto bg-white dark:bg-ink-800 rounded-2xl shadow-lg dark:border dark:border-market-500/10 p-8 text-center space-y-4">
        <div className="flex flex-col items-center gap-3 pt-2">
          <div className="w-16 h-16 rounded-full bg-market-500/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-market-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-amber-100">Job Posted!</h2>
          <p className="text-gray-500 dark:text-amber-700 text-sm">
            Your budget of{" "}
            <span className="font-semibold text-market-400">{form.budget} {form.currency}</span>{" "}
            has been locked in escrow.
          </p>
        </div>
        {txHash && (
          <div className="bg-gray-50 dark:bg-ink-700 rounded-xl p-4 text-left space-y-1">
            <p className="text-xs font-semibold text-gray-500 dark:text-amber-700 uppercase tracking-wider">Transaction Hash</p>
            <p className="text-xs font-mono text-gray-800 dark:text-amber-200 break-all">{txHash}</p>
            {!isMockMode && (
              <a href={`https://stellar.expert/explorer/testnet/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="text-xs text-market-400 hover:underline">
                View on Stellar Expert ↗
              </a>
            )}
          </div>
        )}
        {jobId && (
          <a href={`/jobs/${jobId}`} className="btn-primary text-sm inline-block px-8 py-2.5">View Job →</a>
        )}
        <button onClick={handleReset} className="btn-secondary text-sm px-6 py-2 block w-full">Post Another Job</button>
      </div>
    );
  }

  const isSubmitting = submitStep === "posting" || submitStep === "signing";

  // ── Draft indicator ─────────────────────────────────────────────────────────
  const saveDraftIndicator = (
    <div className="text-xs text-amber-700 flex items-center gap-1.5" aria-live="polite">
      {saveStatus === "saving" && (
        <>
          <span className="inline-block w-3 h-3 border-2 border-amber-700 border-t-transparent rounded-full animate-spin" />
          Saving…
        </>
      )}
      {saveStatus === "saved" && <span className="text-green-400">✓ Saved</span>}
      {saveStatus === "failed" && <span className="text-red-400">✗ Save failed</span>}
    </div>
  );

  return (
    <div className="max-w-lg mx-auto">
      <div className="bg-white dark:bg-ink-800 rounded-2xl shadow-lg dark:border dark:border-market-500/10 p-6 sm:p-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-amber-100">Post a Job</h1>
            <p className="text-gray-500 dark:text-amber-700 text-sm mt-0.5">Step {currentStep} of {FORM_STEPS.length}</p>
          </div>
          {saveDraftIndicator}
        </div>

        <StepIndicator currentStep={currentStep} completedSteps={completedSteps} />

        {/* Error banner */}
        {submitStep === "error" && (
          <div className="mb-5 rounded-xl bg-red-50 border border-red-200 p-4">
            <p className="text-sm font-semibold text-red-700">Something went wrong</p>
            <p className="text-xs text-red-600 mt-1">{errorMsg}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="relative">
          {/* ── Step 1: Basic Info ── */}
          <AnimatedStep visible={currentStep === 1}>
            <BasicInfoStep
              form={form}
              touched={touched}
              errors={step1Errors}
              onChange={handleChange}
            />
          </AnimatedStep>

          {/* ── Step 2: Budget & Escrow ── */}
          <AnimatedStep visible={currentStep === 2}>
            <BudgetEscrowStep
              form={form}
              touched={touched}
              errors={step2Errors}
              budgetValue={budgetValue}
              milestoneSum={milestoneSum}
              xlmPriceUsd={xlmPriceUsd}
              onChange={handleChange}
              updateMilestone={updateMilestone}
              addMilestone={addMilestone}
              removeMilestone={removeMilestone}
            />
          </AnimatedStep>

          {/* ── Step 3: Requirements ── */}
          <AnimatedStep visible={currentStep === 3}>
            <RequirementsStep
              form={form}
              suggestions={suggestions}
              showSuggestions={showSuggestions}
              onChange={handleChange}
              onSelectSkill={handleSelectSkill}
              updateScreeningQuestion={updateScreeningQuestion}
              addScreeningQuestion={addScreeningQuestion}
              removeScreeningQuestion={removeScreeningQuestion}
            />
          </AnimatedStep>

          {/* ── Step 4: Review & Publish ── */}
          <AnimatedStep visible={currentStep === 4}>
            <ReviewStep
              form={form}
              isSubmitting={isSubmitting}
              submitStep={submitStep}
            />
          </AnimatedStep>

          {/* ── Navigation buttons ── */}
          {currentStep < 4 && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100 dark:border-market-500/10">
              <button
                type="button"
                onClick={goBack}
                disabled={currentStep === 1}
                className="btn-secondary text-sm px-5 py-2.5 disabled:opacity-30"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={goNext}
                className="btn-primary text-sm px-5 py-2.5"
              >
                Next →
              </button>
            </div>
          )}
          {currentStep === 4 && (
            <div className="mt-4">
              <button type="button" onClick={goBack} className="btn-secondary text-sm px-5 py-2.5 w-full">
                ← Back to Edit
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

