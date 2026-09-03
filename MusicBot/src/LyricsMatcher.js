const MusicBrainzClient = require('./musicbrainz/MusicBrainzClient');
const LrclibClient = require('./lrclib/LrclibClient');
const YouTube = require('./YouTube');

class LyricsMatcher {
    /**
     * YouTube duration fallback when MusicBrainz fails to find the artist.
     * Uses yt-dlp flat search to get duration without full metadata extraction.
     * @param {string} title - Clean track title
     * @param {string} artist - Clean artist name
     * @returns {Promise<number|null>} Duration in milliseconds or null
     */
    static async getYouTubeDurationFallback(title, artist) {
        try {
            const path = require('path');
            const YTDlpWrap = require('yt-dlp-wrap').default;
            const binaryPath = path.join(__dirname, '..', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
            const ytDlpWrap = new YTDlpWrap(binaryPath);
            
            const searchQuery = artist ? `${artist} - ${title}` : title;
            const searchCommand = `ytsearch1:${searchQuery}`;

            const ytDlpEventEmitter = ytDlpWrap.exec([
                searchCommand,
                '--extractor-args', 'youtube:player_client=web',
                '--flat-playlist', '--skip-download', '--dump-json'
            ]);

            let stdoutBuffer = '';
            ytDlpEventEmitter.ytDlpProcess.stdout.on('data', (data) => { stdoutBuffer += data; });
            
            const result = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    ytDlpEventEmitter.ytDlpProcess.kill();
                    reject(new Error('yt-dlp timeout'));
                }, 10000);
                
                ytDlpEventEmitter.on('close', () => {
                    clearTimeout(timeout);
                    const lines = stdoutBuffer.split('\n').filter(l => l.trim() !== '');
                    try {
                        resolve(lines.length > 0 ? JSON.parse(lines[0]) : null);
                    } catch (err) {
                        reject(err);
                    }
                });
                ytDlpEventEmitter.on('error', (err) => {
                    clearTimeout(timeout);
                    reject(err);
                });
            });

            if (result && result.duration) {
                const durationMs = result.duration * 1000;
                console.log(`[LyricsMatcher] YouTube fallback duration: ${result.duration}s (${durationMs}ms) for "${result.title || searchQuery}"`);
                return durationMs;
            }
        } catch (e) {
            console.log(`[LyricsMatcher] YouTube duration fallback failed: ${e.message}`);
        }
        return null;
    }

    /**
     * Main entry point: Match lyrics using the handshake protocol
     * @param {string} title - Clean track title
     * @param {string} artist - Clean artist name
     * @param {Object} [options] - Optional flags
     * @param {boolean} [options.skipMusicBrainz=false] - Skip all MusicBrainz calls (test mode)
     * @param {number} [options.lrclibTimeoutMs=10000] - Hard cutoff for LRCLIB in ms
     * @returns {Promise<Object>} Match result with locked duration and filtered candidates
     */
    static async match(title, artist, options = {}) {
        const { skipMusicBrainz = false, lrclibTimeoutMs = 10000 } = options;
        console.log(`[LyricsMatcher] Starting handshake for "${title}" - "${artist}"${skipMusicBrainz ? ' [skipMusicBrainz]' : ''}`);

        const lrclibPromise = LrclibClient.searchAllTracks(title, artist);
        const lrclibTimeout = new Promise((resolve) => {
            setTimeout(() => {
                console.log(`[LyricsMatcher] LRCLIB exceeded ${lrclibTimeoutMs}ms cutoff - aborting LRCLIB, falling back...`);
                resolve([]);
            }, lrclibTimeoutMs);
        });

        let studioBaseline = null;
        let lrclibCandidates = [];

        if (skipMusicBrainz) {
            console.log(`[LyricsMatcher] Skipping MusicBrainz (test mode), waiting for LRCLIB only...`);
            lrclibCandidates = await Promise.race([lrclibPromise, lrclibTimeout]);
        } else {
            const mbPromise = MusicBrainzClient.getStudioAlbumBaseline(title, artist);
            [studioBaseline, lrclibCandidates] = await Promise.all([
                mbPromise,
                Promise.race([lrclibPromise, lrclibTimeout])
            ]);
        }

        console.log(`[LyricsMatcher] Studio baseline: ${studioBaseline ? studioBaseline + 'ms' : 'none'}`);
        console.log(`[LyricsMatcher] LRCLIB candidates: ${lrclibCandidates.length}`);

        if (lrclibCandidates.length === 0) {
            console.log(`[LyricsMatcher] No LRCLIB candidates found`);
            return {
                success: false,
                lockedDurationMs: null,
                lockedCandidate: null,
                candidates: [],
                fallbackUsed: 'no-candidates',
                studioBaseline: studioBaseline
            };
        }

        let lockedDurationMs = null;
        let lockedCandidate = null;
        let fallbackUsed = null;

        if (studioBaseline) {
            const matchedCandidates = lrclibCandidates.filter(candidate => {
                const delta = Math.abs(candidate.durationMs - studioBaseline);
                return delta <= 3000;
            });

            console.log(`[LyricsMatcher] Candidates within ±3s of studio baseline (${studioBaseline}ms): ${matchedCandidates.length}`);

            if (matchedCandidates.length > 0) {
                lockedCandidate = matchedCandidates[0];
                lockedDurationMs = lockedCandidate.durationMs;
                fallbackUsed = 'studio-match';
                console.log(`[LyricsMatcher] ✅ Studio match locked: ${lockedCandidate.title} (${lockedDurationMs}ms)`);
            }
        }

        if (!lockedDurationMs) {
            if (skipMusicBrainz) {
                console.log(`[LyricsMatcher] skipMusicBrainz: skipping MB consensus, going straight to YouTube duration fallback...`);
            } else {
                console.log(`[LyricsMatcher] No studio match, falling back to MusicBrainz consensus...`);
            }
            const consensusResult = skipMusicBrainz ? null : await MusicBrainzClient.searchRecordingWithDurationAnchor(title, artist, 0);
            
            if (consensusResult && consensusResult.durationMs) {
                lockedDurationMs = consensusResult.durationMs;
                fallbackUsed = 'mb-consensus';
                
                const matchedCandidates = lrclibCandidates.filter(candidate => {
                    const delta = Math.abs(candidate.durationMs - lockedDurationMs);
                    return delta <= 3000;
                });

                if (matchedCandidates.length > 0) {
                    lockedCandidate = matchedCandidates[0];
                    lockedDurationMs = lockedCandidate.durationMs;
                    console.log(`[LyricsMatcher] ✅ Consensus match locked: ${lockedCandidate.title} (${lockedDurationMs}ms)`);
                } else {
                    console.log(`[LyricsMatcher] No LRCLIB candidates within ±3s of consensus (${lockedDurationMs}ms)`);
                    lockedCandidate = lrclibCandidates[0];
                    lockedDurationMs = lockedCandidate.durationMs;
                }
            } else {
                console.log(`[LyricsMatcher] No MusicBrainz consensus. Trying YouTube duration fallback...`);
                const ytDurationMs = await this.getYouTubeDurationFallback(title, artist);
                
                if (ytDurationMs && lrclibCandidates.length > 0) {
                    lockedDurationMs = ytDurationMs;
                    fallbackUsed = 'youtube-duration';
                    
                    const matchedCandidates = lrclibCandidates.filter(candidate => {
                        const delta = Math.abs(candidate.durationMs - lockedDurationMs);
                        return delta <= 3000;
                    });

                    if (matchedCandidates.length > 0) {
                        lockedCandidate = matchedCandidates[0];
                        lockedDurationMs = lockedCandidate.durationMs;
                        console.log(`[LyricsMatcher] ✅ YouTube duration match locked: ${lockedCandidate.title} (${lockedDurationMs}ms)`);
                    } else {
                        console.log(`[LyricsMatcher] No LRCLIB candidates within ±3s of YouTube duration (${lockedDurationMs}ms), using first candidate`);
                        lockedCandidate = lrclibCandidates[0];
                        lockedDurationMs = lockedCandidate.durationMs;
                    }
                } else {
                    console.log(`[LyricsMatcher] No YouTube duration available, using first LRCLIB candidate`);
                    lockedCandidate = lrclibCandidates[0];
                    lockedDurationMs = lockedCandidate.durationMs;
                    fallbackUsed = 'first-candidate';
                }
            }
        }

        const filteredCandidates = lrclibCandidates.filter(c => 
            Math.abs(c.durationMs - lockedDurationMs) <= 3000
        );

        return {
            success: true,
            lockedDurationMs,
            lockedCandidate,
            candidates: filteredCandidates,
            allCandidates: lrclibCandidates,
            fallbackUsed,
            studioBaseline
        };
    }
}

module.exports = LyricsMatcher;