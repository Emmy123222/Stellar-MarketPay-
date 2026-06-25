/**
 * components/PostJobForm.tsx
 * Issue #350 — Show FeeEstimationModal before job posting.
 *
 * Flow:
 *   1. User fills form and clicks "Post Job"
 *   2. Backend job record is created (status: open, no escrow yet)
 *   3. Soroban tx is built via buildCreateEscrowTx (simulation only)
 *   4. FeeEstimationModal is shown with the simulated fee breakdown
 *   5. User confirms → Freighter signs → tx submitted → escrow ID stored
 *   6. On cancel → orphaned job is deleted
 */
"use client";

import { useState, useEffect } from "react";
import { createJob, getJwtToken, updateJobEscrowId, deleteJob } from "@/lib/api";
import { performSEP0010Auth } from "@/lib/wallet";
import { createEscrowOnChain, signAndSubmitSorobanTx } from "@/lib/stellar";
import { Transaction, xdr } from "@stellar/stellar-sdk";
import { usePriceContext } from "@/contexts/PriceContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Milestone {
  description: string;
  amount: string;
}

interface JobFormData {
  title: string;
  description: string;
  budget: string;
  currency: "XLM" | "USDC";
  category: string;
  skills: string;
  deadline: string;
  milestones: Milestone[];
  visibility: "public" | "private" | "invite_only";
}

interface PostJobFormProps {
  publicKey: string;
  initialCategory?: string;
  suggestedFreelancer?: string;
}

type Step = "idle" | "posting" | "fee_modal" | "signing" | "complete" | "error";

interface PendingEscrow {
  /** Pre-built (assembled) Soroban transaction ready for signing */
  transaction: Transaction;
  /** Backend job UUID — used for rollback on cancel */
  jobId: string;
}

const VALID_CATEGORIES = [
  "Smart Contracts",
  "Frontend Development",
  "Backend Development",
  "UI/UX Design",
  "Technical Writing",
  "DevOps",
  "Security Audit",
  "Data Analysis",
  "Mobile Development",
  "Other",
];

const DRAFT_STORAGE_KEY = "marketpay_post_job_draft";

// ---------------------------------------------------------------------------
// Step progress bar
// ---------------------------------------------------------------------------

const STEPS = [
  { id: "posting", label: "Create Job" },
  { id: "fee_modal", label: "Review Fees" },
  { id: "signing", label: "Lock Escrow" },
  { id: "complete", label: "Done" },
] as const;

function stepIndex(step: Step): number {
  const map: Record<Step, number> = {
    idle: -1,
    posting: 0,
    fee_modal: 1,
    signing: 2,
    complete: 3,
    error: -1,
  };
  return map[step] ?? -1;
}

function ProgressBar({ step }: { step: Step }) {
  const active = stepIndex(step);
  const isError = step === "error";

  return (
    <div className="w-full my-5">
      <div className="flex items-center justify-between relative">
        <div className="absolute left-0 right-0 top-4 h-0.5 bg-market-500/10 z-0" />
        <div
          className="absolute left-0 top-4 h-0.5 bg-market-400 z-0 transition-all duration-700"
          style={{
            width:
              active <= 0 ? "0%" :
              active === 1 ? "33%" :
              active === 2 ? "66%" : "100%",
          }}
        />
        {STEPS.map((s, i) => {
          const done = active > i;
          const current = active === i;
          const errored = isError && current;
          return (
            <div key={s.id} className="flex flex-col items-center gap-1.5 z-10">
              <div
                className={[
                  "w-8 h-8 rounded-full flex items-center justify-center border-2 text-xs font-bold transition-all duration-500",
                  done ? "bg-market-400 border-market-400 text-ink-900" :
                  current && !errored ? "bg-ink-900 border-market-400 text-market-400 animate-pulse" :
                  errored ? "bg-red-500 border-red-500 text-white" :
                  "bg-ink-800 border-market-500/20 text-amber-700",
                ].join(" ")}
              >
                {done ? "✓" : errored ? "✕" : i + 1}
              </div>
              <span className={[
                "text-xs font-medium whitespace-nowrap",
                done ? "text-market-400" :
                current && !errored ? "text-amber-100" :
                errored ? "text-red-400" : "text-amber-700",
              ].join(" ")}>
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function loadLocalDraft(): JobFormData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as JobFormData;
  } catch {
    return null;
  }
}

function hasFormContent(form: JobFormData): boolean {
  return Boolean(
    form.title.trim() ||
      form.description.trim() ||
      form.skills.trim() ||
      form.deadline ||
      form.budget !== "50"
  );
}

function milestoneTotal(milestones: Milestone[]): number {
  return milestones.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
}

export default function PostJobForm({
  publicKey,
  initialCategory = "",
  suggestedFreelancer = "",
}: PostJobFormProps) {
  const { xlmPriceUsd } = usePriceContext();

  const [form, setForm] = useState<JobFormData>(() => {
    const draft = loadLocalDraft();
    return draft || {
      title: "",
      description: "",
      budget: "50",
      currency: "XLM",
      category: initialCategory || VALID_CATEGORIES[0],
      skills: "",
      deadline: "",
      milestones: [{ description: "Final delivery", amount: "50" }],
      visibility: "public",
    };
  });

  const [step, setStep] = useState<Step>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [pendingEscrow, setPendingEscrow] = useState<PendingEscrow | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    const parts = form.skills.split(",");
    const lastPart = parts[parts.length - 1]?.trim() || "";
    
    if (lastPart.length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/skills?q=${encodeURIComponent(lastPart)}`);
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data);
          setShowSuggestions(data.length > 0);
        }
      } catch (err) {
        console.error("Failed to fetch skills", err);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [form.skills]);

  function handleSelectSkill(skill: string) {
    const parts = form.skills.split(",");
    parts.pop();
    parts.push(` ${skill}`);
    const newSkills = parts.join(",").trim() + ", ";
    setForm((prev) => ({ ...prev, skills: newSkills }));
    setSuggestions([]);
    setShowSuggestions(false);
    setTouched((prev) => ({ ...prev, skills: true }));
  }

  const isMockMode = process.env.NEXT_PUBLIC_USE_CONTRACT_MOCK === "true";
  const isInProgress = ["posting", "fee_modal", "signing"].includes(step);

  const budgetValue = parseFloat(form.budget) || 0;
  const milestoneSum = milestoneTotal(form.milestones);

  const fieldErrors = {
    title: !form.title.trim() ? "Title is required"
      : form.title.trim().length < 10 ? "Title must be at least 10 characters"
      : undefined,
    description: !form.description.trim() ? "Description is required"
      : form.description.trim().length < 30 ? "Description must be at least 30 characters"
      : undefined,
    milestones: form.milestones.length > 10 ? "Use 10 milestones or fewer"
      : form.milestones.some((m) => !m.description.trim()) ? "Every milestone needs a description"
      : form.milestones.some((m) => !parseFloat(m.amount) || parseFloat(m.amount) <= 0) ? "Every milestone needs a positive amount"
      : Math.abs(milestoneSum - budgetValue) > 0.000001 ? "Milestones must add up to the job budget"
      : undefined,
  };
  const isFormValid = !fieldErrors.title && !fieldErrors.description && !fieldErrors.milestones;

  // Persist draft
  useEffect(() => {
    if (hasFormContent(form)) {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(form));
    }
  }, [form]);

  // ── form change ────────────────────────────────────────────────────────────
  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setTouched((prev) => ({ ...prev, [name]: true }));
  }


  function updateMilestone(index: number, field: "description" | "amount", value: string) {
    setForm((prev) => ({
      ...prev,
      milestones: prev.milestones.map((milestone, currentIndex) =>
        currentIndex === index ? { ...milestone, [field]: value } : milestone,
      ),
    }));
    setTouched((prev) => ({ ...prev, milestones: true }));
  }

  function addMilestone() {
    setForm((prev) => ({
      ...prev,
      milestones: [...prev.milestones, { description: "", amount: "" }].slice(0, 10),
    }));
  }

  function removeMilestone(index: number) {
    setForm((prev) => ({
      ...prev,
      milestones: prev.milestones.filter((_, currentIndex) => currentIndex !== index),
    }));
  }

  function moveMilestone(index: number, direction: -1 | 1) {
    setForm((prev) => {
      const next = [...prev.milestones];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...prev, milestones: next };
    });
  }

  // ── submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isInProgress) return;

    setTouched({ title: true, description: true, milestones: true });
    if (!isFormValid) return;

    setStep("posting");
    setErrorMsg(null);
    let createdJobId: string | null = null;

    try {
      // Ensure the user has a signed JWT (SEP-0010). If not, prompt Freighter to sign now.
      if (!getJwtToken()) {
        const { token, error } = await performSEP0010Auth(publicKey);
        if (error || !token) {
          throw new Error(error || "Authentication required to post job");
        }
      }

      // ── Step 1: POST to backend ──────────────────────────────────────────
      const job = await createJob({
        title: form.title,
        description: form.description,
        budget: form.budget,
        currency: form.currency,
        category: form.category,
        skills: form.skills
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        deadline: form.deadline,
        clientAddress: publicKey,
        milestones: form.milestones,
        visibility: form.visibility,
      });
      createdJobId = job.id as string;
      setJobId(createdJobId);

      // ── Step 2: Lock escrow on-chain ─────────────────────────────────────
      setStep("signing");

      const { txHash: hash } = await createEscrowOnChain({
        clientPublicKey: publicKey,
        jobId: createdJobId,
        budget: budgetValue,
        currency: form.currency,
      });
      
      await updateJobEscrowId(createdJobId, hash);
      setTxHash(hash);
      setStep("complete");
      localStorage.removeItem(DRAFT_STORAGE_KEY);

    } catch (err) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
      // Roll back orphaned job
      if (createdJobId) {
        await deleteJob(createdJobId).catch(() => {});
      }
      setErrorMsg(msg);
      setStep("error");
    }
  }

  // ── fee modal confirm ──────────────────────────────────────────────────────
  async function handleConfirmFee() {
    if (!pendingEscrow) return;
    const { transaction, jobId: jId } = pendingEscrow;
    setPendingEscrow(null);
    setStep("signing");

    try {
      const hash = await signAndSubmitSorobanTx(transaction.toXDR());
      await updateJobEscrowId(jId, hash);
      setTxHash(hash);
      setStep("complete");
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Signing failed";
      await deleteJob(jId).catch(() => {});
      setErrorMsg(msg);
      setStep("error");
    }
  }

  // ── fee modal cancel ───────────────────────────────────────────────────────
  async function handleCancelFee() {
    if (!pendingEscrow) return;
    const { jobId: jId } = pendingEscrow;
    setPendingEscrow(null);
    await deleteJob(jId).catch(() => {});
    setStep("idle");
    setErrorMsg("Cancelled — the job draft was removed.");
  }

  // ── reset ──────────────────────────────────────────────────────────────────
  function handleReset() {
    setTouched({});
    setStep("idle");
    setErrorMsg(null);
    setTxHash(null);
    setJobId(null);
    setForm({
      title: "",
      description: "",
      budget: "50",
      currency: "XLM",
      category: VALID_CATEGORIES[0],
      skills: "",
      deadline: "",
      visibility: "public",
      milestones: [{ description: "Final delivery", amount: "50" }],
    });
  }

  // ── success state ──────────────────────────────────────────────────────────
  if (step === "complete") {
    return (
      <div className="max-w-lg mx-auto bg-white dark:bg-ink-800 rounded-2xl shadow-lg dark:shadow-none dark:border dark:border-market-500/10 p-8 text-center space-y-4">
        <ProgressBar step="complete" />

        <div className="flex flex-col items-center gap-3 pt-2">
          <div className="w-16 h-16 rounded-full bg-indigo-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-amber-100">Job Posted!</h2>
          <p className="text-gray-500 dark:text-amber-700 text-sm">
            Your budget of{" "}
            <span className="font-semibold text-indigo-600">
              {form.budget} {form.currency}
            </span>{" "}
            has been locked in the escrow contract.
          </p>
        </div>

        {txHash && (
          <div className="bg-gray-50 dark:bg-ink-700 rounded-xl p-4 text-left space-y-1">
            <p className="text-xs font-semibold text-gray-500 dark:text-amber-700 uppercase tracking-wider">
              Contract Transaction Hash
            </p>
            <p className="text-xs font-mono text-gray-800 dark:text-amber-200 break-all">
              {txHash}
            </p>
            {!isMockMode && (
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-market-400 hover:underline"
              >
                View on Stellar Expert ↗
              </a>
            )}
          </div>
        )}
        {jobId && (
          <a href={`/jobs/${jobId}`} className="btn-primary text-sm inline-block px-8 py-2.5">
            View Job →
          </a>
        )}
        <button onClick={handleReset} className="btn-secondary text-sm px-6 py-2">
          Post Another Job
        </button>
      </div>
    );
  }

  // ── main form ──────────────────────────────────────────────────────────────
  return (
    <div className="max-w-lg mx-auto bg-white dark:bg-ink-800 rounded-2xl shadow-lg dark:shadow-none dark:border dark:border-market-500/10 p-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-amber-100 mb-1">Post a Job</h1>
      <p className="text-gray-500 dark:text-amber-700 text-sm mb-6">
        Your {form.currency} budget will be locked in a Soroban escrow contract on-chain.
      </p>

      {/* 3-step progress (shown while submitting) */}
      {isInProgress && <ProgressBar step={step} />}

      {/* Error banner */}
      {step === "error" && (
        <div className="mb-5 rounded-xl bg-red-50 border border-red-200 p-4 space-y-1">
          <ProgressBar step="error" />
          <p className="text-sm font-semibold text-red-700">
            Something went wrong
          </p>
          <p className="text-xs text-red-600">{errorMsg}</p>
          {jobId && (
            <p className="text-xs text-red-500">
              The job record has been rolled back. Please try again.
            </p>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-amber-300 mb-1">
            Job Title
          </label>
          <input
            name="title"
            value={form.title}
            onChange={handleChange}
            required
            disabled={isInProgress}
            placeholder="e.g. Build a Soroban DEX interface"
            className="w-full rounded-xl border border-gray-200 dark:border-market-500/20 bg-gray-50 dark:bg-ink-700 px-4 py-2.5 text-sm text-gray-900 dark:text-amber-100 placeholder-gray-400 dark:placeholder-amber-900/50 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:focus:ring-market-500/40 focus:border-transparent disabled:opacity-60"
          />
          {touched.title && fieldErrors.title && (
            <p className="text-red-400 text-xs mt-1">{fieldErrors.title}</p>
          )}
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-amber-300 mb-1">
            Description
          </label>
          <textarea
            name="description"
            value={form.description}
            onChange={handleChange}
            required
            rows={4}
            disabled={isInProgress}
            placeholder="Describe the work, deliverables, and any context..."
            className="w-full rounded-xl border border-gray-200 dark:border-market-500/20 bg-gray-50 dark:bg-ink-700 px-4 py-2.5 text-sm text-gray-900 dark:text-amber-100 placeholder-gray-400 dark:placeholder-amber-900/50 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:focus:ring-market-500/40 focus:border-transparent disabled:opacity-60 resize-none"
          />
          {touched.description && fieldErrors.description && (
            <p className="text-red-400 text-xs mt-1">{fieldErrors.description}</p>
          )}
        </div>

        {/* Budget */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-amber-300 mb-1">
            Budget ({form.currency})
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-indigo-500">
              {form.currency}
            </span>
            <input
              name="budget"
              type="number"
              step="0.0000001"
              value={form.budget}
              onChange={handleChange}
              required
              disabled={isInProgress}
              className="w-full rounded-xl border border-gray-200 dark:border-market-500/20 bg-gray-50 dark:bg-ink-700 pl-14 pr-4 py-2.5 text-sm text-gray-900 dark:text-amber-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:focus:ring-market-500/40 focus:border-transparent disabled:opacity-60"
            />
          </div>
          <p className="mt-1 text-xs text-gray-400 dark:text-amber-800">
            This exact amount will be deducted from your wallet and held in escrow.
          </p>
        </div>

        {/* Skills */}
        <div className="relative">
          <label className="block text-sm font-medium text-gray-700 dark:text-amber-300 mb-1">
            Required Skills
          </label>
          <input
            name="skills"
            value={form.skills}
            onChange={handleChange}
            disabled={isInProgress}
            autoComplete="off"
            placeholder="Rust, Soroban, TypeScript (comma-separated)"
            className="w-full rounded-xl border border-gray-200 dark:border-market-500/20 bg-gray-50 dark:bg-ink-700 px-4 py-2.5 text-sm text-gray-900 dark:text-amber-100 placeholder-gray-400 dark:placeholder-amber-900/50 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:focus:ring-market-500/40 focus:border-transparent disabled:opacity-60"
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute z-10 w-full mt-1 bg-white dark:bg-ink-800 border border-gray-200 dark:border-market-500/20 rounded-xl shadow-lg max-h-48 overflow-y-auto">
              {suggestions.map((skill) => (
                <li
                  key={skill}
                  onClick={() => handleSelectSkill(skill)}
                  className="px-4 py-2 text-sm text-gray-900 dark:text-amber-100 cursor-pointer hover:bg-indigo-50 dark:hover:bg-market-500/10"
                >
                  {skill}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Deadline */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-amber-300 mb-1">
            Deadline
          </label>
          <input
            name="deadline"
            type="date"
            value={form.deadline}
            onChange={handleChange}
            disabled={isInProgress}
            className="w-full rounded-xl border border-gray-200 dark:border-market-500/20 bg-gray-50 dark:bg-ink-700 px-4 py-2.5 text-sm text-gray-900 dark:text-amber-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:focus:ring-market-500/40 focus:border-transparent disabled:opacity-60"
          />
        </div>

        <button
          type="submit"
          disabled={isInProgress || !isFormValid}
          className="btn-primary w-full py-3 mt-4"
        >
          {step === "posting" ? "Creating Job..." : step === "signing" ? "Signing..." : "Post Job"}
        </button>

        {isInProgress && (
          <p className="text-center text-xs text-gray-400 dark:text-amber-800">
            {step === "signing"
              ? "Please approve the transaction in your Freighter wallet."
              : "Submitting your job to the platform…"}
          </p>
        )}
      </form>
    </div>
  );
}
