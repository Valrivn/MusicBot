# `Voxaria-Web/src/hooks/` — Custom React Application Hooks

## Functional Role
Custom React lifecycle and state extraction layer. Houses reusable UI hooks for responsive layout detection and notification dispatching across components without coupling them to specific parent containers.

## Table of Files

| File Name | Primary Purpose | Key Exports / Components / Hooks | Key Dependencies |
| :--- | :--- | :--- | :--- |
| `use-mobile.tsx` | Viewport breakpoint observer hook; listens to `window.matchMedia` (breakpoint `768px`) to determine mobile device mode dynamically. | `useIsMobile` | `react` |
| `use-toast.ts` | Centralized toast management state machine; dispatches, updates, dismisses, and auto-evicts toast messages. | `useToast`, `toast` | `react`, `@/components/ui/toast` |

## Common Error Scenarios & Troubleshooting Tips
- **SSR / Hydration Discrepancy on `useIsMobile`**: `useIsMobile` initializes state as `undefined` then resolves on mount. In client-side SPA mode this returns `false` or `true` cleanly after mount, but avoid conditional DOM rendering before mount if doing SSR.
- **MatchMedia Missing in Test Runners**: Node/JSDOM environments lack `window.matchMedia`. The test harness must mock `matchMedia` (configured in `@/test/setup.ts`).
- **Toast Queue Overflow**: `use-toast.ts` enforces `TOAST_LIMIT = 1` by default to prevent screen clutter; previous toasts are dismissed automatically when new toasts arrive.

## Upstream / Downstream Dataflow
- **Upstream**: Subscribes to browser window resize / media queries (`window.matchMedia`) and React state reducers.
- **Downstream**: Consumed by layout components (`Sidebar`, navigation bars) and interactive action handlers (`Index.tsx`, mutation success/error callbacks) to trigger user feedback.
