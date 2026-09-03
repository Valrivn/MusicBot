import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Mic, MicOff, Trophy, Flame, Play, Volume2, Loader2, AlertCircle } from 'lucide-react';

interface Contestant {
  id: string;
  username: string;
  avatarUrl?: string;
  score: number;
  streak: number;
  currentPitchDiff: number;
  isSinging: boolean;
}

interface PitchFrame {
  timeMs: number;
  midi: number;
}

interface KaraokeArenaProps {
  currentTrackTitle?: string;
  currentTrackArtist?: string;
  syncOffset?: number;
  trackId?: string;
  audioElement?: HTMLAudioElement | null;
  currentTime?: number;
}

export const KaraokeArena: React.FC<KaraokeArenaProps> = ({
  currentTrackTitle: propTitle,
  currentTrackArtist: propArtist,
  trackId,
  audioElement,
  currentTime: propCurrentTime,
}) => {
  const [isListening, setIsListening] = useState<boolean>(false);
  const [livePitch, setLivePitch] = useState<number>(0);
  const [liveVolume, setLiveVolume] = useState<number>(0);
  const [currentScore, setCurrentScore] = useState<number>(0);
  const [streak, setStreak] = useState<number>(0);
  const [multiplier, setMultiplier] = useState<number>(1);
  const [detectedNoteName, setDetectedNoteName] = useState<string>("---");

  // Simulated target pitch (e.g. 261.63Hz = Middle C) to evaluate matching
  const [targetFrequency, setTargetFrequency] = useState<number>(261.63);

  // Synced lyrics data mockup / fetch (to show lyrics inside the arena while singing)
  const [mockLyrics] = useState<{ timeSeconds: number; text: string }[]>([
    { timeSeconds: 0, text: "Welcome to the Voxaria Arena!" },
    { timeSeconds: 4, text: "Sing into your microphone to match the target frequency." },
    { timeSeconds: 8, text: "Watch the grid lines to see if your pitch is too high or too low." },
    { timeSeconds: 12, text: "Keep hitting correct notes to build up your streak multiplier!" },
    { timeSeconds: 16, text: "Show your friends who has the best pitch control." },
    { timeSeconds: 20, text: "Voxtaria - Advanced Realtime Audio Rendering Engine" }
  ]);
  const [currentLyricIndex, setCurrentLyricIndex] = useState<number>(0);
  const [, setElapsedSeconds] = useState<number>(0);

  // Live scoreboard
  const [contestants, setContestants] = useState<Contestant[]>([
    { id: '1', username: 'Hayden (You)', score: 0, streak: 0, currentPitchDiff: 0, isSinging: false },
    { id: '2', username: 'Alex', score: 1420, streak: 8, currentPitchDiff: 5, isSinging: true },
    { id: '3', username: 'Sarah', score: 2850, streak: 15, currentPitchDiff: -2, isSinging: true },
  ]);

  // Reference pitch data from backend
  const [pitchFrames, setPitchFrames] = useState<PitchFrame[]>([]);
  const [pitchDataLoading, setPitchDataLoading] = useState<boolean>(false);
  const [pitchDataError, setPitchDataError] = useState<string | null>(null);

  // Interpolated reference pitch for current time
  const [referencePitch, setReferencePitch] = useState<number>(0);
  const [referenceNoteName, setReferenceNoteName] = useState<string>("---");

  // Audio refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Pitch matching variables
  const scoreRef = useRef<number>(0);
  const streakRef = useRef<number>(0);

  // Dynamic note frequencies to guide target pitches
  const noteList = [
    { note: "C4", freq: 261.63 },
    { note: "D4", freq: 293.66 },
    { note: "E4", freq: 329.63 },
    { note: "F4", freq: 349.23 },
    { note: "G4", freq: 392.00 },
    { note: "A4", freq: 440.00 },
    { note: "B4", freq: 493.88 },
    { note: "C5", freq: 523.25 },
  ];

  // Convert MIDI note to frequency
  const midiToFreq = useCallback((midi: number): number => {
    if (midi <= 0) return 0;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }, []);

  // Interpolate reference pitch at a given time (ms)
  const getInterpolatedPitch = useCallback((frames: PitchFrame[], timeMs: number): number => {
    if (!frames.length) return 0;
    
    // Find the two frames surrounding the current time
    let leftFrame: PitchFrame | null = null;
    let rightFrame: PitchFrame | null = null;
    
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].timeMs <= timeMs) {
        leftFrame = frames[i];
      } else {
        rightFrame = frames[i];
        break;
      }
    }
    
    // If before first frame or after last frame
    if (!leftFrame) return midiToFreq(rightFrame!.midi);
    if (!rightFrame) return midiToFreq(leftFrame.midi);
    
    // If same MIDI note, no interpolation needed
    if (leftFrame.midi === rightFrame.midi) {
      return midiToFreq(leftFrame.midi);
    }
    
    // Linear interpolation between frames
    const timeDiff = rightFrame.timeMs - leftFrame.timeMs;
    if (timeDiff === 0) return midiToFreq(leftFrame.midi);
    
    const t = (timeMs - leftFrame.timeMs) / timeDiff;
    const leftFreq = midiToFreq(leftFrame.midi);
    const rightFreq = midiToFreq(rightFrame.midi);
    
    // Interpolate in frequency space (logarithmic for pitch)
    if (leftFreq === 0) return rightFreq;
    if (rightFreq === 0) return leftFreq;
    
    const leftLog = Math.log(leftFreq);
    const rightLog = Math.log(rightFreq);
    const interpLog = leftLog + t * (rightLog - leftLog);
    
    return Math.exp(interpLog);
  }, [midiToFreq]);

  // Fetch pitch data from backend
  const fetchPitchData = useCallback(async () => {
    if (!trackId) return;
    
    setPitchDataLoading(true);
    setPitchDataError(null);
    
    try {
      const response = await fetch(`/music/karaoke/pitch-data?trackId=${encodeURIComponent(trackId)}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch pitch data: ${response.status}`);
      }
      const data = await response.json();
      
      if (Array.isArray(data) && data.length > 0) {
        // Validate frame structure
        const validFrames: PitchFrame[] = data
          .filter((f: any) => typeof f.timeMs === 'number' && typeof f.midi === 'number')
          .map((f: any) => ({ timeMs: f.timeMs, midi: f.midi }))
          .sort((a, b) => a.timeMs - b.timeMs);
        
        setPitchFrames(validFrames);
      } else if (data && data.status === 'processing') {
        setPitchDataError('Pitch data is still being generated...');
      } else {
        setPitchFrames([]);
        setPitchDataError('No pitch data available for this track');
      }
    } catch (err) {
      console.error('Pitch data fetch error:', err);
      setPitchDataError(err instanceof Error ? err.message : 'Failed to load pitch data');
      setPitchFrames([]);
    } finally {
      setPitchDataLoading(false);
    }
  }, [trackId]);

  // Fetch pitch data when trackId changes
  useEffect(() => {
    fetchPitchData();
  }, [fetchPitchData]);

  // Randomly cycles targets for simulation if no synced track inputs exist
  useEffect(() => {
    const interval = setInterval(() => {
      const randomNote = noteList[Math.floor(Math.random() * noteList.length)];
      setTargetFrequency(randomNote.freq);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Update reference pitch based on audio playback time
  useEffect(() => {
    if (!pitchFrames.length) return;
    
    const updateReferencePitch = () => {
      // Get current time from audio element or prop
      let currentTimeMs = 0;
      if (audioElement) {
        currentTimeMs = audioElement.currentTime * 1000;
      } else if (typeof propCurrentTime === 'number') {
        currentTimeMs = propCurrentTime * 1000;
      } else if (isListening) {
        // Fallback to internal timer if no audio element provided
        currentTimeMs = Date.now() - (window as any).__karaokeStartTime || 0;
      }
      
      const freq = getInterpolatedPitch(pitchFrames, currentTimeMs);
      setReferencePitch(freq);
      
      if (freq > 0) {
        setReferenceNoteName(getNoteName(freq));
        // Update target frequency to match reference for scoring
        setTargetFrequency(freq);
      } else {
        setReferenceNoteName("---");
      }
    };
    
    // Update at 60fps for smooth interpolation
    const interval = setInterval(updateReferencePitch, 16);
    updateReferencePitch(); // Initial call
    
    return () => clearInterval(interval);
  }, [pitchFrames, audioElement, propCurrentTime, isListening, getInterpolatedPitch]);

  // Update mock elapsed timer to scroll lyrics (fallback when no audio element)
  useEffect(() => {
    if (!isListening || audioElement || typeof propCurrentTime === 'number') return;
    
    if (typeof window !== 'undefined') {
      (window as any).__karaokeStartTime = Date.now();
    }
    
    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setElapsedSeconds(elapsed);

      const idx = mockLyrics.findIndex((lyric, index) => {
        const nextLyric = mockLyrics[index + 1];
        return elapsed >= lyric.timeSeconds && (!nextLyric || elapsed < nextLyric.timeSeconds);
      });
      if (idx !== -1) {
        setCurrentLyricIndex(idx);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [isListening, mockLyrics, audioElement, propCurrentTime]);

  const requestMicrophone = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      setIsListening(true);
      initAudioEngine(stream);
    } catch (err) {
      console.error("Microphone access denied:", err);
      alert("Microphone access is required for Karaoke pitch detection.");
    }
  };

  const stopMicrophone = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    setIsListening(false);
    setLivePitch(0);
    setLiveVolume(0);
    setDetectedNoteName("---");
  };

  const initAudioEngine = (stream: MediaStream) => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AudioContextClass();
    audioContextRef.current = audioCtx;

    const source = audioCtx.createMediaStreamSource(stream);

    const hpFilter = audioCtx.createBiquadFilter();
    hpFilter.type = 'highpass';
    hpFilter.frequency.value = 80;

    const lpFilter = audioCtx.createBiquadFilter();
    lpFilter.type = 'lowpass';
    lpFilter.frequency.value = 1000;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyserRef.current = analyser;

    source.connect(hpFilter);
    hpFilter.connect(lpFilter);
    lpFilter.connect(analyser);

    updatePitch();
  };

  const autoCorrelate = (buffer: Float32Array, sampleRate: number): number => {
    let sumOfSquares = 0;
    for (let i = 0; i < buffer.length; i++) {
      sumOfSquares += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sumOfSquares / buffer.length);
    
    if (rms < 0.015) {
      return -1; 
    }

    let r1 = 0, r2 = buffer.length - 1;
    const thres = 0.2;
    for (let i = 0; i < buffer.length / 2; i++) {
      if (Math.abs(buffer[i]) < thres) { r1 = i; } else { break; }
    }
    for (let i = buffer.length - 1; i >= buffer.length / 2; i--) {
      if (Math.abs(buffer[i]) < thres) { r2 = i; } else { break; }
    }
    const trimmedBuffer = buffer.subarray(r1, r2);
    
    const len = trimmedBuffer.length;
    const r = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      for (let j = 0; j < len - i; j++) {
        r[i] = r[i] + trimmedBuffer[j] * trimmedBuffer[j + i];
      }
    }

    let d = 0;
    while (r[d] > r[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < len; i++) {
      if (r[i] > maxval) {
        maxval = r[i];
        maxpos = i;
      }
    }
    
    let T0 = maxpos;
    
    const x1 = r[T0 - 1], x2 = r[T0], x3 = r[T0 + 1];
    const a = (x1 + x3 - 2 * x2) / 2;
    const b = (x3 - x1) / 2;
    if (a) T0 = T0 - b / (2 * a);

    return sampleRate / T0;
  };

  const getNoteName = (frequency: number): string => {
    const noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const formulaVal = 12 * (Math.log(frequency / 440) / Math.log(2));
    const noteIndex = Math.round(formulaVal) + 69;
    const key = noteStrings[noteIndex % 12];
    const octave = Math.floor(noteIndex / 12) - 1;
    return `${key}${octave}`;
  };

  const updatePitch = () => {
    if (!analyserRef.current || !audioContextRef.current) return;

    const analyser = analyserRef.current;
    const buffer = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buffer);

    const freq = autoCorrelate(buffer, audioContextRef.current.sampleRate);

    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i] * buffer[i];
    }
    const currentRms = Math.sqrt(sum / buffer.length);
    setLiveVolume(Math.min(100, Math.round(currentRms * 300)));

    if (freq !== -1 && freq > 50 && freq < 2000) {
      setLivePitch(Math.round(freq));
      const noteStr = getNoteName(freq);
      setDetectedNoteName(noteStr);

      const diffCents = 1200 * Math.log2(freq / targetFrequency);
      const absDiff = Math.abs(diffCents);

      if (absDiff < 45) {
        streakRef.current += 1;
        const currentMultiplier = Math.min(4, 1 + Math.floor(streakRef.current / 5));
        scoreRef.current += 10 * currentMultiplier;

        setStreak(streakRef.current);
        setMultiplier(currentMultiplier);
        setCurrentScore(scoreRef.current);
      } else {
        streakRef.current = 0;
        setStreak(0);
        setMultiplier(1);
      }
    } else {
      setLivePitch(0);
    }

    drawVisuals();

    setContestants(prev => prev.map(c => {
      if (c.id === '1') {
        return {
          ...c,
          score: scoreRef.current,
          streak: streakRef.current,
          currentPitchDiff: freq !== -1 ? Math.round(1200 * Math.log2(freq / targetFrequency)) : 0,
          isSinging: freq !== -1
        };
      }
      if (c.id === '2' && Math.random() > 0.6) {
        return { ...c, score: c.score + 5, streak: c.streak + 1, isSinging: true };
      }
      return c;
    }).sort((a, b) => b.score - a.score));

    animationFrameRef.current = requestAnimationFrame(updatePitch);
  };

  const drawVisuals = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Draw grid lines
    ctx.strokeStyle = '#18181b';
    ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) {
      const y = (height / 10) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Draw Pitch reference offset lines (+100 cents / -100 cents)
    const targetY = height / 2;
    const scaleCentsRange = 200; // Total range shown is +/- 200 cents

    // Draw +100 cents line (Too High)
    const tooHighY = targetY - (100 / scaleCentsRange) * (height / 3);
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, tooHighY);
    ctx.lineTo(width, tooHighY);
    ctx.stroke();
    
    ctx.fillStyle = '#ef4444';
    ctx.font = '9px sans-serif';
    ctx.fillText("+100 cents (Too High)", 10, tooHighY - 4);

    // Draw -100 cents line (Too Low)
    const tooLowY = targetY + (100 / scaleCentsRange) * (height / 3);
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, tooLowY);
    ctx.lineTo(width, tooLowY);
    ctx.stroke();
    
    ctx.fillStyle = '#3b82f6';
    ctx.fillText("-100 cents (Too Low)", 10, tooLowY + 12);

    // Draw Target Note Line (Perfect Pitch Center)
    ctx.strokeStyle = 'rgba(57, 255, 20, 0.5)';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(0, targetY);
    ctx.lineTo(width, targetY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#39ff14';
    ctx.font = '12px sans-serif';
    ctx.fillText(`Target: ${getNoteName(targetFrequency)} (${Math.round(targetFrequency)}Hz)`, 15, targetY - 10);

    // Draw reference pitch curve (melody preview) if pitch data available
    if (pitchFrames.length > 0) {
      drawReferenceCurve(ctx, width, height, targetY, scaleCentsRange);
    }

    // Draw current reference pitch indicator
    if (referencePitch > 0) {
      drawReferenceIndicator(ctx, width, height, targetY, scaleCentsRange);
    }

    // Draw live vocal node marker
    if (livePitch > 0) {
      drawLiveIndicator(ctx, width, height, targetY, scaleCentsRange);
    }

    // Draw loading/error state
    if (pitchDataLoading) {
      drawLoadingState(ctx, width, height);
    } else if (pitchDataError && !pitchFrames.length) {
      drawErrorState(ctx, width, height, pitchDataError);
    }
  };

  const drawReferenceCurve = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    targetY: number,
    scaleCentsRange: number
  ) => {
    // Draw the melody curve for the visible time window (last 10 seconds + next 2 seconds)
    const currentTimeMs = audioElement 
      ? audioElement.currentTime * 1000 
      : (typeof propCurrentTime === 'number' ? propCurrentTime * 1000 : 0);
    
    const windowStart = Math.max(0, currentTimeMs - 10000);
    const windowEnd = currentTimeMs + 2000;
    
    // Filter frames in window
    const windowFrames = pitchFrames.filter(f => f.timeMs >= windowStart && f.timeMs <= windowEnd);
    if (windowFrames.length < 2) return;

    ctx.strokeStyle = 'rgba(57, 255, 20, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();

    let firstPoint = true;
    for (const frame of windowFrames) {
      const freq = midiToFreq(frame.midi);
      if (freq <= 0) continue; // Skip silence
      
      const diffCents = 1200 * Math.log2(freq / targetFrequency);
      const mappedDiff = Math.max(-scaleCentsRange, Math.min(scaleCentsRange, diffCents));
      const y = targetY - (mappedDiff / scaleCentsRange) * (height / 3);
      
      // Map time to x position (0 = windowStart, width = windowEnd)
      const x = ((frame.timeMs - windowStart) / (windowEnd - windowStart)) * width;
      
      if (firstPoint) {
        ctx.moveTo(x, y);
        firstPoint = false;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Draw current time marker line
    const currentX = ((currentTimeMs - windowStart) / (windowEnd - windowStart)) * width;
    if (currentX >= 0 && currentX <= width) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(currentX, 0);
      ctx.lineTo(currentX, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  };

  const drawReferenceIndicator = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    targetY: number,
    scaleCentsRange: number
  ) => {
    const diffCents = 1200 * Math.log2(referencePitch / targetFrequency);
    const mappedDiff = Math.max(-scaleCentsRange, Math.min(scaleCentsRange, diffCents));
    const refY = targetY - (mappedDiff / scaleCentsRange) * (height / 3);

    // Draw reference pitch marker (diamond shape)
    ctx.fillStyle = '#39ff14';
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#39ff14';
    ctx.shadowBlur = 15;
    
    ctx.beginPath();
    ctx.moveTo(width - 100, refY);
    ctx.lineTo(width - 85, refY - 12);
    ctx.lineTo(width - 100, refY);
    ctx.lineTo(width - 85, refY + 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Reference note label
    ctx.fillStyle = '#39ff14';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(`♪ ${referenceNoteName}`, width - 110, refY - 18);
  };

  const drawLiveIndicator = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    targetY: number,
    scaleCentsRange: number
  ) => {
    const diffCents = 1200 * Math.log2(livePitch / targetFrequency);
    const mappedDiff = Math.max(-scaleCentsRange, Math.min(scaleCentsRange, diffCents));
    const liveY = targetY - (mappedDiff / scaleCentsRange) * (height / 3);

    const hit = Math.abs(diffCents) < 45;
    
    // Draw path/trajectory indicators (how far user should adjust)
    ctx.strokeStyle = hit ? 'rgba(57, 255, 20, 0.3)' : 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(width - 120, targetY);
    ctx.quadraticCurveTo(width - 80, liveY, width - 50, liveY);
    ctx.stroke();

    // Live pitch marker (circle)
    ctx.fillStyle = hit ? '#39ff14' : '#ff3b30';
    ctx.shadowColor = hit ? '#39ff14' : '#ff3b30';
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(width - 50, liveY, 14, 0, 2 * Math.PI);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Draw direction text alert inside visualizer
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    if (!hit) {
      const adjustmentText = diffCents > 0 ? "GO LOWER ↓" : "GO HIGHER ↑";
      ctx.fillStyle = '#ff3b30';
      ctx.fillText(adjustmentText, width - 130, liveY < targetY ? liveY + 30 : liveY - 20);
    }
    
    ctx.fillStyle = '#fff';
    ctx.fillText(detectedNoteName, width - 62, liveY - 20);
  };

  const drawLoadingState = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, width, height);
    
    ctx.fillStyle = '#39ff14';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Loading pitch data...', width / 2, height / 2 - 10);
    
    // Animated spinner
    const time = Date.now() / 1000;
    ctx.strokeStyle = '#39ff14';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2 + 20, 15, time * 4, time * 4 + Math.PI * 1.5);
    ctx.stroke();
    ctx.textAlign = 'start';
  };

  const drawErrorState = (ctx: CanvasRenderingContext2D, width: number, height: number, error: string) => {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, width, height);
    
    ctx.fillStyle = '#ef4444';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Pitch Data Unavailable', width / 2, height / 2 - 20);
    ctx.fillStyle = '#aaa';
    ctx.font = '12px sans-serif';
    ctx.fillText(error, width / 2, height / 2 + 5);
    ctx.textAlign = 'start';
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6 w-full max-w-6xl mx-auto p-4 animate-fade-in">
      {/* Visualizer Panel */}
      <div className="flex-grow glass-panel p-6 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <span className="text-xs text-neonGreen font-semibold uppercase tracking-wider">Live Singing Contest</span>
            <h2 className="text-2xl font-bold leading-tight">{propTitle}</h2>
            <p className="text-sm text-gray-400">{propArtist}</p>
          </div>
          {/* Pitch Data Status */}
          <div className="flex items-center gap-3">
            {pitchDataLoading && (
              <span className="flex items-center gap-1 text-xs text-neonGreen">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading pitch data...
              </span>
            )}
            {pitchDataError && !pitchDataLoading && (
              <span className="flex items-center gap-1 text-xs text-red-400">
                <AlertCircle className="w-3 h-3" /> {pitchDataError}
              </span>
            )}
            {pitchFrames.length > 0 && !pitchDataLoading && !pitchDataError && (
              <span className="flex items-center gap-1 text-xs text-neonGreen">
                <span className="w-2 h-2 rounded-full bg-neonGreen" /> Pitch data loaded ({pitchFrames.length} frames)
              </span>
            )}
            {referencePitch > 0 && (
              <span className="text-xs text-gray-400 font-mono">
                Ref: {referenceNoteName} ({Math.round(referencePitch)}Hz)
              </span>
            )}
          </div>
        </div>

        {/* Pitch Game Canvas + Synced Lyrics Overlay container */}
        <div className="relative bg-black/50 rounded-xl overflow-hidden border border-surfaceHighlight aspect-video flex flex-col items-center justify-between">
          
          {/* Active Lyrics Scrolling Banner (Always visible while singing) */}
          <div className="absolute top-0 inset-x-0 bg-gradient-to-b from-black/80 to-transparent p-4 text-center z-10">
            <span className="text-xs text-gray-500 uppercase tracking-widest block mb-1">Active Lyrics</span>
            <p className="text-lg font-medium text-white max-w-lg mx-auto truncate">
              {isListening && mockLyrics[currentLyricIndex] ? mockLyrics[currentLyricIndex].text : "Lyrics will scroll here as you sing"}
            </p>
            {isListening && mockLyrics[currentLyricIndex + 1] && (
              <p className="text-xs text-gray-400 max-w-lg mx-auto truncate mt-1">
                Next: {mockLyrics[currentLyricIndex + 1].text}
              </p>
            )}
          </div>

          <canvas
            ref={canvasRef}
            width={640}
            height={360}
            className="w-full h-full block"
          />

          {/* Visualizer Legend */}
          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 to-transparent p-3 text-center z-10 flex justify-center gap-6 text-xs">
            <span className="flex items-center gap-1 text-neonGreen">
              <span className="w-2 h-2 rotate-45 border-2 border-neonGreen" /> Reference Pitch
            </span>
            <span className="flex items-center gap-1 text-white">
              <span className="w-3 h-3 rounded-full border-2 border-white" /> Your Pitch
            </span>
            <span className="flex items-center gap-1 text-green-400">
              <span className="w-3 h-3 rounded-full bg-green-400" /> On Target
            </span>
          </div>

          {!isListening && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm p-4 z-20">
              <Mic className="w-12 h-12 text-gray-500 mb-4 animate-pulse" />
              <p className="text-gray-300 text-center mb-6">Ready to sing? Enable browser mic authorization to start tracking score.</p>
              <button
                onClick={requestMicrophone}
                className="px-6 py-3 bg-neonGreen hover:bg-neonGreen/80 text-black font-semibold rounded-xl neon-glow transition-all duration-300 flex items-center gap-2"
              >
                <Play className="w-4 h-4 fill-black" /> Join & Start Singing
              </button>
            </div>
          )}
        </div>

        {/* Input indicators */}
        <div className="flex flex-wrap items-center justify-between gap-4 mt-2">
          <div className="flex items-center gap-4">
            <button
              onClick={isListening ? stopMicrophone : requestMicrophone}
              className={`p-3 rounded-lg border transition-all ${
                isListening 
                  ? 'bg-red-500/20 border-red-500/50 text-red-500 hover:bg-red-500/30' 
                  : 'bg-neonGreen/20 border-neonGreen/50 text-neonGreen hover:bg-neonGreen/30'
              }`}
            >
              {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>

            <div className="flex flex-col">
              <span className="text-xs text-gray-500 uppercase">Input Level</span>
              <div className="flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-gray-400" />
                <div className="w-24 h-2 bg-surfaceHighlight rounded-full overflow-hidden">
                  <div className="h-full bg-neonGreen transition-all duration-100" style={{ width: `${liveVolume}%` }} />
                </div>
              </div>
            </div>
          </div>

          {/* User Score Indicators */}
          <div className="flex items-center gap-6">
            <div className="text-right">
              <span className="text-xs text-gray-500 block">Streak</span>
              <span className="text-xl font-bold flex items-center gap-1 text-orange-400">
                <Flame className="w-5 h-5 fill-current" /> {streak} <span className="text-xs">x{multiplier}</span>
              </span>
            </div>
            <div className="text-right">
              <span className="text-xs text-gray-500 block">Score</span>
              <span className="text-2xl font-bold text-neonGreen font-mono">{currentScore}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Live Contestant Leaderboard */}
      <div className="w-full lg:w-80 flex flex-col gap-4">
        <div className="glass-panel p-6 flex flex-col gap-4 flex-grow">
          <div className="flex items-center gap-2 border-b border-surfaceHighlight pb-3">
            <Trophy className="text-neonGreen w-5 h-5" />
            <h3 className="font-bold">Contest Leaderboard</h3>
          </div>

          <div className="flex flex-col gap-3">
            {contestants.map((contestant, idx) => (
              <div
                key={contestant.id}
                className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                  contestant.id === '1'
                    ? 'bg-neonGreen/10 border-neonGreen/45 shadow-[0_0_10px_rgba(57,255,20,0.1)]'
                    : 'bg-surfaceHighlight/30 border-surfaceHighlight'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-gray-500 w-4">#{idx + 1}</span>
                  <div className="flex flex-col">
                    <span className="font-medium text-sm flex items-center gap-1">
                      {contestant.username}
                      {contestant.isSinging && (
                        <span className="w-2 h-2 rounded-full bg-neonGreen animate-ping inline-block ml-1" />
                      )}
                    </span>
                    <span className="text-xs text-gray-500">Streak: {contestant.streak}</span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="font-mono font-bold text-neonGreen">{contestant.score}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

