# Requirements Document

## Introduction

Enhance the existing `XlmPriceWidget` component to display a multi-timeframe price chart for XLM/USD. The widget currently shows a hardcoded 7-day sparkline with no gradient, no date in tooltips, and no accessibility markup. This feature adds 1D / 7D / 30D timeframe toggles, a gradient fill, a tooltip that shows both date and price, a loading skeleton, and proper ARIA attributes so the chart is accessible to screen readers.

## Glossary

- **Widget**: The `XlmPriceWidget` React component rendered on the dashboard.
- **Chart**: The line chart rendered inside the Widget using chart.js / react-chartjs-2.
- **PriceHistory**: A time-series of `{ timestamp, priceUsd }` data points returned by the data layer.
- **Timeframe**: One of the three selectable periods — `1D` (1 day), `7D` (7 days), or `30D` (30 days).
- **Horizon_API**: The Stellar Horizon trade aggregations REST API at `HORIZON_URL/trade_aggregations`.
- **API_Layer**: The `frontend/lib/api.ts` module that wraps backend/Horizon HTTP calls.
- **Skeleton**: An animated placeholder element displayed while data is loading.

## Requirements

### Requirement 1: Multi-Timeframe Data Fetching

**User Story:** As a dashboard user, I want to select a timeframe so that I can see price history for 1 day, 7 days, or 30 days.

#### Acceptance Criteria

1. THE API_Layer SHALL export a `fetchXlmPriceHistory(timeframe: '1D' | '7D' | '30D')` function that accepts a timeframe parameter.
2. WHEN the timeframe is `1D`, THE API_Layer SHALL fetch OHLCV data covering the last 24 hours from the Horizon_API trade aggregations endpoint.
3. WHEN the timeframe is `7D`, THE API_Layer SHALL fetch OHLCV data covering the last 7 days from the Horizon_API trade aggregations endpoint.
4. WHEN the timeframe is `30D`, THE API_Layer SHALL fetch OHLCV data covering the last 30 days from the Horizon_API trade aggregations endpoint.
5. IF the Horizon_API returns a non-2xx response, THEN THE API_Layer SHALL throw an error with a descriptive message including the HTTP status code.
6. THE API_Layer SHALL return a `PriceHistory` object containing an array of `{ timestamp: number, priceUsd: number }` points, a `currentPriceUsd` value, and a `change24hPercent` value.

### Requirement 2: Timeframe Toggle UI

**User Story:** As a dashboard user, I want clearly labelled timeframe buttons so that I can switch between 1D, 7D, and 30D views without reloading the page.

#### Acceptance Criteria

1. THE Widget SHALL render three toggle buttons labelled `1D`, `7D`, and `30D`.
2. WHEN a toggle button is clicked, THE Widget SHALL set the active timeframe to the selected value and re-fetch price data for that timeframe.
3. WHILE a timeframe is active, THE Widget SHALL render its corresponding toggle button in a visually distinct selected state.
4. THE Widget SHALL default to the `7D` timeframe on initial render.

### Requirement 3: Gradient Fill Chart

**User Story:** As a dashboard user, I want the chart to have a gradient fill so that the price area is visually distinct from a plain sparkline.

#### Acceptance Criteria

1. THE Chart SHALL render as a line chart with a vertical gradient fill beneath the line, transitioning from a semi-transparent amber at the top to fully transparent at the bottom.
2. THE Chart SHALL render with `pointRadius: 0` so individual data points are not shown.
3. THE Chart SHALL render with a smooth curve (`tension: 0.35` or equivalent).
4. THE Chart SHALL hide both the x-axis and y-axis tick labels and grid lines.

### Requirement 4: Hover Tooltip with Date and Price

**User Story:** As a dashboard user, I want the hover tooltip to show both the date and price so that I can identify specific data points in context.

#### Acceptance Criteria

1. WHEN a user hovers over a data point on the Chart, THE Chart SHALL display a tooltip containing the formatted date of that point.
2. WHEN a user hovers over a data point on the Chart, THE Chart SHALL display a tooltip containing the USD price of that point formatted to four decimal places.
3. THE Chart tooltip SHALL display the date above the price in a single tooltip popup.

### Requirement 5: Loading Skeleton

**User Story:** As a dashboard user, I want a loading placeholder while price data is fetching so that the layout does not shift unexpectedly.

#### Acceptance Criteria

1. WHILE data is loading, THE Widget SHALL render a Skeleton element that occupies the same height as the chart area.
2. THE Skeleton SHALL use an animated pulse style consistent with the existing dashboard skeleton components.
3. WHILE data is loading, THE Widget SHALL render skeleton placeholders for the timeframe toggle buttons.
4. WHEN data has loaded, THE Widget SHALL replace the Skeleton with the Chart and toggle buttons.

### Requirement 6: Accessibility

**User Story:** As a screen reader user, I want the chart to have a descriptive label so that I understand what is being presented without seeing the visual.

#### Acceptance Criteria

1. THE Chart container element SHALL have `role="img"` set.
2. THE Chart container element SHALL have an `aria-label` attribute describing the chart content, including the active timeframe (e.g., `"XLM/USD price chart – 7D"`).
3. WHEN the active timeframe changes, THE Widget SHALL update the `aria-label` value to reflect the new timeframe.
4. THE timeframe toggle buttons SHALL each have an `aria-pressed` attribute set to `"true"` when selected and `"false"` when not selected.
