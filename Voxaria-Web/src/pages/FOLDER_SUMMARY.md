# `Voxaria-Web/src/pages/` — Top-Level Route Views & Dashboard Containers

## Functional Role
Top-level page views rendered directly by the router (`react-router-dom`). Contains the primary full-featured application workstation (`Index.tsx`) combining audio playback, real-time karaoke scoring, queue management, presets, and server administration, as well as the 404 fallback page (`NotFound.tsx`).

## Table of Files

| File Name | Primary Purpose | Key Exports / Components / Hooks | Key Dependencies |
| :--- | :--- | :--- | :--- |
| `Index.tsx` | Main Voxaria dashboard & Karaoke Arena view; coordinates live audio analysis (Web Audio API / microphone stream), synchronized lyrics, pitch evaluation, queue drag-and-drop, playback controls, preset libraries, and guild battle modals. | `default Index` | `@tanstack/react-query`, `lucide-react`, `@/components/ui/*`, `@/components/karaoke/ServerBattleModal`, `@/components/AuditLogViewer`, `@/lib/voxaria-api`, `@/lib/pitch-scoring`, `@/lib/auth`, `@/hooks/use-toast` |
| `NotFound.tsx` | Fallback 404 error view for non-existent routes; logs missing route and provides navigation back to root. | `default NotFound` | `react-router-dom`, `react` |

## Common Error Scenarios & Troubleshooting Tips
- **Microphone Access Denied (`NotAllowedError`)**: Karaoke pitch tracking requires microphone permissions via `getUserMedia`. If blocked, pitch analysis disables gracefully and notifies the user via toast.
- **AudioContext Autoplay Policy (`Suspended` state)**: Browsers prevent `AudioContext` from running prior to user interaction. `AudioContext.resume()` must be called in a direct click handler (e.g. "Start Karaoke").
- **Real-Time Polling Congestion**: Polling intervals for queue (`2000ms`), player (`1000ms`), and audit logs (`15000ms`) can saturate network on sluggish connections. Verify tab visibility handling or react-query window focus refetching.
- **404 Redirection Loops**: If URL rewrite is misconfigured on hosting (Vite SPA routing), accessing direct paths may hit 404; ensure server redirects all subpaths to `index.html`.

## Upstream / Downstream Dataflow
- **Upstream**: Mounted by `App.tsx` via `react-router-dom` `<Route>`. Reads browser hardware APIs (`AudioContext`, `navigator.mediaDevices`) and server state via `@tanstack/react-query` calling `@/lib/voxaria-api`.
- **Downstream**: Renders child domain components (`ServerBattleModal`, `AuditLogViewer`), atomic UI components (`@/components/ui/*`), and updates the browser title and audio output.
