# Right-to-left (RTL) groundwork

Status: groundwork only. No RTL translation ships yet (locales: `en es fr pt`),
but the app is now ready for one (Arabic, Hebrew, …) without a layout rewrite.

## What is in place

| Piece | Where |
| --- | --- |
| Locale → direction map (`ar he fa ur ps sd yi dv ckb`, RTL scripts such as `-Arab`) | `lib/direction.ts` |
| `<html lang dir>` set from the request locale at SSR | `pages/_document.tsx` |
| `documentElement.dir/lang` kept in sync when the user switches language client-side | `pages/_app.tsx` |
| Pseudo-RTL locale `en-XB` (English copy, mirrored layout) for review before translations exist | `lib/direction.ts` (`PSEUDO_RTL_LOCALE`) |
| Storybook **Direction** toolbar toggle (LTR / Pseudo-RTL / Arabic) | `.storybook/preview.ts` |
| Logical utilities in the shared components | `Navbar.tsx`, `JobCard.tsx`, `AppFooter.tsx` |
| Conversion/audit tool | `scripts/rtl-audit.mjs` (`npm run rtl:audit`) |
| Tests (direction map, document wiring, no physical utilities in shared components) | `__tests__/rtl-support.test.tsx` |

Tailwind needs no config change: v3.4 ships the logical utilities
(`ms-/me-/ps-/pe-/start-/end-/text-start/text-end/border-s/border-e/rounded-s/rounded-e/rounded-ss/…`)
and the `rtl:` / `ltr:` variants.

## Reviewing a component in RTL

1. `npm run storybook`
2. Use the **Direction** toolbar item → *Pseudo-RTL (en-XB)*. The decorator sets
   `<html dir="rtl" lang="en-XB">` for the story.
3. Check: content order, icon/arrow direction, dropdown anchoring, padding/margin
   asymmetry, text alignment.

In the running app, set `i18n.language` to a real RTL locale (e.g. `ar`) once one
exists; `_app.tsx` flips `dir` immediately.

## Converting a component

Run the audit for the files you are converting:

```bash
npm run rtl:audit -- components/FreelancerCard.tsx          # report + proposed rewrites
npm run rtl:audit -- --write components/FreelancerCard.tsx  # apply the mechanical ones
npm run rtl:audit -- --check components/FreelancerCard.tsx  # exit 1 if physical utilities remain
npm run rtl:audit                                           # whole components/ + pages/ backlog
```

Mechanical rewrites (applied by `--write`, including variants such as `md:` / `hover:`,
negatives such as `-ml-2`, and `!important`):

| Physical | Logical |
| --- | --- |
| `ml-*` / `mr-*` | `ms-*` / `me-*` |
| `pl-*` / `pr-*` | `ps-*` / `pe-*` |
| `left-*` / `right-*` | `start-*` / `end-*` |
| `text-left` / `text-right` | `text-start` / `text-end` |
| `float-left` / `float-right` | `float-start` / `float-end` |
| `border-l*` / `border-r*` | `border-s*` / `border-e*` |
| `rounded-l*` / `rounded-r*` | `rounded-s*` / `rounded-e*` |
| `rounded-tl` / `-tr` / `-bl` / `-br` | `rounded-ss` / `-se` / `-es` / `-ee` |
| `scroll-ml/mr/pl/pr` | `scroll-ms/me/ps/pe` |

Left for a human (reported as *need review*):

- **`left-1/2` + `-translate-x-1/2` centring** is mirror-safe and intentionally untouched.
- **`translate-x-*` toggles/sliders**: add an `rtl:` variant (`translate-x-5 rtl:-translate-x-5`).
- **Directional icons** (chevrons, arrows, back buttons): add `rtl:rotate-180` or `rtl:-scale-x-100`.
- **`space-x-*` / `divide-x`**: physical margins/borders; prefer `gap-*` on the flex/grid parent.
- **Hard-coded arrows in copy** (`→`, `←`): swap per direction or use an icon.
- **Numbers, addresses, hashes, code**: keep LTR with `dir="ltr"` (or `<bdi>`) so Stellar
  addresses and amounts do not reorder inside RTL text.
- **Third-party widgets/charts** often need their own `direction` option.

## Rollout checklist per component

1. `npm run rtl:audit -- --write <file>` and review the diff.
2. Handle every *need review* item above.
3. Add the component to `__tests__/rtl-support.test.tsx` (it asserts no physical utilities
   remain in the rendered DOM).
4. Eyeball it in Storybook with the Direction toggle.

Remaining backlog is whatever `npm run rtl:audit` reports for `components/` and `pages/`.
