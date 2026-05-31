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

import { useState } from "react";
import type { Transaction } from "@stellar/stellar-sdk";
import {
  buildCreateEscrowTx,
  signAndSubmitSorobanTx,
  getXLMBalance,
} from "@/lib/stellar";
import { estimateSorobanFee } from "@/lib/sorobanFees";
import FeeEstimationModal from "@/components/FeeEstimationModal";
import { createJob, updateJobEscrowId, deleteJob } from "@/lib/api";
import { usePriceContext } from "@/contexts/PriceContext";

const DRAFT_STORAGE_KEY = "marketpay_post_job_draft";
const AUTOSAVE_INTERVAL_MS = 30_000;

interface JobFormData {
  title: string;
  description: string;
  budget: string;
  currency: "XLM" | "USDC";
  category: string;
  skills: string;
  deadline: string;
  visibility: "public" | "private" | "invite_only";
  budgetXlm?: number;
  milestones: { description: string; amount: string }[];
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
      form.milestones.some((m) => m.description.trim()) ||
      form.budgetXlm !== 50
  );
}

function milestoneTotal(milestones: JobFormData["milestones"]): number {
  return milestones.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
}

interface PostJobFormProps {
  publicKey: string;
  initialCategory?: string;
  suggestedFreelancer?: string;
}

export default function PostJobForm({
  publicKey,
  initialCategory = "",
  suggestedFreelancer = "",
}: PostJobFormProps) {
  const { xlmPriceUsd } = usePriceContext();

  const [form, setForm] = useState<JobFormData>({
    title: "",
    description: "",
    budget: "50",
    currency: "XLM",
    category: initialCategory || VALID_CATEGORIES[0],
    skills: "",
    deadline: "",
    visibility: "public",
    milestones: [{ description: "Final delivery", amount: "50" }],
  });

  const [step, setStep] = useState<Step>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [pendingEscrow, setPendingEscrow] = useState<PendingEscrow | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const isMockMode = process.env.NEXT_PUBLIC_USE_CONTRACT_MOCK === "true";
  const isInProgress = ["posting", "fee_modal", "signing"].includes(step);

  const milestoneSum = milestoneTotal(form.milestones);
  const budgetValue = parseFloat(form.budget) || 0;

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
      // Step 1 — create job record in backend
      const job = await createJob({
        title: form.title.trim(),
        description: form.description.trim(),
        budget: form.budget,
        currency: form.currency,
        category: form.category,
        skills: form.skills.split(",").map((s) => s.trim()).filter(Boolean),
        deadline: form.deadline || undefined,
        clientAddress: publicKey,
        visibility: form.visibility,
        milestones: form.milestones.map((milestone) => ({
          description: milestone.description.trim(),
          amount: parseFloat(milestone.amount).toFixed(7),
        })),
      });
      createdJobId = job.id;
      setJobId(job.id);

      if (isMockMode) {
        // Mock mode — skip fee modal and on-chain tx
        console.info("[CONTRACT MOCK] create_escrow called", { jobId: job.id, budget: form.budget });
        await new Promise((r) => setTimeout(r, 600));
        const mockHash = `mock-escrow-${Date.now()}`;
        await updateJobEscrowId(job.id, mockHash);
        setTxHash(mockHash);
        setStep("complete");
        return;
      }

      // Step 2 — build Soroban tx (simulation only, no signing yet)
      setStep("fee_modal");
      const { Transaction } = await import("@stellar/stellar-sdk");
      const xdr = await buildCreateEscrowTx({
        clientPublicKey: publicKey,
        jobId: job.id,
        budget: parseFloat(form.budget),
        budgetXlm: parseFloat(form.budget),
      });
      const tx = new Transaction(xdr, process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet"
        ? "Public Global Stellar Network ; September 2015"
        : "Test SDF Network ; September 2015");

      // Show fee modal — user must confirm before signing
      setPendingEscrow({ transaction: tx as unknown as Transaction, jobId: job.id });

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
      <div className="card max-w-lg mx-auto text-center space-y-4 py-8">
        <ProgressBar step="complete" />
        <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto">
          <span className="text-emerald-400 text-2xl">✓</span>
        </div>
        <h2 className="font-display text-2xl font-bold text-amber-100">Job Posted!</h2>
        <p className="text-amber-700 text-sm">
          Your budget of{" "}
          <span className="font-semibold text-market-400">{form.budget} {form.currency}</span>{" "}
          has been locked in the escrow contract.
        </p>
        {txHash && (
          <div className="bg-ink-800 rounded-xl p-4 text-left space-y-1 border border-market-500/15">
            <p className="text-xs text-amber-700 uppercase tracking-wide font-semibold">
              Transaction Hash
            </p>
            <p className="text-xs font-mono text-amber-300 break-all">{txHash}</p>
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
    <>
      <div className="card max-w-2xl mx-auto">
        <h1 className="font-display text-2xl font-bold text-amber-100 mb-1">Post a Job</h1>
        <p className="text-amber-800 text-sm mb-5">
          Your XLM budget will be locked in a Soroban escrow contract.
          {isMockMode && (
            <span className="ml-2 text-xs text-amber-600 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
              Mock mode — no real XLM charged
            </span>
          )}
        </p>

        {isInProgress && <ProgressBar step={step} />}

        {step === "error" && (
          <div className="mb-5 rounded-xl bg-red-500/10 border border-red-500/20 p-4 space-y-1">
            <p className="text-sm font-semibold text-red-400">Something went wrong</p>
            <p className="text-xs text-red-300">{errorMsg}</p>
            <button
              onClick={() => { setStep("idle"); setErrorMsg(null); }}
              className="mt-1 text-xs text-red-400 underline"
            >
              Dismiss and retry
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div>
            <label className="label">Job Title</label>
            <input
              name="title"
              value={form.title}
              onChange={handleChange}
              required
              minLength={10}
              disabled={isInProgress}
              placeholder="e.g. Build a Soroban DEX interface"
              className="input-field"
            />
            {touched.title && fieldErrors.title && (
              <p className="text-red-400 text-xs mt-1">{fieldErrors.title}</p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="label">Description</label>
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              required
              minLength={30}
              rows={4}
              disabled={isInProgress}
              placeholder="Describe the work, deliverables, and any context…"
              className="textarea-field"
            />
            {touched.description && fieldErrors.description && (
              <p className="text-red-400 text-xs mt-1">{fieldErrors.description}</p>
            )}
          </div>

          {/* Budget + Currency */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Budget</label>
              <input
                name="budget"
                type="number"
                min="1"
                step="0.01"
                value={form.budget}
                onChange={handleChange}
                required
                disabled={isInProgress}
                className="input-field"
              />
            </div>
            <div>
              <label className="label">Currency</label>
              <select
                name="currency"
                value={form.currency}
                onChange={handleChange}
                disabled={isInProgress}
                className="input-field"
              >
                <option value="XLM">XLM</option>
                <option value="USDC">USDC</option>
              </select>
            </div>
          </div>


          {/* Milestones */}
          <div className="rounded-xl border border-market-500/15 bg-ink-900/40 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <label className="label mb-1">Milestones</label>
                <p className="text-xs text-amber-800">Add up to 10 deliverables. Total must equal the budget.</p>
              </div>
              <button type="button" onClick={addMilestone} disabled={isInProgress || form.milestones.length >= 10} className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50">+ Add</button>
            </div>
            {form.milestones.map((milestone, index) => (
              <div key={index} className="grid grid-cols-12 gap-2 items-center">
                <input value={milestone.description} onChange={(e) => updateMilestone(index, "description", e.target.value)} disabled={isInProgress} placeholder={`Milestone ${index + 1} description`} className="input-field col-span-12 sm:col-span-6" />
                <input value={milestone.amount} onChange={(e) => updateMilestone(index, "amount", e.target.value)} disabled={isInProgress} type="number" min="0.0000001" step="0.0000001" placeholder="Amount" className="input-field col-span-6 sm:col-span-3" />
                <div className="col-span-6 sm:col-span-3 flex gap-1 justify-end">
                  <button type="button" onClick={() => moveMilestone(index, -1)} disabled={index === 0 || isInProgress} className="btn-secondary text-xs px-2 py-2 disabled:opacity-40">↑</button>
                  <button type="button" onClick={() => moveMilestone(index, 1)} disabled={index === form.milestones.length - 1 || isInProgress} className="btn-secondary text-xs px-2 py-2 disabled:opacity-40">↓</button>
                  <button type="button" onClick={() => removeMilestone(index)} disabled={form.milestones.length === 1 || isInProgress} className="btn-secondary text-xs px-2 py-2 disabled:opacity-40">Remove</button>
                </div>
              </div>
            ))}
            <div className="flex justify-between text-xs">
              <span className={fieldErrors.milestones ? "text-red-400" : "text-amber-700"}>{fieldErrors.milestones || `${form.milestones.length}/10 milestones configured`}</span>
              <span className={Math.abs(milestoneSum - budgetValue) > 0.000001 ? "text-red-400" : "text-market-400"}>Total: {milestoneSum.toFixed(2)} / {budgetValue.toFixed(2)} {form.currency}</span>
            </div>
          </div>

          {/* Category */}
          <div>
            <label className="label">Category</label>
            <select
              name="category"
              value={form.category}
              onChange={handleChange}
              disabled={isInProgress}
              className="input-field"
            >
              {VALID_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Skills */}
          <div>
            <label className="label">Required Skills</label>
            <input
              name="skills"
              value={form.skills}
              onChange={handleChange}
              disabled={isInProgress}
              placeholder="Rust, Soroban, TypeScript (comma-separated)"
              className="input-field"
            />
          </div>

          {/* Visibility */}
          <div>
            <label className="label">Visibility</label>
            <select
              name="visibility"
              value={form.visibility}
              onChange={handleChange}
              disabled={isInProgress}
              className="input-field"
            >
              <option value="public">Public</option>
              <option value="private">Private</option>
              <option value="invite_only">Invite Only</option>
            </select>
          </div>

          {/* Deadline */}
          <div>
            <label className="label">Deadline (optional)</label>
            <input
              name="deadline"
              type="date"
              value={form.deadline}
              onChange={handleChange}
              disabled={isInProgress}
              className="input-field"
            />
          </div>

          <button
            type="submit"
            disabled={isInProgress || !isFormValid}
            className="btn-primary w-full py-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {step === "posting" ? "Creating job…" :
             step === "fee_modal" ? "Estimating fees…" :
             step === "signing" ? "Waiting for signature…" :
             `Post Job & Lock ${form.budget} ${form.currency} Escrow`}
          </button>

          {isInProgress && (
            <p className="text-center text-xs text-amber-700">
              {step === "fee_modal" && "Simulating contract call to estimate fees…"}
              {step === "signing" && "Please approve the transaction in your Freighter wallet."}
            </p>
          )}
        </form>
      </div>

      {/* Fee Estimation Modal — shown after job is created, before signing */}
      {pendingEscrow && (
        <FeeEstimationModal
          transaction={pendingEscrow.transaction}
          functionName="create_escrow"
          payerPublicKey={publicKey}
          onConfirm={handleConfirmFee}
          onCancel={handleCancelFee}
        />
      )}
    </>
  );
}
