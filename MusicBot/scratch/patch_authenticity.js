const fs = require('fs');
const path = require('path');

const filePaths = [
    'c:/Bot/MusicBot/src/MusicPlayer.js',
    'c:/Bot/MusicBot/index.js'
];

filePaths.forEach(filePath => {
    if (!fs.existsSync(filePath)) {
        console.error(`File does not exist: ${filePath}`);
        return;
    }

    let content = fs.readFileSync(filePath, 'utf8');

    // 1. Update spotifyMetadata object creations to include artist
    const metadataRegex = /spotifyMetadata = \{\s*durationMs:\s*spotifyTracks\[0\]\.duration \* 1000,\s*albumName:\s*spotifyTracks\[0\]\.album \|\| ''\s*\};/g;
    const replacementMetadata = `spotifyMetadata = {
                                                artist: spotifyTracks[0].artist,
                                                durationMs: spotifyTracks[0].duration * 1000,
                                                albumName: spotifyTracks[0].album || ''
                                            };`;
    content = content.replace(metadataRegex, replacementMetadata);

    // Also handle indentation variance
    const metadataRegex2 = /spotifyMetadata = \{\s*durationMs:\s*spotifyTracks\[0\]\.duration \* 1000,\s*albumName:\s*spotifyTracks\[0\]\.album \|\| ''\s*\}/g;
    content = content.replace(metadataRegex2, `spotifyMetadata = { artist: spotifyTracks[0].artist, durationMs: spotifyTracks[0].duration * 1000, albumName: spotifyTracks[0].album || '' }`);

    // 2. Update refArtist normalization in penalty engine
    content = content.replace(
        /const refArtist = \(spotifyMetadata\?\.artist \|\| 'Bon Jovi'\)\.toLowerCase\(\);/g,
        "const refArtist = (spotifyMetadata?.artist ? spotifyMetadata.artist.split(',')[0].trim() : 'Bon Jovi').toLowerCase();"
    );

    // 3. Inject Channel Authenticity Weights inside the scoredCandidates map
    const mapRegex = /const channelLower = \(candidate\.channelName \|\| candidate\.uploader \|\| candidate\.artist \|\| ''\)\.toLowerCase\(\);/g;
    const replacementMap = `const channelLower = (candidate.channelName || candidate.uploader || candidate.artist || '').toLowerCase();
                                
                                // 1. Strict Exact Artist Channel Match Bonus
                                // If the channel name is EXACTLY the artist name (e.g., "bon jovi"), give it an absolute priority boost
                                if (channelLower === refArtist) {
                                    totalPenalty -= 3000; // Guarantees the verified artist channel wins over fan uploads
                                    console.log(\`💎 [AUTHENTICITY] Exact Artist Channel Match detected for: "\${candidate.title}"\`);
                                }

                                // 2. Unofficial / Fan Upload Penalty
                                // If the channel name contains known bootleg/re-upload keywords, penalize it heavily
                                const bootlegKeywords = ['remaster', 'hq audio', 'bootleg', 'fan', 'lyrics', 'edit', 'upload', 'records', 'music channel'];
                                const isBootlegChannel = bootlegKeywords.some(keyword => channelLower.includes(keyword));

                                if (isBootlegChannel && channelLower !== refArtist) {
                                    totalPenalty += 1500; // Keeps third-party lyric and audio channels from hijacking the stream
                                    console.log(\`⚠️ [AUTHENTICITY] Penalizing unofficial community channel: "\${candidate.channelName || candidate.uploader || candidate.artist}"\`);
                                }`;

    content = content.replace(mapRegex, replacementMap);

    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Successfully patched authenticity rules in: ${filePath}`);
});
