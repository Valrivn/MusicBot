const { MediaSource } = require('../media-source');
const ytDlpWrap = require('yt-dlp-wrap').default;
const path = require('path');
const config = require('../../../config');

const binaryPath = path.join(__dirname, '..', '..', '..', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const ytDlp = new ytDlpWrap(binaryPath);

class YouTubeSource extends MediaSource {
    constructor() {
        super('youtube');
    }

    _getYtDlpOptions(extraOptions = {}) {
        const baseOptions = {
            noCheckCertificates: true,
            noWarnings: true,
            retries: 3,
            fragmentRetries: 3,
            addHeader: [
                'referer:youtube.com',
                'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            ],
            ...extraOptions
        };

        if (config.ytdl.poToken) {
            baseOptions.extractorArgs = `youtube:po_token=web+${config.ytdl.poToken};player_client=web`;
        } else if (config.ytdl.cookiesFromBrowser) {
            baseOptions.cookiesFromBrowser = config.ytdl.cookiesFromBrowser;
        } else if (config.ytdl.cookiesFile) {
            baseOptions.cookies = config.ytdl.cookiesFile;
        } else {
            baseOptions.extractorArgs = 'youtube:player_client=web';
        }

        return baseOptions;
    }

    async resolve(query) {
        if (!query || !query.trim()) {
            return [];
        }

        const isUrl = this._isYouTubeURL(query);
        const searchCommand = isUrl ? query : `ytsearch10:${query.trim()}`;
        const ytDlpOptions = this._getYtDlpOptions();

        try {
            const args = [
                searchCommand,
            ];

            if (isUrl) {
                args.push('-f', 'bestaudio', '--dump-json', '--skip-download');
            } else {
                args.push(
                    '--extractor-args', ytDlpOptions.extractorArgs || 'youtube:player_client=web',
                    '--flat-playlist',
                    '--skip-download', '--dump-json'
                );
            }

            // Add cookies if configured
            if (ytDlpOptions.cookies) {
                args.push('--cookies', ytDlpOptions.cookies);
            } else if (ytDlpOptions.cookiesFromBrowser) {
                args.push('--cookies-from-browser', ytDlpOptions.cookiesFromBrowser);
            }

            // Add headers
            if (ytDlpOptions.addHeader) {
                for (const header of ytDlpOptions.addHeader) {
                    args.push('--add-header', header);
                }
            }

            const ytDlpEventEmitter = ytDlp.exec(args);

            let stdoutBuffer = '';
            ytDlpEventEmitter.ytDlpProcess.stdout.on('data', (data) => { stdoutBuffer += data; });

            const results = await new Promise((resolve, reject) => {
                ytDlpEventEmitter.on('close', () => {
                    const lines = stdoutBuffer.split('\n').filter(l => l.trim() !== '');
                    try {
                        resolve(lines.map(l => JSON.parse(l)));
                    } catch (err) {
                        reject(err);
                    }
                });
                ytDlpEventEmitter.on('error', (err) => reject(err));
            });

            if (!results || results.length === 0) {
                return [];
            }

            return results.map(candidate => ({
                url: candidate.webpage_url || candidate.url || (candidate.id ? `https://www.youtube.com/watch?v=${candidate.id}` : null),
                title: candidate.title || candidate.fulltitle || 'Unknown Title',
                duration: candidate.duration || 0,
                thumbnail: candidate.thumbnail || (candidate.thumbnails?.length ? candidate.thumbnails[candidate.thumbnails.length - 1].url : null),
                source: 'youtube',
                quality: this._determineQuality(candidate),
                id: candidate.id
            }));

        } catch (err) {
            console.warn(`[YouTubeSource] Search failed for query "${query}":`, err.message);
            return [];
        }
    }

    async probe(url) {
        try {
            const info = await this._getStreamInfo(url);
            if (!info || !info.url) return null;

            return {
                codec: info.acodec?.includes('opus') ? 'opus' : (info.acodec || 'unknown'),
                bitrate: info.abr || info.tbr || 0,
                duration: info.duration || 0,
                isStudioCut: true,
                fingerprint: '',
                source: 'youtube'
            };
        } catch (err) {
            console.warn(`[YouTubeSource] Probe failed for ${url}:`, err.message);
            return null;
        }
    }

    async _getStreamInfo(url) {
        const ytDlpOptions = this._getYtDlpOptions({
            dumpSingleJson: true,
            format: 'bestaudio/best',
        });

        const args = [
            url,
            '-f', 'bestaudio',
            '--dump-json',
            '--skip-download',
        ];

        // Add cookies if configured
        if (ytDlpOptions.cookies) {
            args.push('--cookies', ytDlpOptions.cookies);
        } else if (ytDlpOptions.cookiesFromBrowser) {
            args.push('--cookies-from-browser', ytDlpOptions.cookiesFromBrowser);
        } else if (ytDlpOptions.extractorArgs) {
            args.push('--extractor-args', ytDlpOptions.extractorArgs);
        }

        // Add headers
        if (ytDlpOptions.addHeader) {
            for (const header of ytDlpOptions.addHeader) {
                args.push('--add-header', header);
            }
        }

        const ytDlpEventEmitter = ytDlp.exec(args);

        let stdoutBuffer = '';
        ytDlpEventEmitter.ytDlpProcess.stdout.on('data', (data) => { stdoutBuffer += data; });

        return await new Promise((resolve, reject) => {
            ytDlpEventEmitter.on('close', () => {
                const lines = stdoutBuffer.split('\n').filter(l => l.trim() !== '');
                try {
                    const result = lines.map(l => JSON.parse(l))[0];
                    resolve(result);
                } catch (err) {
                    reject(err);
                }
            });
            ytDlpEventEmitter.on('error', (err) => reject(err));
        });
    }

    _isYouTubeURL(url) {
        const patterns = [
            /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/playlist\?list=)/,
            /^https?:\/\/(www\.)?youtube\.com\/embed\/[a-zA-Z0-9_-]+/,
            /^https?:\/\/(www\.)?youtube\.com\/v\/[a-zA-Z0-9_-]+/,
        ];
        return patterns.some(pattern => pattern.test(url));
    }

    _determineQuality(candidate) {
        const format = candidate.format_id || '';
        if (format.includes('251') || format.includes('opus')) return 'high';
        if (format.includes('140') || format.includes('m4a')) return 'medium';
        return 'high';
    }
}

module.exports = YouTubeSource;