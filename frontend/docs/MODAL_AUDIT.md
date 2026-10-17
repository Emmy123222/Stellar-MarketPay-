# Modal focus-management audit

Every modal must provide: **focus trap**, **Escape to close**, **focus restoration to the
trigger**, and **`role="dialog"` + `aria-modal="true"`** with an accessible name and
description. `components/AccessibleModal.tsx` is the single implementation of those
behaviours; all dialogs route through it.

| Component | Before | After | Notes |
| --- | --- | --- | --- |
| `BoostJobModal` | AccessibleModal | AccessibleModal | — |
| `ExtendJobModal` | AccessibleModal | AccessibleModal | — |
| `FeeEstimationModal` | AccessibleModal | AccessibleModal | — |
| `WithdrawToBankModal` | AccessibleModal | AccessibleModal | — |
| `KeyboardShortcutsModal` | AccessibleModal | AccessibleModal | — |
| `BuyXLMModal` | **bypassed** — plain `div`, no role/aria-modal, no trap, no Escape, no focus restore | AccessibleModal | Escape/backdrop run the same cleanup as the ✕ button (cancel polling, close anchor popup). |
| `ConfirmDialog` | **partial** — own `window` Escape listener, no role/aria-modal, no trap, no restore | AccessibleModal | Typed-confirm input still receives initial focus. Sr-only description is generic so the visible text isn't duplicated. |
| `PriceAlertModal` | **bypassed** — no role/aria-modal, no trap, no Escape, no restore | AccessibleModal | — |
| `ShareJobModal` | **partial** — hand-rolled trap + Escape, `aria-label` only, no focus restore, trap re-registered on every render | AccessibleModal | Trap now labelled by the visible heading. |
| `Admin2FAModal` | **bypassed** — no role/aria-modal, no trap | AccessibleModal with `dismissible={false}` | Mandatory step: Escape and backdrop clicks are intentionally ignored, focus is still trapped. Both the code-entry and backup-code screens. |

## Fixes to the shared base

- **Stable trap.** The effect depended on `onClose`; every parent re-render with an inline
  handler re-ran it, yanking focus back to the first control and overwriting the stored
  trigger. `onClose`/`dismissible` are now read through refs and the effect runs once per mount.
- **`dismissible` prop** (default `true`) for flows that must be completed. When `false` there
  is no clickable backdrop and Escape is ignored.
- **`descriptionId` prop** (default `modal-description`) so two dialogs can coexist without
  duplicate ids.
- The decorative backdrop button is `tabIndex={-1}` so it is never a tab stop.

## Tests

- `__tests__/AccessibleModal.test.tsx` — semantics, initial focus, Escape, backdrop, Tab /
  Shift+Tab wrap, focus restoration, stability across re-renders, `dismissible={false}`.
- `__tests__/modal-focus-audit.test.tsx` — runs the same five checks against **all ten**
  modals above, so a future modal that bypasses the base (or regresses it) fails here.
