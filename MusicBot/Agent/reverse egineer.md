# 🔄 LRCLIB-Anchored Audio Engine Integration Blueprint

This document details the complete structural rerouting of the Voxaria Audio Engine. By utilizing LRCLIB as our absolute source of truth for standard studio audio track runtimes, the system eliminates music video dialogue padding, extended intros, and compilation data skew. MusicBrainz is repurposed to function strictly as our high-fidelity visual asset provider.

## 🧠 The Reversed Cross-Validation Algorithm Flow

The resolution pipeline operates as a sequence of targeted single-responsibility stages:

1. **Query Parsing Stage:** The entry hook splits raw text queries into precise Title and Artist text components.
2. **The Duration Anchor (LRCLIB Query):** The bot hits LRCLIB’s unauthenticated search index. Since synced `.lrc` lyrics are tracked to standard streaming album audio edits (Spotify, Apple Music, Deezer), this search isolates the clean, true track duration, bypassing padded music video variants.
3. **The Metadata & Artwork Harvest (MusicBrainz Query):** The bot queries MusicBrainz for the matching track and evaluates its return matrix. Instead of counting popularities blindly, it directly targets the recording whose length falls within a strict $\pm3\text{-second}$ window of our LRCLIB anchor.
4. **The Visual Link Construction (Cover Art Archive):** The matching release MBID is instantly passed to the Cover Art Archive to grab optimized, fast-loading thumbnails.
5. **The Stream Filter (YouTube Scraper):** The clean LRCLIB duration anchor is handed off to the YouTube resolver. The first video result that matches the target runtime within a tight $\pm3\text{-second}$ delta is selected for streaming.

---

## 🗺️ Visual Architecture Pipeline

```mermaid
graph TD
    %% Input Layer
    In([User Command / Query Input]) --> Parser[TrackManager._resolveTextQuery]
    
    %% LRCLIB Anchor Layer
    subgraph Duration Anchor Layer (LRCLIB API)
        Parser --> LRCQuery["HTTP GET: api.lrclib.net/api/search"]
        LRCQuery --> LRCEval{Find Track with Synced Lyrics}
        LRCEval -->|Found / Default| LockAnchor[Lock Clean Studio Duration Anchor]
    end

    %% MusicBrainz Metadata Layer
    subgraph Metadata Brain (MusicBrainz API)
        LockAnchor --> MBQuery["HTTP GET: musicbrainz.org/ws/2/recording/"]
        MBQuery --> LoopMB{Loop Through Recording Array}
        
        LoopMB --> MatchDelta{"Is |MB_duration - LRCLIB_anchor| <= 3s?"}
        
        MatchDelta -->|No: Disqualify Video/Edit Noise| NextMB[Evaluate Next Record]
        NextMB --> LoopMB
        
        MatchDelta -->|Yes: Track Located| FetchCA["Extract Release MBID Tokens"]
    end

    %% Cover Art Layer
    subgraph Visual Asset Engine (Cover Art Archive)
        FetchCA --> CAQuery["HTTP GET: coverartarchive.org/release/.../front-250"]
        CAQuery --> CACheck{200 OK Response?}
        CACheck -->|Yes| ApplyPremium[Attach Premium Studio Artwork]
        CACheck -->|No: 404 Error| CAGroup["HTTP GET: coverartarchive.org/release-group/.../front-250"]
        CAGroup --> CAGroupCheck{200 OK Response?}
        CAGroupCheck -->|Yes| ApplyPremium
    end

    %% Audio Harvesting Layer
    ApplyPremium & CACheck -->|No: Hard Fallback| YTQuery["Search YouTube Feed: 'Artist - Title Official Audio'"]
    CAGroupCheck -->|No: Hard Fallback| YTQuery
    
    subgraph Stream Selection Filter (YouTube.js)
        YTQuery --> YTResults["Fetch Top 5 Stream Objects"]
        YTResults --> LoopYT{Loop Through Streams}
        
        LoopYT --> YTDelta{"Is |YT_duration - LRCLIB_anchor| <= 3s?"}
        YTDelta -->|No: Drop Video Intro Versions| NextYT[Evaluate Next Video]
        NextYT --> LoopYT
        
        YTDelta -->|Yes: Exact Studio Cut Matched| LockStream[Lock Stream Buffer URL]
    end

    %% Execution Handoff
    LockStream --> CoreHandoff[Pass Track Object to AudioEngineCore.js]
    CoreHandoff --> Playback([PlaybackController Pipes PCM Audio to Voice Channel])
```
