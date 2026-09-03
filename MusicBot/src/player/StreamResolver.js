const YouTube = require('../YouTube');
const MusicBrainzClient = require('../musicbrainz/MusicBrainzClient');
const CoverArtResolver = require('../musicbrainz/CoverArtResolver');
const SoundCloud = require('../SoundCloud');
const DirectLink = require('../DirectLink');
const LanguageManager = require('../LanguageManager');

class StreamResolver {
    /**
     * Detects the platform based on the query URL.
     */
    static detectPlatform(query) {
        if (query.includes('youtube.com') || query.includes('youtu.be')) {
            return 'youtube';
        } else if (query.includes('soundcloud.com')) {
            return 'soundcloud';
        } else if (query.match(/^https?:\/\/.*\.(mp3|wav|ogg|flac|m4a|aac|wma|opus|webm|mp4)$/i)) {
            return 'direct';
        }
        return 'text';
    }

    /**
     * Resolves the stream info for a given track.
     * ALWAYS fetches fresh stream URL - never uses cached stream URLs.
     */
    static async resolveStream(track, guildId, resumeFromSeconds = 0) {
        let streamUrl = track.url;
        let streamInfo = null;

        console.log(`[StreamResolver] Resolving stream for platform: "${track.platform}", title: "${track.title}"`);

        switch (track.platform) {
            case 'youtube':
                // Always fetch fresh YouTube stream (6-hr valid URL)
                streamInfo = await YouTube.getStream(streamUrl, guildId, resumeFromSeconds);
                break;
            case 'soundcloud':
                streamInfo = await SoundCloud.getStream(streamUrl, guildId, resumeFromSeconds);
                break;
            case 'direct':
                streamInfo = await DirectLink.getStream(streamUrl, resumeFromSeconds);
                break;
            default:
                console.error(`[StreamResolver] ❌ Unsupported platform: "${track.platform}" for track: "${track.title}"`);
                let errorMsg;
                try {
                    errorMsg = (await LanguageManager.getTranslation(guildId, 'musicplayer.unsupported_platform')).replace('{platform}', track.platform);
                } catch {
                    errorMsg = `Unsupported platform: ${track.platform}`;
                }
                throw new Error(errorMsg);
        }

        return streamInfo;
    }

    /**
     * Resolves a downloadable URL (primarily used to convert Spotify/SoundCloud to YouTube).
     * Uses the same strict matching logic as resolveSpotifyTrack.
     */
    static async resolveDownloadUrl(track, guildId) {
        let downloadUrl = track.url;
        if (track.platform === 'soundcloud') {
            if (track.youtubeUrl) {
                downloadUrl = track.youtubeUrl;
            } else {
                // SoundCloud fallback - use simple search
                const results = await YouTube.search(track.title, 1, guildId);
                if (results && results.length > 0) {
                    downloadUrl = results[0].url;
                } else {
                    throw new Error('Could not find YouTube equivalent');
                }
            }
        }
        return downloadUrl;
    }
}

module.exports = StreamResolver;
