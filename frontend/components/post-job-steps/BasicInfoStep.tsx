/**
 * components/post-job-steps/BasicInfoStep.tsx
 * Step 1: Basic Info - title, description, category
 */
import { JobFormData } from "@/components/PostJobFormtypes";
import { fetchCategories, scoreJobDescription, type JobDescriptionScore, type CategoryNode } from "@/lib/api";
import { useEffect, useState, useRef, useCallback } from "react";

interface Props {
  form: JobFormData;
  touched: Record<string, boolean>;
  errors: { title?: string; description?: string };
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
}

const SCORE_DEBOUNCE_MS = 1000;
const MIN_CHARS_FOR_SCORING = 30;

export default function BasicInfoStep({ form, touched, errors, onChange }: Props) {
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [score, setScore] = useState<JobDescriptionScore | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);
  const scoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScoredRef = useRef<string>("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    fetchCategories().then(setCategories).catch(() => {});
  }, []);

  // Debounced live scoring of the job description
  const requestScore = useCallback((desc: string) => {
    if (scoreTimerRef.current) clearTimeout(scoreTimerRef.current);

    if (!desc || desc.trim().length < MIN_CHARS_FOR_SCORING) {
      setScore(null);
      return;
    }

    scoreTimerRef.current = setTimeout(async () => {
      // Avoid duplicate calls for the same text
      if (desc === lastScoredRef.current) return;
      lastScoredRef.current = desc;

      setScoreLoading(true);
      try {
        const result = await scoreJobDescription(desc);
        if (!mountedRef.current) return;
        setScore(result);
      } catch {
        // Scoring is optional — silently ignore failures
        if (!mountedRef.current) return;
        setScore(null);
      } finally {
        if (mountedRef.current) setScoreLoading(false);
      }
    }, SCORE_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    requestScore(form.description);
    return () => {
      if (scoreTimerRef.current) clearTimeout(scoreTimerRef.current);
    };
  }, [form.description, requestScore]);

  const scorePercent = score?.score ?? 0;
  const scoreColor =
    scorePercent >= 70 ? "text-green-400" :
    scorePercent >= 40 ? "text-market-400" :
    "text-red-400";

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-amber-300 mb-1">Job Title</label>
        <input
          name="title"
          value={form.title}
          onChange={onChange}
          placeholder="e.g. Build a Soroban DEX interface"
          className="w-full rounded-xl border border-gray-200 dark:border-market-500/20 bg-gray-50 dark:bg-ink-700 px-4 py-2.5 text-sm text-gray-900 dark:text-amber-100 placeholder-gray-400 dark:placeholder-amber-900/50 focus:outline-none focus:ring-2 focus:ring-market-400/40 focus:border-transparent"
        />
        {touched.title && errors.title && <p className="text-red-400 text-xs mt-1">{errors.title}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-amber-300 mb-1">Description</label>
        <textarea
          name="description"
          value={form.description}
          onChange={onChange}
          rows={5}
          placeholder="Describe the work, deliverables, and any context..."
          className="w-full rounded-xl border border-gray-200 dark:border-market-500/20 bg-gray-50 dark:bg-ink-700 px-4 py-2.5 text-sm text-gray-900 dark:text-amber-100 placeholder-gray-400 dark:placeholder-amber-900/50 focus:outline-none focus:ring-2 focus:ring-market-400/40 focus:border-transparent resize-none"
        />
        <div className="flex justify-between mt-1">
          {touched.description && errors.description
            ? <p className="text-red-400 text-xs">{errors.description}</p>
            : <span />}
          <span className="text-xs text-amber-800">{form.description.length} chars</span>
        </div>

        {/* ── AI Score Widget ── */}
        {score && (
          <div className="mt-3 rounded-xl bg-ink-800/60 border border-market-500/10 p-3 space-y-2 transition-all duration-300">
            <div className="flex items-center gap-2">
              <span className={`text-lg font-bold ${scoreColor}`}>{scorePercent}/100</span>
              <span className="text-xs text-amber-700">AI quality score</span>
              {scoreLoading && (
                <span className="inline-block w-3 h-3 border-2 border-amber-700 border-t-transparent rounded-full animate-spin ml-1" />
              )}
            </div>
            {/* Progress bar */}
            <div className="w-full h-1.5 rounded-full bg-ink-700 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  scorePercent >= 70 ? "bg-green-400" :
                  scorePercent >= 40 ? "bg-market-400" :
                  "bg-red-400"
                }`}
                style={{ width: `${scorePercent}%` }}
              />
            </div>
            {score.suggestions && score.suggestions.length > 0 && (
              <details className="text-xs">
                <summary className="text-amber-600 hover:text-amber-400 cursor-pointer transition-colors">
                  {score.suggestions.length} suggestion{score.suggestions.length !== 1 ? "s" : ""}
                </summary>
                <ul className="mt-1.5 ml-4 list-disc space-y-0.5 text-amber-700">
                  {score.suggestions.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </details>
            )}
            {score.missingInformation && score.missingInformation.length > 0 && (
              <details className="text-xs">
                <summary className="text-red-400/80 hover:text-red-300 cursor-pointer transition-colors">
                  {score.missingInformation.length} missing detail{score.missingInformation.length !== 1 ? "s" : ""}
                </summary>
                <ul className="mt-1.5 ml-4 list-disc space-y-0.5 text-red-400/70">
                  {score.missingInformation.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        {scoreLoading && !score && (
          <div className="mt-3 flex items-center gap-2 text-xs text-amber-700">
            <span className="inline-block w-3 h-3 border-2 border-amber-700 border-t-transparent rounded-full animate-spin" />
            Analyzing description…
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-amber-300 mb-1">Category</label>
        <select
          name="category"
          value={form.category}
          onChange={onChange}
          className="w-full rounded-xl border border-gray-200 dark:border-market-500/20 bg-gray-50 dark:bg-ink-700 px-4 py-2.5 text-sm text-gray-900 dark:text-amber-100 focus:outline-none focus:ring-2 focus:ring-market-400/40 focus:border-transparent"
        >
          {categories.length > 0 ? (
            categories.map((parent) => (
              <optgroup key={parent.slug} label={parent.name}>
                {/* The parent itself is selectable */}
                <option value={parent.slug}>{parent.name}</option>
                {parent.children.map((child) => (
                  <option key={child.slug} value={child.slug}>
                    {"\u00a0\u00a0"}{child.name}
                  </option>
                ))}
              </optgroup>
            ))
          ) : (
            // Fallback while categories are loading
            <option value={form.category}>{form.category || "Loading…"}</option>
          )}
        </select>
      </div>
    </div>
  );
}
