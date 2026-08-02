/**
 * components/post-job-steps/BasicInfoStep.tsx
 * Step 1: Basic Info - title, description, category
 */
import { JobFormData } from "@/components/PostJobFormtypes";
import { fetchCategories, type CategoryNode } from "@/lib/api";
import { useEffect, useState } from "react";

interface Props {
  form: JobFormData;
  touched: Record<string, boolean>;
  errors: { title?: string; description?: string };
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  onTitleBlur?: () => void;
  duplicateWarning?: { title: string; id: string } | null;
  onDismissDuplicate?: () => void;
}

export default function BasicInfoStep({ form, touched, errors, onChange, onTitleBlur, duplicateWarning, onDismissDuplicate }: Props) {
  const [categories, setCategories] = useState<CategoryNode[]>([]);

  useEffect(() => {
    fetchCategories().then(setCategories).catch(() => {});
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-amber-300 mb-1">Job Title</label>
        <input
          name="title"
          value={form.title}
          onChange={onChange}
          onBlur={onTitleBlur}
          placeholder="e.g. Build a Soroban DEX interface"
          className="w-full rounded-xl border border-gray-200 dark:border-market-500/20 bg-gray-50 dark:bg-ink-700 px-4 py-2.5 text-sm text-gray-900 dark:text-amber-100 placeholder-gray-400 dark:placeholder-amber-900/50 focus:outline-none focus:ring-2 focus:ring-market-400/40 focus:border-transparent"
        />
        {touched.title && errors.title && <p className="text-red-400 text-xs mt-1">{errors.title}</p>}
        {/* Duplicate job warning (Issue #151) */}
        {duplicateWarning && (
          <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-sm">
            <div className="flex items-start gap-2">
              <svg className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <div className="flex-1 space-y-1">
                <p className="text-amber-300 font-medium text-xs uppercase tracking-wider">Duplicate detected</p>
                <p className="text-amber-100 text-sm">
                  You already have a similar job posted:{" "}
                  <a
                    href={`/jobs/${duplicateWarning.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-market-400 hover:underline"
                  >
                    {duplicateWarning.title}
                  </a>
                </p>
                <p className="text-amber-700 text-xs">
                  Consider closing the existing posting before creating a duplicate.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDismissDuplicate?.()}
                className="shrink-0 text-amber-400 hover:text-amber-300 transition-colors"
                aria-label="Dismiss duplicate warning"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}
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
