# XLM Price Chart

Dashboard widget showing XLM/USD price history with selectable 1D / 7D / 30D
timeframes. The requirements and design decisions were originally captured in a
Kiro spec (`.kiro/specs/xlm-price-chart/`) and are promoted here so the behaviour
is readable without the editor tool.

## Status

Implemented and wired into the dashboard.

| Item                                              | State       |
| ------------------------------------------------- | ----------- |
| `frontend/components/XlmPriceWidget.tsx`          | Implemented |
| `frontend/lib/api/xlmPrice.ts`                    | Implemented |
| `frontend/__tests__/fetchXlmPriceHistory.test.ts` | Implemented |
| Property tests for data layer and widget          | Implemented |

## Behaviour contract

### Timeframes

- Three toggle buttons labelled `1D`, `7D`, and `30D`; `7D` is the default.
- Selecting a timeframe re-fetches data and marks only that button with
  `aria-pressed="true"`; the others are `"false"`.
- Each timeframe has its own SWR cache key (`xlm-price-history-${timeframe}`),
  so switching back and forth shows cached data immediately.

### Data source

`fetchXlmPriceHistory(timeframe)` calls Horizon's `trade_aggregations` endpoint
directly from the browser, using XLM as the base asset and USDC as the counter
asset:

| Timeframe | Resolution (ms) | Lookback |
| --------- | --------------- | -------- |
| `1D`      | 3,600,000       | 24 hours |
| `7D`      | 86,400,000      | 7 days   |
| `30D`     | 86,400,000      | 30 days  |

Each record maps to `{ timestamp, priceUsd }`. `currentPriceUsd` is the last
point's price, and `change24hPercent` is `(last - first) / first * 100` over the
returned window (or `null` when there are fewer than two points).

### Chart

- Line chart with a vertical gradient fill, built from a per-instance chart.js
  plugin (`beforeDatasetsDraw`) so the gradient spans the chart area at any size.
- `pointRadius: 0`, `tension: 0.35`, and both axes hidden.
- Hover tooltip shows the formatted date and time above the USD price formatted
  to four decimal places.

### Loading and errors

- While loading, the widget renders animated skeleton pills for the toggles and a
  same-height skeleton block for the chart, so the layout does not shift.
- A failed fetch replaces the chart with a short error message.

### Accessibility

- The chart container has `role="img"` and an `aria-label` that includes the
  active timeframe (for example `XLM/USD price chart – 7D`), updated when the
  timeframe changes.
- Timeframe buttons expose their selected state through `aria-pressed`.

## Design decisions

- **No backend proxy.** The widget follows the existing `getXLMBalance` pattern
  and queries Horizon from the client, keeping the backend out of the price
  display path.
- **SWR per timeframe.** Keying the cache by timeframe avoids refetching when
  users compare periods and keeps a single 60-second refresh interval per view.
- **Per-instance gradient plugin.** The plugin is passed to this chart only
  rather than registered globally, so other chart.js usage is unaffected.
- **Error and empty-state handling.** Non-2xx Horizon responses throw
  `Horizon API error: <status>`; an empty record set yields `null` price and
  change values rather than an error.

## Files

- `frontend/components/XlmPriceWidget.tsx` — widget, toggles, chart, tools.
- `frontend/lib/api/xlmPrice.ts` — Horizon request, mapping, and derived values.
- `frontend/__tests__/fetchXlmPriceHistory.test.ts` — data-layer unit tests.
- `frontend/__tests__/fetchXlmPriceHistory.property.test.ts` — property tests
  for request parameters, error handling, and derived values.
- `frontend/__tests__/XlmPriceWidget.test.tsx` — toggle and accessibility tests.
