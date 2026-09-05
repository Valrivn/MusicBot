const { runHttpRequest } = require('./resilience/external-calls');
const path = require('path');
const LanguageManager = require('./LanguageManager');

class DirectLink {
    static supportedFormats = [
        '.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.wma', '.opus',
        '.webm', '.mp4', '.mkv', '.avi', '.mov'
    ];

    static async getInfo(url, guildId = null) {
        try {
            if (!this.isDirectAudioLink(url)) {
                throw new Error(await LanguageManager.getTranslation(guildId, 'directlink.not_supported'));
            }

            const response = await runHttpRequest(url, { 
                method: 'HEAD', 
                timeout: 10000 
            });
            const contentType = response.headers.get('content-type') || '';
            const contentLength = response.headers.get('content-length');

            const urlPath = new URL(url).pathname;
            const filename = path.basename(urlPath) || await LanguageManager.getTranslation(guildId, 'directlink.unknown_file');
            const extension = path.extname(filename).toLowerCase();

            const estimatedDuration = this.estimateDuration(contentLength, contentType);

            const track = {
                title: this.extractTitle(filename, guildId),
                artist: await LanguageManager.getTranslation(guildId, 'directlink.artist'),
                url: url,
                duration: estimatedDuration,
                thumbnail: this.getDefaultThumbnail(extension),
                platform: 'direct',
                type: 'track',
                id: this.generateId(url),
                fileSize: contentLength ? parseInt(contentLength) : null,
                contentType: contentType,
                extension: extension,
                filename: filename,
            };

            return track;

        } catch (error) {
            return null;
        }
    }

    static async getStream(url, guildId = null, startSeconds = 0) {
        try {
            if (!this.isDirectAudioLink(url)) {
                throw new Error(await LanguageManager.getTranslation(guildId, 'directlink.not_supported'));
            }

            const response = await runHttpRequest(url, {
                method: 'GET',
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            return response.body;

        } catch (error) {
            throw error;
        }
    }

    static isDirectAudioLink(url) {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname.toLowerCase();

            const hasAudioExtension = this.supportedFormats.some(format =>
                pathname.endsWith(format)
            );

            const isHttpLink = urlObj.protocol === 'http:' || urlObj.protocol === 'https:';

            return isHttpLink && hasAudioExtension;

        } catch (error) {
            return false;
        }
    }

    static async validateUrl(url) {
        try {
            if (!this.isDirectAudioLink(url)) {
                return false;
            }

            const response = await runHttpRequest(url, {
                method: 'HEAD',
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            const contentType = response.headers.get('content-type') || '';
            const isAudio = contentType.startsWith('audio/') ||
                contentType.startsWith('video/') ||
                contentType.includes('octet-stream');

            return response.ok && isAudio;

        } catch (error) {
            return false;
        }
    }

    static async extractTitle(filename, guildId = null) {
        const nameWithoutExt = path.parse(filename).name;

        let title = nameWithoutExt
            .replace(/[-_\.]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        title = title.replace(/\b\w/g, l => l.toUpperCase());

        return title || await LanguageManager.getTranslation(guildId, 'directlink.unknown_title');
    }

    static generateId(url) {
        return Buffer.from(url).toString('base64').substring(0, 16);
    }

    static getDefaultThumbnail(extension) {
        const thumbnails = {
            '.mp3': 'https://cdn-icons-png.flaticon.com/512/2611/2611282.png',
            '.wav': 'https://cdn-icons-png.flaticon.com/512/8263/8263222.png',
            '.flac': 'https://cdn-icons-png.flaticon.com/512/8300/8300336.png',
            '.ogg': 'https://cdn-icons-png.flaticon.com/512/8744/8744689.png',
            '.m4a': 'https://cdn-icons-png.flaticon.com/512/730/730939.png',
        };

        return thumbnails[extension] || 'https://cdn-icons-png.freepik.com/512/3871/3871560.png';
    }

    static estimateDuration(fileSize, contentType) {
        if (!fileSize) return 0;

        let estimatedBitrate = 128;

        if (contentType.includes('mp3')) {
            estimatedBitrate = 128;
        } else if (contentType.includes('wav')) {
            estimatedBitrate = 1411;
        } else if (contentType.includes('flac')) {
            estimatedBitrate = 1000;
        } else if (contentType.includes('ogg')) {
            estimatedBitrate = 160;
        }

        const fileSizeBits = fileSize * 8;
        const bitratePerSecond = estimatedBitrate * 1000;
        const estimatedSeconds = Math.floor(fileSizeBits / bitratePerSecond);

        return Math.max(0, estimatedSeconds);
    }

    static async formatFileSize(bytes, guildId = null) {
        if (!bytes) return await LanguageManager.getTranslation(guildId, 'directlink.unknown_size');

        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
    }

    static getFileExtension(url) {
        try {
            const urlPath = new URL(url).pathname;
            return path.extname(urlPath).toLowerCase();
        } catch (error) {
            return '';
        }
    }

    static async getFileMetadata(url) {
        try {
            const response = await runHttpRequest(url, { method: 'HEAD', timeout: 10000 });

            return {
                contentType: response.headers.get('content-type'),
                contentLength: response.headers.get('content-length'),
                lastModified: response.headers.get('last-modified'),
                server: response.headers.get('server'),
                acceptRanges: response.headers.get('accept-ranges'),
            };

        } catch (error) {
            return null;
        }
    }

    static async downloadAndCache(url, cacheDir) {
        return url;
    }

    static isSupportedFormat(extension) {
        return this.supportedFormats.includes(extension.toLowerCase());
    }

    static async testStreamability(url) {
        try {
            const response = await runHttpRequest(url, {
                method: 'GET',
                headers: {
                    'Range': 'bytes=0-1024'
                },
                timeout: 5000
            });

            return response.status === 206 || response.status === 200;

        } catch (error) {
            return false;
        }
    }

    static extractMetadataFromUrl(url, guildId = null) {
        try {
            const urlObj = new URL(url);
            const filename = path.basename(urlObj.pathname);
            const extension = path.extname(filename);

            return {
                filename: filename,
                extension: extension,
                host: urlObj.hostname,
                path: urlObj.pathname,
                protocol: urlObj.protocol,
                title: this.extractTitle(filename, guildId)
            };

        } catch (error) {
            return null;
        }
    }

    static async analyzeAudioFile(url, guildId = null) {
        try {
            const metadata = await this.getFileMetadata(url);
            const urlInfo = this.extractMetadataFromUrl(url, guildId);

            return {
                ...metadata,
                ...urlInfo,
                isStreamable: await this.testStreamability(url)
            };

        } catch (error) {
            return null;
        }
    }

    static async createFileInfoEmbed(fileInfo, guildId = null) {
        const embed = {
            title: await LanguageManager.getTranslation(guildId, 'directlink.embed_title'),
            description: `**${fileInfo.title}**`,
            fields: [
                {
                    name: await LanguageManager.getTranslation(guildId, 'directlink.embed_filename'),
                    value: fileInfo.filename,
                    inline: true
                },
                {
                    name: await LanguageManager.getTranslation(guildid, 'directlink.embed_filesize'),
                    value: this.formatFileSize(fileInfo.fileSize, guildId),
                    inline: true
                },
                {
                    name: await LanguageManager.getTranslation(guildId, 'directlink.embed_format'),
                    value: fileInfo.extension.toUpperCase().replace('.', ''),
                    inline: true
                }
            ]
        };

        if (fileInfo.duration > 0) {
            embed.fields.push({
                name: await LanguageManager.getTranslation(guildId, 'directlink.embed_duration'),
                value: this.formatDuration(fileInfo.duration),
                inline: true
            });
        }

        return embed;
    }

    static formatDuration(seconds) {
        if (!seconds || seconds === 0) return '0:00';

        const totalSeconds = Math.floor(Number(seconds) || 0);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const remainingSeconds = totalSeconds % 60;

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
        }
    }
}

module.exports = DirectLink;