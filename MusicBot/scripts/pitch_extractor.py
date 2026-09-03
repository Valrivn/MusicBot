import sys
import os
import json
import numpy as np
import yt_dlp
import librosa

# 🛡️ THE SILENCER: Forces debug logs to the background so they don't break Node.js JSON parsing
def log(msg):
    print(msg, file=sys.stderr)

# 📢 SAFE AUDIT LOGGER: Prints to terminal without breaking Node.js JSON parser
def audit_log(message):
    log(f"📡 [PYTHON AUDIT] {message}")

def extract_melody():
    audit_log("Karaoke engine booted. Checking arguments...")
    
    if len(sys.argv) < 3:
        audit_log("CRITICAL: Missing URL or Clean ID.")
        print(json.dumps({"error": "Missing required command arguments."}))
        sys.exit(1)

    raw_url = sys.argv[1]
    clean_id = sys.argv[2]
    
    # 🔄 THE SPOTIFY URL FIX: If it's a Spotify link, force yt-dlp to search YouTube
    video_target = raw_url
    if "spotify.com" in raw_url or "spotify:" in raw_url:
        audit_log(f"Detected Spotify URL. Rerouting to YouTube search using ID/URL: {raw_url}")
        # yt-dlp natively supports 'ytsearch1:' to grab the first audio match of a string
        video_target = f"ytsearch1:{raw_url}"
    else:
        audit_log(f"Using direct URL: {video_target}")

    # 1. Force Python to find the exact folder it is currently sitting in
    SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

    # 2. Hardcode the exact paths to FFmpeg and the output audio file using clean_id
    FFMPEG_PATH = os.path.join(SCRIPT_DIR, "ffmpeg.exe") 
    OUTPUT_BASE = os.path.join(SCRIPT_DIR, f"temp_{clean_id}") 
    FINAL_AUDIO_PATH = OUTPUT_BASE + ".wav"

    audit_log(f"Forcing yt-dlp to use FFmpeg at: {FFMPEG_PATH}")

    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': OUTPUT_BASE,
        'ffmpeg_location': FFMPEG_PATH, # <--- THIS IS THE MAGIC FIX
        'http_chunk_size': 1048576,
        'headers': {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
        },
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'wav',
            'preferredquality': '192',
        }],
        # 🤫 SILENCE YT-DLP COMPLETELY
        'quiet': True,
        'noprogress': True,
        'no_warnings': True
    }

    try:
        audit_log("Initiating audio stream download via yt-dlp...")
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([video_target])
            
        if not os.path.exists(FINAL_AUDIO_PATH):
            # Check if it was saved with a different extension fallback
            fallback_path = FINAL_AUDIO_PATH.replace('.wav', '.opus')
            if os.path.exists(fallback_path):
                FINAL_AUDIO_PATH = fallback_path

        if not os.path.exists(FINAL_AUDIO_PATH):
            raise FileNotFoundError(f"yt-dlp finished, but no audio file was found at: {FINAL_AUDIO_PATH}")

        # Load vocal isolation tool Spleeter
        audit_log("Running Spleeter 2stems vocal separation on downloaded audio...")
        try:
            from spleeter.separator import Separator
            separator = Separator('spleeter:2stems')
            # spleeter requires an output directory and outputs files named <out_dir>/<filename_no_ext>/vocals.wav
            spleeter_out_dir = os.path.join(SCRIPT_DIR, f"spleeter_{clean_id}")
            separator.separate(FINAL_AUDIO_PATH, spleeter_out_dir)
            
            # The separated vocal track is saved inside vocals.wav
            filename_no_ext = os.path.splitext(os.path.basename(FINAL_AUDIO_PATH))[0]
            vocals_path = os.path.join(spleeter_out_dir, filename_no_ext, "vocals.wav")
            
            if os.path.exists(vocals_path):
                # Replace our input audio path with isolated vocals
                # Move to standard location and remove the spleeter temp directory
                target_vocals = OUTPUT_BASE + "_vocals.wav"
                import shutil
                shutil.move(vocals_path, target_vocals)
                shutil.rmtree(spleeter_out_dir, ignore_errors=True)
                
                # Delete the downloaded original polyphonic file
                if os.path.exists(FINAL_AUDIO_PATH):
                    os.remove(FINAL_AUDIO_PATH)
                FINAL_AUDIO_PATH = target_vocals
                audit_log(f"Vocal separation complete. Isolated vocals loaded at {FINAL_AUDIO_PATH}")
            else:
                audit_log("Spleeter vocals output file missing. Falling back to mixed audio...")
        except Exception as sep_err:
            audit_log(f"Spleeter execution failed ({sep_err}). Falling back to mixed audio...")

        audit_log(f"Loading {FINAL_AUDIO_PATH} into Librosa matrix...")
        # Load audio (downsample to 22050Hz for faster processing)
        y, sr = librosa.load(FINAL_AUDIO_PATH, sr=22050)
        
        audit_log("Running pitch extraction (autocorrelation fmin=75, fmax=600)...")
        pitches, magnitudes = librosa.piptrack(y=y, sr=sr, fmin=75.0, fmax=600.0)
        
        melody_line = []
        for t in range(pitches.shape[1]):
            col_pitches = pitches[:, t]
            col_magnitudes = magnitudes[:, t]
            
            best_pitch = 0.0
            best_magnitude = -1.0
            
            for idx in range(len(col_pitches)):
                p = col_pitches[idx]
                m = col_magnitudes[idx]
                # Filter down to human singing boundaries and magnitude gate
                if 75.0 <= p <= 600.0 and m >= 0.15:
                    if m > best_magnitude:
                        best_magnitude = m
                        best_pitch = p
            
            if best_pitch > 0:
                melody_line.append(float(np.round(best_pitch, 2)))
            else:
                melody_line.append(0.0)

        # Cleanup vocals/temporary files
        audit_log("Scrubbing temporary files...")
        if os.path.exists(FINAL_AUDIO_PATH):
            os.remove(FINAL_AUDIO_PATH)

        audit_log(f"SUCCESS: Pitch map generated with {len(melody_line)} frames.")
        
        # 🎁 THE ONLY STANDARD PRINT: Returns clean JSON to Node.js
        print(json.dumps({"success": True, "pitchMap": melody_line}))
        
    except Exception as err:
        audit_log(f"CRITICAL ERROR: {str(err)}")
        if os.path.exists(FINAL_AUDIO_PATH):
            os.remove(FINAL_AUDIO_PATH)
            
        print(json.dumps({"error": str(err)}))
        sys.exit(1)

if __name__ == '__main__':
    extract_melody()
