import { describe, expect, it } from "vitest";
import {
  calculateOctaveInvariantCentsDistance,
  toChroma,
  evaluateIntervalTrajectory,
  calculateVocalStability,
  getComboMultiplier,
  evaluatePitchScoreTick,
} from "../lib/pitch-scoring";

describe("Low-Voice Adaptive Pitch Engine & Scoring", () => {
  it("computes exact chroma classes", () => {
    expect(toChroma(60)).toBe(0); // C4
    expect(toChroma(48)).toBe(0); // C3
    expect(toChroma(36)).toBe(0); // C2
    expect(toChroma(72)).toBe(0); // C5
    expect(toChroma(61)).toBe(1); // C#4
    expect(toChroma(69)).toBe(9); // A4 (440Hz)
  });

  it("ensures deep voices (C2-C3) singing songs in C4-C5 get 0 cents distance and PERFECT score", () => {
    // C2 (36) vs C4 (60)
    const distC2toC4 = calculateOctaveInvariantCentsDistance(36, 60);
    expect(distC2toC4).toBe(0);

    // C2 (36) vs C5 (72)
    const distC2toC5 = calculateOctaveInvariantCentsDistance(36, 72);
    expect(distC2toC5).toBe(0);

    // C3 (48) vs C4 (60)
    const distC3toC4 = calculateOctaveInvariantCentsDistance(48, 60);
    expect(distC3toC4).toBe(0);

    // Evaluate tick for C2 singing C5 melody
    const result = evaluatePitchScoreTick({
      userMidi: 36,
      targetMidi: 72,
      prevUserMidi: 36,
      prevTargetMidi: 72,
      isSingingActive: true,
      recentPitchesMidi: [36, 36.02, 35.98, 36.01],
      currentCombo: 0,
      basePoints: 100,
    });

    expect(result.tier).toBe("PERFECT");
    expect(result.centsDistance).toBe(0);
    expect(result.isHit).toBe(true);
    expect(result.effectivePitchScore).toBe(1.0);
    expect(result.compositeQuality).toBe(1.0);
    expect(result.pointsEarned).toBe(100);
  });

  it("strictly enforces cents distance tolerance tiers", () => {
    // <= 25 cents -> PERFECT (100%)
    const perfResult = evaluatePitchScoreTick({
      userMidi: 60.20, // +20 cents
      targetMidi: 60,
      prevUserMidi: null,
      prevTargetMidi: null,
      isSingingActive: true,
      recentPitchesMidi: [60.2],
      currentCombo: 5,
    });
    expect(perfResult.tier).toBe("PERFECT");
    expect(perfResult.pitchPointsRatio).toBe(1.0);

    // <= 50 cents -> GREAT (75%)
    const greatResult = evaluatePitchScoreTick({
      userMidi: 60.40, // +40 cents
      targetMidi: 60,
      prevUserMidi: null,
      prevTargetMidi: null,
      isSingingActive: true,
      recentPitchesMidi: [60.4],
      currentCombo: 5,
    });
    expect(greatResult.tier).toBe("GREAT");
    expect(greatResult.pitchPointsRatio).toBe(0.75);

    // <= 85 cents -> GOOD (50%)
    const goodResult = evaluatePitchScoreTick({
      userMidi: 60.75, // +75 cents
      targetMidi: 60,
      prevUserMidi: null,
      prevTargetMidi: null,
      isSingingActive: true,
      recentPitchesMidi: [60.75],
      currentCombo: 5,
    });
    expect(goodResult.tier).toBe("GOOD");
    expect(goodResult.pitchPointsRatio).toBe(0.50);

    // > 85 cents -> MISS (0 points, reset combo)
    const missResult = evaluatePitchScoreTick({
      userMidi: 60.90, // +90 cents
      targetMidi: 60,
      prevUserMidi: null,
      prevTargetMidi: null,
      isSingingActive: true,
      recentPitchesMidi: [60.9],
      currentCombo: 15,
    });
    expect(missResult.tier).toBe("MISS");
    expect(missResult.isHit).toBe(false);
    expect(missResult.pointsEarned).toBe(0);
  });

  it("rewards relative interval trajectory on melody shifts", () => {
    // Target moves up by 2 semitones (+2)
    // User moves up by 2 semitones in their octave (+2)
    const trajectoryGood = evaluateIntervalTrajectory(40, 64, 38, 62);
    expect(trajectoryGood).toBe(1.0);

    // User moves in opposite direction (-2)
    const trajectoryBad = evaluateIntervalTrajectory(36, 64, 38, 62);
    expect(trajectoryBad).toBe(0.2);
  });

  it("calculates combo multiplier up to 4.0x", () => {
    expect(getComboMultiplier(0)).toBe(1.0);
    expect(getComboMultiplier(9)).toBe(1.0);
    expect(getComboMultiplier(10)).toBe(1.5);
    expect(getComboMultiplier(20)).toBe(2.0);
    expect(getComboMultiplier(30)).toBe(2.5);
    expect(getComboMultiplier(40)).toBe(3.0);
    expect(getComboMultiplier(50)).toBe(3.5);
    expect(getComboMultiplier(60)).toBe(4.0);
    expect(getComboMultiplier(150)).toBe(4.0);
  });

  it("computes vocal stability based on pitch standard deviation", () => {
    // Highly stable voice (stdDev < 0.35)
    expect(calculateVocalStability([60.0, 60.05, 59.95, 60.02])).toBe(1.0);
    // Moderate vibrato
    expect(calculateVocalStability([60.0, 60.5, 59.5, 60.4])).toBe(0.75);
    // Unstable/crack
    expect(calculateVocalStability([60.0, 62.5, 57.0, 61.2])).toBe(0.15);
  });
});
