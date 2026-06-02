import { useEffect, useMemo, useState } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
} from "chart.js";
import { fetchXlmPriceHistory } from "@/lib/api";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

const COLLAPSE_KEY = "marketpay_dashboard_xlm_widget_collapsed";

function formatUsd(value: number) {
  return `$${value.toFixed(4)}`;
}

export default function XlmPriceWidget() {
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<Array<{ timestamp: number; priceUsd: number }>>([]);
  const [currentPriceUsd, setCurrentPriceUsd] = useState<number | null>(null);
  const [change24hPercent, setChange24hPercent] = useState<number | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(COLLAPSE_KEY);
      setCollapsed(stored === "true");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchXlmPriceHistory()
      .then((data) => {
        setPoints(data.points || []);
        setCurrentPriceUsd(data.currentPriceUsd);
        setChange24hPercent(data.change24hPercent);
      })
      .catch(() => setError("Failed to load XLM price chart."))
      .finally(() => setLoading(false));
  }, []);

  const chartData = useMemo(
    () => ({
      labels: points.map((p) =>
        new Date(p.timestamp).toLocaleDateString("en-US", { weekday: "short" }),
      ),
      datasets: [
        {
          data: points.map((p) => p.priceUsd),
          borderColor: "#f59e0b",
          backgroundColor: "rgba(245, 158, 11, 0.12)",
          pointRadius: 0,
          tension: 0.35,
          fill: true,
          borderWidth: 2,
        },
      ],
    }),
    [points],
  );

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx: any) => ` ${formatUsd(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: { display: false },
        y: { display: false },
      },
    }),
    [],
  );

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  return (
    <div className="card bg-gradient-to-br from-ink-800 to-ink-900 border-market-500/18">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold text-amber-100">XLM / USD</h3>
        <button
          type="button"
          onClick={toggleCollapsed}
          className="btn-secondary text-xs py-1 px-2"
        >
          {collapsed ? "Expand" : "Collapse"}
        </button>
      </div>

      {!collapsed && (
        <div className="mt-3 space-y-3">
          {loading ? (
            <div className="h-28 rounded-lg bg-market-500/10 animate-pulse" />
          ) : error ? (
            <p className="text-sm text-red-400">{error}</p>
          ) : (
            <>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs text-amber-800">Current price</p>
                  <p className="text-2xl font-bold text-amber-100">
                    {currentPriceUsd !== null ? formatUsd(currentPriceUsd) : "--"}
                  </p>
                </div>
                <div
                  className={`text-sm font-semibold ${
                    (change24hPercent || 0) >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {change24hPercent !== null ? `${change24hPercent.toFixed(2)}% (24h)` : "--"}
                </div>
              </div>
              <div className="h-28">
                <Line data={chartData} options={chartOptions as any} />
              </div>
              <p className="text-xs text-amber-700">7-day sparkline</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
