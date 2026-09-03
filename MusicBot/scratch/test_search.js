const axios = require('axios');
const config = require('../config');

async function testSearch(query) {
    console.log(`Searching for: "${query}"`);
    // Connect to local Lavalink node or call node.rest.resolve
    // Since Lavalink is running, we can request it via API if there's a running client,
    // or request Lavalink REST API directly: http://localhost:2333/v4/loadtracks?identifier=ytmsearch:query
    // Let's check Lavalink password and port from config or index.js: localhost:2333, password 'youshallnotpass'
    
    const prefixes = ['ytmsearch:', 'ytsearch:'];
    const allScoredTracks = [];

    try {
        const lowerQuery = query.toLowerCase();
        let targetArtist = null;
        let targetTitle = lowerQuery;
        if (lowerQuery.includes(' by ')) {
            const parts = lowerQuery.split(' by ');
            targetTitle = parts[0].trim();
            targetArtist = parts[1].trim();
        } else if (lowerQuery.includes(' - ')) {
            const parts = lowerQuery.split(' - ');
            targetTitle = parts[0].trim();
            targetArtist = parts[1].trim();
        }

        const isRemixInQuery = lowerQuery.includes('remix');
        const isAlternativeInQuery = lowerQuery.includes('alternative') || lowerQuery.includes('ver') || lowerQuery.includes('version');
        const isNightcoreInQuery = lowerQuery.includes('nightcore');
        const isDaycoreInQuery = lowerQuery.includes('daycore');

        console.log(`Target Title: "${targetTitle}", Target Artist: "${targetArtist}"`);

        for (const prefix of prefixes) {
            console.log(`Querying prefix: ${prefix}`);
            const url = `http://localhost:2333/v4/loadtracks?identifier=${prefix}${encodeURIComponent(query)}`;
            const response = await axios.get(url, {
                headers: { 'Authorization': 'youshallnotpass' }
            });
            
            const result = response.data;
            const tracks = result.data.tracks || result.data || [];
            console.log(`  Found ${tracks.length} tracks.`);

            const limit = Math.min(tracks.length, 10);
            for (let i = 0; i < limit; i++) {
                const track = tracks[i];
                const title = (track.info?.title || track.title || '').toLowerCase();
                const artist = (track.info?.author || track.author || track.artist || '').toLowerCase();

                let score = 0;
                score += (limit - i) * 2; // Position bias

                if (title.includes(targetTitle)) {
                    score += 50;
                }

                if (targetArtist) {
                    const artistWords = targetArtist.split(/\s+/).filter(w => w.length > 2);
                    const artistMatch = artist.includes(targetArtist) || title.includes(targetArtist);
                    const fuzzyMatch = (targetArtist.includes('stetson') && (artist.includes('stenson') || title.includes('stenson'))) ||
                                      (targetArtist.includes('stenson') && (artist.includes('stetson') || title.includes('stetson'))) ||
                                      (artistWords.length > 0 && artistWords.every(word => artist.includes(word) || title.includes(word)));

                    if (artistMatch || fuzzyMatch) {
                        score += 150;
                    } else {
                        score -= 100;
                    }
                }

                if (!isNightcoreInQuery && (title.includes('nightcore') || title.includes('daycore'))) {
                    score -= 200;
                }
                if (!isRemixInQuery && (title.includes('remix') || title.includes('cover') || title.includes('tribute') || title.includes('karaoke'))) {
                    score -= 100;
                }
                if (!isAlternativeInQuery && (title.includes('ver.') || title.includes('ver ') || title.includes('version') || title.includes('alternative'))) {
                    score -= 100;
                }

                allScoredTracks.push({
                    title: track.info.title,
                    author: track.info.author,
                    uri: track.info.uri,
                    prefix,
                    score
                });
            }
        }

        // Sort by score
        allScoredTracks.sort((a, b) => b.score - a.score);
        console.log("\nScored Results:");
        allScoredTracks.forEach((s, idx) => {
            console.log(`${idx + 1}. [Score: ${s.score}] (${s.prefix}) "${s.title}" by ${s.author} (${s.uri})`);
        });

    } catch (err) {
        console.error("Search failed:", err.message);
    }
}

const query = process.argv[2] || "writing on the wall by will stenson";
testSearch(query);
