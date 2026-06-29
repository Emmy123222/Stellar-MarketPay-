# Design Document: xlm-price-chart

## Overview

This feature enhances the existing `XlmPriceWidget` component to support multi-timeframe (1D / 7D / 30D) price history with a canvas gradient fill, an informative hover tooltip, a loading skeleton, and ARIA accessibility attributes.

The data layer change is minimal: `fetchXlmPriceHistory` gains a required `timeframe` parameter and the widget keys its SWR cache entry by timeframe so each view is cached independently.

No new libraries are needed. The project already ships `react-chartjs-2` / `chart.js`, SWR (via `useApi`), and Tailwind CSS.

---

## Architecture

```mermaid
graph TD
    subgraph "XlmPriceWidget (React)"
        A[activeTimeframe state\n'1D' | '7D' | '30D'] --> B[useApi\nkey: 'xlm-price-history-7D']
        B -->|data| C[XlmPriceChart\n(Line + gradient plugin)]
        A --> D[TimeframeToggle\n(3 buttons)]
        B -->|isLoading| E[Skeleton]
    end

    subgraph "API Layer (frontend/lib/api.ts)"
        F[fetchXlmPriceHistory(timeframe)]
        F -->|GET /trade_aggregations| G[Horizon API]
        F -->|maps records| H[XlmPriceHistory]
    end

    B --> F
```

Key design decisions:
- The widget owns `activeTimeframe` state; the SWR key is `xlm-price-history-${timeframe}`, giving each period its own cache slot so switching tabs shows cached data instantly.
- The gradient fill is built via a chart.js `beforeDatasetsDraw` plugin that creates a `CanvasGradient` from the chart canvas dimensions at draw time — no static `rgba` string.
- The Horizon trade aggregations endpoint is called directly from the browser (same pattern as `getXLMBalance` in `stellar.ts`), keeping the backend out of the critical path for price display.

---

## Components and Interfaces

### `XlmPriceWidget` (modified)

Owns timeframe state, drives data fetching, and composes sub-components.

```tsx
// No external props needed — widget is self-contained
export default function XlmPriceWidget(): JSX.Element
```

Internal state:
```ts
const [activeTimeframe, setActiveTimeframe] = useState<Timeframe>('7D');
```

SWR cache key per timeframe:
```ts
useApi(
  `xlm-price-history-${activeTimeframe}`,
  () => fetchXlmPriceHistory(activeTimeframe),
  { refreshInterval: 60_000 }
)
```

### `TimeframeToggle` (new, co-located or inline)

Renders three `<button>` elements.

```tsx
interface TimeframeToggleProps {
  active: Timeframe;
  onChange: (t: Timeframe) => void;
  loading?: boolean; // renders skeleton buttons when true
}
```

Each button:
- `aria-pressed="true"` when active, `"false"` otherwise
- visually distinct active style (e.g. `bg-amber-600/30 text-amber-200` vs `text-amber-700`)

### `XlmPriceChart` (new, inline or extracted)

Wraps `<Line>` and applies the gradient plugin.

```tsx
interface XlmPriceChartProps {
  points: XlmPriceHistoryPoint[];
  activeTimeframe: Timeframe;
}
```

Accessibility wrapper:
```tsx
<div
  role="img"
  aria-label={`XLM/USD price chart – ${activeTimeframe}`}
  className="h-28"
>
  <Line data={chartData} options={chartOptions} plugins={[gradientPlugin]} />
</div>
```

---

## Data Models

### Types (unchanged, already exported from `api.ts`)

```ts
export interface XlmPriceHistoryPoint {
  timestamp: number;   // Unix ms
  priceUsd: number;
}

export interface XlmPriceHistory {
  points: XlmPriceHistoryPoint[];
  currentPriceUsd: number | null;
  change24hPercent: number | null;
}
```

### New type

```ts
export type Timeframe = '1D' | '7D' | '30D';
```

### `fetchXlmPriceHistory` updated signature

```ts
export async function fetchXlmPriceHistory(
  timeframe: Timeframe = '7D'
): Promise<XlmPriceHistory>
```

### Horizon trade aggregations parameters per timeframe

| Timeframe | resolution (ms) | lookback window |
|-----------|----------------|-----------------|
| 1D        | 3 600 000      | now − 24 h      |
| 7D        | 86 400 000     | now − 7 d       |
| 30D       | 86 400 000     | now − 30 d      |

Endpoint shape:
```
GET {HORIZON_URL}/trade_aggregations
  ?base_asset_type=native
  &counter_asset_code=USDC
  &counter_asset_issuer={USDC_ISSUER}
  &resolution={resolutionMs}
  &start_time={startMs}
  &end_time={nowMs}
  &order=asc
  &limit=200
```

Each record maps to `{ timestamp: Number(r.timestamp), priceUsd: parseFloat(r.close) }`.

`currentPriceUsd` = last point's `priceUsd`.  
`change24hPercent` = `((last − first) / first) * 100` over the returned window.

### Gradient fill implementation

Chart.js inline plugin registered per chart instance, not globally:

```ts
const gradientPlugin = {
  id: 'xlmGradient',
  beforeDatasetsDraw(chart: ChartJS) {
    const { ctx, chartArea: { top, bottom } } = chart;
    const gradient = ctx.createLinearGradient(0, top, 0, bottom);
    gradient.addColorStop(0,   'rgba(245, 158, 11, 0.35)');
    gradient.addColorStop(1,   'rgba(245, 158, 11, 0)');
    chart.data.datasets[0].backgroundColor = gradient;
  },
};
```

This replaces the flat `rgba(245, 158, 11, 0.12)` string so the fill always spans the full chart height regardless of zoom or resize.

### Tooltip configuration

```ts
tooltip: {
  callbacks: {
    title: (items) => {
      const ts = points[items[0].dataIndex]?.timestamp;
      return ts
        ? new Date(ts).toLocaleString('en-US', {
            month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })
        : '';
    },
    label: (ctx) => ` $${ctx.parsed.y.toFixed(4)}`,
  },
},
```

### Skeleton

While `isLoading`:
- Three skeleton pill buttons replace the timeframe toggle
- A `h-28 rounded-lg bg-market-500/10 animate-pulse` block replaces the chart area

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: fetchXlmPriceHistory returns well-formed PriceHistory for any timeframe

*For any* valid timeframe (`'1D'`, `'7D'`, or `'30D'`), calling `fetchXlmPriceHistory(timeframe)` against a mocked Horizon response should return a `PriceHistory` object where `points` is a non-empty array, `currentPriceUsd` equals the last point's `priceUsd`, and all points have numeric `timestamp` and `priceUsd` fields.

**Validates: Requirements 1.1, 1.6**

### Property 2: Horizon request parameters are correct for every timeframe

*For any* valid timeframe, the `fetch` call made by `fetchXlmPriceHistory` should construct a URL where `resolution` equals `3600000` for `'1D'` and `86400000` for `'7D'` and `'30D'`, `start_time` is approximately `Date.now() − lookback` (within a 5-second tolerance), and `end_time` is approximately `Date.now()`.

**Validates: Requirements 1.2, 1.3, 1.4**

### Property 3: Non-2xx response always throws an error containing the status code

*For any* HTTP status code in the range 300–599 returned by the Horizon endpoint, `fetchXlmPriceHistory` should throw an `Error` whose message includes the numeric status code as a substring.

**Validates: Requirements 1.5**

### Property 4: Toggle selection invariant — exactly one aria-pressed button matches activeTimeframe

*For any* sequence of one or more timeframe selections applied to `XlmPriceWidget`, after each selection exactly one button should have `aria-pressed="true"` and it should be the button whose label matches the last selected timeframe; all other buttons should have `aria-pressed="false"`.

**Validates: Requirements 2.2, 2.3, 6.4**

### Property 5: aria-label always contains the active timeframe string

*For any* active timeframe value set on `XlmPriceWidget`, the chart container's `aria-label` attribute should contain that timeframe string as a substring (e.g. when `activeTimeframe === '7D'` the label contains `"7D"`).

**Validates: Requirements 6.2, 6.3**

### Property 6: Tooltip title callback returns a non-empty date string for any valid timestamp

*For any* Unix millisecond timestamp in a reasonable historical range, the tooltip `title` callback should return a non-empty string that represents a human-readable date/time derived from that timestamp.

**Validates: Requirements 4.1, 4.3**

### Property 7: Tooltip label callback formats priceUsd to exactly four decimal places

*For any* positive `priceUsd` value, the tooltip `label` callback should return a string that, when the numeric portion is parsed as a float, equals `priceUsd` rounded to four decimal places.

**Validates: Requirements 4.2, 4.3**

### Property 8: change24hPercent round-trip

*For any* non-empty array of price points where the first point's `priceUsd` is greater than zero, the `change24hPercent` value computed from those points should satisfy `first × (1 + change24hPercent / 100) ≈ last` within floating-point tolerance (1e-9 relative error).

**Validates: Requirements 1.6**

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Horizon returns non-2xx | `fetchXlmPriceHistory` throws `Error("Horizon API error: <status>")` |
| Horizon returns empty `_embedded.records` | `points = []`, `currentPriceUsd = null`, `change24hPercent = null` |
| Network timeout / fetch throws | Error propagates; `useApi` sets `error`; widget renders error message |
| `NEXT_PUBLIC_HORIZON_URL` not set | Falls back to `https://horizon-testnet.stellar.org` (existing behaviour) |
| Canvas context unavailable (SSR) | `beforeDatasetsDraw` plugin is a no-op server-side; chart renders with flat fill |

---

## Testing Strategy

### Unit tests

Focus on deterministic, example-based cases:

- `fetchXlmPriceHistory` with a mocked `fetch` that returns a valid Horizon response for each timeframe — assert point count, `currentPriceUsd`, and `change24hPercent`.
- `fetchXlmPriceHistory` with a mocked 500 response — assert the thrown error message contains `"500"`.
- Tooltip callback functions called with specific `{ dataIndex, parsed.y }` objects — assert correct date format and price format.
- `XlmPriceWidget` renders three buttons labelled `1D`, `7D`, `30D` with correct `aria-pressed` values on initial render.
- Clicking a timeframe button updates `aria-pressed` on all three buttons.
- Chart container has `role="img"` and `aria-label` containing the active timeframe.

### Property-based tests

Use **fast-check** (already present in the JS ecosystem; add as dev dependency if not already installed).

Each property test runs a minimum of **100 iterations**.

Tag format: `// Feature: xlm-price-chart, Property <N>: <property_text>`

| Test | Design Property | fast-check arbitraries |
|---|---|---|
| `fetchXlmPriceHistory` returns well-formed PriceHistory | Property 1 | `fc.constantFrom('1D','7D','30D')` + mocked Horizon response with `fc.array(fc.record({timestamp: fc.integer({min:0}), close: fc.float({min:0.0001})}), {minLength:1})` |
| Horizon URL params are correct per timeframe | Property 2 | `fc.constantFrom('1D','7D','30D')` — spy on `fetch` and assert URL params |
| Non-2xx response always throws error containing status | Property 3 | `fc.integer({min:300,max:599})` for status codes |
| Toggling through timeframes: exactly one `aria-pressed="true"` | Property 4 | `fc.array(fc.constantFrom('1D','7D','30D'), {minLength:1,maxLength:20})` |
| `aria-label` always contains `activeTimeframe` string | Property 5 | `fc.constantFrom('1D','7D','30D')` |
| Tooltip title callback returns non-empty date string | Property 6 | `fc.integer({min:0, max:Date.now()})` for timestamps |
| Tooltip label parsed as float equals `priceUsd` to 4dp | Property 7 | `fc.float({min:0.0001, max:9999})` for priceUsd values |
| `change24hPercent` round-trip | Property 8 | `fc.array(fc.record({timestamp: fc.integer({min:0}), priceUsd: fc.float({min:0.0001,max:9999})}), {minLength:2})` |
