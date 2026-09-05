const { runYtdlp, runYtdlpWrap, getYtDlpOptions } = require('./resilience/external-calls');
const config = require('../config');
const LanguageManager = require('./LanguageManager');

class SoundCloud {
    static async search(query, limit = 1, guildId = null) {
        try {
            if (this.isSoundCloudURL(query)) {
                const info = await this.getInfo(query, guildId);
                return info ? [info] : [];
            }

            const searchQuery = `ytsearch${limit}:${query} site:soundcloud.com`;

            const results = await runYtdlpWrap([
                searchQuery,
                '--extractor-args', 'youtube:player_client=web',
                '--flat-playlist', '--skip-download', '--dump-json'
            ]);

            if (!results || !results.entries) {
                return [];
            }

            const tracks = [];
            for (const item of results.entries.slice(0, limit)) {
                try {
                    if (item.webpage_url && item.webpage_url.includes('soundcloud.com')) {
                        const track = await this.formatTrack(item, guildId);
                        if (track) {
                            tracks.push(track);
                        }
                    }
                } catch (error) {
                    continue;
                }
            }

            return tracks;

        } catch (error) {
            return [];
        }
    }

    static async getInfo(url, guildId = null) {
        try {
            const info = await runYtdlp(url, getYtDlpOptions({
                dumpSingleJson: true,
            }));

            if (!info) {
                const errorMsg = guildId ? await LanguageManager.getTranslation(guildId, 'soundcloud.no_info_returned') : 'No info returned from SoundCloud';
                throw new Error(errorMsg);
            }

            const track = await this.formatTrack(info, guildId);

            return track;

        } catch (error) {
            return null;
        }
    }

    static async getStream(url, guildId = null, startSeconds = 0) {
        try {
            const result = await runYtdlp(url, getYtDlpOptions({
                format: 'bestaudio/best',
                getUrl: true,
            }));

            if (!result) {
                const errorMsg = guildId ? await LanguageManager.getTranslation(guildId, 'soundcloud.no_stream_url') : 'No stream URL found';
                throw new Error(errorMsg);
            }

            return result;

        } catch (error) {
            throw error;
        }
    }

    static async getPlaylist(url, guildId = null) {
        try {
            const result = await runYtdlp(url, getYtDlpOptions({
                dumpSingleJson: true,
                flatPlaylist: true,
            }));

            if (!result || !result.entries) {
                const errorMsg = guildId ? await LanguageManager.getTranslation(guildId, 'soundcloud.no_playlist_tracks') : 'No playlist tracks found';
                throw new Error(errorMsg);
            }

            const tracks = [];
            for (const item of result.entries.slice(0, config.bot.maxPlaylistSize)) {
                const formattedTrack = await this.formatTrack(item, guildId);
                if (formattedTrack) {
                    tracks.push(formattedTrack);
                }
            }

            const unknownPlaylist = guildId ? await LanguageManager.getTranslation(guildId, 'soundcloud.unknown_playlist') : 'Unknown Playlist';

            return {
                title: result.title || result.playlist_title || unknownPlaylist,
                tracks: tracks,
                totalTracks: result.playlist_count || tracks.length,
                url: url,
                platform: 'soundcloud',
                type: 'playlist',
                description: result.description,
                user: result.uploader || result.playlist_uploader,
            };

        } catch (error) {
            return null;
        }
    }

    static async getUserTracks(userUrl, limit = 10, guildId = null) {
        try {
            const result = await runYtdlp(userUrl, getYtDlpOptions({
                dumpSingleJson: true,
                flatPlaylist: true,
                playlistEnd: limit,
            }));

            if (!result || !result.entries) {
                return [];
            }

            const tracks = [];
            for (const item of result.entries.slice(0, limit)) {
                const formattedTrack = await this.formatTrack(item, guildId);
                if (formattedTrack) {
                    tracks.push(formattedTrack);
                }
            }

            return tracks;

        } catch (error) {
            return [];
        }
    }

    static async formatTrack(soundcloudTrack, guildId = null) {
        try {
            const unknownTitle = guildId ? await LanguageManager.getTranslation(guildId, 'soundcloud.unknown_title') : 'Unknown Title';
            const unknownArtist = guildId ? await LanguageManager.getTranslation(guildId, 'soundcloud.unknown_artist') : 'Unknown Artist';

            const track = {
                title: soundcloudTrack.title || soundcloudTrack.fulltitle || unknownTitle,
                artist: soundcloudTrack.uploader || soundcloudTrack.artist || unknownArtist,
                url: soundcloudTrack.webpage_url || soundcloudTrack.url,
                duration: soundcloudTrack.duration || 0,
                thumbnail: soundcloudTrack.thumbnail,
                platform: 'soundcloud',
                type: 'track',
                id: soundcloudTrack.id,
                description: soundcloudTrack.description,
                uploadDate: soundcloudTrack.upload_date,
                viewCount: soundcloudTrack.view_count,
                likeCount: soundcloudTrack.like_count,
                channel: soundcloudTrack.channel,
                channelId: soundcloudTrack.channel_id,
            };

            return track;
        } catch (error) {
            return null;
        }
    }

    static isSoundCloudURL(url) {
        const patterns = [
            /^https?:\/\/(www\.)?soundcloud\.com\/[\w-]+\/[\w-]+/,
            /^https?:\/\/(www\.)?soundcloud\.com\/[\w-]+\/sets\/[\w-]+/,
            /^https?:\/\/(www\.)?soundcloud\.com\/[\w-]+$/,
        ];
        return patterns.some(pattern => pattern.test(url));
    }

    static isPlaylist(url) {
        return url.includes('/sets/');
    }

    static isTrack(url) {
        return this.isSoundCloudURL(url) && !this.isPlaylist(url) && !this.isUser(url);
    }

    static isUser(url) {
        const match = url.match(/^https?:\/\/(www\.)?soundcloud\.com\/([\w-]+)$/);
        return !!match;
    }

    static extractUsername(url) {
        const match = url.match(/^https?:\/\/(www\.)?soundcloud\.com\/([\w-]+)/);
        return match ? match[2] : null;
    }

    static extractTrackSlug(url) {
        const match = url.match(/^https?:\/\/(www\.)?soundcloud\.com\/[\w-]+\/([\w-]+)/);
        return match ? match[2] : null;
    }

    static extractPlaylistSlug(url) {
        const match = url.match(/^https?:\/\/(www\.)?soundcloud\.com\/[\w-]+\/sets\/([\w-]+)/);
        return match ? match[2] : null;
    }

    static async validateUrl(url) {
        try {
            if (!this.isSoundCloudURL(url)) {
                return false;
            }

            const info = await runYtdlp(url, getYtDlpOptions({
                dumpSingleJson: true,
            }));
            return !!info && !!info.title;

        } catch (error) {
            return false;
        }
    }

    static formatDuration(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;

        if (minutes >= 60) {
            const hours = Math.floor(minutes / 60);
            const remainingMinutes = minutes % 60;
            return `${hours}:${remainingMinutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
        }
    }

    static createTrackUrl(username, trackSlug) {
        return `https://soundcloud.com/${username}/${trackSlug}`;
    }

    static createPlaylistUrl(username, playlistSlug) {
        return `https://soundcloud.com/${username}/sets/${playlistSlug}`;
    }

    static createUserUrl(username) {
        return `https://soundcloud.com/${username}`;
    }

    static async getRelatedTracks(trackUrl, limit = 5) {
        try {
            return [];
        } catch (error) {
            return [];
        }
    }

    static async searchAdvanced(query, options = {}, guildId = null) {
        try {
            return await this.search(query, options.limit || 20, guildId);
        } catch (error) {
            return [];
        }
    }
}

module.exports = SoundCloud;