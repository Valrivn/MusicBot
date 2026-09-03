const youtubedl = require('youtube-dl-exec');
const url = "https://music.youtube.com/search?q=%22It%27s%20My%20Life%22%20Bon%20Jovi%20Official%20Audio%20Topic";
console.log("Calling youtubedl directly for:", url);
youtubedl(url, {
    dumpSingleJson: true,
    flatPlaylist: true,
    playlistEnd: 20
}).then(res => {
    console.log("Success! Entries:", res.entries ? res.entries.length : "none");
}).catch(err => {
    console.error("Direct Error:", err);
});
