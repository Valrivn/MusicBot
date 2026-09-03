// test-fuzzy.js
const MusicBrainzClient = require('./src/musicbrainz/MusicBrainzClient');

const testCases = [
    { target: "aha", candidate: "a-ha", expected: true },
    { target: "The Fray", candidate: "Fray, The", expected: true },
    { target: "Bon Jovi", candidate: "Bon Jovi", expected: true },
    { target: "Bon Jovi", candidate: "Jon Bon Jovi", expected: true },
    { target: "Aha", candidate: "Trash Pour 4", expected: false }
];

testCases.forEach(tc => {
    const score = MusicBrainzClient._getSimilarityScore(tc.target, tc.candidate);
    const passed = score >= 0.75;
    console.log(`[TEST] "${tc.target}" vs "${tc.candidate}" -> Score: ${score.toFixed(2)} | Passed: ${passed} (Expected: ${tc.expected})`);
});