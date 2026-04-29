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

interface PostJobFormProps { publicKey: string; }

type Step = "idle" | "posting" | "locking" | "done" | "error";
type FormState = {
  title: string;
  description: string;
  budget: string;
  category: string;
  skillInput: string;
  deadline: string;
  currency: Currency;
  timezone: string;
};

type JobTemplate = {
  name: string;
  title: string;
  description: string;
  budget: string;
  category: string;
  skills: string[];
  deadline: string;
};

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

  // Template feature states
  const [templates, setTemplates] = useState<JobTemplate[]>([]);
  const [selectedTemplateName, setSelectedTemplateName] = useState("");
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [templateNameInput, setTemplateNameInput] = useState("");
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [pendingOverwriteTemplate, setPendingOverwriteTemplate] = useState<JobTemplate | null>(null);

  useEffect(() => {
    setTemplates(readTemplates());
  }, []);

  const handleLoadTemplate = (name: string) => {
    setSelectedTemplateName(name);
    setShowDeleteConfirmation(false);
    if (!name) {
      setForm(emptyForm);
      setSkills([]);
      return;
    }
    const template = templates.find((t) => t.name === name);
    if (template) {
      setForm({
        ...emptyForm,
        title: template.title,
        description: template.description,
        budget: template.budget,
        category: template.category,
        deadline: template.deadline,
      });
      setSkills(template.skills);
    }
  };

  const handleDeleteTemplate = () => setShowDeleteConfirmation(true);
  const handleCancelDelete = () => setShowDeleteConfirmation(false);
  const handleConfirmDelete = () => {
    const updated = templates.filter((t) => t.name !== selectedTemplateName);
    window.localStorage.setItem(JOB_TEMPLATES_STORAGE_KEY, JSON.stringify(updated));
    setTemplates(updated);
    setSelectedTemplateName("");
    setShowDeleteConfirmation(false);
    toast.success("Template deleted.");
  };

  const handleSaveTemplate = () => {
    const name = templateNameInput.trim();
    if (!name) {
      setTemplateError("Please enter a template name.");
      return;
    }
    const newTemplate: JobTemplate = {
      name,
      title: form.title,
      description: form.description,
      budget: form.budget,
      category: form.category,
      skills,
      deadline: form.deadline,
    };
    const existing = templates.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      setPendingOverwriteTemplate(newTemplate);
      return;
    }
    const updated = [...templates, newTemplate];
    window.localStorage.setItem(JOB_TEMPLATES_STORAGE_KEY, JSON.stringify(updated));
    setTemplates(updated);
    setTemplateNameInput("");
    setTemplateError(null);
    toast.success("Template saved.");
  };

  const handleConfirmOverwrite = () => {
    if (!pendingOverwriteTemplate) return;
    const updated = templates.map((t) => 
      t.name.toLowerCase() === pendingOverwriteTemplate.name.toLowerCase() ? pendingOverwriteTemplate : t
    );
    window.localStorage.setItem(JOB_TEMPLATES_STORAGE_KEY, JSON.stringify(updated));
    setTemplates(updated);
    setPendingOverwriteTemplate(null);
    setTemplateNameInput("");
    toast.success("Template updated.");
  };

  const handleCancelOverwrite = () => setPendingOverwriteTemplate(null);

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
    <div className="card max-w-2xl mx-auto animate-slide-up">
      <h2 className="font-display text-2xl font-bold text-amber-100 mb-2">Post a Job</h2>
      <p className="text-amber-800 text-sm mb-8">Fill in the details and set your XLM budget. Funds will be locked in escrow when a freelancer is hired.</p>

      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <label className="label">Load Template</label>
            <select
              value={selectedTemplateName}
              onChange={(e) => handleLoadTemplate(e.target.value)}
              className="input-field appearance-none cursor-pointer"
            >
              <option value="">Select a saved template...</option>
              {templates.map((template) => (
                <option key={template.name} value={template.name}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={handleDeleteTemplate}
            disabled={!selectedTemplateName}
            className="btn-secondary px-4 py-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Delete Template
          </button>
        </div>

        {showDeleteConfirmation && selectedTemplateName && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 space-y-3">
            <p className="text-sm text-red-300">Delete template &quot;{selectedTemplateName}&quot;?</p>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={handleConfirmDelete} className="btn-secondary px-4 py-2 text-sm">
                Confirm Delete
              </button>
              <button type="button" onClick={handleCancelDelete} className="btn-secondary px-4 py-2 text-sm">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Title */}
        <div>
          <label className="label">Job Title</label>
          <input type="text" value={form.title} onChange={(e) => set("title", e.target.value)}
            placeholder="e.g. Build a Soroban escrow contract for NFT marketplace"
            className={clsx("input-field", form.title.length > 0 && form.title.length < 10 && "border-red-500/40")} />
          {form.title.length > 0 && form.title.length < 10 && (
            <p className="mt-1 text-xs text-red-400">Title must be at least 10 characters</p>
          )}
        </div>

            {/* Description */}
        <div>
          <label className="label">Description</label>
        
          <textarea
            value={form.description}
            rows={5}
            maxLength={2000}
            placeholder="Describe the work in detail — requirements, deliverables, acceptance criteria..."
            className={clsx(
              "textarea-field",
              form.description.length > 0 &&
                form.description.trim().length < 30 &&
                "border-red-500/40"
            )}
            aria-invalid={form.description.trim().length > 0 && form.description.trim().length < 30}
            aria-describedby="description-counter description-error"
            onChange={(e) => {
              let value = e.target.value;
        
              // Prevent overflow beyond 2000 characters (extra safety beyond maxLength)
              if (value.length > 2000) {
                value = value.slice(0, 2000);
              }
        
              set("description", value);
            }}
            onPaste={(e) => {
              const paste = e.clipboardData.getData("text");
              const newLength = form.description.length + paste.length;
        
              // If pasted content would exceed limit, truncate it
              if (newLength > 2000) {
                e.preventDefault();
                const allowed = paste.slice(0, 2000 - form.description.length);
                set("description", form.description + allowed);
              }
            }}
          />
        
          {/* Character Counter + Word Count Quality Indicator (Issue #148) */}
          {(() => {
            const wordCount = form.description.trim() === ""
              ? 0
              : form.description.trim().split(/\s+/).length;
            const quality: "too_short" | "good" | "detailed" =
              wordCount < 30 ? "too_short" : wordCount <= 80 ? "good" : "detailed";
            const qualityLabel =
              quality === "too_short" ? "Too short"
              : quality === "good" ? "Good"
              : "Detailed";
            const qualityClass =
              quality === "too_short"
                ? "bg-red-500/10 text-red-400 border-red-500/20"
                : quality === "good"
                  ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
                  : "bg-green-500/10 text-green-400 border-green-500/20";

            return (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <p
                  id="description-counter"
                  className={clsx(
                    "text-xs font-medium",
                    form.description.trim().length < 30 && "text-red-400",
                    form.description.trim().length >= 30 &&
                      form.description.trim().length <= 100 &&
                      "text-amber-400",
                    form.description.trim().length > 100 && "text-green-400"
                  )}
                >
                  {form.description.length} / 2000
                </p>
                <p className="text-xs font-medium text-amber-800/80">
                  {wordCount} {wordCount === 1 ? "word" : "words"}
                </p>
                <span
                  className={clsx(
                    "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-semibold",
                    qualityClass
                  )}
                >
                  {qualityLabel}
                </span>
              </div>
            );
          })()}

          {/* Inline Error */}
          {form.description.length > 0 && form.description.trim().length < 30 && (
            <p
              id="description-error"
              className="mt-1 text-xs text-red-400"
            >
              Description must be at least 30 characters
            </p>
          )}
        </div>

        {/* Category + Budget + Currency row */}
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="label">Category</label>
            <select value={form.category} onChange={(e) => set("category", e.target.value)}
              className="input-field appearance-none cursor-pointer">
              <option value="">Select a category...</option>
              {JOB_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Budget</label>
            <input type="number" value={form.budget} onChange={(e) => set("budget", e.target.value)}
              placeholder="e.g. 500" min="1" step="1" className="input-field" />
            <p className="mt-1 text-xs text-amber-800/50">Will be locked in escrow on hire</p>
          </div>
          <div>
            <label className="label">Currency</label>
            <select value={form.currency} onChange={(e) => set("currency", e.target.value as Currency)}
              className="input-field appearance-none cursor-pointer">
              <option value="XLM">XLM (Stellar Lumens)</option>
              <option value="USDC">USDC (USD Coin)</option>
            </select>
            <p className="mt-1 text-xs text-amber-800/50">Payment currency for this job</p>
          </div>
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
        <div className="relative">
          <label className="label">Required Skills</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input 
                type="text" 
                value={form.skillInput} 
                onChange={(e) => {
                  set("skillInput", e.target.value);
                  setShowSuggestions(e.target.value.trim().length > 0);
                  setSelectedSuggestionIndex(0);
                }}
                onFocus={() => setShowSuggestions(form.skillInput.trim().length > 0)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (showSuggestions && filteredSuggestions.length > 0) {
                      addSkill(filteredSuggestions[selectedSuggestionIndex]);
                    } else {
                      addSkill();
                    }
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSelectedSuggestionIndex((prev) => 
                      prev < filteredSuggestions.length - 1 ? prev + 1 : prev
                    );
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSelectedSuggestionIndex((prev) => prev > 0 ? prev - 1 : 0);
                  } else if (e.key === "Escape") {
                    setShowSuggestions(false);
                  }
                }}
                placeholder="Type a skill and press Enter"
                className="input-field w-full" />
              {/* Suggestions Dropdown */}
              {showSuggestions && filteredSuggestions.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-market-900 border border-market-500/20 rounded-lg shadow-lg overflow-hidden">
                  {filteredSuggestions.map((suggestion, index) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => addSkill(suggestion)}
                      className={clsx(
                        "w-full text-left px-3 py-2 text-sm transition-colors",
                        index === selectedSuggestionIndex 
                          ? "bg-market-500/20 text-market-400" 
                          : "text-amber-100 hover:bg-market-500/10"
                      )}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => addSkill()} type="button" className="btn-secondary px-4 py-3 text-sm">Add</button>
          </div>
          {skills.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {skills.map((s) => (
                <span key={s} className="flex items-center gap-1.5 text-xs bg-market-500/10 text-market-400 border border-market-500/20 px-2.5 py-1 rounded-full">
                  {s}
                  <button onClick={() => removeSkill(s)} className="text-market-600 hover:text-red-400 transition-colors">×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Deadline (optional) */}
        <div>
          <label className="label">Deadline <span className="normal-case text-amber-900 font-normal">(optional)</span></label>
          <input type="date" value={form.deadline} onChange={(e) => set("deadline", e.target.value)}
            className="input-field" min={new Date().toISOString().split("T")[0]} />
        </div>

        {/* Timezone (optional) */}
        <div>
          <label className="label">Timezone/Location <span className="normal-case text-amber-900 font-normal">(optional)</span></label>
          <select value={form.timezone} onChange={(e) => set("timezone", e.target.value)}
            className="input-field appearance-none cursor-pointer">
            <option value="">No timezone preference</option>
            <option value="UTC">UTC (Universal)</option>
            <option value="America/New_York">America/New York (EST/EDT)</option>
            <option value="America/Los_Angeles">America/Los Angeles (PST/PDT)</option>
            <option value="America/Chicago">America/Chicago (CST/CDT)</option>
            <option value="Europe/London">Europe/London (GMT/BST)</option>
            <option value="Europe/Paris">Europe/Paris (CET/CEST)</option>
            <option value="Europe/Berlin">Europe/Berlin (CET/CEST)</option>
            <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
            <option value="Asia/Shanghai">Asia/Shanghai (CST)</option>
            <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
            <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
            <option value="Australia/Sydney">Australia/Sydney (AEST/AEDT)</option>
            <option value="Pacific/Auckland">Pacific/Auckland (NZST/NZDT)</option>
          </select>
          <p className="mt-1 text-xs text-amber-800/50">Helps freelancers in compatible timezones find your job</p>
        </div>

        {/* Screening Questions (optional) */}
        <div>
          <label className="label">Screening Questions <span className="normal-case text-amber-900 font-normal">(optional - up to 5)</span></label>
          <p className="text-xs text-amber-800/50 mb-3">Add questions applicants must answer when applying. This helps filter relevant candidates.</p>
          <div className="space-y-3">
            {screeningQuestions.map((question, index) => (
              <div key={index} className="flex gap-2">
                <input
                  type="text"
                  value={question}
                  onChange={(e) => updateScreeningQuestion(index, e.target.value)}
                  placeholder={`Question ${index + 1}`}
                  className="input-field flex-1"
                />
                {screeningQuestions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeScreeningQuestion(index)}
                    className="btn-secondary px-3 py-2 text-sm"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            {screeningQuestions.length < 5 && (
              <button
                type="button"
                onClick={addScreeningQuestion}
                className="btn-secondary text-sm py-2 px-4"
              >
                + Add Question
              </button>
            )}
          </div>
        </div>

        {/* Multi-step progress indicator */}
        {step !== "idle" && (
          <div className="p-4 rounded-xl bg-market-900/60 border border-market-500/20 space-y-3">
            <p className="text-xs font-medium text-amber-800/70 uppercase tracking-wider">Transaction progress</p>
            <div className="flex items-center gap-3">
              <StepDot status={getStepStatus(step, "posting")} />
              <span className={clsx("text-sm", getStepTextColor(step, "posting"))}>
                Posting job
              </span>
            </div>
            <div className="flex items-center gap-3">
              <StepDot status={getStepStatus(step, "locking")} />
              <span className={clsx("text-sm", getStepTextColor(step, "locking"))}>
                Locking escrow on-chain
              </span>
            </div>
            <div className="flex items-center gap-3">
              <StepDot status={getStepStatus(step, "done")} />
              <span className={clsx("text-sm", getStepTextColor(step, "done"))}>
                Complete
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        <div className="space-y-3 rounded-xl border border-market-500/20 bg-market-900/30 p-4">
          <label className="label">Template Name</label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={templateNameInput}
              onChange={(e) => {
                setTemplateNameInput(e.target.value);
                setTemplateError(null);
                setPendingOverwriteTemplate(null);
                setShowDeleteConfirmation(false);
              }}
              placeholder="e.g. Ongoing smart contract audit brief"
              className={clsx("input-field flex-1", templateError && "border-red-500/40")}
            />
            <button
              type="button"
              onClick={handleSaveTemplate}
              className="btn-secondary px-4 py-3 text-sm"
            >
              Save as Template
            </button>
          </div>
          {templateError && (
            <p className="text-xs text-red-400">{templateError}</p>
          )}
          {pendingOverwriteTemplate && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 space-y-3">
              <p className="text-sm text-amber-100">
                A template named &quot;{pendingOverwriteTemplate.name}&quot; already exists. Overwrite it?
              </p>
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={handleConfirmOverwrite} className="btn-secondary px-4 py-2 text-sm">
                  Overwrite Template
                </button>
                <button type="button" onClick={handleCancelOverwrite} className="btn-secondary px-4 py-2 text-sm">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={handleSubmit}
          disabled={
            loading ||
            !isValid ||
            form.description.trim().length < 30 ||
            form.description.trim().length > 2000 ||
            form.description.replace(/\s/g, "").length < 30
          }
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {step === "posting" && <><Spinner /> Posting job...</>}
          {step === "locking" && <><Spinner /> Locking escrow — sign in Freighter...</>}
          {(step === "idle" || step === "error") && "Post Job & Lock Budget in Escrow"}
        </button>

        <p className="text-center text-xs text-amber-800/60">
          By posting, budget ({form.budget ? `${form.budget} ${form.currency}` : "—"}) will be held in a Soroban escrow contract and released when you approve of completed work.
        </p>
      </div>

      {pendingEscrow && (
        <FeeEstimationModal
          transaction={pendingEscrow.transaction}
          functionName="create_escrow"
          payerPublicKey={publicKey}
          onConfirm={handleConfirmEscrowFee}
          onCancel={handleCancelEscrowFee}
        />
      )}
    </div>
  );
}

function Spinner() {
  return <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>;
}

function StepDot({ status }: { status: "idle" | "active" | "done" }) {
  if (status === "done") {
    return (
      <span className="w-5 h-5 rounded-full bg-green-500/20 border border-green-500/40 flex items-center justify-center text-green-400 text-xs">✓</span>
    );
  }
  if (status === "active") {
    return (
      <span className="w-5 h-5 rounded-full border border-amber-400/60 flex items-center justify-center">
        <Spinner />
      </span>
    );
  }
  return <span className="w-5 h-5 rounded-full border border-amber-800/30 bg-market-900/40" />;
}

function readTemplates(): JobTemplate[] {
  if (typeof window === "undefined") return [];

  try {
    const rawTemplates = window.localStorage.getItem(JOB_TEMPLATES_STORAGE_KEY);
    if (!rawTemplates) return [];

    const parsedTemplates = JSON.parse(rawTemplates);
    if (!Array.isArray(parsedTemplates)) return [];

    return parsedTemplates.filter(isJobTemplate);
  } catch {
    return [];
  }
}

function isJobTemplate(value: unknown): value is JobTemplate {
  if (!value || typeof value !== "object") return false;

  const template = value as Partial<JobTemplate>;
  return typeof template.name === "string" &&
    typeof template.title === "string" &&
    typeof template.description === "string" &&
    typeof template.budget === "string" &&
    typeof template.category === "string" &&
    Array.isArray(template.skills) &&
    template.skills.every((skill) => typeof skill === "string") &&
    typeof template.deadline === "string";
}
