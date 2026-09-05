const YouTube = require('../YouTube');
const SoundCloud = require('../SoundCloud');
const DirectLink = require('../DirectLink');
const MusicBrainzClient = require('../musicbrainz/MusicBrainzClient');
const CoverArtResolver = require('../musicbrainz/CoverArtResolver');
const LrclibClient = require('../lrclib/LrclibClient');
const StreamResolver = require('./StreamResolver');
const LanguageManager = require('../LanguageManager');
const crypto = require('crypto');
const AuditLog = require('../AuditLog');
const Genius = require('genius-lyrics');
const config = require('../../config');
const youtubedl = require('youtube-dl-exec');
const trackCache = require('../trackCache');

class TrackManager {
    constructor(player) {
        this.player = player;
        this.queue = [];
        this.history = [];
        this.previousTracks = this.history; // Alias for compatibility
        this.currentTrack = null;
        this.isProcessingRequest = false;
        this.geniusClient = new Genius.Client(config.genius?.clientId || '');
    }

    /**
     * Resolves and adds a track to the queue or sets it as current track if none is playing
     */
    async addTrack(query, requestedBy, platform = 'auto') {
        if (this.isProcessingRequest) return { status: "ignored" };
        this.isProcessingRequest = true;

        try {
            let richTrack = null;
            if (query && typeof query === 'object') {
                richTrack = query;
                console.log(`[TrackManager] Adding pre-resolved track: "${richTrack.title}", platform: "${richTrack.platform}"`);

                if (richTrack.platform === 'youtube' && !richTrack.url) {
                    console.log(`[TrackManager] Pre-resolved YouTube track missing URL, resolving...`);
                    const guildId = this.player.guild.id;
                    const resolved = await this._resolveTextQuery(richTrack.title, guildId);
                    if (resolved) {
                        richTrack = { ...richTrack, ...resolved };
                    } else {
                        const errorMsg = await LanguageManager.getTranslation(this.player.guild.id, 'musicplayer.no_results_found');
                        return { success: false, message: errorMsg };
                    }
                }
            } else {
                const detectedPlatform = StreamResolver.detectPlatform(query);
                console.log(`[TrackManager] Detected platform: "${detectedPlatform}" for query: "${query}"`);
                const guildId = this.player.guild.id;

                if (detectedPlatform === 'youtube' && YouTube.isPlaylist(query)) {
                    return await this._resolveYouTubePlaylist(query, guildId, requestedBy);
                }

                if (detectedPlatform === 'youtube') {
                    richTrack = await this._resolveYouTubeTrack(query, guildId);
                } else if (detectedPlatform === 'soundcloud') {
                    richTrack = await this._resolveSoundCloudTrack(query, guildId);
                } else if (detectedPlatform === 'direct') {
                    richTrack = await this._resolveDirectTrack(query, guildId);
                } else {
                    // Text query - use MusicBrainz as canonical metadata source (Pivot.md §3)
                    richTrack = await this._resolveTextQuery(query, guildId);
                }
            }

            if (!richTrack) {
                const errorMsg = await LanguageManager.getTranslation(this.player.guild.id, 'musicplayer.no_results_found');
                return { success: false, message: errorMsg };
            }

            richTrack.requestedBy = requestedBy;
            richTrack.addedAt = Date.now();

            // LAYER 5: UI OVERRIDE & STATE DISPATCH
            if (this.player.audioEngine.isPlaying || this.currentTrack) {
                this.queue.push(richTrack);
                this.player.broadcastStateUpdate();
            } else {
                this.currentTrack = richTrack;
                this.player.broadcastStateUpdate();
                await this.player.play(null, 0);
            }

            // Append to audit log
            const requesterId = richTrack.requestedBy?.id || '1';
            const requesterTag = richTrack.requestedBy?.tag || richTrack.requestedBy?.username || 'Dashboard User';
            const avatar = richTrack.requestedBy?.avatar ? `https://cdn.discordapp.com/avatars/${requesterId}/${richTrack.requestedBy.avatar}.png` : '';
            const logId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
            
            AuditLog.append({
                id: logId,
                title: richTrack.title,
                url: richTrack.url,
                requesterId: requesterId,
                requesterTag: requesterTag,
                requesterAvatar: avatar,
                timestamp: new Date().toISOString()
            }).catch(err => console.error('Failed to append audit log:', err));

            await this.player.persistState('queue-update');
            return {
                success: true,
                tracks: [richTrack],
                isPlaylist: false,
                position: this.queue.length
            };

        } catch (error) {
            console.error('Error adding track:', error);
            const errorMsg = await LanguageManager.getTranslation(this.player.guild.id, 'musicplayer.error_adding_track');
            return { success: false, message: errorMsg };
        } finally {
            this.isProcessingRequest = false;
        }
    }

    /**
     * Resolve text query using LRCLIB-Anchored Pipeline:
     * 1. Parse query → Title + Artist
     * 2. LRCLIB Duration Anchor → Fetch synced lyrics, lock clean studio duration
     * 2b. YouTube Link Fallback (if LRCLIB fails & input is YT URL) → Metadata + Transcript + YT Duration Anchor
     * 3. MusicBrainz Metadata Harvest → Match recordings within ±3s of anchor
     * 4. Cover Art Archive → Fetch premium artwork (release → release-group fallback)
     * 5. YouTube Stream Filter → Filter by ±3s of anchor
     */
    async _resolveTextQuery(query, guildId) {
        let lrclibDurationMs = 0;
        let lrclibAnchor = null;
        let refTitle = '';
        let refArtist = '';
        let refDurationMs = 0;
        let refAlbumCover = null;
        let mbRecord = null;
        let youtubeFallback = false;
        let youtubeTranscript = null;

        // Stage 0: Cache Check
        const tempParsed = this._parseTextQuery(query);
        const tempTitle = tempParsed.title;
        const tempArtist = tempParsed.artist;
        const anchorDurationSec = Math.round((lrclibDurationMs > 0 ? lrclibDurationMs : 0) / 1000);
        const cacheKey = trackCache.normalizeKey(tempTitle, tempArtist, anchorDurationSec);
        const cached = await trackCache.get(cacheKey);
        if (cached) {
            console.log(`[TrackCache] HIT: "${tempTitle}" - "${tempArtist}"`);
            return { ...cached, url: null };
        }

        // Stage 1: Query Parsing
        try {
            const parsed = this._parseTextQuery(query);
            refTitle = parsed.title;
            refArtist = parsed.artist;
            console.log(`[Pipeline] Stage 1 - Query Parsed: Title="${refTitle}", Artist="${refArtist}"`);
        } catch (err) {
            console.error(`[Pipeline] Stage 1 - Query Parsing failed:`, err.message);
            return null;
        }

        // Stage 2: LRCLIB Duration Anchor (with error handling)
        try {
            if (refArtist) {
                lrclibAnchor = await LrclibClient.searchTrack(refTitle, refArtist);
            }
            
            if (lrclibAnchor && lrclibAnchor.durationMs) {
                lrclibDurationMs = lrclibAnchor.durationMs;
                console.log(`[Pipeline] Stage 2 - LRCLIB Anchor Locked: ${lrclibDurationMs}ms (${(lrclibDurationMs/1000).toFixed(2)}s) ${lrclibAnchor.hasSyncedLyrics ? '✓ Synced Lyrics' : ''}`);
            } else {
                console.log(`[Pipeline] Stage 2 - LRCLIB: No synced lyrics found, proceeding without duration anchor`);
            }
        } catch (err) {
            console.error(`[Pipeline] Stage 2 - LRCLIB error (non-fatal):`, err.message);
        }

        // Stage 2b: YouTube Link Fallback (if LRCLIB anchor invalid AND input is a YouTube URL)
        const isYouTubeUrl = YouTube.isYouTubeURL(query);
        const anchorInvalid = lrclibDurationMs === 0 || !lrclibAnchor?.hasSyncedLyrics;
        
        if (anchorInvalid && isYouTubeUrl) {
            console.log(`[Pipeline] Stage 2b - YouTube Link Fallback triggered`);
            youtubeFallback = true;
            
            try {
                const ytMeta = await YouTube.getVideoMetadata(query);
                if (ytMeta) {
                    refTitle = ytMeta.title;
                    refArtist = ytMeta.artist;
                    refDurationMs = ytMeta.durationMs;
                    refAlbumCover = ytMeta.thumbnail;
                    
                    console.log(`[Pipeline] Stage 2b - YT Metadata: "${refTitle}" - "${refArtist}" (${refDurationMs}ms)`);
                    
                    // Try to extract Artist - Title for MusicBrainz cover art lookup
                    const parsedYT = this._parseYouTubeTitle(ytMeta.title);
                    if (parsedYT) {
                        console.log(`[Pipeline] Stage 2b - Parsed YT Title: Artist="${parsedYT.artist}", Title="${parsedYT.title}"`);
                    }
                    
                    // Fetch transcript for lyrics
                    if (ytMeta.videoId) {
                        youtubeTranscript = await YouTube.getTranscript(ytMeta.videoId);
                        if (youtubeTranscript) {
                            console.log(`[Pipeline] Stage 2b - Transcript: ${youtubeTranscript.hasSynced ? 'Synced' : 'Plain'} (${youtubeTranscript.language})`);
                        }
                    }
                } else {
                    console.log(`[Pipeline] Stage 2b - Failed to fetch YouTube metadata`);
                }
            } catch (err) {
                console.error(`[Pipeline] Stage 2b - YouTube fallback error:`, err.message);
            }
        }

        // Stage 3: MusicBrainz Metadata Harvest (filtered by anchor)
        // Use LRCLIB anchor if available, else YouTube duration if fallback triggered, else 0
        const anchorDurationMs = lrclibDurationMs > 0 ? lrclibDurationMs : (youtubeFallback ? refDurationMs : 0);
        
        try {
            mbRecord = await MusicBrainzClient.searchRecordingWithDurationAnchor(refTitle, refArtist, anchorDurationMs);
            if (!mbRecord) {
                console.log(`[Pipeline] Stage 3 - MusicBrainz: No matching recording found`);
                if (!youtubeFallback) {
                    // Don't return null - continue to Stage 3b for YouTube search fallback
                    console.log(`[Pipeline] Stage 3 - Proceeding to YouTube search fallback for text query`);
                }
                // If YouTube fallback, continue without MB record
            } else {
                refTitle = mbRecord.title;
                refArtist = mbRecord.artist;
                refDurationMs = mbRecord.durationMs || refDurationMs;
                console.log(`[Pipeline] Stage 3 - MusicBrainz: "${refTitle}" - "${refArtist}" (${refDurationMs}ms)`);
            }
        } catch (err) {
            console.error(`[Pipeline] Stage 3 - MusicBrainz error:`, err.message);
            if (!youtubeFallback) {
                console.log(`[Pipeline] Stage 3 - Proceeding to YouTube search fallback for text query`);
            }
        }

        // Stage 3b: YouTube Search Fallback for text queries (when MusicBrainz fails)
        // Use raw query string, pick #1 result, extract duration/thumbnail, fetch transcript
        let stage3bVideoId = null;
        let stage3bVideoUrl = null;
        if (!mbRecord && !youtubeFallback) {
            console.log(`[Pipeline] Stage 3b - YouTube search fallback for: "${query}"`);
            try {
                const ytResults = await YouTube.search(query, 1, guildId);
                if (ytResults && ytResults.length > 0) {
                    const yt = ytResults[0];
                    refDurationMs = yt.durationMs || yt.duration * 1000 || 0;
                    refAlbumCover = yt.thumbnail;
                    anchorDurationMs = refDurationMs;
                    youtubeFallback = true;
                    stage3bVideoId = yt.id;
                    stage3bVideoUrl = yt.url || yt.webpage_url || (yt.id ? `https://www.youtube.com/watch?v=${yt.id}` : null);
                    console.log(`[Pipeline] Stage 3b - YouTube result: "${yt.title}" (${refDurationMs}ms) ID: ${yt.id}`);
                    
                    // Fetch YouTube transcript for lyrics
                    if (yt.id) {
                        youtubeTranscript = await YouTube.getTranscript(yt.id);
                        if (youtubeTranscript) {
                            console.log(`[Pipeline] Stage 3b - Transcript: ${youtubeTranscript.hasSynced ? 'Synced' : 'Plain'} (${youtubeTranscript.language})`);
                        }
                    }
                }
            } catch (err) {
                console.error(`[Pipeline] Stage 3b - YouTube search fallback error:`, err.message);
            }
        }

        // Stage 3c: Genius Lyrics Fallback (when no LRCLIB and no YouTube transcript)
        if (!lrclibAnchor && !youtubeTranscript) {
            console.log(`[Pipeline] Stage 3c - Genius lyrics fallback for: "${query}"`);
            try {
                const searches = await this.geniusClient.songs.search(query);
                if (searches && searches.length > 0) {
                    const lyrics = await searches[0].lyrics();
                    if (lyrics) {
                        youtubeTranscript = {
                            plain: lyrics,
                            synced: '',
                            hasSynced: false,
                            source: 'Genius',
                            language: 'en'
                        };
                        console.log(`[Pipeline] Stage 3c - Genius lyrics found`);
                    }
                }
            } catch (err) {
                console.error(`[Pipeline] Stage 3c - Genius lyrics fallback error:`, err.message);
            }
        }

        // Stage 4: Cover Art Archive (Premium Visual Assets) - with fallback
        try {
            let premiumArt = null;
            if (mbRecord) {
                premiumArt = await CoverArtResolver.resolveCoverArt(mbRecord.releaseMbid, mbRecord.releaseGroupMbid, '250');
            } else if (youtubeFallback) {
                // If we already have a YouTube thumbnail from Stage 3b (text query fallback), use it
                if (refAlbumCover) {
                    console.log(`[Pipeline] Stage 4 - Using YouTube thumbnail from Stage 3b`);
                } else {
                    // Try MusicBrainz with parsed YouTube title if regex succeeded (Stage 2b URL fallback)
                    const parsedYT = this._parseYouTubeTitle(query.includes('youtube') ? refTitle : query);
                    if (parsedYT) {
                        const mbFallback = await MusicBrainzClient.searchRecording(parsedYT.title, parsedYT.artist);
                        if (mbFallback) {
                            premiumArt = await CoverArtResolver.resolveCoverArt(mbFallback.releaseMbid, mbFallback.releaseGroupMbid, '250');
                        }
                    }
                }
            }
            if (premiumArt) refAlbumCover = premiumArt;
            console.log(`[Pipeline] Stage 4 - Cover Art: ${refAlbumCover ? '✓ Premium artwork resolved' : '✗ No premium artwork, will use YouTube thumbnail'}`);
        } catch (err) {
            console.error(`[Pipeline] Stage 4 - Cover Art error (non-fatal):`, err.message);
        }

        // Stage 5: YouTube Stream Filter (strict ±3s against anchor)
        const targetDurationMs = anchorDurationMs > 0 ? anchorDurationMs : refDurationMs;
        
        // If we have a video ID from Stage 3b (text query fallback), use it directly
        if (stage3bVideoId && stage3bVideoUrl) {
            console.log(`[Pipeline] Stage 5 - Using Stage 3b video ID: ${stage3bVideoId}`);
            try {
                const streamInfo = await YouTube.getStream(stage3bVideoUrl, guildId, 0);
                if (streamInfo && streamInfo.url) {
                    console.log(`[Pipeline] Stage 5 - Direct stream resolved for Stage 3b video`);
                    return {
                        url: streamInfo.url,
                        rawUrl: streamInfo.rawUrl,
                        title: refTitle,
                        artist: refArtist,
                        lyricArtist: refArtist,
                        duration: Math.floor(refDurationMs / 1000),
                        durationMs: refDurationMs,
                        albumCover: refAlbumCover,
                        thumbnail: refAlbumCover,
                        platform: 'youtube',
                        originalPlatform: 'text',
                        lrclibAnchor: lrclibDurationMs > 0,
                        youtubeFallback: true,
                        lyrics: youtubeTranscript,
                        id: stage3bVideoId
                    };
                }
            } catch (err) {
                console.error(`[Pipeline] Stage 5 - Direct stream error for Stage 3b video:`, err.message);
            }
        }
        
        try {
            const matchedTrack = await YouTube.resolveMetadataTrack(refTitle, [refArtist], targetDurationMs, refAlbumCover, guildId);
            if (matchedTrack && matchedTrack.url) {
                const drift = Math.abs((matchedTrack.durationMs || 0) - targetDurationMs) / 1000;
                const isLocked = drift <= 3;
                console.log(`[Pipeline] Stage 5 - YouTube Match: "${matchedTrack.title}" | Drift: ${drift.toFixed(2)}s (Threshold: ≤3.0s) ${isLocked ? '✓ LOCKED' : '⚠ OUT OF BOUNDS'}`);
                
                // Log duration matching accuracy metric
                if (lrclibDurationMs > 0) {
                    const mbDrift = Math.abs(refDurationMs - lrclibDurationMs) / 1000;
                    console.log(`[Metrics] Duration Accuracy: LRCLIB=${(lrclibDurationMs/1000).toFixed(2)}s | MB=${(refDurationMs/1000).toFixed(2)}s | Drift=${mbDrift.toFixed(2)}s | YT=${(matchedTrack.durationMs/1000).toFixed(2)}s`);
                }
                
                const richMetadata = {
                    ...matchedTrack,
                    title: refTitle,
                    artist: refArtist,
                    lyricArtist: matchedTrack.artist || refArtist,
                    duration: Math.floor(refDurationMs / 1000),
                    durationMs: refDurationMs,
                    albumCover: refAlbumCover,
                    thumbnail: refAlbumCover,
                    platform: 'youtube',
                    originalPlatform: youtubeFallback ? 'youtube-url' : 'text',
                    lrclibAnchor: lrclibDurationMs > 0,
                    youtubeFallback,
                    lyrics: youtubeTranscript,
                    mbid: mbRecord?.mbid,
                    releaseMbid: mbRecord?.releaseMbid,
                    releaseGroupMbid: mbRecord?.releaseGroupMbid,
                    popularityCount: mbRecord?.popularityCount || 0,
                    majorLabel: mbRecord?.majorLabel || false
                };
                const tier = (mbRecord?.popularityCount >= 10 || mbRecord?.majorLabel) ? 'mainstream' : 'indie';
                const cacheKeySet = trackCache.normalizeKey(refTitle, refArtist, Math.round(refDurationMs / 1000));
                await trackCache.set(cacheKeySet, richMetadata, tier);
                return { ...richMetadata, url: null };
            }
        } catch (err) {
            console.error(`[Pipeline] Stage 5 - YouTube resolveMetadataTrack error:`, err.message);
        }

        // Fallback: Basic YouTube search using MusicBrainz metadata
        console.log(`[Pipeline] Stage 5 - Strict match failed, falling back to basic YouTube search...`);
        try {
            const fallbackResults = await YouTube.search(`${refArtist} - ${refTitle} audio`, 5, guildId);
            if (fallbackResults && fallbackResults.length > 0) {
                const fallback = fallbackResults[0];
                const fallbackDrift = Math.abs((fallback.durationMs || fallback.duration * 1000 || 0) - targetDurationMs) / 1000;
                console.log(`[Pipeline] Fallback Match: "${fallback.title}" | Drift: ${fallbackDrift.toFixed(2)}s`);
                const richMetadataFallback = {
                    url: fallback.url,
                    rawUrl: fallback.rawUrl,
                    title: refTitle,
                    artist: refArtist,
                    lyricArtist: refArtist,
                    duration: Math.floor(refDurationMs / 1000),
                    durationMs: refDurationMs,
                    thumbnail: fallback.thumbnail,
                    albumCover: refAlbumCover,
                    platform: 'youtube',
                    type: 'track',
                    id: fallback.id,
                    originalPlatform: youtubeFallback ? 'youtube-url' : 'text',
                    lrclibAnchor: lrclibDurationMs > 0,
                    youtubeFallback,
                    lyrics: youtubeTranscript,
                    mbid: mbRecord?.mbid,
                    releaseMbid: mbRecord?.releaseMbid,
                    releaseGroupMbid: mbRecord?.releaseGroupMbid,
                    popularityCount: mbRecord?.popularityCount || 0,
                    majorLabel: mbRecord?.majorLabel || false
                };
                const tierFallback = (mbRecord?.popularityCount >= 10 || mbRecord?.majorLabel) ? 'mainstream' : 'indie';
                const cacheKeyFallback = trackCache.normalizeKey(refTitle, refArtist, Math.round(refDurationMs / 1000));
                await trackCache.set(cacheKeyFallback, richMetadataFallback, tierFallback);
                return { ...richMetadataFallback, url: null };
            }
        } catch (err) {
            console.error(`[Pipeline] Stage 5 - YouTube fallback search error:`, err.message);
        }

        return null;
    }

    /**
     * Parse YouTube video title to extract Artist and Title
     * Handles patterns like "Artist - Title (Official Video)", "Artist - Title [Official Audio]", etc.
     */
    _parseYouTubeTitle(title) {
        if (!title || typeof title !== 'string') return null;
        
        const trimmed = title.trim();
        
        // Remove common YouTube suffixes
        const cleanTitle = trimmed
            .replace(/\s*\(official\s+(video|audio|music\s+video|lyric\s+video)\)/gi, '')
            .replace(/\s*\[official\s+(video|audio|music\s+video|lyric\s+video)\]/gi, '')
            .replace(/\s*\(official\)/gi, '')
            .replace(/\s*\[official\]/gi, '')
            .replace(/\s*\(lyrics?\)/gi, '')
            .replace(/\s*\[lyrics?\]/gi, '')
            .replace(/\s*\(hd\)/gi, '')
            .replace(/\s*\[hd\]/gi, '')
            .replace(/\s*\(4k\)/gi, '')
            .replace(/\s*\[4k\]/gi, '')
            .replace(/\s*\(audio\)/gi, '')
            .replace(/\s*\[audio\]/gi, '')
            .replace(/\s*\(visualizer\)/gi, '')
            .replace(/\s*\[visualizer\]/gi, '')
            .trim();
        
        // Pattern: "Artist - Title" (most common)
        const dashParts = cleanTitle.split(/\s+-\s+/);
        if (dashParts.length >= 2) {
            // Heuristic: first part is usually artist if it's shorter and doesn't contain title keywords
            const potentialArtist = dashParts[0].trim();
            const potentialTitle = dashParts.slice(1).join(' - ').trim();
            
            // Basic validation: artist shouldn't be too long, title shouldn't be empty
            if (potentialArtist.length > 0 && potentialArtist.length < 80 && potentialTitle.length > 0) {
                return { title: potentialTitle, artist: potentialArtist };
            }
        }
        
        // Pattern: "Title by Artist" (less common in YT titles)
        const byMatch = cleanTitle.match(/^(.+?)\s+by\s+(.+)$/i);
        if (byMatch) {
            return { title: byMatch[1].trim(), artist: byMatch[2].trim() };
        }
        
        return null;
    }

    /**
     * Parse text query to extract title and artist
     * Handles patterns: "song by artist", "artist - song", "song - artist"
     */
    _parseTextQuery(query) {
        if (!query || typeof query !== 'string') {
            return { title: query || '', artist: '' };
        }

        const trimmed = query.trim();
        
        // Pattern 1: "song by artist" (case insensitive)
        const byMatch = trimmed.match(/^(.+?)\s+by\s+(.+)$/i);
        if (byMatch) {
            return { title: byMatch[1].trim(), artist: byMatch[2].trim() };
        }

        // Pattern 2: "artist - song" or "song - artist"
        // Try to split on " - " and determine which is artist vs title
        const dashParts = trimmed.split(/\s+-\s+/);
        if (dashParts.length >= 2) {
            // Heuristic: if first part looks like an artist name (shorter, no common title words)
            // or if it's a known pattern, we'll try both orders in MusicBrainz
            // For now, assume "artist - song" format
            return { title: dashParts[1].trim(), artist: dashParts[0].trim() };
        }

        // No recognizable pattern, treat entire query as title
        return { title: trimmed, artist: '' };
    }

    /**
     * Resolve YouTube URL: Get stream info directly (single yt-dlp call)
     */
    async _resolveYouTubeTrack(query, guildId) {
        try {
            const info = await youtubedl(query, YouTube.getYtDlpOptions({
                dumpSingleJson: true,
                format: 'bestaudio/best',
            }));

            if (!info || !info.url) return null;

            const baseUrl = info.url;
            const canSeek = /googlevideo\.com/i.test(baseUrl);

            return {
                url: baseUrl,
                rawUrl: baseUrl,
                title: info.title,
                artist: info.channel || info.uploader || 'Unknown Artist',
                lyricArtist: info.channel || info.uploader || 'Unknown Artist',
                duration: info.duration || 0,
                durationMs: (info.duration || 0) * 1000,
                thumbnail: info.thumbnail || (info.thumbnails?.length ? info.thumbnails[info.thumbnails.length - 1].url : null),
                albumCover: info.thumbnail || (info.thumbnails?.length ? info.thumbnails[info.thumbnails.length - 1].url : null),
                platform: 'youtube',
                type: 'track',
                id: info.id,
                originalPlatform: 'youtube',
                canSeek,
                format: info.format,
                httpHeaders: info.http_headers || {}
            };
        } catch (error) {
            console.error('[TrackManager] _resolveYouTubeTrack error:', error.message);
            return null;
        }
    }

    /**
     * Resolve SoundCloud URL: Get stream info directly
     */
    async _resolveSoundCloudTrack(query, guildId) {
        const trackInfo = await SoundCloud.getInfo(query, guildId);
        if (!trackInfo) return null;

        const streamInfo = await SoundCloud.getStream(query, guildId, 0);
        if (!streamInfo || !streamInfo.url) return null;

        return {
            url: streamInfo.url,
            title: trackInfo.title || 'SoundCloud Track',
            artist: trackInfo.artist || 'Unknown Artist',
            lyricArtist: trackInfo.artist || 'Unknown Artist',
            duration: trackInfo.duration || 0,
            durationMs: (trackInfo.duration || 0) * 1000,
            thumbnail: trackInfo.thumbnail,
            albumCover: trackInfo.thumbnail,
            platform: 'soundcloud',
            type: 'track',
            originalPlatform: 'soundcloud'
        };
    }

    /**
     * Resolve direct audio link
     */
    async _resolveDirectTrack(query, guildId) {
        const trackInfo = await DirectLink.getInfo(query, guildId);
        if (!trackInfo) return null;

        const streamInfo = await DirectLink.getStream(query, guildId, 0);
        if (!streamInfo || !streamInfo.url) return null;

        return {
            url: streamInfo.url,
            title: trackInfo.title || 'Direct Audio',
            artist: trackInfo.artist || 'Unknown Artist',
            lyricArtist: trackInfo.artist || 'Unknown Artist',
            duration: trackInfo.duration || 0,
            durationMs: (trackInfo.duration || 0) * 1000,
            thumbnail: trackInfo.thumbnail,
            albumCover: trackInfo.thumbnail,
            platform: 'direct',
            type: 'track',
            originalPlatform: 'direct'
        };
    }

    /**
     * Resolve YouTube playlist - Approach B: Resolve first track immediately, background-resolve rest
     */
    async _resolveYouTubePlaylist(playlistUrl, guildId, requestedBy) {
        console.log(`[TrackManager] Resolving YouTube playlist: ${playlistUrl}`);

        try {
            const playlistId = YouTube.extractPlaylistId(playlistUrl);
            if (!playlistId) {
                console.error('[TrackManager] Failed to extract playlist ID');
                return { success: false, message: 'Invalid playlist URL' };
            }

            const ytDlpWrap = require('yt-dlp-wrap').default;
            const path = require('path');
            const binaryPath = path.join(__dirname, '..', '..', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
            const ytDlp = new ytDlpWrap(binaryPath);

            const playlistData = await new Promise((resolve, reject) => {
                let stdoutBuffer = '';
                let stderrBuffer = '';
                const emitter = ytDlp.exec([
                    playlistUrl,
                    '--flat-playlist',
                    '--skip-download',
                    '--dump-json',
                    '--extractor-args', 'youtube:player_client=web',
                ]);

                emitter.ytDlpProcess.stdout.on('data', (data) => { stdoutBuffer += data; });
                emitter.ytDlpProcess.stderr.on('data', (data) => { stderrBuffer += data; });

                emitter.on('close', (code) => {
                    if (code !== 0) {
                        reject(new Error(stderrBuffer || `yt-dlp exited with code ${code}`));
                        return;
                    }
                    const lines = stdoutBuffer.split('\n').filter(l => l.trim() !== '');
                    try {
                        const entries = lines.map(l => JSON.parse(l));
                        resolve(entries);
                    } catch (err) {
                        reject(err);
                    }
                });
                emitter.on('error', (err) => reject(err));
            });

            if (!playlistData || playlistData.length === 0) {
                console.error('[TrackManager] Playlist is empty or fetch failed');
                return { success: false, message: 'Playlist is empty or could not be fetched' };
            }

            console.log(`[TrackManager] Playlist "${playlistData[0]?.playlist_title || playlistId}" has ${playlistData.length} entries`);

            const allTracks = [];
            let firstTrackResolved = null;

            for (let i = 0; i < playlistData.length; i++) {
                const entry = playlistData[i];
                const videoId = entry.id;
                const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

                if (i === 0) {
                    firstTrackResolved = await this._resolveYouTubeTrack(videoUrl, guildId);
                    if (firstTrackResolved) {
                        firstTrackResolved.requestedBy = requestedBy;
                        firstTrackResolved.addedAt = Date.now();
                        firstTrackResolved.isPlaylist = true;
                        firstTrackResolved.playlistPosition = i + 1;
                        firstTrackResolved.playlistTitle = entry.playlist_title || `Playlist ${playlistId}`;
                        allTracks.push(firstTrackResolved);
                    }
                } else {
                    const minimalTrack = {
                        url: videoUrl,
                        title: entry.title || `Track ${i + 1}`,
                        artist: entry.channel || entry.uploader || 'Unknown Artist',
                        duration: entry.duration || 0,
                        durationMs: (entry.duration || 0) * 1000,
                        thumbnail: entry.thumbnail || (entry.thumbnails?.length ? entry.thumbnails[entry.thumbnails.length - 1].url : null),
                        albumCover: entry.thumbnail || (entry.thumbnails?.length ? entry.thumbnails[entry.thumbnails.length - 1].url : null),
                        platform: 'youtube',
                        type: 'track',
                        id: videoId,
                        originalPlatform: 'youtube',
                        isPlaylist: true,
                        playlistPosition: i + 1,
                        playlistTitle: entry.playlist_title || `Playlist ${playlistId}`,
                        requestedBy,
                        addedAt: Date.now(),
                        pendingResolution: true,
                    };
                    allTracks.push(minimalTrack);
                }
            }

            if (!firstTrackResolved) {
                console.error('[TrackManager] Failed to resolve first track of playlist');
                return { success: false, message: 'Failed to resolve playlist tracks' };
            }

            const position = this.queue.length;

            if (this.player.audioEngine.isPlaying || this.currentTrack) {
                this.queue.push(...allTracks);
                this.player.broadcastStateUpdate();
            } else {
                this.currentTrack = allTracks[0];
                if (allTracks.length > 1) {
                    this.queue.push(...allTracks.slice(1));
                }
                this.player.broadcastStateUpdate();
                await this.player.play(null, 0);
            }

            this._backgroundResolvePlaylistTracks(allTracks.slice(1), guildId);

            const logId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
            AuditLog.append({
                id: logId,
                title: firstTrackResolved.title,
                url: firstTrackResolved.url,
                requesterId: requestedBy?.id || '1',
                requesterTag: requestedBy?.tag || requestedBy?.username || 'Dashboard User',
                requesterAvatar: requestedBy?.avatar ? `https://cdn.discordapp.com/avatars/${requestedBy.id}/${requestedBy.avatar}.png` : '',
                timestamp: new Date().toISOString()
            }).catch(err => console.error('Failed to append audit log:', err));

            await this.player.persistState('queue-update');

            return {
                success: true,
                tracks: allTracks,
                isPlaylist: true,
                position,
                playlistTitle: firstTrackResolved.playlistTitle,
                playlistTotal: allTracks.length,
            };

        } catch (error) {
            console.error('[TrackManager] _resolveYouTubePlaylist error:', error.message);
            return { success: false, message: error.message };
        }
    }

    /**
     * Background resolve playlist tracks - updates queue entries in-place
     */
    async _backgroundResolvePlaylistTracks(tracks, guildId) {
        for (const track of tracks) {
            if (!track.pendingResolution) continue;

            try {
                const resolved = await this._resolveYouTubeTrack(track.url, guildId);
                if (resolved) {
                    Object.assign(track, {
                        ...resolved,
                        requestedBy: track.requestedBy,
                        addedAt: track.addedAt,
                        isPlaylist: track.isPlaylist,
                        playlistPosition: track.playlistPosition,
                        playlistTitle: track.playlistTitle,
                        pendingResolution: false,
                    });
                    this.player.broadcastStateUpdate();
                    await this.player.persistState('queue-update');
                }
            } catch (error) {
                console.error(`[TrackManager] Background resolution failed for ${track.url}:`, error.message);
                track.pendingResolution = false;
                track.resolutionError = error.message;
            }
        }
    }

    /**
     * Removes a track from the queue by its index
     */
    removeTrack(index) {
        if (index >= 0 && index < this.queue.length) {
            return this.queue.splice(index, 1)[0];
        }
        return null;
    }

    /**
     * Moves a track to history/previous tracks
     */
    moveToHistory(track) {
        if (track) {
            this.history.push(track);
        }
    }

    /**
     * Shuffles the tracks in the queue
     */
    shuffle() {
        if (this.queue.length > 1) {
            for (let i = this.queue.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
            }
        }
        return this.queue;
    }

    /**
     * Clears all tracks from the queue
     */
    clear() {
        const cleared = this.queue.length;
        this.queue = [];
        return cleared;
    }

    /**
     * Returns the current state of the queue, history, and current track
     */
    getQueue() {
        return {
            current: this.currentTrack,
            queue: this.queue,
            previous: this.previousTracks,
            totalTracks: (this.currentTrack ? 1 : 0) + this.queue.length,
            duration: this.getTotalDuration(),
        };
    }

    /**
     * Calculates the total duration of the current track and all tracks in the queue
     */
    getTotalDuration() {
        let total = 0;
        if (this.currentTrack && this.currentTrack.duration) {
            total += this.currentTrack.duration;
        }
        this.queue.forEach(track => {
            if (track.duration) total += track.duration;
        });
        return total;
    }

    /**
     * Deserialize track from storage (for event store restoration)
     */
    _deserializeTrack(data) {
        if (!data) return null;

        const track = {
            id: data.id || null,
            title: data.title || null,
            url: data.url || null,
            duration: typeof data.duration === 'number' ? data.duration : Number(data.duration) || null,
            thumbnail: data.thumbnail || null,
            artist: data.artist || null,
            album: data.album || null,
            platform: data.platform || null,
            uploader: data.uploader || null,
            youtubeUrl: data.youtubeUrl || null,
            soundcloudUrl: data.soundcloudUrl || null,
            isLive: Boolean(data.isLive),
            addedAt: data.addedAt || Date.now(),
            extra: data.extra || null
        };

        if (data.requesterId) {
            const cachedMember = this.player?.guild?.members?.cache?.get?.(data.requesterId) || null;
            track.requestedBy = cachedMember || { id: data.requesterId, tag: data.requesterTag || data.requesterId };
            track.requesterId = data.requesterId;
            track.requesterTag = data.requesterTag || null;
        }

        return track;
    }
}

module.exports = TrackManager;
