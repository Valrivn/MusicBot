/**
 * Test YouTube transcript extraction for "Writing on the Wall" by Will Stenson
 * Video ID: BW5G7v5PqPc
 */

const YouTube = require('../src/YouTube');

const VIDEO_ID = 'BW5G7v5PqPc';

async function testTranscript() {
    console.log('='.repeat(80));
    console.log(`TEST: YouTube Transcript Extraction`);
    console.log(`Video ID: ${VIDEO_ID}`);
    console.log(`URL: https://www.youtube.com/watch?v=${VIDEO_ID}`);
    console.log('='.repeat(80));
    
    const results = {
        videoId: VIDEO_ID,
        timestamp: new Date().toISOString(),
        steps: [],
        finalResult: null,
        pass: false
    };

    // Step 1: Check cache first
    console.log('\n[STEP 1] Checking transcript cache...');
    const cacheStart = Date.now();
    const cached = YouTube.getTranscript.__proto__ ? null : null; // Just for timing
    
    // Step 2: Fetch transcript
    console.log('\n[STEP 2] Fetching YouTube transcript...');
    const fetchStart = Date.now();
    const transcript = await YouTube.getTranscript(VIDEO_ID);
    const fetchTime = Date.now() - fetchStart;
    
    results.steps.push({
        name: 'YouTube Transcript Fetch',
        input: { videoId: VIDEO_ID },
        output: transcript ? {
            hasSynced: transcript.hasSynced,
            source: transcript.source,
            language: transcript.language,
            plainLength: transcript.plain?.length || 0,
            syncedLength: transcript.synced?.length || 0,
            preview: transcript.plain?.substring(0, 200) + '...'
        } : null,
        durationMs: fetchTime,
        passed: transcript !== null && (transcript.plain || transcript.synced),
        note: transcript 
            ? `Found ${transcript.hasSynced ? 'synced' : 'plain'} transcript (${transcript.language})`
            : 'No transcript available'
    });
    
    if (transcript) {
        console.log(`  ✅ Transcript found!`);
        console.log(`  Source: ${transcript.source}`);
        console.log(`  Language: ${transcript.language}`);
        console.log(`  Has Synced: ${transcript.hasSynced}`);
        console.log(`  Plain Length: ${transcript.plain?.length || 0} chars`);
        console.log(`  Synced Length: ${transcript.synced?.length || 0} chars`);
        console.log(`\n  Preview (first 500 chars):`);
        console.log(`  ${'─'.repeat(76)}`);
        const preview = transcript.plain || transcript.synced?.replace(/\[\d+:\d+\.\d+\]/g, '');
        console.log(`  ${preview?.substring(0, 500) || 'N/A'}`);
        console.log(`  ${'─'.repeat(76)}`);
    } else {
        console.log(`  ❌ No transcript available`);
    }
    
    // Step 3: Test full LyricsManager waterfall with track object
    console.log('\n[STEP 3] Testing full LyricsManager waterfall...');
    const LyricsManager = require('../src/LyricsManager');
    
    const mockTrack = {
        title: 'Writing on the Wall',
        artist: 'Will Stenson',
        url: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
        duration: 277,
        durationMs: 277000,
        lyrics: transcript // Pre-fetched transcript
    };
    
    const waterfallStart = Date.now();
    const lyricsResult = await LyricsManager.fetchLyrics(mockTrack);
    const waterfallTime = Date.now() - waterfallStart;
    
    results.steps.push({
        name: 'LyricsManager Waterfall',
        input: { 
            title: mockTrack.title,
            artist: mockTrack.artist,
            url: mockTrack.url,
            hasPreFetchedLyrics: !!transcript
        },
        output: lyricsResult ? {
            source: lyricsResult.source,
            hasSynced: lyricsResult.hasSynced,
            plainLength: lyricsResult.plain?.length || 0,
            syncedLength: lyricsResult.synced?.length || 0,
            preview: lyricsResult.plain?.substring(0, 200) + '...'
        } : null,
        durationMs: waterfallTime,
        passed: lyricsResult !== null,
        note: lyricsResult 
            ? `Lyrics found via: ${lyricsResult.source}`
            : 'No lyrics found'
    });
    
    if (lyricsResult) {
        console.log(`  ✅ Lyrics found!`);
        console.log(`  Source: ${lyricsResult.source}`);
        console.log(`  Has Synced: ${lyricsResult.hasSynced}`);
        console.log(`  Plain Length: ${lyricsResult.plain?.length || 0} chars`);
        console.log(`  Synced Length: ${lyricsResult.synced?.length || 0} chars`);
    } else {
        console.log(`  ❌ No lyrics found in waterfall`);
    }
    
    // Determine overall pass/fail
    results.finalResult = {
        transcriptAvailable: transcript !== null,
        lyricsFound: lyricsResult !== null,
        source: lyricsResult?.source || 'none',
        totalDurationMs: fetchTime + waterfallTime
    };
    
    results.pass = transcript !== null || lyricsResult !== null;
    
    console.log('\n' + '='.repeat(80));
    console.log(`FINAL RESULT: ${results.pass ? 'PASS' : 'FAIL'}`);
    console.log(`Transcript Available: ${results.finalResult.transcriptAvailable}`);
    console.log(`Lyrics Found: ${results.finalResult.lyricsFound}`);
    console.log(`Source: ${results.finalResult.source}`);
    console.log(`Total Time: ${results.finalResult.totalDurationMs}ms`);
    console.log('='.repeat(80));
    
    // Write results
    const fs = require('fs');
    fs.writeFileSync(
        __dirname + '/test_transcript_results.json', 
        JSON.stringify(results, null, 2)
    );
    console.log('\nResults saved to scratch/test_transcript_results.json');
    
    return results;
}

testTranscript().catch(console.error);
