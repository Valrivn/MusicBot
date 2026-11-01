# `Voxaria-Web/src/components/karaoke/` — Karaoke Gaming & Server Battle UI

## Functional Role
Specialized interactive karaoke presentation layer. Contains gamified UI modals, leaderboards, and scoring recap dialogs displayed at the conclusion of karaoke performances in the Voxaria Karaoke Arena.

## Table of Files

| File Name | Primary Purpose | Key Exports / Components / Hooks | Key Dependencies |
| :--- | :--- | :--- | :--- |
| `ServerBattleModal.tsx` | Post-song battle recap dialog; submits performance results, displays player grade badges, score metrics, and guild high-score leaderboard with quick actions for replay and skipping. | `ServerBattleModal`, interface `ServerBattleModalProps` | `react`, `lucide-react`, `@/components/ui/dialog`, `@/components/ui/button`, `@/components/ui/badge`, `@/components/ui/avatar`, `@/components/ui/table`, `@/lib/api/karaoke` |

## Common Error Scenarios & Troubleshooting Tips
- **Leaderboard / Record Sync Failure**: If `karaokeApi.submitRecord()` fails due to network outage or API error, the component automatically falls back to `karaokeApi.getRecords()` to retrieve existing records without crashing.
- **Race Conditions on Modal Close**: Managed via the `isMounted` flag pattern in `useEffect` cleanup to prevent React state updates on unmounted component trees.
- **Missing User Identity**: Requires valid `user.id` and `user.username`. If unauthenticated or user is anonymous, verify mock or guest profiles are passed from upstream caller.

## Upstream / Downstream Dataflow
- **Upstream**: Triggered by karaoke performance completion in `Index.tsx`, consuming evaluation metrics (score, accuracy, maxCombo, grade) from the pitch-scoring engine (`@/lib/pitch-scoring`).
- **Downstream**: Calls `@/lib/api/karaoke` (`submitRecord`, `getRecords`) to mutate and query guild rankings; renders Radix UI dialog and primitives (`Dialog`, `Button`, `Badge`, `Avatar`, `Table`). Triggers parent callbacks `onSingAgain` or `onNextTrack`.
