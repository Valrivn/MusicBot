# `Voxaria-Web/src/test/` — Frontend Test Suite & Test Harness Setup

## Functional Role
Unit and integration test suite executing via Vitest. Provides global test environment polyfills, browser mock definitions, and comprehensive mathematical verification of the low-voice adaptive karaoke pitch engine and core algorithmic calculations.

## Table of Files

| File Name | Primary Purpose | Key Exports / Components / Hooks | Key Dependencies |
| :--- | :--- | :--- | :--- |
| `setup.ts` | Global test setup script executed before Vitest suites; imports `@testing-library/jest-dom` and injects mock implementation of `window.matchMedia`. | None (environment side-effects) | `@testing-library/jest-dom` |
| `example.test.ts` | Vitest smoke test asserting test harness functionality. | None (test suite) | `vitest` |
| `pitch-scoring.test.ts` | Comprehensive test suite for the low-voice adaptive pitch engine; validates chroma mapping, octave invariance (deep voice baritones C2 hitting soprano C5 targets), trajectory tracking, and combo scaling. | None (test suite) | `vitest`, `@/lib/pitch-scoring` |

## Common Error Scenarios & Troubleshooting Tips
- **`window.matchMedia is not a function`**: Happens if tests render components utilizing `use-mobile.tsx` without importing `setup.ts`. Verify Vitest config includes `setupFiles: ['./src/test/setup.ts']`.
- **Octave Invariant Distance Edge Cases**: When modifying pitch scoring algorithms, ensuring interval distances loop cleanly across modulo 12 semitones is critical; `pitch-scoring.test.ts` acts as the safety gate.
- **Floating Point Comparison Discrepancies**: Pitch cents and stability calculations produce floating-point decimals. Use `toBeCloseTo` or `Math.round` rounding logic as tested in `pitch-scoring.test.ts`.

## Upstream / Downstream Dataflow
- **Upstream**: Executed via test runner (`npm run test` or `vitest run`). Ingests source code from `@/lib/pitch-scoring` and testing libraries.
- **Downstream**: Outputs test execution reports, assertion verifications, and coverage metrics to CI/CD and developer terminals.
