#!/usr/bin/env python3
import sys
import os
import json
import math
import collections

def hz_to_midi(freq):
    if freq <= 0:
        return 0
    # Acoustic log-conversion formula: n = 69 + 12 * log2(f/440)
    return round(69 + 12 * math.log2(freq / 440.0))

def quantize_pitch_map(pitch_map_raw, window_ms=100):
    """
    Apply logarithmic MIDI conversion, Mode-filtering over time windows,
    and sliding-window merging to form snapped MIDI note blocks.
    """
    if not pitch_map_raw:
        return []

    # 1. Map each raw frame to MIDI note numbers
    frames = []
    for entry in pitch_map_raw:
        time_sec = entry.get("time")
        freq = entry.get("freq", 0)
        amp = entry.get("amplitude", 0)
        
        midi_note = hz_to_midi(freq)
        # Only process frames with sound
        if midi_note > 0 and amp > 0.01:
            frames.append((time_sec, midi_note))

    if not frames:
        return []

    # Sort frames chronologically
    frames.sort(key=lambda x: x[0])
    start_time = frames[0][0]
    end_time = frames[-1][0]
    
    # 2. Window grouping (100ms intervals)
    window_size_sec = window_ms / 1000.0
    num_windows = int(math.ceil((end_time - start_time) / window_size_sec)) + 1
    
    windows = [[] for _ in range(num_windows)]
    for time_sec, note in frames:
        win_idx = int((time_sec - start_time) / window_size_sec)
        if win_idx < num_windows:
            windows[win_idx].append(note)

    # 3. Mode filter: Find the most frequent note in each window
    snapped_timeline = []
    for i, notes in enumerate(windows):
        window_start = start_time + (i * window_size_sec)
        if not notes:
            snapped_timeline.append((window_start, 0)) # Silence
            continue
            
        counter = collections.Counter(notes)
        mode_note, _ = counter.most_common(1)[0]
        snapped_timeline.append((window_start, mode_note))

    # 4. Sliding-window merge: combine identical sequential notes into block ranges
    merged_blocks = []
    current_note = 0
    block_start = 0.0
    
    for time_sec, note in snapped_timeline:
        if note != current_note:
            # Save previous note block
            if current_note > 0:
                duration = time_sec - block_start
                if duration >= 0.15: # Ignore ultra-short jitter blocks
                    merged_blocks.append({
                        "note": current_note,
                        "start": round(block_start, 3),
                        "duration": round(duration, 3)
                    })
            current_note = note
            block_start = time_sec
            
    # Save final block
    if current_note > 0:
        duration = (end_time + window_size_sec) - block_start
        if duration >= 0.15:
            merged_blocks.append({
                "note": current_note,
                "start": round(block_start, 3),
                "duration": round(duration, 3)
            })

    return merged_blocks

def main():
    if len(sys.argv) < 3:
        print("Usage: python pitch_quantizer.py <pitch_map_input.json> <track_id_or_output_path>", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1].strip('"')
    track_id_or_path = sys.argv[2].strip('"')

    if track_id_or_path.endswith('.json'):
        output_path = track_id_or_path
    else:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(script_dir)
        output_filename = f"{track_id_or_path}_pitch.json"
        output_path = os.path.join(project_root, "audio_cache", output_filename)

    if not os.path.exists(input_path):
        print(f"ERROR: Input file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    try:
        with open(input_path, 'r') as f:
            raw_data = json.load(f)

        snapped_blocks = quantize_pitch_map(raw_data)
        
        # Ensure output directory exists
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, 'w') as f:
            json.dump(snapped_blocks, f, indent=2)

        print(f"SUCCESS: Snapped {len(snapped_blocks)} melody note blocks saved to {output_path}")
        sys.exit(0)
    except Exception as e:
        print(f"CRITICAL ERROR in pitch_quantizer: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
