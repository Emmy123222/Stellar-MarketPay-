import { useMemo, useState, useEffect } from "react";
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
import { fetchXlmPriceHistory, Timeframe } from "@/lib/api";
import { useApi } from "@/hooks/useApi";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

const COLLAPSE_KEY = "marketpay_dashboard_xlm_widget_collapsed";

const gradientPlugin = {
  id: "xlmGradient",
  beforeDatasetsDraw(chart: ChartJS) {
    const {
      ctx,
      chartArea: { top, bottom },
    } = chart;
    const gradient = ctx.createLinearGradient(0, top, 0, bottom);
    gradient.addColorStop(0, "rgba(245, 158, 11, 0.35)");
    gradient.addColorStop(1, "rgba(245, 158, 11, 0)");
    chart.data.datasets[0].backgroundColor = gradient as unknown as string;
  },
};

function formatUsd(value: number) {
  return `$${value.toFixed(4)}`;
}

export default function XlmPriceWidget() {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTimeframe, setActiveTimeframe] = useState<Timeframe>('7D');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(COLLAPSE_KEY);
      setCollapsed(stored === "true");
    } catch {
      // ignore
    }
  }, []);

  const { data, error, isLoading, isValidating } = useApi(
    `xlm-price-history-${activeTimeframe}`,
    () => fetchXlmPriceHistory(activeTimeframe),
    { refreshInterval: 60_000 },
  );

  const points           = data?.points ?? [];
  const currentPriceUsd  = data?.currentPriceUsd ?? null;
  const change24hPercent = data?.change24hPercent ?? null;

  const chartData = useMemo(
    () => ({
      labels: points.map((p) =>
        new Date(p.timestamp).toLocaleDateString("en-US", { weekday: "short" }),
      ),
      datasets: [
        {
          data: points.map((p) => p.priceUsd),
          borderColor: "#f59e0b",
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
            title: (items: any[]) => {
              const ts = points[items[0].dataIndex]?.timestamp;
              return ts !== undefined
                ? new Date(ts).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '';
            },
            label: (ctx: any) => ` ${formatUsd(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: { display: false },
        y: { display: false },
      },
    }),
    [points],
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

  const TIMEFRAMES: Timeframe[] = ['1D', '7D', '30D'];

  return (
    <div className="card bg-gradient-to-br from-ink-800 to-ink-900 border-market-500/18">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-lg font-semibold text-amber-100">XLM / USD</h3>
          {isValidating && !isLoading && (
            <span className="text-xs text-amber-600 animate-pulse">Refreshing…</span>
          )}
        </div>
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
          {/* Timeframe toggle buttons or skeleton pills */}
          <div className="flex items-center gap-1">
            {isLoading
              ? TIMEFRAMES.map((tf) => (
                  <div
                    key={tf}
                    className="h-5 w-8 rounded bg-market-500/10 animate-pulse"
                  />
                ))
              : TIMEFRAMES.map((tf) => {
                  const isActive = tf === activeTimeframe;
                  return (
                    <button
                      key={tf}
                      type="button"
                      aria-pressed={isActive ? "true" : "false"}
                      onClick={() => setActiveTimeframe(tf)}
                      className={`text-xs font-medium px-2 py-0.5 rounded transition-colors ${
                        isActive
                          ? "bg-amber-600/30 text-amber-200"
                          : "text-amber-700 hover:text-amber-500"
                      }`}
                    >
                      {tf}
                    </button>
                  );
                })}
          </div>

          {isLoading ? (
            <div className="h-28 rounded-lg bg-market-500/10 animate-pulse" />
          ) : error ? (
            <p className="text-sm text-red-400">Failed to load XLM price chart.</p>
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
              <div
                role="img"
                aria-label={`XLM/USD price chart – ${activeTimeframe}`}
                className="h-28"
              >
                <Line data={chartData} options={chartOptions as any} plugins={[gradientPlugin]} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
