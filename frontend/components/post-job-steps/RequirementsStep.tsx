/**
 * components/post-job-steps/RequirementsStep.tsx
 * Step 3: Requirements - skills, screening questions, deadline
 */
import { JobFormData } from "@/components/PostJobFormtypes";

interface Props {
  form: JobFormData;
  suggestions: string[];
  showSuggestions: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  onSelectSkill: (skill: string) => void;
  updateScreeningQuestion: (index: number, value: string) => void;
  addScreeningQuestion: () => void;
  removeScreeningQuestion: (index: number) => void;
}

export default function RequirementsStep({
  form,
  suggestions,
  showSuggestions,
  onChange,
  onSelectSkill,
  updateScreeningQuestion,
  addScreeningQuestion,
  removeScreeningQuestion
}: Props) {
  return (
    <div className="space-y-5">
      <div className="relative">
        <label className="block text-sm font-medium text-gray-700 dark:text-amber-300 mb-1">Required Skills</label>
        <input
          name="skills"
          value={form.skills}
          onChange={onChange}
          autoComplete="off"
          placeholder="Rust, Soroban, TypeScript (comma-separated)"
          className="w-full rounded-xl border border-gray-200 dark:border-market-500/20 bg-gray-50 dark:bg-ink-700 px-4 py-2.5 text-sm text-gray-900 dark:text-amber-100 placeholder-gray-400 dark:placeholder-amber-900/50 focus:outline-none focus:ring-2 focus:ring-market-400/40 focus:border-transparent"
        />
        {showSuggestions && suggestions.length > 0 && (
          <ul className="absolute z-10 w-full mt-1 bg-white dark:bg-ink-800 border border-gray-200 dark:border-market-500/20 rounded-xl shadow-lg max-h-40 overflow-y-auto">
            {suggestions.map((s) => (
              <li key={s} onClick={() => onSelectSkill(s)} className="px-4 py-2 text-sm text-gray-900 dark:text-amber-100 cursor-pointer hover:bg-market-500/10">{s}</li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-amber-300 mb-1">Deadline</label>
        <input
          name="deadline"
          type="date"
          value={form.deadline}
          onChange={onChange}
          min={new Date().toISOString().split("T")[0]}
          className="w-full rounded-xl border border-gray-200 dark:border-market-500/20 bg-gray-50 dark:bg-ink-700 px-4 py-2.5 text-sm text-gray-900 dark:text-amber-100 focus:outline-none focus:ring-2 focus:ring-market-400/40 focus:border-transparent"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700 dark:text-amber-300">Screening Questions</label>
          <button type="button" onClick={addScreeningQuestion} disabled={form.screeningQuestions.length >= 5} className="btn-secondary text-xs px-2 py-1">+ Add</button>
        </div>
        <div className="space-y-2">
          {form.screeningQuestions.map((q, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                value={q}
                onChange={(e) => updateScreeningQuestion(i, e.target.value)}
                placeholder={`Question ${i + 1}`}
                className="flex-1 rounded-xl border border-gray-200 dark:border-market-500/20 bg-gray-50 dark:bg-ink-700 px-3 py-2 text-xs text-gray-900 dark:text-amber-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-market-400/40"
              />
              {form.screeningQuestions.length > 1 && (
                <button type="button" onClick={() => removeScreeningQuestion(i)} className="text-red-400 hover:text-red-300 text-lg leading-none flex-shrink-0">✕</button>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-amber-800 mt-1">Up to 5 questions. Applicants will answer these when submitting.</p>
      </div>
    </div>
  );
}
