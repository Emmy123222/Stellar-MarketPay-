/**
 * components/insights/CategoryTable.tsx
 * Table displaying category statistics in insights page
 */
import type { InsightCategory } from "@/lib/api";

interface Props {
  categories: InsightCategory[];
  onSort: (key: "totalJobs" | "avgBudget" | "avgApplicationsPerJob" | "acceptanceRate" | "lowCompetitionJobs") => void;
  sortKey: string;
  sortDirection: "asc" | "desc";
}

function formatBudget(value: number) {
  return `${value.toFixed(2)} XLM`;
}

function SortButton({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left transition-colors ${
        active ? "text-market-300" : "text-amber-800 hover:text-amber-200"
      }`}
    >
      {label}
      {active && <span className="ml-1 text-[10px] font-mono">{direction === "asc" ? "▲" : "▼"}</span>}
    </button>
  );
}

export default function CategoryTable({ categories, onSort, sortKey, sortDirection }: Props) {
  return (
    <div className="bg-white dark:bg-ink-800 rounded-lg shadow overflow-hidden mb-10">
      <div className="px-6 py-4 border-b dark:border-market-500/10">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-amber-100">Stats by Category</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-ink-700 dark:bg-ink-900">
            <tr>
              <th className="text-left py-3 px-6 text-gray-600 dark:text-amber-700 font-medium">
                <SortButton
                  label="Category"
                  active={false}
                  direction={sortDirection}
                  onClick={() => {}}
                />
              </th>
              <th className="text-right py-3 px-6 text-gray-600 dark:text-amber-700 font-medium">
                <SortButton
                  label="Jobs"
                  active={sortKey === "totalJobs"}
                  direction={sortDirection}
                  onClick={() => onSort("totalJobs")}
                />
              </th>
              <th className="text-right py-3 px-6 text-gray-600 dark:text-amber-700 font-medium">
                <SortButton
                  label="Avg Budget (XLM)"
                  active={sortKey === "avgBudget"}
                  direction={sortDirection}
                  onClick={() => onSort("avgBudget")}
                />
              </th>
              <th className="text-right py-3 px-6 text-gray-600 dark:text-amber-700 font-medium">
                <SortButton
                  label="Avg App/Job"
                  active={sortKey === "avgApplicationsPerJob"}
                  direction={sortDirection}
                  onClick={() => onSort("avgApplicationsPerJob")}
                />
              </th>
              <th className="text-right py-3 px-6 text-gray-600 dark:text-amber-700 font-medium">
                <SortButton
                  label="Acceptance %"
                  active={sortKey === "acceptanceRate"}
                  direction={sortDirection}
                  onClick={() => onSort("acceptanceRate")}
                />
              </th>
              <th className="text-right py-3 px-6 text-gray-600 dark:text-amber-700 font-medium">
                <SortButton
                  label="Low Comp"
                  active={sortKey === "lowCompetitionJobs"}
                  direction={sortDirection}
                  onClick={() => onSort("lowCompetitionJobs")}
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {categories.map((entry) => (
              <tr key={entry.category} className="border-t dark:border-market-500/10 hover:bg-gray-50 dark:hover:bg-ink-700">
                <td className="py-3 px-6 text-gray-900 dark:text-amber-100 font-medium">{entry.category}</td>
                <td className="py-3 px-6 text-right text-gray-900 dark:text-amber-100">{entry.totalJobs}</td>
                <td className="py-3 px-6 text-right text-gray-900 dark:text-amber-100">{formatBudget(entry.avgBudget)}</td>
                <td className="py-3 px-6 text-right text-gray-900 dark:text-amber-100">{entry.avgApplicationsPerJob.toFixed(1)}</td>
                <td className="py-3 px-6 text-right text-gray-900 dark:text-amber-100">{entry.acceptanceRate.toFixed(1)}%</td>
                <td className="py-3 px-6 text-right text-gray-900 dark:text-amber-100">{entry.lowCompetitionJobs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
