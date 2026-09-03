const config = require('../../config');
const requestQueue = require('./RequestQueue');
const { recordingCache } = require('./Cache');
const { fetchWithRetry } = require('../utils/retry');
const USER_AGENT = `VoxariaMusicBot/1.0.0 (${config.bot.website || 'https://github.com/Voxaria/MusicBot'})`;

const MAJOR_LABELS = [
    'universal music', 'sony music', 'warner music', 'emi', 'epic records',
    'rca records', 'columbia records', 'atlantic records', 'island records',
    'def jam', 'capitol records', 'polydor', 'decca', 'virgin records',
    'interscope', 'geffen', 'a&m records', 'mercury records', 'reprise',
    'elektra', 'mca', 'parlophone', 'rough trade', 'domino', 'xl recordings',
    'matador', 'sub pop', '4ad', 'nonesuch', 'verve', 'impulse', 'blue note'
];

// ── Industry Weight Algorithm Constants ─────────────────────────────────────
const RELEASE_CAP = 250;                          // Max official releases counted per artist
const SOUNDTRACK_FLAT_BONUS = 50;                  // One-time bonus if any release is a soundtrack
const COMPILATION_BONUS_PER_RELEASE = 2;           // Per-compilation bonus
const MIN_RELEASES_FOR_YEAR_BOOST = 5;             // Minimum total releases to qualify for era boost
const DIGITAL_STREAMING_ERA_BOOST = 150;           // Boost for recordings first released >= 2005
const DIGITAL_DOWNLOAD_ERA_BOOST = 75;             // Boost for recordings first released >= 2000

class MusicBrainzClient {
    /**
     * Executes an HTTP GET request to the MusicBrainz API through the Request Queue.
     * @param {string} url The target MusicBrainz endpoint.
     * @returns {Promise<Object>} The parsed JSON response.
     */
    static async fetchWithRateLimit(url) {
        return requestQueue.enqueue(async () => {
            return fetchWithRetry(async () => {
                const response = await fetch(url, {
                    headers: {
                        'User-Agent': USER_AGENT,
                        'Accept': 'application/json'
                    }
                });

            if (response.status === 400) {
                console.error(`[MusicBrainz] 400 Bad Request - Malformed Lucene query syntax. URL: ${url}`);
                throw new Error('MusicBrainz API Error: 400 Bad Request - Malformed query');
            }

            if (response.status === 403) {
                console.error(`[MusicBrainz] 403 Forbidden - Missing or invalid User-Agent. Check USER_AGENT config.`);
                throw new Error('MusicBrainz API Error: 403 Forbidden - Check User-Agent header');
            }

            if (response.status === 404) {
                return null;
            }

            if (response.status === 503) {
                throw new Error('MusicBrainz API Rate Limited (503)');
            }

            if (!response.ok) {
                throw new Error(`MusicBrainz API Error: ${response.status} ${response.statusText}`);
            }

            return response.json();
            }, {
                retries: 3,
                baseDelay: 1000,
                maxDelay: 10000,
                onRetry: (attempt, maxRetries, delay, error) => {
                    console.log(`[MusicBrainz] Attempt ${attempt}/${maxRetries} failed: ${error.message}. Retrying in ${Math.round(delay)}ms...`);
                }
            });
        });
    }

    /**
     * Sanitize input for MusicBrainz Lucene query to prevent 400 errors.
     * @param {string} str Input string
     * @returns {string} Sanitized string safe for Lucene query
     */
    static _sanitizeQuery(str) {
        if (!str || typeof str !== 'string') return '';
        return str
            .replace(/[\[\]{}]/g, '')
            .replace(/["]/g, '')
            .replace(/[:]/g, ' ')
            .replace(/[\\]/g, '')
            .replace(/[~]/g, '')
            .replace(/[?]/g, '')
            .replace(/[*]/g, '')
            .trim();
    }

    static _normalizeString(str) {
        if (!str) return '';
        return str
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]/g, "");
    }

    static _getSimilarityScore(str1, str2) {
        const s1 = this._normalizeString(str1);
        const s2 = this._normalizeString(str2);

        if (s1 === s2) return 1.0;
        if (s1.length < 2 || s2.length < 2) return 0.0;

        const getBigrams = str => {
            const bigrams = new Set();
            for (let i = 0; i < str.length - 1; i++) {
                bigrams.add(str.substring(i, i + 2));
            }
            return bigrams;
        };

        const bigrams1 = getBigrams(s1);
        const bigrams2 = getBigrams(s2);

        let intersection = 0;
        for (const bigram of bigrams1) {
            if (bigrams2.has(bigram)) intersection++;
        }

        return (2.0 * intersection) / (bigrams1.size + bigrams2.size);
    }

    /**
     * Parse raw query string to extract title and artist.
     * Handles: "song by artist", "artist - song", "song - artist"
     * @param {string} query Raw query string
     * @returns {{title: string, artist: string}}
     */
    static parseQuery(query) {
        if (!query || typeof query !== 'string') {
            return { title: query || '', artist: '' };
        }

        const trimmed = query.trim();

        const byMatch = trimmed.match(/^(.+?)\s+by\s+(.+)$/i);
        if (byMatch) {
            return { title: byMatch[1].trim(), artist: byMatch[2].trim() };
        }

        const dashParts = trimmed.split(/\s+-\s+/);
        if (dashParts.length >= 2) {
            return { title: dashParts[1].trim(), artist: dashParts[0].trim() };
        }

        return { title: trimmed, artist: '' };
    }

    /**
     * Check if artist credit contains target artist (case-insensitive exact match).
     * @param {Object} recording MusicBrainz recording object
     * @param {string} targetArtist Target artist name
     * @returns {boolean}
     */
    static _artistMatches(recording, targetArtist) {
        if (!recording['artist-credit'] || !targetArtist) return false;

        const THRESHOLD = 0.75;
        return recording['artist-credit'].some(ac => {
            const name = ac.name || ac.artist?.name || '';
            const score = this._getSimilarityScore(name, targetArtist);
            if (score >= THRESHOLD && process.env.NODE_ENV !== 'production') {
                console.log(`[MusicBrainz] Fuzzy match: "${name}" ≈ "${targetArtist}" (score: ${score.toFixed(2)})`);
            }
            return score >= THRESHOLD;
        });
    }

    /**
     * Check if release label is a major label.
     * @param {Object} release MusicBrainz release object
     * @returns {boolean}
     */
    static _isMajorLabel(release) {
        if (!release.label_info) return false;
        return release.label_info.some(info => {
            const labelName = (info.label?.name || '').toLowerCase();
            return MAJOR_LABELS.some(major => labelName.includes(major));
        });
    }

    /**
     * Check if a release group is a studio album (not live, remix, compilation, etc.)
     * @param {Object} releaseGroup MusicBrainz release-group object
     * @returns {boolean}
     */
    static _isStudioAlbum(releaseGroup) {
        if (!releaseGroup) return false;
        if (releaseGroup['primary-type'] !== 'Album') return false;
        
        const secondaryTypes = releaseGroup['secondary-types'] || [];
        const excludedTypes = ['Live', 'Remix', 'Compilation', 'Soundtrack', 'Spokenword', 'Interview', 'Audiobook', 'Radio'];
        
        return !secondaryTypes.some(type => excludedTypes.includes(type));
    }

    /**
     * Get the consensus duration from studio album releases only.
     * Queries MusicBrainz for recordings and filters for official studio album cuts.
     * @param {string} title The requested song title.
     * @param {string} artist The requested artist name.
     * @returns {Promise<number|null>} Consensus duration in milliseconds, or null if not found.
     */
    static async getStudioAlbumBaseline(title, artist) {
        const cleanTitle = this._sanitizeQuery(title);
        const cleanArtist = this._sanitizeQuery(artist);

        const cacheKey = `studio_baseline:${cleanTitle.toLowerCase()}:${cleanArtist.toLowerCase()}`;
        
        const cached = await recordingCache.get(cacheKey);
        if (cached) {
            console.log(`[MusicBrainz] Studio baseline cache hit for "${cleanTitle}" - "${cleanArtist}"`);
            return cached;
        }

        try {
            const encodedTitle = encodeURIComponent(`"${cleanTitle}"`);
            const encodedArtist = encodeURIComponent(`"${cleanArtist}"`);
            
            let queryUrl = `https://musicbrainz.org/ws/2/recording/?query=recording:${encodedTitle} AND artist:${encodedArtist}&fmt=json&limit=25&inc=release-groups`;
            
            let data = await this.fetchWithRateLimit(queryUrl);

            if (!data.recordings || data.recordings.length === 0) {
                console.log(`[MusicBrainz] Studio baseline: Exact match failed for "${cleanTitle}" - "${cleanArtist}". Falling back to title-only search.`);
                queryUrl = `https://musicbrainz.org/ws/2/recording/?query=recording:${encodedTitle}&fmt=json&limit=25&inc=release-groups`;
                data = await this.fetchWithRateLimit(queryUrl);
            }

            if (!data.recordings || data.recordings.length === 0) {
                return null;
            }

            const filteredRecordings = data.recordings.filter(rec => 
                this._artistMatches(rec, cleanArtist)
            );

            if (filteredRecordings.length === 0) {
                console.log(`[MusicBrainz] Studio baseline: No recordings matched artist "${cleanArtist}" after filtering.`);
                return null;
            }

            const durationFrequencyMap = {};

            for (const recording of filteredRecordings) {
                if (!recording.length || !recording.releases) continue;

                const durationSec = Math.round(recording.length / 1000);

                for (const release of recording.releases) {
                    if (release.status !== 'Official') continue;
                    
                    const releaseGroup = release['release-group'];
                    if (!this._isStudioAlbum(releaseGroup)) continue;

                    if (!this._isMajorLabel(release)) continue;

                    if (!durationFrequencyMap[durationSec]) {
                        durationFrequencyMap[durationSec] = {
                            count: 0,
                            candidates: []
                        };
                    }
                    durationFrequencyMap[durationSec].count++;
                    durationFrequencyMap[durationSec].candidates.push({
                        recording,
                        releaseMbid: release.id,
                        releaseGroupMbid: releaseGroup?.id || null
                    });
                }
            }

            if (Object.keys(durationFrequencyMap).length === 0) {
                console.log(`[MusicBrainz] No official major-label studio album releases found for "${cleanTitle}" - "${cleanArtist}".`);
                return null;
            }

            let winningDuration = null;
            let maxCount = 0;
            for (const [duration, data] of Object.entries(durationFrequencyMap)) {
                if (data.count > maxCount) {
                    maxCount = data.count;
                    winningDuration = parseInt(duration);
                }
            }

            const result = winningDuration * 1000;
            
            await recordingCache.set(cacheKey, result);
            
            console.log(`[MusicBrainz] Studio album baseline: "${cleanTitle}" - ${winningDuration}s (${maxCount} official major-label studio album releases)`);
            
            return result;

        } catch (error) {
            console.error(`[MusicBrainz] Studio Baseline Error:`, error.message);
            return null;
        }
    }

    /**
     * Queries MusicBrainz for recordings and applies popularity consensus algorithm.
     * @param {string} title The requested song title.
     * @param {string} artist The requested artist name.
     * @returns {Promise<Object|null>} Consolidated track data contract or null if not found.
     */
    static async searchRecording(title, artist) {
        return this.searchRecordingWithDurationAnchor(title, artist, 0);
    }

    /**
     * Queries MusicBrainz for recordings and filters by LRCLIB duration anchor (±3s).
     * @param {string} title The requested song title.
     * @param {string} artist The requested artist name.
     * @param {number} lrclibDurationMs The LRCLIB duration anchor in milliseconds (0 = no anchor).
     * @returns {Promise<Object|null>} Consolidated track data contract or null if not found.
     */
    static async searchRecordingWithDurationAnchor(title, artist, lrclibDurationMs) {
        const cleanTitle = this._sanitizeQuery(title);
        const cleanArtist = this._sanitizeQuery(artist);

        const cacheKey = `recording:${cleanTitle.toLowerCase()}:${cleanArtist.toLowerCase()}`;
        
        const cached = await recordingCache.get(cacheKey);
        if (cached) {
            console.log(`[MusicBrainz] Cache hit for "${cleanTitle}" - "${cleanArtist}"`);
            return cached;
        }

        try {
            const encodedTitle = encodeURIComponent(`"${cleanTitle}"`);
            const encodedArtist = encodeURIComponent(`"${cleanArtist}"`);
            
            let queryUrl = `https://musicbrainz.org/ws/2/recording/?query=recording:${encodedTitle} AND artist:${encodedArtist}&fmt=json&limit=25&inc=releases`;
            
            let data = await this.fetchWithRateLimit(queryUrl);

            if (!data.recordings || data.recordings.length === 0) {
                console.log(`[MusicBrainz] Exact match failed for "${cleanTitle}" - "${cleanArtist}". Falling back to title-only search.`);
                queryUrl = `https://musicbrainz.org/ws/2/recording/?query=recording:${encodedTitle}&fmt=json&limit=25&inc=releases`;
                data = await this.fetchWithRateLimit(queryUrl);
            }

            if (!data.recordings || data.recordings.length === 0) {
                return null;
            }

            const filteredRecordings = data.recordings.filter(rec => 
                this._artistMatches(rec, cleanArtist)
            );

            // DEBUG: Log artist credits for first few recordings
            console.log(`[MusicBrainz DEBUG] Top 5 recording artist-credits:`, 
                data.recordings.slice(0, 5).map(r => ({
                    title: r.title,
                    artistCredit: r['artist-credit']?.map(ac => ac.name),
                    id: r.id
                }))
            );

            if (filteredRecordings.length === 0) {
                console.log(`[MusicBrainz] No recordings matched artist "${cleanArtist}" after filtering.`);
                return null;
            }

            // Stage 3b: Filter recordings by LRCLIB duration anchor (±3s)
            let anchorFilteredRecordings = filteredRecordings;
            if (lrclibDurationMs > 0) {
                const anchorSec = Math.round(lrclibDurationMs / 1000);
                const minSec = anchorSec - 3;
                const maxSec = anchorSec + 3;
                
                anchorFilteredRecordings = filteredRecordings.filter(rec => {
                    if (!recording.length) return false;
                    const recSec = Math.round(rec.length / 1000);
                    return recSec >= minSec && recSec <= maxSec;
                });
                
                console.log(`[MusicBrainz] LRCLIB Anchor Filter: ${filteredRecordings.length} → ${anchorFilteredRecordings.length} recordings (${anchorSec}s ±3s)`);
                
                if (anchorFilteredRecordings.length === 0) {
                    console.log(`[MusicBrainz] No recordings within ±3s of LRCLIB anchor (${anchorSec}s). Falling back to all artist-matched recordings.`);
                    anchorFilteredRecordings = filteredRecordings;
                }
            }

            const durationFrequencyMap = {};

            for (const recording of anchorFilteredRecordings) {
                if (!recording.length || !recording.releases) continue;

                const durationSec = Math.round(recording.length / 1000);

                for (const release of recording.releases) {
                    if (release.status !== 'Official') continue;
                    
                    // DEBUG: Log label info for first few releases
                    if (release.label_info) {
                        console.log(`[MusicBrainz DEBUG] Release ${release.id} labels:`, 
                            release.label_info.map(l => l.label?.name).filter(Boolean));
                    }
                    
                    if (!this._isMajorLabel(release)) continue;

                    const releaseMbid = release.id;
                    let releaseGroupMbid = null;
                    if (release['release-group']) {
                        releaseGroupMbid = release['release-group'].id;
                    }

                    const bucketKey = `${durationSec}|${releaseMbid}|${releaseGroupMbid || ''}`;
                    if (!durationFrequencyMap[durationSec]) {
                        durationFrequencyMap[durationSec] = {
                            count: 0,
                            candidates: []
                        };
                    }
                    durationFrequencyMap[durationSec].count++;
                    durationFrequencyMap[durationSec].candidates.push({
                        recording,
                        releaseMbid,
                        releaseGroupMbid
                    });
                }
            }

            if (Object.keys(durationFrequencyMap).length === 0) {
                console.log(`[MusicBrainz] No official major-label releases found for "${cleanTitle}" - "${cleanArtist}". Trying fallback to any official release...`);
                
                const fallbackDurationMap = {};
                for (const recording of anchorFilteredRecordings) {
                    if (!recording.length || !recording.releases) continue;
                    const durationSec = Math.round(recording.length / 1000);
                    for (const release of recording.releases) {
                        if (release.status !== 'Official') continue;
                        let releaseGroupMbid = null;
                        if (release['release-group']) {
                            releaseGroupMbid = release['release-group'].id;
                        }
                        if (!fallbackDurationMap[durationSec]) {
                            fallbackDurationMap[durationSec] = {
                                count: 0,
                                candidates: []
                            };
                        }
                        fallbackDurationMap[durationSec].count++;
                        fallbackDurationMap[durationSec].candidates.push({
                            recording,
                            releaseMbid: release.id,
                            releaseGroupMbid
                        });
                    }
                }
                
                if (Object.keys(fallbackDurationMap).length > 0) {
                    let winningDuration = null;
                    let maxCount = 0;
                    for (const [duration, data] of Object.entries(fallbackDurationMap)) {
                        if (data.count > maxCount) {
                            maxCount = data.count;
                            winningDuration = parseInt(duration);
                        }
                    }
                    const winnerData = fallbackDurationMap[winningDuration];
                    const bestCandidate = winnerData.candidates[0];
                    
                    let majorLabel = false;
                    if (bestCandidate.recording.releases) {
                        majorLabel = bestCandidate.recording.releases.some(release => 
                            this._isMajorLabel(release)
                        );
                    }
                    
                    const result = {
                        title: bestCandidate.recording.title,
                        artist: bestCandidate.recording['artist-credit'] 
                            ? bestCandidate.recording['artist-credit'].map(ac => ac.name).join('') 
                            : cleanArtist,
                        durationMs: winningDuration * 1000,
                        releaseMbid: bestCandidate.releaseMbid,
                        releaseGroupMbid: bestCandidate.releaseGroupMbid,
                        mbid: bestCandidate.recording.id,
                        popularityCount: maxCount,
                        majorLabel
                    };
                    
                    await recordingCache.set(cacheKey, result);
                    console.log(`[MusicBrainz] Fallback winner: "${result.title}" - ${winningDuration}s (${maxCount} official releases)`);
                    return result;
                }
                
                console.log(`[MusicBrainz] No official releases found at all for "${cleanTitle}" - "${cleanArtist}".`);
                return null;
            }

            let winningDuration = null;
            let maxCount = 0;
            for (const [duration, data] of Object.entries(durationFrequencyMap)) {
                if (data.count > maxCount) {
                    maxCount = data.count;
                    winningDuration = parseInt(duration);
                }
            }

            const winnerData = durationFrequencyMap[winningDuration];
            const bestCandidate = winnerData.candidates[0];

            // Check if any release is from a major label
            let majorLabel = false;
            if (bestCandidate.recording.releases) {
                majorLabel = bestCandidate.recording.releases.some(release => 
                    this._isMajorLabel(release)
                );
            }

            const result = {
                title: bestCandidate.recording.title,
                artist: bestCandidate.recording['artist-credit'] 
                    ? bestCandidate.recording['artist-credit'].map(ac => ac.name).join('') 
                    : cleanArtist,
                durationMs: winningDuration * 1000,
                releaseMbid: bestCandidate.releaseMbid,
                releaseGroupMbid: bestCandidate.releaseGroupMbid,
                mbid: bestCandidate.recording.id,
                popularityCount: maxCount,
                majorLabel
            };

            await recordingCache.set(cacheKey, result);

            console.log(`[MusicBrainz] Consensus winner: "${result.title}" - ${winningDuration}s (${maxCount} official major-label releases)`);

            return result;

        } catch (error) {
            console.error(`[MusicBrainz] Search Error:`, error.message);
            return null;
        }
    }

    /**
     * Search MusicBrainz for multiple recordings by title, grouped by artist.
     * Used for playlist builder to show different artist versions of the same song.
     * @param {string} title The song title to search for.
     * @param {number} limit Max number of artist groups to return.
     * @returns {Promise<Array>} Array of artist groups with best recording per artist.
     */
    static async searchRecordingsByTitle(title, limit = 10) {
        const cleanTitle = this._sanitizeQuery(title);

        const cacheKey = `title_search:${cleanTitle.toLowerCase()}:${limit}`;
        
        const cached = await recordingCache.get(cacheKey);
        if (cached) {
            console.log(`[MusicBrainz] Cache hit for title search "${cleanTitle}"`);
            return cached;
        }

        try {
            const encodedTitle = encodeURIComponent(`"${cleanTitle}"`);
            const queryUrl = `https://musicbrainz.org/ws/2/recording/?query=recording:${encodedTitle}&fmt=json&limit=50&inc=releases`;
            
            const data = await this.fetchWithRateLimit(queryUrl);

            if (!data.recordings || data.recordings.length === 0) {
                return [];
            }

            // Group recordings by artist
            const artistGroups = new Map();

            for (const recording of data.recordings) {
                if (!recording['artist-credit'] || !recording.length) continue;

                const artistNames = recording['artist-credit'].map(ac => ac.name).filter(Boolean);
                if (artistNames.length === 0) continue;

                const primaryArtist = artistNames[0];
                const artistKey = this._normalizeString(primaryArtist);

                if (!artistGroups.has(artistKey)) {
                    artistGroups.set(artistKey, {
                        artist: primaryArtist,
                        allArtists: artistNames,
                        recordings: []
                    });
                }
                artistGroups.get(artistKey).recordings.push(recording);
            }

            // For each artist group, find the best recording (consensus duration)
            const results = [];
            for (const [artistKey, group] of artistGroups) {
                const durationFrequencyMap = {};

                for (const recording of group.recordings) {
                    if (!recording.length || !recording.releases) continue;

                    const durationSec = Math.round(recording.length / 1000);

                    for (const release of recording.releases) {
                        if (release.status !== 'Official') continue;

                        let releaseGroupMbid = null;
                        if (release['release-group']) {
                            releaseGroupMbid = release['release-group'].id;
                        }

                        if (!durationFrequencyMap[durationSec]) {
                            durationFrequencyMap[durationSec] = {
                                count: 0,
                                candidates: []
                            };
                        }
                        durationFrequencyMap[durationSec].count++;
                        durationFrequencyMap[durationSec].candidates.push({
                            recording,
                            releaseMbid: release.id,
                            releaseGroupMbid
                        });
                    }
                }

                if (Object.keys(durationFrequencyMap).length === 0) continue;

                let winningDuration = null;
                let maxCount = 0;
                for (const [duration, data] of Object.entries(durationFrequencyMap)) {
                    if (data.count > maxCount) {
                        maxCount = data.count;
                        winningDuration = parseInt(duration);
                    }
                }

                const winnerData = durationFrequencyMap[winningDuration];
                const bestCandidate = winnerData.candidates[0];

                results.push({
                    title: bestCandidate.recording.title,
                    artist: group.artist,
                    allArtists: group.allArtists,
                    durationMs: winningDuration * 1000,
                    durationSec: winningDuration,
                    releaseMbid: bestCandidate.releaseMbid,
                    releaseGroupMbid: bestCandidate.releaseGroupMbid,
                    mbid: bestCandidate.recording.id,
                    popularityCount: maxCount,
                    recordingCount: group.recordings.length
                });
            }

            // Sort by popularity (most releases first)
            results.sort((a, b) => b.popularityCount - a.popularityCount);

            const limitedResults = results.slice(0, limit);

            await recordingCache.set(cacheKey, limitedResults);

            console.log(`[MusicBrainz] Title search for "${cleanTitle}" found ${limitedResults.length} artist versions`);
            return limitedResults;

        } catch (error) {
            console.error(`[MusicBrainz] Title Search Error:`, error.message);
            return [];
        }
    }
    /**
     * Search by title only and score each artist's recordings by "industry weight".
     * Score = official release count + soundtrack bonus + compilation bonus.
     * Returns sorted results with the definitive mainstream version first.
     * @param {string} title The song title to search for.
     * @param {number} limit Max results to return.
     * @returns {Promise<Array>} Array of artist-scored results sorted by industry weight.
     */
    static async searchBestRecordingByTitle(title, limit = 10, artist = null) {
        const cleanTitle = this._sanitizeQuery(title);
        const cleanArtist = artist ? this._sanitizeQuery(artist) : null;
        const cacheKey = `best_recording:${cleanTitle.toLowerCase()}:${cleanArtist ? cleanArtist.toLowerCase() : 'noartist'}:${limit}`;

        const cached = await recordingCache.get(cacheKey);
        if (cached) {
            console.log(`[MusicBrainz] Cache hit for best recording search "${cleanTitle}"${cleanArtist ? ` by "${cleanArtist}"` : ''}`);
            return cached;
        }

        try {
            const encodedTitle = encodeURIComponent(`"${cleanTitle}"`);
            let queryUrl;

            // Phase 1: If artist is known, try artist-specific query first
            if (cleanArtist) {
                const encodedArtist = encodeURIComponent(`"${cleanArtist}"`);
                queryUrl = `https://musicbrainz.org/ws/2/recording/?query=recording:${encodedTitle} AND artist:${encodedArtist}&fmt=json&limit=50&inc=releases+release-groups`;
                console.log(`[MusicBrainz] Trying artist-specific query: recording:"${cleanTitle}" AND artist:"${cleanArtist}"`);
            } else {
                queryUrl = `https://musicbrainz.org/ws/2/recording/?query=recording:${encodedTitle}&fmt=json&limit=50&inc=releases+release-groups`;
            }

            let data = await this.fetchWithRateLimit(queryUrl);

            // Phase 2: If artist-specific query returned nothing, fall back to title-only
            if (cleanArtist && (!data.recordings || data.recordings.length === 0)) {
                console.log(`[MusicBrainz] Artist-specific query returned 0 results, falling back to title-only search`);
                queryUrl = `https://musicbrainz.org/ws/2/recording/?query=recording:${encodedTitle}&fmt=json&limit=50&inc=releases+release-groups`;
                data = await this.fetchWithRateLimit(queryUrl);
            }

            if (!data.recordings || data.recordings.length === 0) {
                console.log(`[MusicBrainz] No recordings found for title "${cleanTitle}"`);
                return [];
            }

            // Group recordings by normalized artist name
            const artistGroups = new Map();

            for (const recording of data.recordings) {
                if (!recording['artist-credit'] || !recording.length) continue;

                const artistNames = recording['artist-credit'].map(ac => ac.name).filter(Boolean);
                if (artistNames.length === 0) continue;

                const primaryArtist = artistNames[0];
                const artistKey = this._normalizeString(primaryArtist);

                if (!artistGroups.has(artistKey)) {
                    artistGroups.set(artistKey, {
                        artist: primaryArtist,
                        allArtists: artistNames,
                        recordings: []
                    });
                }
                artistGroups.get(artistKey).recordings.push(recording);
            }

            // Score each artist group by industry weight
            const results = [];
            for (const [artistKey, group] of artistGroups) {
                let totalOfficialReleases = 0;
                let hasSoundtrack = false;
                let compilationReleases = 0;
                let totalYearBoost = 0;
                let bestRecording = null;
                let bestRecordingScore = 0;
                let durationFrequencyMap = {};

                for (const recording of group.recordings) {
                    if (!recording.releases) continue;

                    let recordingScore = 0;
                    let recordingOfficialCount = 0;
                    let recordingSoundtrack = false;
                    let recordingCompilations = 0;
                    const durationSec = recording.length ? Math.round(recording.length / 1000) : null;

                    // Extract earliest release year for this recording
                    let earliestReleaseYear = null;
                    for (const release of recording.releases) {
                        if (release.status !== 'Official') continue;
                        if (release.date) {
                            const year = parseInt(release.date.split('-')[0], 10);
                            if (!isNaN(year) && (earliestReleaseYear === null || year < earliestReleaseYear)) {
                                earliestReleaseYear = year;
                            }
                        }
                    }

                    for (const release of recording.releases) {
                        if (release.status !== 'Official') continue;

                        totalOfficialReleases++;
                        recordingOfficialCount++;
                        recordingScore++;

                        // Check release group metadata
                        const releaseGroup = release['release-group'];
                        if (releaseGroup) {
                            const secondaryTypes = releaseGroup['secondary-types'] || [];
                            if (secondaryTypes.includes('Soundtrack')) {
                                recordingSoundtrack = true;
                            }
                            if (secondaryTypes.includes('Compilation')) {
                                recordingCompilations++;
                            }
                        }

                        // Track duration consensus
                        if (durationSec) {
                            if (!durationFrequencyMap[durationSec]) {
                                durationFrequencyMap[durationSec] = { count: 0, durationSec };
                            }
                            durationFrequencyMap[durationSec].count++;
                        }
                    }

                    // Flat soundtrack bonus (one-time per recording, not per release)
                    if (recordingSoundtrack) {
                        recordingScore += SOUNDTRACK_FLAT_BONUS;
                        hasSoundtrack = true;
                    }

                    // Compilation bonus
                    recordingScore += recordingCompilations * COMPILATION_BONUS_PER_RELEASE;
                    compilationReleases += recordingCompilations;

                    // Scaled release year boost (Bon Jovi edge case protection)
                    let releaseYearBoost = 0;
                    if (earliestReleaseYear !== null && recordingOfficialCount >= MIN_RELEASES_FOR_YEAR_BOOST) {
                        if (earliestReleaseYear >= 2005) {
                            releaseYearBoost = DIGITAL_STREAMING_ERA_BOOST;
                        } else if (earliestReleaseYear >= 2000) {
                            releaseYearBoost = DIGITAL_DOWNLOAD_ERA_BOOST;
                        }
                    }
                    recordingScore += releaseYearBoost;
                    totalYearBoost += releaseYearBoost;

                    if (recordingScore > bestRecordingScore) {
                        bestRecordingScore = recordingScore;
                        bestRecording = recording;
                    }
                }

                if (totalOfficialReleases === 0) continue;

                // Find consensus duration (most common)
                let consensusDurationSec = null;
                let maxCount = 0;
                for (const [, durData] of Object.entries(durationFrequencyMap)) {
                    if (durData.count > maxCount) {
                        maxCount = durData.count;
                        consensusDurationSec = durData.durationSec;
                    }
                }

                // Industry weight score with capped release volume
                const cappedReleases = Math.min(totalOfficialReleases, RELEASE_CAP);
                const soundtrackScore = hasSoundtrack ? SOUNDTRACK_FLAT_BONUS : 0;
                const industryScore = cappedReleases + soundtrackScore + (compilationReleases * COMPILATION_BONUS_PER_RELEASE) + totalYearBoost;

                results.push({
                    title: bestRecording?.title || cleanTitle,
                    artist: group.artist,
                    allArtists: group.allArtists,
                    durationMs: consensusDurationSec ? consensusDurationSec * 1000 : null,
                    durationSec: consensusDurationSec,
                    mbid: bestRecording?.id || null,
                    industryScore,
                    totalOfficialReleases,
                    soundtrackReleases: hasSoundtrack ? 1 : 0,
                    compilationReleases,
                    yearBoost: totalYearBoost,
                    recordingCount: group.recordings.length
                });

                console.log(`[MusicBrainz] Industry weight: "${group.artist}" score=${industryScore} (releases=${totalOfficialReleases}${totalOfficialReleases > RELEASE_CAP ? ' [capped]' : ''}, soundtrack=${hasSoundtrack}, compilations=${compilationReleases}, yearBoost=${totalYearBoost})`);
            }

            // Sort by industry weight score (highest first)
            results.sort((a, b) => b.industryScore - a.industryScore);

            const limitedResults = results.slice(0, limit);

            await recordingCache.set(cacheKey, limitedResults);

            if (limitedResults.length > 0) {
                console.log(`[MusicBrainz] Best recording for "${cleanTitle}": "${limitedResults[0].artist}" (score: ${limitedResults[0].industryScore})`);
            }

            return limitedResults;

        } catch (error) {
            console.error(`[MusicBrainz] Best Recording Search Error:`, error.message);
            return [];
        }
    }
}

module.exports = MusicBrainzClient;