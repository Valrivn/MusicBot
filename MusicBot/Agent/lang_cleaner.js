const fs = require('fs');
const path = require('path');

const langDir = path.join(__dirname, '..', 'languages');
if (!fs.existsSync(langDir)) {
    console.error('Languages directory not found!');
    process.exit(1);
}

const files = fs.readdirSync(langDir).filter(f => f.endsWith('.json'));
let modifiedCount = 0;

function cleanNode(node, pathKey) {
    if (typeof node === 'string') {
        if (node.includes('Spotify')) {
            return node.replace(/Spotify/g, 'MusicBrainz');
        }
        return node;
    } else if (Array.isArray(node)) {
        return node.map((item) => cleanNode(item, pathKey));
    } else if (typeof node === 'object' && node !== null) {
        const result = {};
        for (const [key, value] of Object.entries(node)) {
            // Delete specific Spotify-related keys entirely
            if (key === 'spotify' || key === 'platform_name_spotify' || key === 'spotify_no_match') {
                continue;
            }
            
            // Delete the youtube_not_found_spotify key in musicplayer
            if (key === 'youtube_not_found_spotify') {
                continue;
            }
            
            const newVal = cleanNode(value, key);
            if (newVal !== undefined) result[key] = newVal;
        }
        return result;
    }
    return node;
}

for (const file of files) {
    const filePath = path.join(langDir, file);
    try {
        let content = fs.readFileSync(filePath, 'utf-8');
        const originalData = JSON.parse(content);
        
        const cleanedData = cleanNode(originalData, 'root');
        const newContent = JSON.stringify(cleanedData, null, 2) + '\n';
        
        if (content !== newContent) {
            fs.writeFileSync(filePath, newContent, 'utf-8');
            modifiedCount++;
            console.log(`✅ Cleaned ${file}`);
        }
    } catch (err) {
        console.error(`❌ Error processing ${file}: ${err.message}`);
    }
}

console.log(`\n🎉 Successfully cleaned ${modifiedCount} language files.`);
