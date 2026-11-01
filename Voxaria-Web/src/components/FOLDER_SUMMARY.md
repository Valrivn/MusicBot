# `Voxaria-Web/src/components/` — Shared Domain Components & Navigational Primitives

## Functional Role
Shared domain and navigation layer intermediate between atomic design primitives (`components/ui/`) and full view containers (`pages/`). Houses domain-specific widgets such as audit trail observers and enhanced navigational links, as well as subdirectories for domain verticals (`karaoke/`) and design system primitives (`ui/`).

## Table of Files

| File Name | Primary Purpose | Key Exports / Components / Hooks | Key Dependencies |
| :--- | :--- | :--- | :--- |
| `AuditLogViewer.tsx` | Visual widget polling and rendering recent playback, track requests, and user action audit trails with relative time formatting. | `AuditLogViewer` | `@tanstack/react-query`, `lucide-react`, `@/lib/voxaria-api` |
| `NavLink.tsx` | Forward-ref wrapped navigation link combining `react-router-dom`'s `NavLink` with Tailwind utility class resolution (`cn`). | `NavLink` (forwardRef) | `react-router-dom`, `@/lib/utils` |

## Subdirectories
- **`karaoke/`**: High-level interactive karaoke feature modals (e.g. `ServerBattleModal.tsx`) and game UI components.
- **`ui/`**: Radix UI + shadcn/ui atomic building blocks (buttons, dialogs, dropdowns, inputs, tables, toasters).

## Common Error Scenarios & Troubleshooting Tips
- **Audit Log Polling Failures / "Service Unavailable" State**: If `voxariaApi.getAuditLog()` rejects or API is offline, `AuditLogViewer` gracefully displays a "Service Unavailable" banner. Check network connectivity or API port (default `3002`).
- **Invalid Timestamp in Audit Log**: Handled defensively in `toRelativeTime()`, falling back to `"just now"` if `Date.parse()` fails or timestamp is missing.
- **Active Navigation Styling Issues**: `NavLink` supports `activeClassName` and `pendingClassName`. Ensure class names do not conflict with standard Tailwind class ordering when merged via `cn()`.

## Upstream / Downstream Dataflow
- **Upstream**: Ingests API data from `@/lib/voxaria-api` (e.g. `getAuditLog`), router navigation events from `react-router-dom`, and class composition utilities from `@/lib/utils`.
- **Downstream**: Rendered within view pages (such as `Index.tsx`) and layout headers/sidebars to provide operational monitoring and client navigation.
