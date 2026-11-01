/**
 * Pitch Scoring & Low-Voice Adaptive Engine for Voxaria Karaoke Arena
 */

export type PitchTier = "PERFECT" | "GREAT" | "GOOD" | "MISS";

export interface PitchEvaluationResult {
  tier: PitchTier;
  centsDistance: number;
  userChroma: number;
  targetChroma: number;
  pitchPointsRatio: number;
  trajectoryScore: number;
  effectivePitchScore: number;
  rhythmScore: number;
  stabilityScore: number;
  compositeQuality: number;
  comboMultiplier: number;
  pointsEarned: number;
  comboIncrement: number; // +1 if hit, reset to 0 if miss
  isHit: boolean;
}

export interface ScoreTickOptions {
  userMidi: number;
  targetMidi: number;
  prevUserMidi: number | null;
  prevTargetMidi: number | null;
  isSingingActive: boolean;
  recentPitchesMidi: number[]; // Rolling buffer for stability calculation
  currentCombo: number;
  basePoints?: number; // Default 120 (approx 1000 pts/sec at 120ms ticks)
}

/**
 * Calculates octave-invariant cents distance between user pitch and target pitch.
 * Deep voices (C2 = MIDI 36) on soprano targets (C4 = MIDI 60, C5 = MIDI 72) yield 0 cents distance.
 */
export function calculateOctaveInvariantCentsDistance(userMidi: number, targetMidi: number): number {
  let semitoneDiff = (userMidi - targetMidi) % 12;
  if (semitoneDiff < 0) semitoneDiff += 12; // Wrap into [0, 12)
  if (semitoneDiff > 6) semitoneDiff = 12 - semitoneDiff; // Wrap into [0, 6] semitones
  const cents = Math.round(semitoneDiff * 100 * 100) / 100;
  return cents === 0 ? 0 : Math.abs(cents);
}

/**
 * Extracts pitch chroma class (0-11) in [C, C#, D, ..., B].
 */
export function toChroma(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12;
}

/**
 * Evaluates relative interval trajectory when melody moves.
 * Rewards matching direction and step magnitude.
 */
export function evaluateIntervalTrajectory(
  userMidi: number,
  targetMidi: number,
  prevUserMidi: number | null,
  prevTargetMidi: number | null,
): number {
  if (prevUserMidi === null || prevTargetMidi === null) {
    return 1.0; // Initial note has neutral perfect trajectory
  }

  const targetStep = targetMidi - prevTargetMidi;
  const userStep = userMidi - prevUserMidi;

  // If the melody pitch changed significantly (>= 0.5 semitone)
  if (Math.abs(targetStep) >= 0.5) {
    const sameDirection =
      (targetStep > 0 && userStep > 0) || (targetStep < 0 && userStep < 0);

    if (!sameDirection) {
      return 0.2; // Singer moved in the opposite direction
    }

    const stepDiff = Math.abs(Math.abs(userStep) - Math.abs(targetStep));
    if (stepDiff <= 1.0) {
      return 1.0; // Accurate interval step
    } else if (stepDiff <= 2.5) {
      return 0.75; // Direction correct, step slightly over/undershot
    } else {
      return 0.5; // Direction correct, step inaccurate
    }
  }

  // Steady sustained melody note (< 0.5 semitone change)
  if (Math.abs(userStep) <= 0.8) {
    return 1.0; // Steady vocal hold
  }
  return 0.6; // Slight pitch drift
}

/**
 * Calculates vocal stability (0.0 to 1.0) from pitch variance across recent frames.
 */
export function calculateVocalStability(recentPitchesMidi: number[]): number {
  if (recentPitchesMidi.length < 3) return 1.0;

  const n = recentPitchesMidi.length;
  const mean = recentPitchesMidi.reduce((acc, val) => acc + val, 0) / n;
  const variance = recentPitchesMidi.reduce((acc, val) => acc + (val - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  // Natural human vibrato produces ~0.2 - 0.4 semitone std dev
  if (stdDev <= 0.35) return 1.0;
  if (stdDev <= 0.70) return 0.75;
  if (stdDev <= 1.20) return 0.40;
  return 0.15;
}

/**
 * Calculates combo multiplier from 1.0x to 4.0x based on active streak.
 */
export function getComboMultiplier(combo: number): number {
  // 0-9: 1.0x, 10-19: 1.5x, 20-29: 2.0x, 30-39: 2.5x, 40-49: 3.0x, 50-59: 3.5x, 60+: 4.0x
  return Math.min(4.0, 1.0 + Math.floor(Math.max(0, combo) / 10) * 0.5);
}

/**
 * Core scoring tick evaluation.
 * Formula: (Pitch Score 60% + Syllable Rhythm 25% + Vocal Stability 15%) * Combo Multiplier (1.0x - 4.0x)
 */
export function evaluatePitchScoreTick(options: ScoreTickOptions): PitchEvaluationResult {
  const {
    userMidi,
    targetMidi,
    prevUserMidi,
    prevTargetMidi,
    isSingingActive,
    recentPitchesMidi,
    currentCombo,
    basePoints = 120,
  } = options;

  const userChroma = toChroma(userMidi);
  const targetChroma = toChroma(targetMidi);
  const centsDistance = calculateOctaveInvariantCentsDistance(userMidi, targetMidi);

  let tier: PitchTier = "MISS";
  let pitchPointsRatio = 0;

  if (centsDistance <= 25) {
    tier = "PERFECT";
    pitchPointsRatio = 1.0;
  } else if (centsDistance <= 50) {
    tier = "GREAT";
    pitchPointsRatio = 0.75;
  } else if (centsDistance <= 85) {
    tier = "GOOD";
    pitchPointsRatio = 0.50;
  } else {
    tier = "MISS";
    pitchPointsRatio = 0.0;
  }

  const isHit = tier !== "MISS";

  // Relative interval trajectory
  const trajectoryScore = evaluateIntervalTrajectory(
    userMidi,
    targetMidi,
    prevUserMidi,
    prevTargetMidi,
  );

  // Pitch score blends base tier matching (85%) with interval trajectory reward (15%)
  const effectivePitchScore = isHit
    ? pitchPointsRatio * 0.85 + trajectoryScore * 0.15
    : 0;

  // Syllable Rhythm: Active singing during target window
  const rhythmScore = isSingingActive ? 1.0 : 0.0;

  // Vocal Stability
  const stabilityScore = calculateVocalStability(recentPitchesMidi);

  // Weighted formula: Pitch (60%) + Rhythm (25%) + Stability (15%)
  const compositeQuality = isHit
    ? 0.60 * effectivePitchScore + 0.25 * rhythmScore + 0.15 * stabilityScore
    : 0;

  const nextCombo = isHit ? currentCombo + 1 : 0;
  const comboMultiplier = getComboMultiplier(nextCombo);

  const pointsEarned = isHit
    ? Math.round(basePoints * compositeQuality * comboMultiplier)
    : 0;

  return {
    tier,
    centsDistance,
    userChroma,
    targetChroma,
    pitchPointsRatio,
    trajectoryScore,
    effectivePitchScore,
    rhythmScore,
    stabilityScore,
    compositeQuality,
    comboMultiplier,
    pointsEarned,
    comboIncrement: isHit ? 1 : -currentCombo,
    isHit,
  };
}
