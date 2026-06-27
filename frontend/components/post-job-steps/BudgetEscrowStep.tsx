/**
 * components/post-job-steps/BudgetEscrowStep.tsx
 * Step 2: Budget & Escrow - amount, currency, milestones
 */
import { JobFormData, Milestone } from "@/components/PostJobFormtypes";

interface Props {
  form: JobFormData;
  touched: Record<string, boolean>;
  errors: { budget?: string; milestones?: string };
  budgetValue: number;
  milestoneSum: number;
  xlmPriceUsd: number | null;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  updateMilestone: (index: number, field: "description" | "amount", value: string) => void;
  addMilestone: () => void;
  removeMilestone: (index: number) => void;
}

export default function BudgetEscrowStep({ 
  form, 
  touched, 
  errors, 
  budgetValue, 
  milestoneSum, 
  xlmPriceUsd,
  onChange,
  updateMilestone,
  addMilestone,
  removeMilestone 
}: Props) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-amber-300 mb-1">Budget</label>
          <div className="relative">
            <input
              name="budget"
              type="number"
              step="0.0000001"
              min="0"
              value={form.budget}
              onChange={onChange}
              className="w-full rounded-xl border border-gray-200 dark:border-market-500/20 bg-gray-50 dark:bg-ink-700 px-4 py-2.5 text-sm text-gray-900 dark:text-amber-100 focus:outline-none focus:ring-2 focus:ring-market-400/40 focus:border-transparent"
            />
          </div>
          {touched.budget && errors.budget && <p className="text-red-400 text-xs mt-1">{errors.budget}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-amber-300 mb-1">Currency</label>
          <select
            name="currency"
            value={form.currency}
            onChange={onChange}
            className="w-full rounded-xl border border-gray-200 dark:border-market-500/20 bg-gray-50 dark:bg-ink-700 px-4 py-2.5 text-sm text-gray-900 dark:text-amber-100 focus:outline-none focus:ring-2 focus:ring-market-400/40 focus:border-transparent"
          >
            <option value="XLM">XLM</option>
            <option value="USDC">USDC</option>
          </select>
        </div>
      </div>

      {xlmPriceUsd && form.currency === "XLM" && budgetValue > 0 && (
        <p className="text-xs text-amber-700">≈ ${(budgetValue * xlmPriceUsd).toFixed(2)} USD at current rate</p>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700 dark:text-amber-300">Milestones</label>
          <button type="button" onClick={addMilestone} disabled={form.milestones.length >= 10} className="btn-secondary text-xs px-2 py-1">+ Add</button>
        </div>
        <div className="space-y-2">
          {form.milestones.map((m: Milestone, i: number) => (
            <div key={i} className="flex gap-2 items-start">
              <input
                value={m.description}
                onChange={(e) => updateMilestone(i, "description", e.target.value)}
                placeholder="Milestone description"
                className="flex-1 rounded-xl border border-gray-200 dark:border-market-500/20 bg-gray-50 dark:bg-ink-700 px-3 py-2 text-xs text-gray-900 dark:text-amber-100 placeholder-gray-400 dark:placeholder-amber-900/50 focus:outline-none focus:ring-2 focus:ring-market-400/40"
              />
              <input
                type="number"
                value={m.amount}
                onChange={(e) => updateMilestone(i, "amount", e.target.value)}
                placeholder="Amount"
                className="w-24 rounded-xl border border-gray-200 dark:border-market-500/20 bg-gray-50 dark:bg-ink-700 px-3 py-2 text-xs text-gray-900 dark:text-amber-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-market-400/40"
              />
              {form.milestones.length > 1 && (
                <button type="button" onClick={() => removeMilestone(i)} className="text-red-400 hover:text-red-300 text-lg leading-none mt-1.5 flex-shrink-0">✕</button>
              )}
            </div>
          ))}
        </div>
        <div className={`mt-2 text-xs flex justify-between ${Math.abs(milestoneSum - budgetValue) > 0.000001 ? "text-red-400" : "text-amber-700"}`}>
          <span>{touched.milestones && errors.milestones ? errors.milestones : "Milestones must sum to total budget"}</span>
          <span>{milestoneSum.toFixed(2)} / {budgetValue.toFixed(2)} {form.currency}</span>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-amber-300 mb-1">Visibility</label>
        <select
          name="visibility"
          value={form.visibility}
          onChange={onChange}
          className="w-full rounded-xl border border-gray-200 dark:border-market-500/20 bg-gray-50 dark:bg-ink-700 px-4 py-2.5 text-sm text-gray-900 dark:text-amber-100 focus:outline-none focus:ring-2 focus:ring-market-400/40 focus:border-transparent"
        >
          <option value="public">Public</option>
          <option value="private">Private</option>
          <option value="invite_only">Invite Only</option>
        </select>
      </div>
    </div>
  );
}
