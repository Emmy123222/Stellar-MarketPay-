/**
 * components/PostJobForm.tsx
 * Form for clients to post a new job with XLM budget.
 * Issue #21: Integrates Soroban escrow contract into job creation flow.
 */
import { useEffect, useState } from "react";
import type { Transaction } from "@stellar/stellar-sdk";
import { createJob, updateJobEscrowId, deleteJob, saveDraft, fetchDrafts } from "@/lib/api";
import { buildCreateEscrowTransaction, submitSorobanTransaction } from "@/lib/stellar";
import { fetchActualFee } from "@/lib/sorobanFees";
import { signTransactionWithWallet } from "@/lib/wallet";
import { JOB_CATEGORIES, SKILL_SUGGESTIONS, formatUSDEquivalent, getMonthlyEstimate } from "@/utils/format";
import { useRouter } from "next/router";
import clsx from "clsx";
import { useToast } from "@/components/Toast";
import { usePriceContext } from "@/contexts/PriceContext";
import type { Currency } from "@/utils/types";
import { usePriceContext } from "@/contexts/PriceContext";

import { useState } from "react";
import { getPublicKey } from "@stellar/freighter-api";
import { createEscrowOnChain } from "@/lib/stellar";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JobFormData {
  title: string;
  description: string;
  budgetXlm: number;
  skills: string;
  deadline: string;
  currency: Currency;
  timezone: string;
};

type Step = "idle" | "posting" | "escrow" | "complete" | "error";

const JOB_TEMPLATES_STORAGE_KEY = "stellar-marketpay-job-templates";
const SCOPE_PREFILL_STORAGE_KEY = "marketpay_scope_prefill";
const REPOST_JOB_PREFILL_STORAGE_KEY = "marketpay_repost_job_prefill";
const emptyForm: FormState = {
  title: "",
  description: "",
  budget: "",
  category: "",
  skillInput: "",
  deadline: "",
  currency: "XLM",
  timezone: "",
};

export default function PostJobForm({ publicKey }: PostJobFormProps) {
  const router = useRouter();
  const toast = useToast();
  const { xlmPriceUsd } = usePriceContext();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [skills, setSkills] = useState<string[]>([]);
  const [screeningQuestions, setScreeningQuestions] = useState<string[]>([""]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [templates, setTemplates] = useState<JobTemplate[]>([]);
  const [selectedTemplateName, setSelectedTemplateName] = useState("");
  const [templateNameInput, setTemplateNameInput] = useState("");
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [pendingOverwriteTemplate, setPendingOverwriteTemplate] = useState<JobTemplate | null>(null);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);

  const usdPreview = formatUSDEquivalent(form.budget, xlmPriceUsd);
  const monthlyEst = getMonthlyEstimate(form.budget, xlmPriceUsd);

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: val }));

  useEffect(() => {
    setTemplates(readTemplates());
  }, []);

  // Filter suggestions based on input
  const filteredSuggestions = form.skillInput.trim().length > 0
    ? SKILL_SUGGESTIONS.filter(
        (s) => s.toLowerCase().includes(form.skillInput.toLowerCase()) && !skills.includes(s)
      ).slice(0, 5)
    : [];

  const addSkill = (skill?: string) => {
    const s = (skill || form.skillInput).trim();
    if (s && !skills.includes(s) && skills.length < 8) {
      setSkills([...skills, s]);
      set("skillInput", "");
      setShowSuggestions(false);
      setSelectedSuggestionIndex(0);
    }
  };

  const removeSkill = (s: string) => setSkills(skills.filter((x) => x !== s));

  const buildTemplateFromCurrentForm = (name: string): JobTemplate => ({
    name: name.trim(),
    title: form.title,
    description: form.description,
    budget: form.budget,
    category: form.category,
    skills,
    deadline: form.deadline,
  });

  const applyTemplate = (template: JobTemplate) => {
    setForm((current) => ({
      ...current,
      title: template.title,
      description: template.description,
      budget: template.budget,
      category: template.category,
      deadline: template.deadline,
      skillInput: "",
    }));
    setSkills(template.skills);
    setSelectedTemplateName(template.name);
  };

  const persistTemplates = (nextTemplates: JobTemplate[]) => {
    setTemplates(nextTemplates);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(JOB_TEMPLATES_STORAGE_KEY, JSON.stringify(nextTemplates));
    }
  };

  const handleLoadTemplate = (name: string) => {
    setSelectedTemplateName(name);
    if (!name) return;

    const selectedTemplate = templates.find((template) => template.name === name);
    if (selectedTemplate) {
      applyTemplate(selectedTemplate);
      setTemplateNameInput(selectedTemplate.name);
      setTemplateError(null);
      setPendingOverwriteTemplate(null);
    }
  };

  const handleSaveTemplate = () => {
    const normalizedName = templateNameInput.trim();
    if (!normalizedName) {
      setTemplateError("Template name is required.");
      return;
    }

    const template = buildTemplateFromCurrentForm(normalizedName);
    const existingTemplate = templates.find((item) => item.name === normalizedName);

    if (existingTemplate) {
      setPendingOverwriteTemplate(template);
      setTemplateError(null);
      return;
    }

    persistTemplates([...templates, template]);
    setSelectedTemplateName(template.name);
    setPendingOverwriteTemplate(null);
    setTemplateError(null);
    toast.success(`Saved template: ${template.name}`);
  };

  const handleConfirmOverwrite = () => {
    if (!pendingOverwriteTemplate) return;

    const nextTemplates = templates.map((template) =>
      template.name === pendingOverwriteTemplate.name ? pendingOverwriteTemplate : template
    );
    persistTemplates(nextTemplates);
    setSelectedTemplateName(pendingOverwriteTemplate.name);
    setPendingOverwriteTemplate(null);
    setTemplateError(null);
    toast.success(`Updated template: ${templateNameInput.trim()}`);
  };

  const handleCancelOverwrite = () => {
    setPendingOverwriteTemplate(null);
  };

  const handleDeleteTemplate = () => {
    if (!selectedTemplateName) return;
    setShowDeleteConfirmation(true);
  };

  const handleConfirmDelete = () => {
    if (!selectedTemplateName) return;

    const nextTemplates = templates.filter((template) => template.name !== selectedTemplateName);
    persistTemplates(nextTemplates);
    setSelectedTemplateName("");
    setTemplateNameInput("");
    setShowDeleteConfirmation(false);
    toast.success("Template deleted.");
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirmation(false);
  };

  const addScreeningQuestion = () => {
    if (screeningQuestions.length < 5) {
      setScreeningQuestions([...screeningQuestions, ""]);
    }
  };

  const removeScreeningQuestion = (index: number) => {
    setScreeningQuestions(screeningQuestions.filter((_, i) => i !== index));
  };

  const updateScreeningQuestion = (index: number, value: string) => {
    const updated = [...screeningQuestions];
    updated[index] = value;
    setScreeningQuestions(updated);
  };

  function getStepStatus(currentStep: Step, targetStep: Step): "idle" | "active" | "done" {
    if (currentStep === targetStep) return "active";
    if (targetStep === "done" && currentStep === "done") return "done";
    if (targetStep === "locking" && (currentStep === "done" || currentStep === "error")) return "done";
    if (targetStep === "posting" && (currentStep === "locking" || currentStep === "done" || currentStep === "error")) return "done";
    return "idle";
  }

  function getStepTextColor(currentStep: Step, targetStep: Step): string {
    if (currentStep === targetStep) return "text-amber-100";
    if (targetStep === "done" && currentStep === "done") return "text-green-400";
    if (targetStep === "locking" && (currentStep === "done" || currentStep === "error")) return "text-green-400";
    if (targetStep === "posting" && (currentStep === "locking" || currentStep === "done" || currentStep === "error")) return "text-green-400";
    return "text-amber-800/50";
  }

  const isValid =
    form.title.trim().length >= 10 &&
    form.description.trim().length >= 30 &&
    parseFloat(form.budget) > 0 &&
    form.category !== "";

  const handleSubmit = async () => {
    if (!isValid) return;
    setLoading(true);
    setError(null);
    setStep("posting");

    try {
      const job = await createJob({
        title: form.title.trim(),
        description: form.description.trim(),
        budget: parseFloat(form.budget).toFixed(7),
        currency: form.currency,
        category: form.category,
        skills,
        deadline: form.deadline || undefined,
        timezone: form.timezone || undefined,
        visibility: form.visibility,
        clientAddress: publicKey,
        screeningQuestions: screeningQuestions.filter(q => q.trim().length > 0),
      });

      setStep("locking");

      const unsignedTx = await buildCreateEscrowTransaction({
        clientPublicKey: publicKey,
        jobId: job.id,
        freelancerAddress: publicKey,
        budget: parseFloat(form.budget).toFixed(7),
        currency: form.currency,
      });

      // Pause here so the user can review the on-chain fee (Issue #222)
      // before Freighter prompts them to sign.
      setPendingEscrow({ transaction: unsignedTx, jobId: job.id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      setStep("error");
      toast.error(`Failed: ${msg}`);
      setLoading(false);
    }
  };

  const handleConfirmEscrowFee = async () => {
    if (!pendingEscrow) return;
    const { transaction, jobId } = pendingEscrow;
    setPendingEscrow(null);

    try {
      const { signedXDR, error: signError } = await signTransactionWithWallet(transaction.toXDR());
      if (signError || !signedXDR) {
        await deleteJob(jobId).catch(() => {});
        throw new Error(signError || "Freighter signing was cancelled");
      }

      const txHash = await submitSorobanTransaction(signedXDR).catch(async (e) => {
        await deleteJob(jobId).catch(() => {});
        throw e;
      });

      // Log the actual fee charged for the AC.
      fetchActualFee(txHash).then((actual) => {
        if (actual) {
          // eslint-disable-next-line no-console
          console.info(`[escrow] create_escrow ${jobId} actual fee ${actual.feeChargedXlm} XLM`);
        }
      }).catch(() => {});

      await updateJobEscrowId(jobId, txHash);

      setStep("done");
      toast.success("Job posted and budget locked in escrow.");
      router.push(`/jobs/${jobId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      setStep("error");
      toast.error(`Failed: ${msg}`);
      setLoading(false);
    }
  };

  const handleCancelEscrowFee = async () => {
    if (!pendingEscrow) return;
    const { jobId } = pendingEscrow;
    setPendingEscrow(null);
    await deleteJob(jobId).catch(() => {});
    setStep("idle");
    setLoading(false);
    setError("Cancelled before signing — the orphaned job was removed.");
  };

  const handleLoadTemplate = (name: string) => {
    const template = templates.find((t) => t.name === name);
    if (template) {
      setForm((f) => ({
        ...f,
        title: template.title,
        description: template.description,
        budget: template.budget,
        category: template.category,
        deadline: template.deadline,
      }));
      setSkills(template.skills);
      setSelectedTemplateName(name);
    }
  };

  const handleSaveTemplate = () => {
    if (!templateNameInput.trim()) {
      setTemplateError("Template name is required");
      return;
    }
    const existing = templates.find((t) => t.name === templateNameInput);
    if (existing) {
      setPendingOverwriteTemplate(existing);
      return;
    }
    const newTemplate: JobTemplate = {
      name: templateNameInput, title: form.title, description: form.description,
      budget: form.budget, category: form.category, skills, deadline: form.deadline,
    };
    const updated = [...templates, newTemplate];
    setTemplates(updated);
    localStorage.setItem(JOB_TEMPLATES_STORAGE_KEY, JSON.stringify(updated));
    setTemplateNameInput("");
    setTemplateError(null);
    toast.success(`Template "${templateNameInput}" saved`);
  };

  const handleConfirmOverwrite = () => {
    const updated = templates.map((t) =>
      t.name === templateNameInput
        ? { ...t, title: form.title, description: form.description, budget: form.budget, category: form.category, skills, deadline: form.deadline }
        : t
    );
    setTemplates(updated);
    localStorage.setItem(JOB_TEMPLATES_STORAGE_KEY, JSON.stringify(updated));
    setTemplateNameInput("");
    setPendingOverwriteTemplate(null);
    toast.success("Template updated");
  };

  const handleCancelOverwrite = () => setPendingOverwriteTemplate(null);

  const handleDeleteTemplate = () => setShowDeleteConfirmation(true);

  const handleConfirmDelete = () => {
    const updated = templates.filter((t) => t.name !== selectedTemplateName);
    setTemplates(updated);
    localStorage.setItem(JOB_TEMPLATES_STORAGE_KEY, JSON.stringify(updated));
    setSelectedTemplateName("");
    setShowDeleteConfirmation(false);
    toast.success("Template deleted");
  };

  const handleCancelDelete = () => setShowDeleteConfirmation(false);

  return (
    <div className="w-full my-6">
      <div className="flex items-center justify-between relative">
        {/* Connector line */}
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-0.5 bg-gray-200 z-0" />
        <div
          className="absolute left-0 top-1/2 -translate-y-1/2 h-0.5 bg-indigo-500 z-0 transition-all duration-700"
          style={{
            width:
              active < 0
                ? "0%"
                : active === 0
                ? "0%"
                : active === 1
                ? "50%"
                : "100%",
          }}
        />

        {STEPS.map((s, i) => {
          const done = active > i;
          const current = active === i;
          const errored = isError && current;

          return (
            <div
              key={s.id}
              className="flex flex-col items-center gap-2 z-10"
            >
              <div
                className={[
                  "w-9 h-9 rounded-full flex items-center justify-center border-2 text-sm font-bold transition-all duration-500",
                  done
                    ? "bg-indigo-500 border-indigo-500 text-white"
                    : current && !errored
                    ? "bg-white border-indigo-500 text-indigo-600 animate-pulse"
                    : errored
                    ? "bg-red-500 border-red-500 text-white"
                    : "bg-white border-gray-300 text-gray-400",
                ].join(" ")}
              >
                {done ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : errored ? (
                  "✕"
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={[
                  "text-xs font-medium whitespace-nowrap",
                  done
                    ? "text-indigo-600"
                    : current && !errored
                    ? "text-indigo-500"
                    : errored
                    ? "text-red-500"
                    : "text-gray-400",
                ].join(" ")}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PostJobForm() {
  const [form, setForm] = useState<JobFormData>({
    title: "",
    description: "",
    budgetXlm: 50,
    skills: "",
    deadline: "",
  });

  const [stepState, setStepState] = useState<StepState>({ current: "idle" });
  const [submitting, setSubmitting] = useState(false);

  const isInProgress =
    stepState.current === "posting" || stepState.current === "escrow";

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: name === "budgetXlm" ? Number(value) : value,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setStepState({ current: "posting" });

    let jobId: string | undefined;

    try {
      // ── Step 1: POST to backend ──────────────────────────────────────────
      const createRes = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          budgetXlm: form.budgetXlm,
          skills: form.skills
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          deadline: form.deadline,
        }),
      });

      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        throw new Error(err?.message ?? "Failed to create job");
      }

      const { job } = await createRes.json();
      jobId = job.id as string;

      // ── Step 2: Lock escrow on-chain ─────────────────────────────────────
      setStepState({ current: "escrow", jobId });

      // Resolve the client's Freighter public key
      const { publicKey: clientPublicKey } = await getPublicKey();

      const { txHash } = await createEscrowOnChain({
        clientPublicKey,
        jobId,
        budgetXlm: form.budgetXlm,
      });

      // ── Step 2b: Store the contract tx hash in the job record ────────────
      await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractTxHash: txHash }),
      });

      // ── Step 3: Done ─────────────────────────────────────────────────────
      setStepState({ current: "complete", jobId, txHash });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred.";

      // Roll back the job if it was created but escrow failed
      if (jobId) {
        try {
          await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
        } catch {
          // Best-effort rollback; ignore secondary failures
        }
      }

      setStepState({
        current: "error",
        jobId,
        errorMessage: message,
      });
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setStepState({ current: "idle" });
    setForm({
      title: "",
      description: "",
      budgetXlm: 50,
      skills: "",
      deadline: "",
    });
  }

  // -------------------------------------------------------------------------
  // Render: success state
  // -------------------------------------------------------------------------

  if (stepState.current === "complete") {
    return (
      <div className="max-w-lg mx-auto bg-white rounded-2xl shadow-lg p-8 text-center space-y-4">
        <ProgressBar step="complete" />

        <div className="flex flex-col items-center gap-3 pt-2">
          <div className="w-16 h-16 rounded-full bg-indigo-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Job Posted!</h2>
          <p className="text-gray-500 text-sm">
            Your budget of{" "}
            <span className="font-semibold text-indigo-600">
              {form.budgetXlm} XLM
            </span>{" "}
            has been locked in the escrow contract.
          </p>
        </div>

        {stepState.txHash && (
          <div className="bg-gray-50 rounded-xl p-4 text-left space-y-1">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Contract Transaction Hash
            </p>
            <p className="text-xs font-mono text-gray-800 break-all">
              {stepState.txHash}
            </p>
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${stepState.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-indigo-500 hover:underline inline-flex items-center gap-1"
            >
              View on Stellar Expert
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        )}

        <button
          onClick={handleReset}
          className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors text-sm"
        >
          Post Another Job
        </button>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: form + in-progress overlay
  // -------------------------------------------------------------------------

  return (
    <div className="max-w-lg mx-auto bg-white rounded-2xl shadow-lg p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Post a Job</h1>
      <p className="text-gray-500 text-sm mb-6">
        Your XLM budget will be locked in a Soroban escrow contract on-chain.
      </p>

      {/* 3-step progress (shown while submitting) */}
      {isInProgress && <ProgressBar step={stepState.current} />}

      {/* Error banner */}
      {stepState.current === "error" && (
        <div className="mb-5 rounded-xl bg-red-50 border border-red-200 p-4 space-y-1">
          <ProgressBar step={stepState.current} />
          <p className="text-sm font-semibold text-red-700">
            Something went wrong
          </p>
          <p className="text-xs text-red-600">{stepState.errorMessage}</p>
          {stepState.jobId && (
            <p className="text-xs text-red-500">
              The job record has been rolled back. Please try again.
            </p>
          )}
          <button
            onClick={() => setStepState({ current: "idle" })}
            className="mt-2 text-xs text-red-600 underline"
          >
            Dismiss and retry
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Job Title
          </label>
          <input
            name="title"
            value={form.title}
            onChange={handleChange}
            required
            disabled={isInProgress}
            placeholder="e.g. Build a Soroban DEX interface"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent disabled:opacity-60"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
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
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent disabled:opacity-60 resize-none"
          />
        </div>

        {/* Budget */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Budget (XLM)
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-indigo-500">
              XLM
            </span>
            <input
              name="budgetXlm"
              type="number"
              min={1}
              step={1}
              value={form.budgetXlm}
              onChange={handleChange}
              required
              disabled={isInProgress}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-14 pr-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent disabled:opacity-60"
            />
          </div>
          <p className="mt-1 text-xs text-gray-400">
            This exact amount will be deducted from your wallet and held in escrow.
          </p>
        </div>

        <div>
          <label className="label">Visibility</label>
          <select
            value={form.visibility}
            onChange={(e) => set("visibility", e.target.value as "public" | "private" | "invite_only")}
            className="input-field appearance-none cursor-pointer"
          >
            <option value="public">Public</option>
            <option value="private">Private (only you)</option>
            <option value="invite_only">Invite Only</option>
          </select>
        </div>

        {/* Skills */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Required Skills
          </label>
          <input
            name="skills"
            value={form.skills}
            onChange={handleChange}
            disabled={isInProgress}
            placeholder="Rust, Soroban, TypeScript (comma-separated)"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent disabled:opacity-60"
          />
        </div>

        {/* Deadline */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Deadline
          </label>
          <input
            name="deadline"
            type="date"
            value={form.deadline}
            onChange={handleChange}
            disabled={isInProgress}
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent disabled:opacity-60"
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isInProgress}
          className={[
            "w-full py-3 rounded-xl font-semibold text-sm transition-all duration-200",
            isInProgress
              ? "bg-indigo-300 text-white cursor-not-allowed"
              : "bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95",
          ].join(" ")}
        >
          {stepState.current === "posting"
            ? "Posting job…"
            : stepState.current === "escrow"
            ? "Waiting for Freighter signature…"
            : `Post Job & Lock ${form.budgetXlm} XLM Escrow`}
        </button>

        {isInProgress && (
          <p className="text-center text-xs text-gray-400">
            {stepState.current === "escrow"
              ? "Please approve the transaction in your Freighter wallet."
              : "Submitting your job to the platform…"}
          </p>
        )}
      </form>
    </div>
  );
}