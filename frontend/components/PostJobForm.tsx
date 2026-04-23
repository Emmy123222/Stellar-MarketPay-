/**
 * components/PostJobForm.tsx
 * Form for clients to post a new job with XLM budget.
 * Issue #21: Integrates Soroban escrow contract into job creation flow.
 */
import { useState } from "react";
import { createJob, updateJobEscrowId, deleteJob } from "@/lib/api";
import { buildCreateEscrowTransaction, submitSorobanTransaction } from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import { JOB_CATEGORIES, SKILL_SUGGESTIONS } from "@/utils/format";
import { useRouter } from "next/router";
import clsx from "clsx";
import { useToast } from "@/components/Toast";
import type { Currency } from "@/utils/types";

interface PostJobFormProps { publicKey: string; }

type Step = "idle" | "posting" | "locking" | "done" | "error";

export default function PostJobForm({ publicKey }: PostJobFormProps) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({
    title: "", description: "", budget: "", category: "", skillInput: "", deadline: "", currency: "XLM" as Currency,
  });
  const [skills, setSkills] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);

  const set = (key: string, val: string) => setForm((f) => ({ ...f, [key]: val }));

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

    let job: Awaited<ReturnType<typeof createJob>> | null = null;

    try {
      // Step 1 — Post job to backend
      job = await createJob({
        title: form.title.trim(),
        description: form.description.trim(),
        budget: parseFloat(form.budget).toFixed(7),
        currency: form.currency,
        category: form.category,
        skills,
        deadline: form.deadline || undefined,
        clientAddress: publicKey,
      });

      // Step 2 — Build & sign Soroban create_escrow() transaction
      setStep("locking");

      const unsignedTx = await buildCreateEscrowTransaction({
        clientPublicKey: publicKey,
        jobId: job.id,
        // Use client as placeholder freelancer until one is hired
        freelancerAddress: publicKey,
        budget: parseFloat(form.budget).toFixed(7),
        currency: form.currency,
      });

      const { signedXDR, error: signError } = await signTransactionWithWallet(unsignedTx.toXDR());
      if (signError || !signedXDR) {
        // Roll back: remove the orphaned job from the backend
        await deleteJob(job.id).catch(() => {}); // best-effort
        throw new Error(signError || "Freighter signing was cancelled");
      }

      // Step 3 — Submit to Soroban RPC and wait for confirmation
      const txHash = await submitSorobanTransaction(signedXDR).catch(async (e) => {
        // Roll back: remove the orphaned job from the backend
        await deleteJob(job!.id).catch(() => {});
        throw e;
      });

      // Step 4 — Persist escrow contract ID in the job record
      await updateJobEscrowId(job.id, txHash);

      setStep("done");
      toast.success("Job posted and budget locked in escrow.");
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      setStep("error");
      toast.error(`Failed: ${msg}`);
      setLoading(false);
    }
  };

  return (
    <div className="card max-w-2xl mx-auto animate-slide-up">
      <h2 className="font-display text-2xl font-bold text-amber-100 mb-2">Post a Job</h2>
      <p className="text-amber-800 text-sm mb-8">Fill in the details and set your XLM budget. Funds will be locked in escrow when a freelancer is hired.</p>

      <div className="space-y-6">
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
        
          {/* Character Counter */}
          <p
            id="description-counter"
            className={clsx(
              "mt-1 text-xs font-medium",
              form.description.trim().length < 30 && "text-red-400",
              form.description.trim().length >= 30 &&
                form.description.trim().length <= 100 &&
                "text-amber-400",
              form.description.trim().length > 100 && "text-green-400"
            )}
          >
            {form.description.length} / 2000
          </p>
        
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

        {/* Multi-step progress indicator */}
        {step !== "idle" && (
          <div className="p-4 rounded-xl bg-market-900/60 border border-market-500/20 space-y-3">
            <p className="text-xs font-medium text-amber-800/70 uppercase tracking-wider">Transaction progress</p>
            <div className="flex items-center gap-3">
              <StepDot status={step === "posting" ? "active" : step === "idle" || step === "error" ? "idle" : "done"} />
              <span className={clsx("text-sm", step === "posting" ? "text-amber-100" : step === "idle" ? "text-amber-800/50" : "text-green-400")}>
                Posting job
              </span>
            </div>
            <div className="flex items-center gap-3">
              <StepDot status={step === "locking" ? "active" : step === "done" ? "done" : "idle"} />
              <span className={clsx("text-sm", step === "locking" ? "text-amber-100" : step === "done" ? "text-green-400" : "text-amber-800/50")}>
                Locking escrow on-chain
              </span>
            </div>
            <div className="flex items-center gap-3">
              <StepDot status={step === "done" ? "done" : "idle"} />
              <span className={clsx("text-sm", step === "done" ? "text-green-400" : "text-amber-800/50")}>
                Complete
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

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
