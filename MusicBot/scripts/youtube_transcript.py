import sys
import json
import re
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No video ID provided."}))
        sys.exit(1)
        
    video_id = sys.argv[1]
    
    try:
        # Fetch the transcript list
        transcript_list = YouTubeTranscriptApi().list(video_id)
        
        # Prioritize English variants, fallback to any available if needed
        try:
            transcript_obj = transcript_list.find_transcript(['en', 'en-US', 'en-GB'])
        except NoTranscriptFound:
            # If English is not found, get the first available transcript
            transcript_obj = next(iter(transcript_list))
            
        transcript = transcript_obj.fetch()
        
        final_lyrics = ""
        previous_end = 0.0
        
        for i, line in enumerate(transcript):
            text = line.get('text', '').strip()
            start = line.get('start', 0.0)
            duration = line.get('duration', 0.0)
            
            if not text:
                continue
                
            # Strip bracketed timestamps inside subtitle text
            text = re.sub(r'\[\d+:\d+(?:\.\d+)?\]', '', text).strip()
            
            if not text: # skip if it was only a timestamp
                continue
            
            minutes = int(start // 60)
            seconds = int(start % 60)
            hundredths = int(round((start % 1) * 100))
            lrc_timestamp = f"[{minutes:02d}:{seconds:02d}.{hundredths:02d}]"
            
            if i > 0:
                gap = start - previous_end
                if gap > 3.0:
                    final_lyrics += "\n\n"
                else:
                    final_lyrics += "\n"
            
            final_lyrics += f"{lrc_timestamp} {text}"
            previous_end = start + duration
            
        print(json.dumps({"success": True, "lyrics": final_lyrics.strip()}))
        
    except (TranscriptsDisabled, NoTranscriptFound) as e:
        print(json.dumps({"success": False, "error": str(e)}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    main()
