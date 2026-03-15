/**
 * components/PostJobForm.tsx
 * Form for clients to post a new job with XLM budget.
 */
import { useState } from "react";
import { createJob } from "@/lib/api";
import { JOB_CATEGORIES } from "@/utils/format";
import { useRouter } from "next/router";
import clsx from "clsx";

interface PostJobFormProps { publicKey: string; }

export default function PostJobForm({ publicKey }: PostJobFormProps) {
  const router = useRouter();
  const [form, setForm] = useState({
    title: "", description: "", budget: "", category: "", skillInput: "", deadline: "",
  });
  const [skills, setSkills] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: string, val: string) => setForm((f) => ({ ...f, [key]: val }));

  const addSkill = () => {
    const s = form.skillInput.trim();
    if (s && !skills.includes(s) && skills.length < 8) {
      setSkills([...skills, s]);
      set("skillInput", "");
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
    try {
      const job = await createJob({
        title: form.title.trim(),
        description: form.description.trim(),
        budget: parseFloat(form.budget).toFixed(7),
        category: form.category,
        skills,
        deadline: form.deadline || undefined,
        clientAddress: publicKey,
      });
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      setError("Failed to post job. Please try again.");
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
          <textarea value={form.description} onChange={(e) => set("description", e.target.value)}
            rows={5} placeholder="Describe the work in detail — requirements, deliverables, acceptance criteria..."
            className="textarea-field" />
          <p className="mt-1 text-xs text-amber-800/50">{form.description.length} chars (min 30)</p>
        </div>

        {/* Category + Budget row */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Category</label>
            <select value={form.category} onChange={(e) => set("category", e.target.value)}
              className="input-field appearance-none cursor-pointer">
              <option value="">Select a category...</option>
              {JOB_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Budget (XLM)</label>
            <input type="number" value={form.budget} onChange={(e) => set("budget", e.target.value)}
              placeholder="e.g. 500" min="1" step="1" className="input-field" />
            <p className="mt-1 text-xs text-amber-800/50">Will be locked in escrow on hire</p>
          </div>
        </div>

        {/* Skills */}
        <div>
          <label className="label">Required Skills</label>
          <div className="flex gap-2">
            <input type="text" value={form.skillInput} onChange={(e) => set("skillInput", e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSkill())}
              placeholder="Type a skill and press Enter"
              className="input-field flex-1" />
            <button onClick={addSkill} type="button" className="btn-secondary px-4 py-3 text-sm">Add</button>
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

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        <button onClick={handleSubmit} disabled={!isValid || loading} className="btn-primary w-full flex items-center justify-center gap-2">
          {loading ? <><Spinner /> Posting Job...</> : "Post Job & Lock Budget in Escrow"}
        </button>

        <p className="text-center text-xs text-amber-800/60">
          By posting, the budget ({form.budget ? `${form.budget} XLM` : "—"}) will be held in a Soroban escrow contract and released when you approve the completed work.
        </p>
      </div>
    </div>
  );
}

function Spinner() {
  return <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>;
}
