const { createAudioResource, StreamType } = require('@discordjs/voice');
const prism = require('prism-media');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');

class AudioResourceFactory {
    /**
     * Creates a Discord.js voice AudioResource from a readable audio stream.
     * Applies FFmpeg transcoding and seeking logic.
     */
    static createFromStream(audioStream, track, streamInfo, resumeFromMs = 0) {
        const seekArgs = resumeFromMs > 0 ? ['-ss', (resumeFromMs / 1000).toFixed(3)] : [];
        
        const ffmpegProcess = new prism.FFmpeg({
            command: ffmpegPath,
            args: [
                ...seekArgs,
                '-analyzeduration', '0',
                '-loglevel', '0',
                '-i', 'pipe:0',
                '-f', 's16le',
                '-ar', '48000',
                '-ac', '2'
            ]
        });

        ffmpegProcess.on('error', (err) => {
            if (err.message && err.message.includes('Premature close')) return;
            console.error('❌ FFmpeg streaming error:', err.message);
        });

        // Pipe the raw HTTP or incoming audio stream into FFmpeg
        audioStream.pipe(ffmpegProcess);

        return createAudioResource(ffmpegProcess, {
            inputType: StreamType.Raw,
            inlineVolume: true,
            metadata: {
                title: track.title,
                url: track.url,
                duration: streamInfo?.duration || track.duration,
                bitrate: streamInfo?.bitrate || 128
            }
        });
    }

    /**
     * Creates a Discord.js voice AudioResource from a local downloaded file.
     * Applies FFmpeg transcoding and seeking logic.
     */
    static createFromFile(filepath, track, streamInfo, resumeFromMs = 0) {
        if (!fs.existsSync(filepath)) {
            throw new Error(`AudioResourceFactory Error: Target audio file does not exist at path: ${filepath}`);
        }

        const seekArgs = resumeFromMs > 0 ? ['-ss', (resumeFromMs / 1000).toFixed(3)] : [];
        
        const ffmpegProcess = new prism.FFmpeg({
            command: ffmpegPath,
            args: [
                ...seekArgs,
                '-i', filepath,
                '-analyzeduration', '0',
                '-loglevel', '0',
                '-f', 's16le',
                '-ar', '48000',
                '-ac', '2'
            ]
        });

        ffmpegProcess.on('error', (err) => {
            if (err.message && err.message.includes('Premature close')) return;
            console.error('❌ FFmpeg playback error:', err.message);
        });

        return createAudioResource(ffmpegProcess, {
            inputType: StreamType.Raw,
            inlineVolume: true,
            metadata: {
                title: track.title,
                url: track.url,
                duration: streamInfo?.duration || track.duration,
                bitrate: streamInfo?.bitrate || 128
            }
        });
    }
}

module.exports = AudioResourceFactory;
