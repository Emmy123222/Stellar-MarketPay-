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
}

export default function BasicInfoStep({ form, touched, errors, onChange }: Props) {
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
