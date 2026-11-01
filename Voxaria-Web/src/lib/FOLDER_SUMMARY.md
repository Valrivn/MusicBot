# `Voxaria-Web/src/lib/` — Core Infrastructure, Pitch Engine, & Shared Utilities

## Functional Role
Core frontend infrastructure and algorithmic engine layer. Houses Discord OAuth authentication state management (`auth.ts`, `AuthContext.tsx`), the low-voice adaptive pitch scoring engine (`pitch-scoring.ts`), styling/class utility mergers (`utils.ts`), and the centralized API barrel (`voxaria-api.ts`), along with subpackages for REST clients (`api/`) and tRPC bindings (`trpc/`).

## Table of Files

| File Name | Primary Purpose | Key Exports / Components / Hooks | Key Dependencies |
| :--- | :--- | :--- | :--- |
| `auth.ts` | OAuth2 Discord authentication manager; token storage, session refresh logic, auth state subscriptions, and Bearer token headers. | `loginWithDiscord`, `logout`, `validateSession`, `refreshAccessToken`, `getAccessToken`, `subscribeToAuth`, `isAuthenticated`, `getCurrentUser`, types `AuthUser`, `TokenResponse` | Native `fetch`, `localStorage` |
| `AuthContext.tsx` | React Context provider and hook exposing user session, login status, and auth actions to the component tree. | `AuthProvider`, `useAuth` | `react`, `./auth` |
| `pitch-scoring.ts` | Octave-invariant, low-voice adaptive karaoke pitch scoring engine; computes cents distance, chroma mapping, interval trajectory, vocal stability, combo multipliers, and performance grades. | `evaluatePitchScoreTick`, `calculateOctaveInvariantCentsDistance`, `toChroma`, `evaluateIntervalTrajectory`, `calculateVocalStability`, `getComboMultiplier`, types `PitchEvaluationResult`, `ScoreTickOptions`, `PitchTier` | Pure TypeScript / math algorithms |
| `utils.ts` | Class merger combining `clsx` and `tailwind-merge` to resolve conditional Tailwind utility classes cleanly without collisions. | `cn(...inputs)` | `clsx`, `tailwind-merge` |
| `voxaria-api.ts` | Centralized barrel re-exporting the entire REST API client namespace from `./api`. | `voxariaApi`, all exports from `./api` | `./api` |

## Subdirectories
- **`api/`**: Modular REST API endpoint client modules (auth, player, queue, karaoke, presets, system settings, metrics/audit).
- **`trpc/`**: Type-safe end-to-end tRPC client bindings, query provider, and custom procedure hooks.

## Common Error Scenarios & Troubleshooting Tips
- **Auth Session Expiration**: `auth.ts` attempts proactive refresh; if refresh fails, tokens are evicted from `localStorage` and `currentUser` is set to `null`.
- **`useAuth must be used within an AuthProvider`**: Thrown if `useAuth()` is called in a component tree not wrapped by `<AuthProvider>`.
- **Low Pitch / Baritone Under-scoring**: Resolved by `calculateOctaveInvariantCentsDistance` (modulo 12 semitones); ensures singers performing 1 or 2 octaves below target pitch (e.g. C2 vs C4) receive exact distance 0 and PERFECT rating.
- **Tailwind Style Override Failures**: Always wrap conflicting dynamic classes in `cn(...)` to ensure `tailwind-merge` properly resolves specificity.

## Upstream / Downstream Dataflow
- **Upstream**: Ingests environment API base URL (`VITE_VOXARIA_API_BASE_URL`), browser storage, and microphone audio FFT pitch streams.
- **Downstream**: Supplies authentication contexts to pages, feeds pitch evaluation results into karaoke playback visualizers and `ServerBattleModal`, and provides `cn` utility across the entire UI component system.
