▼Todo
[ ] Add runYTMusicHarvest() method - single python call with 4s timeout, returns {isSynced, plain, synced, source}
[ ] Add runGeniusPlain() method - Genius only, returns plain text candidate
[ ] Update runLyricsMatcher() - add 2s timeout for LRCLIB search
[ ] Refactor fetchLyrics() to waterfall structure: Wave 0 → 1.1 (LRCLIB) → 1.2 (YT Music) → 1.3 (Pre-fetch) → Wave 2 (early exits at each step) → Wave 2 (Genius + YTM plain + LRCLIB plain) → Final Resort
[ ] Implement decimal waterfall logging: 🌊 Wave 1.1, 1.2, 1.3, Wave 2, Final Resort with early exit markers
[ ] Pre-harvest YT Music plain in Wave 1.2, store in ytmPreHarvested for Wave 2 reuse
[ ] Feed LRCLIB plain candidates to Wave 2 selection pool
[ ] Remove runWave2Parallel() method (replaced by runGeniusPlain + reuse)
[ ] Verify timeout budgets: LRCLIB 2s + YT Music 4s = 6s max Wave 1 blocking
[ ] Test: LRCLIB network error isolated, Wave 1.2 still executes
[ ] Test: forceResync=true bypasses all caches
[ ] Run syntax check and import verification
