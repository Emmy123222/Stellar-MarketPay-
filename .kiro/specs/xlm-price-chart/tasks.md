# Implementation Plan: xlm-price-chart

## Overview

Enhance `XlmPriceWidget` with multi-timeframe toggles (1D/7D/30D), a canvas gradient fill, a date+price tooltip, a loading skeleton, and ARIA accessibility attributes. The data layer change updates `fetchXlmPriceHistory` in `frontend/lib/api.ts` to accept a `timeframe` parameter and call the Horizon trade aggregations endpoint directly.

## Tasks

- [x] 1. Update `fetchXlmPriceHistory` in `frontend/lib/api.ts`
  - Add `Timeframe` type export (`'1D' | '7D' | '30D'`)
  - Update function signature to `fetchXlmPriceHistory(timeframe: Timeframe = '7D'): Promise<XlmPriceHistory>`
  - Map each timeframe to the correct Horizon `resolution` ms value (1D → 3 600 000; 7D/30D → 86 400 000)
  - Compute `start_time` and `end_time` from `Date.now()` per timeframe lookup window
  - Call `GET {HORIZON_URL}/trade_aggregations` with `base_asset_type=native`, `counter_asset_code=USDC`, `counter_asset_issuer`, `resolution`, `start_time`, `end_time`, `order=asc`, `limit=200`
  - Map each record to `{ timestamp: Number(r.timestamp), priceUsd: parseFloat(r.close) }`
  - Set `currentPriceUsd` to the last point's `priceUsd` (or `null` if empty)
  - Compute `change24hPercent` as `((last − first) / first) * 100` (or `null` if fewer than 2 points)
  - Throw `Error("Horizon API error: <status>")` on non-2xx response
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ]* 1.1 Write unit tests for `fetchXlmPriceHistory`
    - Mock `fetch`; assert correct URL params for each timeframe
    - Assert returned `points`, `currentPriceUsd`, and `change24hPercent` for a valid response
    - Assert error thrown with status code substring on a mocked 500 response
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ]* 1.2 Write property test — Property 1: well-formed PriceHistory for any timeframe
    - `// Feature: xlm-price-chart, Property 1: fetchXlmPriceHistory returns well-formed PriceHistory for any timeframe`
    - Arbitraries: `fc.constantFrom('1D','7D','30D')` + mocked Horizon response with `fc.array(fc.record({timestamp: fc.integer({min:0}), close: fc.float({min:0.0001})}), {minLength:1})`
    - Assert `points` non-empty, `currentPriceUsd` equals last point's `priceUsd`, all points have numeric fields
    - **Validates: Requirements 1.1, 1.6**

  - [ ]* 1.3 Write property test — Property 2: Horizon URL params correct for every timeframe
    - `// Feature: xlm-price-chart, Property 2: Horizon request parameters are correct for every timeframe`
    - Arbitraries: `fc.constantFrom('1D','7D','30D')` — spy on `fetch` and assert URL params
    - Assert `resolution` = 3600000 for `'1D'`, 86400000 for `'7D'`/`'30D'`; `start_time` within 5 s tolerance; `end_time` ≈ `Date.now()`
    - **Validates: Requirements 1.2, 1.3, 1.4**

  - [ ]* 1.4 Write property test — Property 3: non-2xx response always throws error containing status code
    - `// Feature: xlm-price-chart, Property 3: Non-2xx response always throws an error containing the status code`
    - Arbitraries: `fc.integer({min:300, max:599})` for status codes
    - Assert thrown `Error` message includes the status code as a substring
    - **Validates: Requirements 1.5**

  - [ ]* 1.5 Write property test — Property 8: change24hPercent round-trip
    - `// Feature: xlm-price-chart, Property 8: change24hPercent round-trip`
    - Arbitraries: `fc.array(fc.record({timestamp: fc.integer({min:0}), priceUsd: fc.float({min:0.0001, max:9999})}), {minLength:2})`
    - Assert `first × (1 + change24hPercent / 100) ≈ last` within 1e-9 relative error
    - **Validates: Requirements 1.6**

- [x] 2. Add `activeTimeframe` state and keyed SWR cache to `XlmPriceWidget`
  - Import `Timeframe` type from `api.ts`
  - Add `const [activeTimeframe, setActiveTimeframe] = useState<Timeframe>('7D')`
  - Change SWR cache key to `` `xlm-price-history-${activeTimeframe}` ``
  - Pass `activeTimeframe` to `fetchXlmPriceHistory(activeTimeframe)` in the `useApi` call
  - _Requirements: 2.2, 2.4_

- [x] 3. Implement `TimeframeToggle` buttons inside `XlmPriceWidget`
  - Render three `<button>` elements labelled `1D`, `7D`, `30D`
  - Set `aria-pressed="true"` on the active button; `"false"` on the others
  - Apply a visually distinct active style (e.g. `bg-amber-600/30 text-amber-200`) vs inactive (`text-amber-700`)
  - On click, call `setActiveTimeframe` with the corresponding timeframe value
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 6.4_

  - [ ]* 3.1 Write unit tests for `TimeframeToggle` behavior
    - Assert three buttons render with labels `1D`, `7D`, `30D`
    - Assert initial `aria-pressed` values: `7D` = `"true"`, others = `"false"`
    - Assert clicking a button updates `aria-pressed` on all three buttons correctly
    - _Requirements: 2.1, 2.3, 2.4, 6.4_

  - [ ]* 3.2 Write property test — Property 4: exactly one `aria-pressed="true"` after any sequence of toggles
    - `// Feature: xlm-price-chart, Property 4: Toggle selection invariant — exactly one aria-pressed button matches activeTimeframe`
    - Arbitraries: `fc.array(fc.constantFrom('1D','7D','30D'), {minLength:1, maxLength:20})`
    - After each selection: assert exactly one button has `aria-pressed="true"` and its label matches the last selected timeframe
    - **Validates: Requirements 2.2, 2.3, 6.4**

- [x] 4. Implement gradient fill via `beforeDatasetsDraw` plugin
  - Define `gradientPlugin` inline (not registered globally) with `id: 'xlmGradient'`
  - In `beforeDatasetsDraw`: create `ctx.createLinearGradient(0, top, 0, bottom)` using `chart.chartArea`
  - Add color stops: `rgba(245, 158, 11, 0.35)` at 0, `rgba(245, 158, 11, 0)` at 1
  - Assign the gradient to `chart.data.datasets[0].backgroundColor`
  - Pass `plugins={[gradientPlugin]}` to the `<Line>` component
  - Remove the static `backgroundColor: "rgba(245, 158, 11, 0.12)"` string from dataset config
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 5. Update chart tooltip to show formatted date and price
  - Add `title` callback to `chartOptions.plugins.tooltip.callbacks`
  - In `title`: read `points[items[0].dataIndex]?.timestamp`, format with `toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })`
  - Keep existing `label` callback formatting price to four decimal places
  - _Requirements: 4.1, 4.2, 4.3_

  - [ ]* 5.1 Write unit tests for tooltip callbacks
    - Assert `title` callback returns a non-empty date string for a known timestamp
    - Assert `label` callback returns a string containing the price formatted to exactly four decimal places
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ]* 5.2 Write property test — Property 6: tooltip title returns non-empty date string for any valid timestamp
    - `// Feature: xlm-price-chart, Property 6: Tooltip title callback returns a non-empty date string for any valid timestamp`
    - Arbitraries: `fc.integer({min:0, max:Date.now()})` for timestamps
    - Assert returned string is non-empty
    - **Validates: Requirements 4.1, 4.3**

  - [ ]* 5.3 Write property test — Property 7: tooltip label formats priceUsd to exactly four decimal places
    - `// Feature: xlm-price-chart, Property 7: Tooltip label callback formats priceUsd to exactly four decimal places`
    - Arbitraries: `fc.float({min:0.0001, max:9999})` for priceUsd values
    - Assert numeric portion of returned string equals `priceUsd` rounded to four decimal places
    - **Validates: Requirements 4.2, 4.3**

- [x] 6. Add loading skeleton for chart area and toggle buttons
  - While `isLoading`: render three skeleton pill `<div>` elements in place of timeframe toggle buttons
  - While `isLoading`: render `<div className="h-28 rounded-lg bg-market-500/10 animate-pulse" />` in place of chart area
  - When data loads: replace skeletons with the chart and toggle buttons
  - Remove the previous single skeleton that only covered the chart area
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 7. Add `role="img"` and `aria-label` to chart container
  - Wrap `<Line>` in a `<div role="img" aria-label={`XLM/USD price chart – ${activeTimeframe}`} className="h-28">`
  - Ensure `aria-label` updates reactively when `activeTimeframe` changes
  - _Requirements: 6.1, 6.2, 6.3_

  - [ ]* 7.1 Write unit tests for ARIA attributes on chart container
    - Assert `role="img"` is present on the chart wrapper
    - Assert `aria-label` contains `"7D"` on initial render
    - Assert `aria-label` updates to contain the new timeframe after a toggle click
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ]* 7.2 Write property test — Property 5: `aria-label` always contains the active timeframe string
    - `// Feature: xlm-price-chart, Property 5: aria-label always contains the active timeframe string`
    - Arbitraries: `fc.constantFrom('1D','7D','30D')`
    - Assert `aria-label` attribute of chart container contains the active timeframe as a substring
    - **Validates: Requirements 6.2, 6.3**

- [x] 8. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests require `fast-check` (`fc`) — add as dev dependency if not already present
- The gradient plugin must be passed per-instance (not via `ChartJS.register`) to avoid polluting other charts
