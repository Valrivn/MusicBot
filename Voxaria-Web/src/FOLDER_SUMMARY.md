# `Voxaria-Web/src/` — Root Application Shell & Bootstrapper

## Functional Role
Root frontend orchestration layer. Responsible for bootstrapping the React 18 application, providing top-level context providers (tRPC, React Query, Radix Tooltip, Toaster), loading the global Tailwind styling and HSL theme variables, and configuring client-side routing.

## Table of Files

| File Name | Primary Purpose | Key Exports / Components / Hooks | Key Dependencies |
| :--- | :--- | :--- | :--- |
| `main.tsx` | Entrypoint; mounts React root into DOM `#root` with `TRPCProvider`. | None (bootstrap script) | `react-dom/client`, `@/lib/trpc`, `./App`, `./index.css` |
| `App.tsx` | App shell; establishes `QueryClientProvider`, Radix UI providers, toast providers, and routing (`/` to `Index`, `*` to `NotFound`). | `default App` | `@tanstack/react-query`, `react-router-dom`, `@/components/ui/toaster`, `@/components/ui/sonner`, `@/components/ui/tooltip`, `@/pages/Index`, `@/pages/NotFound` |
| `index.css` | Global styling; defines Tailwind base, dark/neon Voxaria HSL theme tokens, animations, and custom utility classes. | Global CSS tokens (`--background`, `--primary`, `--panel-soft`, etc.) | `tailwindcss` |
| `App.css` | Secondary/legacy root CSS overrides. | Global styles | None |
| `vite-env.d.ts` | Ambient TypeScript declarations for Vite client environment (`ImportMetaEnv`). | Compiler type references | `vite/client` |

## Common Error Scenarios & Troubleshooting Tips
- **Uncaught Error: "No QueryClient set"**: Occurs if a hook or component utilizing React Query (`useQuery`, `useMutation`) is rendered outside the `<QueryClientProvider>` hierarchy in `App.tsx`.
- **tRPC Context Missing**: Occurs if components invoking tRPC hooks (`trpc.useUtils`, etc.) are rendered outside `<TRPCProvider>` in `main.tsx`.
- **Broken / Missing Neon Styling**: If HSL colors or borders are transparent, verify `index.css` is imported in `main.tsx` and custom properties like `--panel-soft` or `--neon-edge` are intact.
- **Route 404 on New Pages**: Routes in `App.tsx` must be declared **above** the catch-all `<Route path="*" element={<NotFound />} />`.

## Upstream / Downstream Dataflow
- **Upstream**: Loaded by `index.html` via Vite bundle loader (`/src/main.tsx`). Ingests environment variables from `import.meta.env` (`VITE_VOXARIA_API_BASE_URL`).
- **Downstream**: Wraps and renders `<TRPCProvider>` -> `<QueryClientProvider>` -> `<TooltipProvider>` -> `<BrowserRouter>` -> routes pages (`@/pages/Index`, `@/pages/NotFound`), mounting global floating UI primitives (`Toaster`, `Sonner`).
