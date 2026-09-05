const { Worker } = require('bullmq');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const { broadcastToGuild } = require('../utils/websocket');

const STEMS_DIR = path.join(__dirname, '..', '..', '..', 'audio_cache', 'stems');

const PYTHON_SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'karaoke_worker.py');
const PITCH_QUANTIZER = path.join(__dirname, '..', '..', '..', 'scripts', 'pitch_quantizer.py');

function notifyProgress(guildId, songId, progress, data = {}) {
    broadcastToGuild(guildId, 'karaoke:progress', {
        songId,
        progress,
        ...data,
    });
}

async function runPythonScript(args) {
    return new Promise((resolve, reject) => {
        const child = spawn('python', args, {
            timeout: 600000,
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                reject(new Error(`Python script exited with code ${code}: ${stderr}`));
            }
        });

        child.on('error', (err) => {
            reject(err);
        });
    });
}

async function downloadAudio(url, outputPath) {
    const ytdlp = require('yt-dlp-wrap');
    const ydl = new ytdlp.default();

    await ydl.execPromise([
        '-x',
        '--audio-format', 'wav',
        '--audio-quality', '0',
        '-o', outputPath,
        url,
    ]);

    return outputPath;
}

async function runDemucs(inputPath, outputDir) {
    const args = [PYTHON_SCRIPT, inputPath, outputDir];
    await runPythonScript(args);

    const vocalsPath = path.join(outputDir, 'vocals.wav');
    const noVocalsPath = path.join(outputDir, 'no_vocals.wav');

    if (!fs.existsSync(vocalsPath) || !fs.existsSync(noVocalsPath)) {
        throw new Error('Demucs output files not found');
    }

    return { vocals: vocalsPath, noVocals: noVocalsPath };
}

async function extractPitch(vocalsPath, outputDir) {
    const pitchMapPath = path.join(outputDir, 'pitch_map.json');
    const quantizedPath = path.join(outputDir, 'pitch_quantized.json');
    
    if (!fs.existsSync(pitchMapPath)) {
        return [];
    }

    const args = [PITCH_QUANTIZER, pitchMapPath, quantizedPath];
    await runPythonScript(args);

    if (fs.existsSync(quantizedPath)) {
        return JSON.parse(fs.readFileSync(quantizedPath, 'utf-8'));
    }
    return [];
}

async function saveKaraokeArtifacts(songId, vocalsPath, noVocalsPath, pitchData) {
    return {
        songId,
        vocalsPath,
        noVocalsPath,
        pitchDataPath: path.join(path.dirname(vocalsPath), 'pitch_quantized.json'),
        duration: 0,
    };
}

const worker = new Worker('karaoke', async (job) => {
    const { songId, url, guildId, requestedBy, priority } = job.data;

    console.log(chalk.magenta(`🎤 [KARAOKE WORKER] Starting job ${job.id} for ${songId}`));

    await job.updateProgress(10);
    notifyProgress(guildId, songId, 10, { status: 'downloading' });

    const outputDir = path.join(STEMS_DIR, songId);
    fs.mkdirSync(outputDir, { recursive: true });

    const audioPath = path.join(outputDir, 'source.wav');
    await downloadAudio(url, audioPath);

    await job.updateProgress(30);
    notifyProgress(guildId, songId, 30, { status: 'separating' });

    const { vocals, noVocals } = await runDemucs(audioPath, outputDir);

    await job.updateProgress(70);
    notifyProgress(guildId, songId, 70, { status: 'extracting_pitch' });

    const pitchData = await extractPitch(vocals, outputDir);

    await job.updateProgress(90);
    notifyProgress(guildId, songId, 90, { status: 'saving' });

    const result = await saveKaraokeArtifacts(songId, vocals, noVocals, pitchData);

    await job.updateProgress(100);
    notifyProgress(guildId, songId, 100, { status: 'completed', result });

    console.log(chalk.green(`✅ [KARAOKE WORKER] Job ${job.id} completed for ${songId}`));

    return result;
}, {
    concurrency: 2,
    connection: require('../queue/karaoke-queue').redisConnection,
});

worker.on('completed', (job) => {
    console.log(chalk.green(`✅ [KARAOKE WORKER] Job ${job.id} completed`));
});

worker.on('failed', (job, err) => {
    console.error(chalk.red(`❌ [KARAOKE WORKER] Job ${job?.id} failed:`), err.message);
    if (job?.data?.guildId && job?.data?.songId) {
        notifyProgress(job.data.guildId, job.data.songId, -1, {
            status: 'error',
            error: err.message,
        });
    }
});

worker.on('error', (err) => {
    console.error(chalk.red('❌ [KARAOKE WORKER] Worker error:'), err.message);
});

module.exports = {
    worker,
};