/**
 * Test script for YouTube duration fallback in LyricsMatcher
 * Tests: "Writing on the Wall" by "Will Stenson"
 */

const LyricsMatcher = require('../src/LyricsMatcher');
const MusicBrainzClient = require('../src/musicbrainz/MusicBrainzClient');
const LrclibClient = require('../src/lrclib/LrclibClient');

const TITLE = 'Writing on the Wall';
const ARTIST = 'Will Stenson';

async function testFallback() {
    console.log('='.repeat(80));
    console.log(`TEST: LyricsMatcher YouTube Duration Fallback`);
    console.log(`Song: "${TITLE}" by "${ARTIST}"`);
    console.log('='.repeat(80));
    
    const results = {
        song: `${TITLE} by ${ARTIST}`,
        timestamp: new Date().toISOString(),
        steps: [],
        finalResult: null,
        pass: false
    };

    // Step 1: Test MusicBrainz Studio Baseline
    console.log('\n[STEP 1] Testing MusicBrainz Studio Album Baseline...');
    const studioStart = Date.now();
    const studioBaseline = await MusicBrainzClient.getStudioAlbumBaseline(TITLE, ARTIST);
    const studioTime = Date.now() - studioStart;
    
    results.steps.push({
        name: 'MusicBrainz Studio Baseline',
        input: { title: TITLE, artist: ARTIST },
        output: studioBaseline,
        durationMs: studioTime,
        passed: studioBaseline !== null,
        note: studioBaseline ? `Found: ${studioBaseline}ms` : 'No match (indie artist not in MusicBrainz)'
    });
    console.log(`  Result: ${studioBaseline ? `${studioBaseline}ms` : 'null'} (${studioTime}ms)`);
    
    // Step 2: Test MusicBrainz Consensus Search
    console.log('\n[STEP 2] Testing MusicBrainz Consensus Search...');
    const consensusStart = Date.now();
    const consensusResult = await MusicBrainzClient.searchRecordingWithDurationAnchor(TITLE, ARTIST, 0);
    const consensusTime = Date.now() - consensusStart;
    
    results.steps.push({
        name: 'MusicBrainz Consensus Search',
        input: { title: TITLE, artist: ARTIST, lrclibDurationMs: 0 },
        output: consensusResult,
        durationMs: consensusTime,
        passed: consensusResult !== null,
        note: consensusResult ? `Found: ${consensusResult.durationMs}ms` : 'No consensus (artist not in database)'
    });
    console.log(`  Result: ${consensusResult ? `${consensusResult.durationMs}ms` : 'null'} (${consensusTime}ms)`);
    
    // Step 3: Test LRCLIB Search
    console.log('\n[STEP 3] Testing LRCLIB Search...');
    const lrclibStart = Date.now();
    const lrclibCandidates = await LrclibClient.searchAllTracks(TITLE, ARTIST);
    const lrclibTime = Date.now() - lrclibStart;
    
    results.steps.push({
        name: 'LRCLIB Search',
        input: { title: TITLE, artist: ARTIST },
        output: lrclibCandidates.map(c => ({
            title: c.title,
            artist: c.artist,
            durationMs: c.durationMs,
            hasSynced: !!c.syncedLyrics
        })),
        durationMs: lrclibTime,
        passed: lrclibCandidates.length > 0,
        note: `Found ${lrclibCandidates.length} candidates`
    });
    console.log(`  Found ${lrclibCandidates.length} candidates (${lrclibTime}ms)`);
    lrclibCandidates.forEach((c, i) => {
        console.log(`    [${i+1}] "${c.title}" by "${c.artist}" - ${c.durationMs}ms (synced: ${!!c.syncedLyrics})`);
    });
    
    // Step 4: Test YouTube Duration Fallback
    console.log('\n[STEP 4] Testing YouTube Duration Fallback...');
    const ytStart = Date.now();
    const ytDuration = await LyricsMatcher.getYouTubeDurationFallback(TITLE, ARTIST);
    const ytTime = Date.now() - ytStart;
    
    results.steps.push({
        name: 'YouTube Duration Fallback',
        input: { title: TITLE, artist: ARTIST },
        output: ytDuration,
        durationMs: ytTime,
        passed: ytDuration !== null,
        note: ytDuration ? `Found: ${ytDuration}ms` : 'YouTube search failed'
    });
    console.log(`  Result: ${ytDuration ? `${ytDuration}ms` : 'null'} (${ytTime}ms)`);
    
    // Step 5: Test Full Handshake
    console.log('\n[STEP 5] Testing Full LyricsMatcher Handshake...');
    const handshakeStart = Date.now();
    const handshakeResult = await LyricsMatcher.match(TITLE, ARTIST);
    const handshakeTime = Date.now() - handshakeStart;
    
    results.steps.push({
        name: 'Full Handshake',
        input: { title: TITLE, artist: ARTIST },
        output: {
            success: handshakeResult.success,
            lockedDurationMs: handshakeResult.lockedDurationMs,
            fallbackUsed: handshakeResult.fallbackUsed,
            candidateCount: handshakeResult.candidates?.length || 0,
            lockedCandidate: handshakeResult.lockedCandidate ? {
                title: handshakeResult.lockedCandidate.title,
                artist: handshakeResult.lockedCandidate.artist,
                durationMs: handshakeResult.lockedCandidate.durationMs
            } : null
        },
        durationMs: handshakeTime,
        passed: handshakeResult.success && handshakeResult.lockedDurationMs !== null,
        note: handshakeResult.success 
            ? `Locked: ${handshakeResult.lockedDurationMs}ms via ${handshakeResult.fallbackUsed}`
            : 'Handshake failed'
    });
    
    console.log(`  Success: ${handshakeResult.success}`);
    console.log(`  Locked Duration: ${handshakeResult.lockedDurationMs}ms`);
    console.log(`  Fallback Used: ${handshakeResult.fallbackUsed}`);
    console.log(`  Candidates: ${handshakeResult.candidates?.length || 0}`);
    if (handshakeResult.lockedCandidate) {
        console.log(`  Locked Candidate: "${handshakeResult.lockedCandidate.title}" by "${handshakeResult.lockedCandidate.artist}"`);
    }
    
    // Determine overall pass/fail
    results.finalResult = {
        success: handshakeResult.success,
        durationLocked: handshakeResult.lockedDurationMs !== null,
        fallbackUsed: handshakeResult.fallbackUsed,
        totalDurationMs: handshakeTime
    };
    
    // Pass if we got a locked duration (either from MusicBrainz or YouTube fallback)
    results.pass = handshakeResult.success && handshakeResult.lockedDurationMs !== null;
    
    console.log('\n' + '='.repeat(80));
    console.log(`FINAL RESULT: ${results.pass ? 'PASS' : 'FAIL'}`);
    console.log(`Duration Locked: ${results.finalResult.durationLocked}`);
    console.log(`Fallback Method: ${results.finalResult.fallbackUsed}`);
    console.log(`Total Time: ${results.finalResult.totalDurationMs}ms`);
    console.log('='.repeat(80));
    
    // Write results to JSON for output file generation
    const fs = require('fs');
    fs.writeFileSync(
        __dirname + '/test_results.json', 
        JSON.stringify(results, null, 2)
    );
    console.log('\nResults saved to scratch/test_results.json');
    
    return results;
}

testFallback().catch(console.error);
