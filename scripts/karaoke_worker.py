#!/usr/bin/env python3
"""
Karaoke Worker — Stem Separation + Pitch Map Generator

Usage:
    python karaoke_worker.py <input_audio_path> <output_dir>

Outputs into <output_dir>:
    - vocals.wav
    - no_vocals.wav (instrumental)
    - pitch_map.json  (time-stamped frequency data from the vocal stem)

Requires: demucs, numpy, scipy (scipy ships with numpy)
Install:  pip install demucs
"""

import sys
import os
import json
import subprocess
import shutil
import tempfile
import traceback

def run_demucs(input_path, output_dir):
    """Run Demucs htdemucs model to separate stems."""
    # Use a temp dir for demucs output, then move what we need
    tmp_out = tempfile.mkdtemp(prefix="demucs_")

    try:
        cmd = [
            sys.executable, "-m", "demucs",
            "--two-stems", "vocals",   # Only split into vocals + no_vocals
            "-n", "htdemucs",          # High-quality model
            "--out", tmp_out,
            input_path
        ]

        print(f"[karaoke_worker] Running Demucs: {' '.join(cmd)}", flush=True)
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

        if result.returncode != 0:
            print(f"[karaoke_worker] Demucs stderr: {result.stderr}", flush=True)
            raise RuntimeError(f"Demucs failed with exit code {result.returncode}")

        # Demucs outputs to: <tmp_out>/htdemucs/<filename_without_ext>/vocals.wav, no_vocals.wav
        basename = os.path.splitext(os.path.basename(input_path))[0]
        stems_dir = os.path.join(tmp_out, "htdemucs", basename)

        if not os.path.isdir(stems_dir):
            # Try finding any directory under htdemucs
            htdemucs_dir = os.path.join(tmp_out, "htdemucs")
            if os.path.isdir(htdemucs_dir):
                subdirs = os.listdir(htdemucs_dir)
                if subdirs:
                    stems_dir = os.path.join(htdemucs_dir, subdirs[0])

        vocals_src = os.path.join(stems_dir, "vocals.wav")
        instrumental_src = os.path.join(stems_dir, "no_vocals.wav")

        if not os.path.exists(vocals_src):
            raise FileNotFoundError(f"Vocals stem not found at {vocals_src}")
        if not os.path.exists(instrumental_src):
            raise FileNotFoundError(f"Instrumental stem not found at {instrumental_src}")

        # Move to final output directory
        os.makedirs(output_dir, exist_ok=True)
        shutil.move(vocals_src, os.path.join(output_dir, "vocals.wav"))
        shutil.move(instrumental_src, os.path.join(output_dir, "no_vocals.wav"))

        print(f"[karaoke_worker] Stems saved to {output_dir}", flush=True)

    finally:
        # Cleanup temp directory
        shutil.rmtree(tmp_out, ignore_errors=True)


def generate_pitch_map(vocals_path, output_dir, window_ms=100):
    """
    Analyze the vocal stem with FFT to produce a time-stamped pitch map.

    Each entry: { "time": <seconds>, "freq": <Hz>, "amplitude": <0-1 normalized> }

    Uses a simple peak-frequency approach in the vocal range (80 Hz – 1100 Hz).
    """
    try:
        import numpy as np
        from scipy.io import wavfile
    except ImportError:
        print("[karaoke_worker] numpy/scipy not available — skipping pitch map.", flush=True)
        # Write an empty pitch map so the API still has something to return
        with open(os.path.join(output_dir, "pitch_map.json"), "w") as f:
            json.dump([], f)
        return

    print(f"[karaoke_worker] Generating pitch map from {vocals_path}...", flush=True)

    sample_rate, data = wavfile.read(vocals_path)

    # Convert to mono if stereo
    if len(data.shape) > 1:
        data = data.mean(axis=1)

    # Normalize to float [-1, 1]
    if data.dtype == np.int16:
        data = data.astype(np.float64) / 32768.0
    elif data.dtype == np.int32:
        data = data.astype(np.float64) / 2147483648.0
    elif data.dtype == np.float32 or data.dtype == np.float64:
        pass  # Already float
    else:
        data = data.astype(np.float64) / np.iinfo(data.dtype).max

    window_samples = int(sample_rate * window_ms / 1000)
    pitch_map = []

    # Vocal frequency range (Hz)
    freq_min = 80
    freq_max = 1100

    total_windows = len(data) // window_samples
    for i in range(total_windows):
        start = i * window_samples
        end = start + window_samples
        chunk = data[start:end]

        # Apply Hanning window to reduce spectral leakage
        windowed = chunk * np.hanning(len(chunk))

        # FFT
        fft_result = np.fft.rfft(windowed)
        magnitudes = np.abs(fft_result)
        freqs = np.fft.rfftfreq(len(windowed), d=1.0 / sample_rate)

        # Filter to vocal range
        mask = (freqs >= freq_min) & (freqs <= freq_max)
        vocal_freqs = freqs[mask]
        vocal_mags = magnitudes[mask]

        if len(vocal_mags) == 0:
            continue

        # Find the dominant frequency
        peak_idx = np.argmax(vocal_mags)
        peak_freq = float(vocal_freqs[peak_idx])
        peak_amp = float(vocal_mags[peak_idx])

        # Normalize amplitude (relative to max possible for this window size)
        max_possible = window_samples / 2.0  # theoretical max for a pure sine
        normalized_amp = min(peak_amp / max_possible, 1.0) if max_possible > 0 else 0.0

        # Only include entries with meaningful amplitude (filter silence)
        if normalized_amp > 0.01:
            time_sec = round(start / sample_rate, 3)
            pitch_map.append({
                "time": time_sec,
                "freq": round(peak_freq, 1),
                "amplitude": round(normalized_amp, 4)
            })

    out_path = os.path.join(output_dir, "pitch_map.json")
    with open(out_path, "w") as f:
        json.dump(pitch_map, f)

    print(f"[karaoke_worker] Pitch map generated: {len(pitch_map)} data points → {out_path}", flush=True)


def main():
    if len(sys.argv) < 3:
        print("Usage: python karaoke_worker.py <input_audio_path> <output_dir>", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_dir = sys.argv[2]

    if not os.path.exists(input_path):
        print(f"[karaoke_worker] ERROR: Input file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    try:
        # Step 1: Stem separation
        run_demucs(input_path, output_dir)

        # Step 2: Pitch map from vocals
        vocals_path = os.path.join(output_dir, "vocals.wav")
        if os.path.exists(vocals_path):
            generate_pitch_map(vocals_path, output_dir)
        else:
            print("[karaoke_worker] WARNING: vocals.wav not found, skipping pitch map.", flush=True)

        # Write a completion marker
        with open(os.path.join(output_dir, ".done"), "w") as f:
            f.write("ok")

        print("[karaoke_worker] ✅ Karaoke preparation complete.", flush=True)
        sys.exit(0)

    except Exception as e:
        traceback.print_exc()
        # Write error marker
        with open(os.path.join(output_dir, ".error"), "w") as f:
            f.write(str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
