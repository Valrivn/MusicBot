const crypto = require('crypto');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { Readable } = require('stream');
const prism = require('prism-media');
const ffmpegPath = require('ffmpeg-static');
const StreamResolver = require('./StreamResolver');

const CACHE_DIR = path.join(__dirname, '..', '..', 'audio_cache');

let cachedFetch;
async function ensureFetch() {
    if (cachedFetch) return cachedFetch;
    if (typeof global.fetch === 'function') {
        cachedFetch = global.fetch.bind(global);
    } else {
        const mod = await import('node-fetch');
        cachedFetch = mod.default;
    }
    return cachedFetch;
}

class DownloadManager {
    static downloadingFiles = new Set();
    static downloadedFiles = new Set();

    /**
     * Downloads a track stream or URL directly to disk for playback caching.
     */
    static async downloadTrack(track, streamUrl, streamInfo, player) {
        const hash = crypto.createHash('md5').update(track.url).digest('hex');
        const extension = '.opus';
        const filename = `track_${hash}${extension}`;
        const filepath = path.join(CACHE_DIR, filename);
        
        try {
            if (fsSync.existsSync(filepath)) {
                const stats = await fs.stat(filepath);
                if (stats.size > 0) {
                    this.downloadedFiles.add(filepath);
                    if (player) player.scheduleStatePersist('download-cache-hit', 500);
                    return filepath;
                }
            }

            if (this.downloadingFiles.has(filepath)) {
                for (let i = 0; i < 60; i++) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    if (fsSync.existsSync(filepath)) {
                        const stats = await fs.stat(filepath);
                        if (stats.size > 0) {
                            this.downloadedFiles.add(filepath);
                            if (player) player.scheduleStatePersist('download-wait-complete', 500);
                            return filepath;
                        }
                    }
                }
                this.downloadingFiles.delete(filepath);
                throw new Error('Download timeout - file not ready after 60 seconds');
            }

            this.downloadingFiles.add(filepath);

            let downloadUrl;
            try {
                downloadUrl = await StreamResolver.resolveDownloadUrl(track, player?.guild?.id);
                if (track.platform === 'soundcloud' && !track.youtubeUrl) {
                    track.youtubeUrl = downloadUrl;
                }
            } catch (err) {
                this.downloadingFiles.delete(filepath);
                throw err;
            }

            if (track.platform === 'youtube' || track.platform === 'soundcloud') {
                const youtubedl = require('youtube-dl-exec');
                await youtubedl(downloadUrl, {
                    output: filepath,
                    format: 'bestaudio',
                    noCheckCertificates: true,
                    noWarnings: true,
                    preferFreeFormats: true,
                    addHeader: [
                        'referer:youtube.com',
                        'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    ],
                    postprocessorArgs: {
                        'ffmpeg': ['-c:a', 'libopus', '-b:a', '128k']
                    },
                    extractAudio: true,
                    audioFormat: 'opus'
                });
            } else {
                const fetch = await ensureFetch();
                const response = await fetch(streamUrl, {
                    headers: streamInfo?.httpHeaders || {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });

                if (!response.ok) {
                    this.downloadingFiles.delete(filepath);
                    throw new Error(`Failed to fetch: ${response.status}`);
                }

                let audioStream = typeof response.body?.getReader === 'function' && typeof Readable.fromWeb === 'function'
                    ? Readable.fromWeb(response.body)
                    : response.body;

                const ffmpegProcess = new prism.FFmpeg({
                    command: ffmpegPath,
                    args: [
                        '-i', 'pipe:0',
                        '-f', 'opus',
                        '-ar', '48000',
                        '-ac', '2',
                        '-b:a', '128k',
                        '-y',
                        filepath
                    ]
                });

                audioStream.pipe(ffmpegProcess);

                await new Promise((resolve, reject) => {
                    ffmpegProcess.on('close', (code) => {
                        if (code === 0) resolve();
                        else reject(new Error(`FFmpeg exited with code ${code}`));
                    });
                    ffmpegProcess.on('error', reject);
                });
            }

            const stats = await fs.stat(filepath);
            if (stats.size === 0) {
                await fs.unlink(filepath).catch(() => {});
                this.downloadingFiles.delete(filepath);
                throw new Error('Downloaded file is empty');
            }

            this.downloadedFiles.add(filepath);
            this.downloadingFiles.delete(filepath);
            if (player) player.scheduleStatePersist('download-complete', 500);
            return filepath;

        } catch (error) {
            this.downloadingFiles.delete(filepath);
            console.error(`❌ Download failed for ${track.title}:`, error.message);
            throw error;
        }
    }

    /**
     * Safely deletes a cached downloaded file and updates the state.
     */
    static async deleteDownloadedFile(filepath, player) {
        if (!filepath) return;
        try {
            await fs.unlink(filepath);
            this.downloadedFiles.delete(filepath);
            if (player) player.scheduleStatePersist('download-removed', 500);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error(`❌ Failed to delete file ${filepath}:`, error.message);
            }
        }
    }
}

module.exports = DownloadManager;
