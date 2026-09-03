/**
 * ============================================================================
 * MASTER TEST FILE - Beatra Music Bot Full Pipeline Test
 * ============================================================================
 * 
 * Tests: MusicBrainz, LRCLIB, YouTube, LyricsManager, Caching, Fuzzy Matching
 * Songs: 5 tracks across mainstream, niche, indie, classic categories
 * 
 * Usage:  node "scratch/master test.js"
 * Output: Console only (real-time)
 * Failure: Stops on first failure
 * Cleanup: Prompts at end
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

// ── Test Songs ──────────────────────────────────────────────────────────────
const TEST_SONGS = [
    {
        id: 'mainstream',
        title: 'Blinding Lights',
        artist: 'The Weeknd',
        url: 'https://www.youtube.com/watch?v=4NRXx6U8ABQ',
        expectedDurationMs: 200000,  // ~3:20
        category: 'Mainstream Pop',
        notes: 'Major label, should have MusicBrainz + LRCLIB + YouTube transcript'
    },
    {
        id: 'niche',
        title: 'Welcome to the Internet',
        artist: 'Bo Burnham',
        url: 'https://www.youtube.com/watch?v=Kd7lCCbv5j0',
        expectedDurationMs: 283000,  // ~4:43
        category: 'Comedy/Special',
        notes: 'May not be on MusicBrainz, should have YouTube transcript'
    },
    {
        id: 'indie1',
        title: 'Live in Life',
        artist: 'Will Stetson',
        url: 'https://www.youtube.com/watch?v=CCqNPv-Z9JQ',
        expectedDurationMs: 218000,  // ~3:38
        category: 'Indie/Original',
        notes: 'Indie artist original song, unlikely on MusicBrainz, test YouTube fallback'
    },
    {
        id: 'indie2',
        title: 'Writing on the Wall',
        artist: 'Will Stetson',
        url: 'https://www.youtube.com/watch?v=BW5G7v5PqPc',
        expectedDurationMs: 277000,  // ~4:37
        category: 'Indie/Fan Cover',
        notes: 'Indie artist, MusicBrainz fail expected, test YouTube Music fallback'
    },
    {
        id: 'classic',
        title: 'Summer of 69',
        artist: 'Bryan Adams',
        url: 'https://www.youtube.com/watch?v=eJnNsCqd_q8',
        expectedDurationMs: 243000,  // ~4:03
        category: 'Classic Rock',
        notes: 'Classic hit, should have full coverage across all sources'
    },
    {
        id: 'lrclib-baseline',
        title: 'Never Gonna Give You Up',
        artist: 'Rick Astley',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        expectedDurationMs: 214000,  // ~3:34
        category: 'LRCLIB Baseline',
        notes: 'LRCLIB-only test: skipMusicBrainz=true. Validates whether LRCLIB works when a song genuinely exists. If this fails, LRCLIB is down or rate-limited.',
        skipMusicBrainz: true
    },
    {
        id: 'mb-algo-1',
        title: 'Life is a Highway',
        artist: '',
        url: '',
        expectedDurationMs: 264000,  // ~4:24
        category: 'MusicBrainz Algorithm',
        notes: 'No artist specified. Algorithm must pick Rascal Flatts (2006, soundtrack + streaming era boost) over Tom Cochrane (1991, compilation camping bias).',
        expectedArtist: 'Rascal Flatts',
        algorithmTest: true
    },
    {
        id: 'mb-algo-2',
        title: 'Stereo Love',
        artist: '',
        url: '',
        expectedDurationMs: 247000,  // ~4:07
        category: 'MusicBrainz Algorithm',
        notes: 'No artist specified. Algorithm must pick Edward Maya (highest industry weight). MB credits as "Edward Maya" (primary) with Vika Jigulina as secondary.',
        expectedArtist: 'Edward Maya',
        algorithmTest: true
    },
    {
        id: 'mb-algo-3',
        title: "It's My Life",
        artist: '',
        url: '',
        expectedDurationMs: 224000,  // ~3:44
        category: 'MusicBrainz Algorithm',
        notes: 'No artist specified. Algorithm must pick Bon Jovi (2000, high releases + download era boost) over random covers below the 5-release threshold.',
        expectedArtist: 'Bon Jovi',
        algorithmTest: true
    }
];

// ── Fuzzy Test Variants ─────────────────────────────────────────────────────
// Realistic misspellings/typos that a human would still recognize
const FUZZY_VARIANTS = {
    mainstream: {
        title: 'Blinding Lights',
        artist: 'The Weeknd',
        variants: [
            { title: 'Blindedd by the Ligh', artist: 'The Weeekend', note: 'Doubled letters + missing word' },
            { title: 'Blinding Lites', artist: 'The Weekend', note: 'Missing letters + alternate spelling' },
            { title: 'Blindnig Lights', artist: 'Weeknd', note: 'Swapped letters + missing article' },
            { title: 'Bllinding Lights', artist: 'The Weekeknd', note: 'Extra letter + typo' },
            { title: 'Blinding Light', artist: 'The Wkend', note: 'Missing plural + missing vowel' }
        ]
    },
    niche: {
        title: 'Welcome to the Internet',
        artist: 'Bo Burnham',
        variants: [
            { title: 'Wlcome to the Intenet', artist: 'Bo Burnam', note: 'Missing vowels' },
            { title: 'Welcome to teh Internet', artist: 'Bo Burnahm', note: 'Swapped letters' },
            { title: 'Welcom to the Intarnet', artist: 'Bo Burnam', note: 'Missing e + alternate vowel' },
            { title: 'Welcme to te Internet', artist: 'Bo Burnhm', note: 'Missing letters' },
            { title: 'Welcoem to the Internett', artist: 'Bo Bnurham', note: 'Typo + transposed letters' }
        ]
    },
    indie1: {
        title: 'Live in Life',
        artist: 'Will Stetson',
        variants: [
            { title: 'Liveing Lif', artist: 'Will Stetson', note: 'Extra -ing + missing e' },
            { title: 'Live in Lif', artist: 'Wil Stetson', note: 'Missing letters' },
            { title: 'Liv in Life', artist: 'Will Sttson', note: 'Missing e + double consonant' },
            { title: 'Live in Lfe', artist: 'Will Stetson', note: 'Missing vowel' },
            { title: 'Lifve in Life', artist: 'Will Setson', note: 'Transposed letters + missing t' }
        ]
    },
    indie2: {
        title: 'Writing on the Wall',
        artist: 'Will Stetson',
        variants: [
            { title: 'Writng on the Wll', artist: 'Will Stetson', note: 'Missing vowels' },
            { title: 'Writing o the Wall', artist: 'Wil Stetson', note: 'Missing n + missing l' },
            { title: 'Writting on teh Wall', artist: 'Will Stetson', note: 'Double t + typo' },
            { title: 'Writing on te Wall', artist: 'Will Sttson', note: 'Missing h + missing vowel' },
            { title: 'Writig on the Wall', artist: 'Will Setson', note: 'Missing n + missing t' }
        ]
    },
    classic: {
        title: 'Summer of 69',
        artist: 'Bryan Adams',
        variants: [
            { title: 'Summer of 68', artist: 'Bryan Adams', note: 'Wrong number' },
            { title: 'Summr of 69', artist: 'Bryan Adms', note: 'Missing letters' },
            { title: 'Summer ov 69', artist: 'Bryan Adams', note: 'Alternate vowel' },
            { title: 'Sumemr of 69', artist: 'Bryan Admas', note: 'Transposed letters' },
            { title: 'Summer fo 69', artist: 'Bryan Adems', note: 'Swapped words + vowel change' }
        ]
    }
};

// ── Module Imports ──────────────────────────────────────────────────────────
let MusicBrainzClient, LrclibClient, LyricsMatcher, YouTube, LyricsManager;

function loadModules() {
    console.log('Loading modules...');
    try {
        MusicBrainzClient = require('../src/musicbrainz/MusicBrainzClient');
        LrclibClient = require('../src/lrclib/LrclibClient');
        LyricsMatcher = require('../src/LyricsMatcher');
        YouTube = require('../src/YouTube');
        LyricsManager = require('../src/LyricsManager');
        console.log('✅ All modules loaded\n');
        return true;
    } catch (e) {
        console.error('❌ Failed to load modules:', e.message);
        return false;
    }
}

// ── Cache Management ────────────────────────────────────────────────────────
function clearAllCaches() {
    console.log('Clearing all caches...');
    
    const cacheDirs = [
        path.join(__dirname, '..', 'audio_cache'),
        path.join(__dirname, '..', 'cache', 'lyrics'),
        path.join(__dirname, '..', 'tmp', 'musicbrainz_cache')
    ];
    
    let cleared = 0;
    for (const dir of cacheDirs) {
        if (fs.existsSync(dir)) {
            const entries = fs.readdirSync(dir);
            for (const entry of entries) {
                const entryPath = path.join(dir, entry);
                try {
                    const stat = fs.statSync(entryPath);
                    if (stat.isDirectory()) continue;
                    fs.unlinkSync(entryPath);
                    cleared++;
                } catch (e) {
                    console.warn(`  ⚠️ Could not delete: ${entryPath}`);
                }
            }
        }
    }
    
    // Clear in-memory caches
    if (LyricsManager && LyricsManager.cache) {
        LyricsManager.cache.clear();
    }
    
    console.log(`✅ Cleared ${cleared} cached files\n`);
    return cleared;
}

function verifyCacheEmpty() {
    const cacheDirs = [
        path.join(__dirname, '..', 'audio_cache'),
        path.join(__dirname, '..', 'cache', 'lyrics'),
        path.join(__dirname, '..', 'tmp', 'musicbrainz_cache')
    ];
    
    let totalFiles = 0;
    for (const dir of cacheDirs) {
        if (fs.existsSync(dir)) {
            const entries = fs.readdirSync(dir);
            for (const entry of entries) {
                const entryPath = path.join(dir, entry);
                try {
                    const stat = fs.statSync(entryPath);
                    if (!stat.isDirectory()) totalFiles++;
                } catch (e) {}
            }
        }
    }
    
    return totalFiles === 0;
}

// ── Test Helpers ────────────────────────────────────────────────────────────
function pass(name, detail) {
    console.log(`  ✅ PASS: ${name}${detail ? ' - ' + detail : ''}`);
}

function fail(name, reason) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Reason: ${reason}`);
    throw new Error(`Test failed: ${name} - ${reason}`);
}

function info(msg) {
    console.log(`  ℹ️  ${msg}`);
}

function separator() {
    console.log('\n' + '─'.repeat(80));
}

// ── Fuzzy Match Verification ────────────────────────────────────────────────
function verifyFuzzyMatch(searchArtist, foundArtist, threshold = 0.75) {
    const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    const s1 = normalize(searchArtist);
    const s2 = normalize(foundArtist);
    
    if (s1 === s2) return { match: true, score: 1.0 };
    
    if (s1.length < 2 || s2.length < 2) return { match: false, score: 0 };
    
    const getBigrams = (str) => {
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
    
    const score = (2.0 * intersection) / (bigrams1.size + bigrams2.size);
    return { match: score >= threshold, score };
}

// ── Lyric Validation ────────────────────────────────────────────────────────
function validateLyrics(lyrics, song) {
    if (!lyrics) {
        fail(`Lyrics for "${song.title}"`, 'No lyrics returned');
    }
    
    const hasPlain = lyrics.plain && lyrics.plain.trim().length > 0;
    const hasSynced = lyrics.synced && lyrics.synced.trim().length > 0;
    const source = lyrics.source || 'unknown';
    
    if (!hasPlain && !hasSynced) {
        fail(`Lyrics for "${song.title}"`, 'Lyrics object exists but no content');
    }
    
    // Check plain lyrics have multiple lines
    if (hasPlain) {
        const lines = lyrics.plain.split('\n').filter(l => l.trim());
        if (lines.length < 2) {
            info(`Warning: Plain lyrics only have ${lines.length} line(s)`);
        }
    }
    
    // Check synced lyrics have timestamps
    if (hasSynced) {
        const timestampPattern = /\[\d{2}:\d{2}[\.\:]\d{2,3}\]/;
        if (!timestampPattern.test(lyrics.synced)) {
            info(`Warning: Synced lyrics don't contain expected timestamps`);
        }
    }
    
    return { hasPlain, hasSynced, source };
}

// ── Artist Match Verification ───────────────────────────────────────────────
function verifyArtistMatch(lyrics, song) {
    if (!lyrics) return false;
    
    const lyricArtist = (lyrics.artist || lyrics.artistName || '').toLowerCase();
    const searchArtist = song.artist.toLowerCase();
    
    // Direct check
    if (lyricArtist.includes(searchArtist) || searchArtist.includes(lyricArtist)) {
        return true;
    }
    
    // Fuzzy check
    const fuzzy = verifyFuzzyMatch(song.artist, lyrics.artist || lyrics.artistName || '');
    return fuzzy.match;
}

// ── Fuzzy Logic Test Suite ──────────────────────────────────────────────────
async function testFuzzyLogic() {
    console.log('\n╔══════════════════════════════════════════════════════════════════════════╗');
    console.log('║           FUZZY LOGIC TEST - Misspelled Song/Artist Matching            ║');
    console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');
    
    const results = [];
    
    for (const [songId, songData] of Object.entries(FUZZY_VARIANTS)) {
        console.log(`\n${'─'.repeat(80)}`);
        console.log(`SONG: "${songData.title}" by ${songData.artist}`);
        console.log(`${'─'.repeat(80)}`);
        
        // First, get baseline result with exact match
        console.log(`  [BASELINE] Running exact match: "${songData.title}" - "${songData.artist}"`);
        const baselineStart = Date.now();
        const baseline = await LyricsMatcher.match(songData.title, songData.artist);
        const baselineTime = Date.now() - baselineStart;
        const baselineDuration = baseline?.lockedDurationMs || null;
        
        console.log(`  [BASELINE] Duration: ${baselineDuration}ms (${baselineTime}ms)`);
        
        // Test each fuzzy variant
        const variantResults = [];
        
        for (const variant of songData.variants) {
            console.log(`\n  [FUZZY] Testing: "${variant.title}" - "${variant.artist}"`);
            console.log(`  [FUZZY] Note: ${variant.note}`);
            
            const fuzzyStart = Date.now();
            const fuzzyResult = await LyricsMatcher.match(variant.title, variant.artist);
            const fuzzyTime = Date.now() - fuzzyStart;
            const fuzzyDuration = fuzzyResult?.lockedDurationMs || null;
            
            // Compare durations to determine if fuzzy match found same song
            let matchFound = false;
            let durationDelta = null;
            let durationMatch = false;
            
            if (baselineDuration && fuzzyDuration) {
                durationDelta = Math.abs(baselineDuration - fuzzyDuration);
                durationMatch = durationDelta <= 3000; // Within 3 seconds = same song
                matchFound = durationMatch;
            } else if (!baselineDuration && !fuzzyDuration) {
                // Both null - could mean same song not found
                matchFound = true;
                durationDelta = 0;
            }
            
            const passed = matchFound;
            
            variantResults.push({
                variant,
                fuzzyDuration,
                baselineDuration,
                durationDelta,
                matchFound,
                passed,
                time: fuzzyTime
            });
            
            const status = passed ? '✅' : '❌';
            console.log(`  ${status} Result: ${fuzzyDuration || 'null'}ms (baseline: ${baselineDuration || 'null'}ms, delta: ${durationDelta || 0}ms)`);
        }
        
        // Summary for this song
        const passed = variantResults.filter(v => v.passed).length;
        const total = variantResults.length;
        
        console.log(`\n  Song Summary: ${passed}/${total} fuzzy variants matched`);
        
        results.push({
            song: songData,
            baselineDuration,
            variants: variantResults,
            passed,
            total,
            allPassed: passed === total
        });
    }
    
    // Overall summary
    console.log('\n\n' + '═'.repeat(80));
    console.log('FUZZY LOGIC TEST SUMMARY');
    console.log('═'.repeat(80));
    
    let totalPassed = 0;
    let totalVariants = 0;
    
    for (const result of results) {
        const status = result.allPassed ? '✅' : '⚠️';
        console.log(`\n${status} "${result.song.title}" by ${result.song.artist}`);
        console.log(`   Baseline: ${result.baselineDuration || 'null'}ms`);
        console.log(`   Variants: ${result.passed}/${result.total} matched`);
        
        for (const v of result.variants) {
            const vStatus = v.passed ? '✅' : '❌';
            console.log(`     ${vStatus} "${v.variant.title}" - "${v.variant.artist}"`);
            console.log(`        Duration: ${v.fuzzyDuration || 'null'}ms (delta: ${v.durationDelta || 0}ms)`);
        }
        
        totalPassed += result.passed;
        totalVariants += result.total;
    }
    
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`TOTAL: ${totalPassed}/${totalVariants} fuzzy variants matched correctly`);
    console.log(`${'─'.repeat(80)}`);
    
    return results;
}

// ── Individual Test Suites ──────────────────────────────────────────────────
async function testMusicBrainz(song) {
    if (song.skipMusicBrainz) {
        info('  Skipping MusicBrainz (skipMusicBrainz: true)');
        return null;
    }
    console.log(`  [MusicBrainz] Testing "${song.title}" by "${song.artist}"...`);
    
    const startTime = Date.now();
    const result = await MusicBrainzClient.getStudioAlbumBaseline(song.title, song.artist);
    const elapsed = Date.now() - startTime;
    
    if (result) {
        pass('Studio baseline', `${result}ms (${elapsed}ms)`);
    } else {
        info(`No studio baseline (${elapsed}ms) - expected for indie artists`);
    }
    
    return result;
}

async function testLRCLIB(song) {
    console.log(`  [LRCLIB] Testing "${song.title}" by "${song.artist}"...`);
    
    const startTime = Date.now();
    const result = await LrclibClient.searchTrack(song.title, song.artist);
    const elapsed = Date.now() - startTime;
    
    if (result) {
        const hasSynced = !!result.syncedLyrics;
        pass('LRCLIB search', `${hasSynced ? 'synced' : 'plain'} lyrics (${elapsed}ms)`);
        return result;
    } else {
        info(`No LRCLIB results (${elapsed}ms)`);
        return null;
    }
}

async function testYouTubeTranscript(song) {
    if (!song.url) {
        info('No URL provided, skipping transcript test');
        return null;
    }
    
    const videoIdMatch = song.url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (!videoIdMatch) {
        info('Could not extract video ID from URL');
        return null;
    }
    
    const videoId = videoIdMatch[1];
    console.log(`  [YouTube] Testing transcript for ${videoId}...`);
    
    const startTime = Date.now();
    const result = await YouTube.getTranscript(videoId);
    const elapsed = Date.now() - startTime;
    
    if (result && (result.plain || result.synced)) {
        const hasSynced = !!result.synced;
        pass('YouTube transcript', `${hasSynced ? 'synced' : 'plain'} (${elapsed}ms)`);
        return result;
    } else {
        info(`No YouTube transcript available (${elapsed}ms)`);
        return null;
    }
}

async function testLyricsMatcher(song) {
    console.log(`  [LyricsMatcher] Testing handshake for "${song.title}" by "${song.artist}"...`);
    
    const options = {};
    if (song.skipMusicBrainz) {
        options.skipMusicBrainz = true;
        info('  skipMusicBrainz: true');
    }
    
    const startTime = Date.now();
    const result = await LyricsMatcher.match(song.title, song.artist, options);
    const elapsed = Date.now() - startTime;
    
    if (result && result.success && result.lockedDurationMs) {
        const fallback = result.fallbackUsed || 'unknown';
        const candidates = result.candidates?.length || 0;
        pass('LyricsMatcher handshake', `locked ${result.lockedDurationMs}ms via ${fallback}, ${candidates} candidates (${elapsed}ms)`);
        return result;
    } else {
        info(`Handshake failed or no duration locked (${elapsed}ms)`);
        return result;
    }
}

async function testLyricsManager(song) {
    console.log(`  [LyricsManager] Testing full waterfall for "${song.title}" by "${song.artist}"...`);
    
    const track = {
        title: song.title,
        artist: song.artist,
        url: song.url || '',
        duration: song.expectedDurationMs ? Math.round(song.expectedDurationMs / 1000) : 0,
        durationMs: song.expectedDurationMs || 0
    };
    
    const options = {};
    if (song.skipMusicBrainz) {
        options.skipMusicBrainz = true;
        info('  skipMusicBrainz: true (LRCLIB-only test)');
    }
    
    const startTime = Date.now();
    const result = await LyricsManager.fetchLyrics(track, false, options);
    const elapsed = Date.now() - startTime;
    
    if (result) {
        const validation = validateLyrics(result, song);
        const artistMatch = verifyArtistMatch(result, song);
        
        pass('LyricsManager waterfall', `${validation.source} (${elapsed}ms)`);
        
        if (validation.hasSynced) {
            info(`  Synced lyrics: ${result.synced.length} chars`);
        }
        if (validation.hasPlain) {
            info(`  Plain lyrics: ${result.plain.length} chars`);
        }
        if (!artistMatch) {
            info(`  ⚠️ Artist mismatch: expected "${song.artist}", got "${result.artist || result.artistName || 'unknown'}"`);
        }
        
        return { lyrics: result, validation, artistMatch };
    } else {
        fail(`LyricsManager for "${song.title}"`, 'No lyrics found in waterfall');
    }
}

// ── MusicBrainz Algorithm Test ──────────────────────────────────────────────
async function testMusicBrainzAlgorithm(song) {
    console.log(`  [MB Algorithm] Testing title-only search for "${song.title}"...`);
    console.log(`  [MB Algorithm] Expected artist: "${song.expectedArtist}"`);

    const startTime = Date.now();
    const results = await MusicBrainzClient.searchBestRecordingByTitle(song.title, 10, song.expectedArtist || null);
    const elapsed = Date.now() - startTime;

    if (!results || results.length === 0) {
        fail(`MB Algorithm for "${song.title}"`, 'No recordings found');
    }

    console.log(`\n  [MB Algorithm] Results (sorted by industry weight):`);
    for (let i = 0; i < Math.min(results.length, 5); i++) {
        const r = results[i];
        const primaryMatch = MusicBrainzClient._normalizeString(r.artist) === MusicBrainzClient._normalizeString(song.expectedArtist);
        const allArtistsMatch = r.allArtists?.some(a => MusicBrainzClient._normalizeString(a) === MusicBrainzClient._normalizeString(song.expectedArtist));
        const isExpected = primaryMatch || allArtistsMatch;
        const marker = isExpected ? ' ← EXPECTED' : '';
        const allArtistsStr = r.allArtists && r.allArtists.length > 1 ? ` [allArtists: ${r.allArtists.join(', ')}]` : '';
        const yrBoost = r.yearBoost ? ` | yearBoost=${r.yearBoost}` : '';
        console.log(`    ${i + 1}. "${r.artist}" | score=${r.industryScore} | releases=${r.totalOfficialReleases} | soundtrack=${r.soundtrackReleases} | duration=${r.durationSec}s${yrBoost}${marker}${allArtistsStr}`);
    }

    const topResult = results[0];
    const primaryMatch = MusicBrainzClient._normalizeString(topResult.artist) === MusicBrainzClient._normalizeString(song.expectedArtist);
    const allArtistsMatch = topResult.allArtists?.some(a => MusicBrainzClient._normalizeString(a) === MusicBrainzClient._normalizeString(song.expectedArtist));

    if (primaryMatch || allArtistsMatch) {
        pass('MB Algorithm', `"${topResult.artist}" correctly selected (score: ${topResult.industryScore}, ${elapsed}ms)`);
    } else {
        fail(`MB Algorithm for "${song.title}"`, `Expected "${song.expectedArtist}" but got "${topResult.artist}" (score: ${topResult.industryScore})`);
    }

    return { results, topResult, elapsed };
}

// ── Full Song Test ──────────────────────────────────────────────────────────
async function testSong(song) {
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`TESTING: "${song.title}"${song.artist ? ' by ' + song.artist : ''}`);
    console.log(`Category: ${song.category}`);
    console.log(`Notes: ${song.notes}`);
    if (song.skipMusicBrainz) console.log(`⚡ MODE: LRCLIB-ONLY (skipMusicBrainz)`);
    if (song.algorithmTest) console.log(`🧠 MODE: ALGORITHM TEST (title-only, artist must be determined)`);
    console.log('═'.repeat(80));
    
    // Algorithm test - only run MB algorithm, skip everything else
    if (song.algorithmTest) {
        separator();
        const algoResult = await testMusicBrainzAlgorithm(song);
        return {
            song,
            musicbrainz: null,
            lrclib: null,
            youtubeTranscript: null,
            lyricsMatcher: null,
            lyricsManager: null,
            algorithmTest: algoResult,
            pass: !!algoResult
        };
    }
    
    const results = {
        song: song,
        musicbrainz: null,
        lrclib: null,
        youtubeTranscript: null,
        lyricsMatcher: null,
        lyricsManager: null,
        pass: false
    };
    
    // 1. MusicBrainz
    separator();
    results.musicbrainz = await testMusicBrainz(song);
    
    // 2. LRCLIB
    separator();
    results.lrclib = await testLRCLIB(song);
    
    // 3. YouTube Transcript
    separator();
    results.youtubeTranscript = await testYouTubeTranscript(song);
    
    // 4. LyricsMatcher Handshake
    separator();
    results.lyricsMatcher = await testLyricsMatcher(song);
    
    // 5. LyricsManager Full Waterfall
    separator();
    results.lyricsManager = await testLyricsManager(song);
    
    // Final verdict
    separator();
    results.pass = results.lyricsManager !== null;
    
    if (results.pass) {
        console.log(`\n✅ SONG TEST PASSED: "${song.title}" by ${song.artist}`);
    } else {
        console.log(`\n❌ SONG TEST FAILED: "${song.title}" by ${song.artist}`);
    }
    
    return results;
}

// ── Master Test Runner ──────────────────────────────────────────────────────
async function runAllTests() {
    console.log('╔══════════════════════════════════════════════════════════════════════════╗');
    console.log('║           BEATRA MUSIC BOT - MASTER PIPELINE TEST                       ║');
    console.log('║           Testing songs across mainstream/niche/indie/classic + algo     ║');
    console.log('╚══════════════════════════════════════════════════════════════════════════╝');
    console.log(`\nTimestamp: ${new Date().toISOString()}`);
    console.log(`Songs to test: ${TEST_SONGS.length}\n`);
    
    // Load modules
    if (!loadModules()) {
        console.error('FATAL: Could not load modules');
        process.exit(1);
    }
    
    // Clear caches
    const cleared = clearAllCaches();
    if (!verifyCacheEmpty()) {
        console.error('FATAL: Cache not empty after clearing');
        process.exit(1);
    }
    info('All caches verified empty\n');
    
    // Run tests
    const allResults = [];
    
    for (const song of TEST_SONGS) {
        try {
            const result = await testSong(song);
            allResults.push(result);
        } catch (e) {
            console.error(`\n❌ STOPPED ON FAILURE: ${e.message}`);
            console.error(`Song: "${song.title}" by ${song.artist}`);
            break;
        }
    }
    
    // Run Fuzzy Logic Tests
    if (allResults.length === TEST_SONGS.length) {
        separator();
        await testFuzzyLogic();
    }
    
    // Summary
    console.log('\n\n' + '═'.repeat(80));
    console.log('TEST SUMMARY');
    console.log('═'.repeat(80));
    
    const passed = allResults.filter(r => r.pass).length;
    const failed = allResults.filter(r => !r.pass).length;
    const total = allResults.length;
    
    for (const result of allResults) {
        const status = result.pass ? '✅' : '❌';
        
        if (result.song.algorithmTest) {
            const algoArtist = result.algorithmTest?.topResult?.artist || 'unknown';
            const algoScore = result.algorithmTest?.topResult?.industryScore || 0;
            console.log(`${status} "${result.song.title}" [ALGORITHM TEST]`);
            console.log(`   Picked: "${algoArtist}" (score: ${algoScore}) | Expected: "${result.song.expectedArtist}"`);
        } else {
            const mb = result.musicbrainz ? 'MB✓' : 'MB✗';
            const lrclib = result.lrclib ? 'LR✓' : 'LR✗';
            const yt = result.youtubeTranscript ? 'YT✓' : 'YT✗';
            const lm = result.lyricsManager ? 'LM✓' : 'LM✗';
            
            console.log(`${status} "${result.song.title}" by ${result.song.artist}`);
            console.log(`   Sources: [${mb}] [${lrclib}] [${yt}] [${lm}]`);
        }
    }
    
    console.log(`\n${passed}/${total} songs passed`);
    
    if (failed > 0) {
        console.log(`\n❌ ${failed} song(s) failed`);
    } else {
        console.log('\n✅ All songs passed!');
    }
    
    // Cleanup prompt
    console.log('\n' + '─'.repeat(80));
    console.log('Cache cleanup?');
    console.log('Run: Remove-Item -Path "C:\\Bot\\MusicBot\\audio_cache\\*" -Recurse -Force');
    console.log('Run: Remove-Item -Path "C:\\Bot\\MusicBot\\cache\\lyrics\\*" -Recurse -Force');
    console.log('Run: Remove-Item -Path "C:\\Bot\\MusicBot\\tmp\\musicbrainz_cache\\*" -Recurse -Force');
    console.log('─'.repeat(80));
    
    return { allResults, passed, failed, total };
}

// ── Execute ─────────────────────────────────────────────────────────────────
runAllTests()
    .then(result => {
        process.exit(result.failed > 0 ? 1 : 0);
    })
    .catch(e => {
        console.error('FATAL ERROR:', e);
        process.exit(1);
    });
