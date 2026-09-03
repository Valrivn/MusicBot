import sys
import json
import re
from ytmusicapi import YTMusic

def get_lyrics_for_id(yt, video_id):
    try:
        playlist = yt.get_watch_playlist(video_id)
        lyrics_id = playlist.get('lyrics')
        if not lyrics_id:
            return None
        
        # Try retrieving timed lyrics first
        try:
            lyrics_data = yt.get_lyrics(lyrics_id, timestamps=True)
            if lyrics_data and lyrics_data.get('lyrics') and lyrics_data.get('hasTimestamps'):
                return lyrics_data
        except Exception:
            pass
            
        # Fallback to plain lyrics
        return yt.get_lyrics(lyrics_id, timestamps=False)
    except Exception:
        return None

def format_lrc(lyrics_list):
    lrc_lines = []
    for line in lyrics_list:
        start_time = line.start_time
        # Convert milliseconds to standard [mm:ss.xx]
        minutes = int(start_time // 60000)
        seconds = int((start_time % 60000) // 1000)
        hundredths = int((start_time % 1000) // 10)
        lrc_lines.append(f"[{minutes:02d}:{seconds:02d}.{hundredths:02d}] {line.text}")
    return "\n".join(lrc_lines)

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Prerequisites: videoId and title arguments required."}))
        sys.exit(1)
        
    video_id = sys.argv[1]
    title = sys.argv[2]
    artist = sys.argv[3] if len(sys.argv) > 3 else ""
    
    yt = YTMusic()
    
    # 1. Try direct video ID if it's valid
    if video_id and len(video_id) == 11 and not " " in video_id:
        res = get_lyrics_for_id(yt, video_id)
        if res and res.get('lyrics'):
            has_timestamps = res.get('hasTimestamps', False)
            lyrics_content = format_lrc(res['lyrics']) if has_timestamps else res['lyrics']
            print(json.dumps({
                "success": True, 
                "lyrics": lyrics_content, 
                "synced": has_timestamps,
                "source": "YouTube Music (Synced)" if has_timestamps else "YouTube Music"
            }))
            sys.exit(0)
            
    # 2. Search fallback using title and artist
    query = f"{title} {artist}".strip()
    try:
        search_results = yt.search(query, filter="songs")
        if search_results:
            song_id = search_results[0].get('videoId')
            if song_id:
                res = get_lyrics_for_id(yt, song_id)
                if res and res.get('lyrics'):
                    has_timestamps = res.get('hasTimestamps', False)
                    lyrics_content = format_lrc(res['lyrics']) if has_timestamps else res['lyrics']
                    print(json.dumps({
                        "success": True, 
                        "lyrics": lyrics_content, 
                        "synced": has_timestamps,
                        "source": "YouTube Music (Synced)" if has_timestamps else "YouTube Music"
                    }))
                    sys.exit(0)
                    
        print(json.dumps({"success": False, "error": "No lyrics found on YouTube Music."}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    main()
