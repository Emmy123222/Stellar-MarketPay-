/**
 * components/insights/PayTrendsChart.tsx
 * Line chart showing pay trends over time
 */
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";
import { format } from "date-fns";
import type { InsightPayTrend } from "@/lib/api";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

interface Props {
  payTrends: InsightPayTrend[];
  categories: string[];
}

export default function PayTrendsChart({ payTrends, categories }: Props) {
  const topTrendCategories = categories.slice(0, 5);
  const trendDates = Array.from(new Set(payTrends.map((entry) => entry.date))).sort();
  const trendLabels = trendDates.map((date) => format(new Date(date), "MMM d"));
  const trendDatasets = topTrendCategories.map((category, index) => {
    const palette = [
      "rgb(245, 158, 11)",
      "rgb(59, 130, 246)",
      "rgb(16, 185, 129)",
      "rgb(244, 63, 94)",
      "rgb(168, 85, 247)",
    ];

    return {
      label: category,
      data: trendDates.map((date) => {
        const match = payTrends.find((entry) => entry.date === date && entry.category === category);
        return match ? match.avgBudget : 0;
      }),
      borderColor: palette[index % palette.length],
      backgroundColor: "transparent",
      tension: 0.35,
      pointRadius: 2,
    };
  });

  return (
    <div className="mt-6 h-80 rounded-2xl border border-[rgba(251,191,36,0.08)] bg-ink-800/80 p-4">
      <Line
        data={{
          labels: trendLabels,
          datasets: trendDatasets,
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "bottom",
              labels: { color: "#fef3c7" },
            },
          },
          scales: {
            x: {
              ticks: { color: "#a8956a" },
              grid: { color: "rgba(251,191,36,0.06)" },
            },
            y: {
              ticks: { color: "#a8956a" },
              grid: { color: "rgba(251,191,36,0.06)" },
            },
          },
        }}
      />
    </div>
  );
}
