const crypto = require('crypto');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../../config');
const { MediaSource } = require('./media-source');

const PROBE_CACHE_DIR = path.join(__dirname, '..', '..', 'cache', 'probes');
const PROBE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

class MediaResolver {
    constructor() {
        this.sources = [];
        this.probeCache = new Map();
    }

    addSource(source) {
        if (source instanceof MediaSource) {
            this.sources.push(source);
        } else {
            throw new Error('Source must be an instance of MediaSource');
        }
    }

    async resolve(query, options = {}) {
        const { quality = 'high' } = options;
        
        for (const source of this.sources) {
            try {
                console.log(`[MediaResolver] Trying source: ${source.name}`);
                const results = await source.resolve(query);
                
                if (results && results.length > 0) {
                    const filtered = results.filter(r => this._matchesQuality(r.quality, quality));
                    if (filtered.length > 0) {
                        const best = await this.probeAndSelect(filtered);
                        if (best) {
                            console.log(`[MediaResolver] Selected from ${source.name}: ${best.title}`);
                            return best;
                        }
                    }
                }
            } catch (err) {
                console.warn(`[MediaResolver] Source ${source.name} failed:`, err.message);
                continue;
            }
        }
        
        throw new Error('All media sources failed to resolve query');
    }

    async probeAndSelect(results) {
        if (!results || results.length === 0) return null;
        
        const probed = [];
        
        for (const result of results) {
            try {
                // Find the source that produced this result
                const source = this.sources.find(s => s.name === result.source);
                if (source && typeof source.probe === 'function') {
                    const probeResult = await source.probe(result.url);
                    if (probeResult) {
                        probed.push({ result, probe: probeResult });
                    }
                } else {
                    // Fallback to generic ffprobe
                    const probeResult = await this._probeWithCache(result.url);
                    if (probeResult) {
                        probed.push({ result, probe: probeResult });
                    }
                }
            } catch (err) {
                console.warn(`[MediaResolver] Probe failed for ${result.url}:`, err.message);
            }
        }
        
        if (probed.length === 0) return null;
        
        probed.sort((a, b) => this._scoreProbe(b) - this._scoreProbe(a));
        
        // Attach probe info to the best result
        const best = probed[0].result;
        best.probeInfo = probed[0].probe;
        
        return best;
    }

    _scoreProbe({ probe }) {
        let score = 0;
        
        if (probe.isStudioCut) score += 1000;
        score += Math.min(probe.bitrate / 1000, 320);
        
        const sourcePriority = {
            'youtube': 100,
            'invidious': 80,
            'piped': 60,
            'local': 50
        };
        score += sourcePriority[probe.source] || 0;
        
        return score;
    }

    _matchesQuality(resultQuality, requestedQuality) {
        const qualityOrder = { low: 0, medium: 1, high: 2 };
        return qualityOrder[resultQuality] <= qualityOrder[requestedQuality];
    }

    async _probeWithCache(url) {
        const cacheKey = crypto.createHash('sha256').update(url).digest('hex');
        const cacheFile = path.join(PROBE_CACHE_DIR, `${cacheKey}.json`);
        
        try {
            if (fsSync.existsSync(cacheFile)) {
                const stats = fsSync.statSync(cacheFile);
                if (Date.now() - stats.mtimeMs < PROBE_CACHE_TTL) {
                    const cached = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
                    console.log(`[MediaResolver] Probe cache hit for ${url}`);
                    return cached;
                }
            }
        } catch (err) {
            console.warn('[MediaResolver] Cache read failed:', err.message);
        }
        
        const probeResult = await this._runFFprobe(url);
        
        if (probeResult) {
            try {
                await fs.mkdir(PROBE_CACHE_DIR, { recursive: true });
                await fs.writeFile(cacheFile, JSON.stringify(probeResult, null, 2));
            } catch (err) {
                console.warn('[MediaResolver] Cache write failed:', err.message);
            }
        }
        
        return probeResult;
    }

    async _runFFprobe(url) {
        return new Promise((resolve) => {
            const ffprobePath = require('ffprobe-static').path;
            const args = [
                '-v', 'quiet',
                '-show_streams',
                '-show_format',
                '-of', 'json',
                '-i', url
            ];
            
            const proc = spawn(ffprobePath, args, { 
                timeout: 30000,
                windowsHide: true 
            });
            
            let stdout = '';
            let stderr = '';
            
            proc.stdout.on('data', (data) => { stdout += data; });
            proc.stderr.on('data', (data) => { stderr += data; });
            
            proc.on('close', (code) => {
                if (code !== 0) {
                    console.warn(`[MediaResolver] ffprobe failed (code ${code}): ${stderr}`);
                    resolve(null);
                    return;
                }
                
                try {
                    const data = JSON.parse(stdout);
                    resolve(this._parseProbeResult(data, url));
                } catch (err) {
                    console.warn('[MediaResolver] Failed to parse ffprobe output:', err.message);
                    resolve(null);
                }
            });
            
            proc.on('error', (err) => {
                console.warn('[MediaResolver] ffprobe spawn error:', err.message);
                resolve(null);
            });
        });
    }

    _parseProbeResult(data, url) {
        const audioStream = data.streams?.find(s => s.codec_type === 'audio');
        const format = data.format || {};
        
        if (!audioStream) return null;
        
        const codec = audioStream.codec_name || 'unknown';
        const bitrate = parseInt(audioStream.bit_rate || format.bit_rate || '0', 10);
        const duration = parseFloat(format.duration || audioStream.duration || '0');
        
        const fingerprint = this._generateFingerprint(url, duration);
        const isStudioCut = this._checkStudioCut(duration, fingerprint);
        
        return {
            codec,
            bitrate,
            duration,
            isStudioCut,
            fingerprint,
            source: this._detectSource(url)
        };
    }

    _generateFingerprint(url, duration) {
        const hash = crypto.createHash('sha256');
        hash.update(url);
        hash.update(String(Math.round(duration)));
        return hash.digest('hex').substring(0, 16);
    }

    _checkStudioCut(duration, fingerprint) {
        const knownDurations = new Map([
            ['dQw4w9WgXcQ', 212], // Never Gonna Give You Up
            ['9bZkp7q19f0', 252], // Gangnam Style
        ]);
        
        const videoId = this._extractVideoId(url);
        if (videoId && knownDurations.has(videoId)) {
            const expected = knownDurations.get(videoId);
            return Math.abs(duration - expected) <= 2;
        }
        
        return duration > 60 && duration < 600;
    }

    _extractVideoId(url) {
        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/,
            /youtube\.com\/embed\/([a-zA-Z0-9_-]+)/,
        ];
        
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
        return null;
    }

    _detectSource(url) {
        if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
        if (url.includes('invidious') || url.includes('yewtu.be')) return 'invidious';
        if (url.includes('piped') || url.includes('piped.kavin.rocks')) return 'piped';
        return 'local';
    }
}

const { YouTubeSource, InvidiousSource, PipedSource, LocalCacheSource } = require('./sources');

function createDefaultResolver() {
    const resolver = new MediaResolver();
    resolver.addSource(new LocalCacheSource());
    resolver.addSource(new YouTubeSource());
    resolver.addSource(new InvidiousSource());
    resolver.addSource(new PipedSource());
    return resolver;
}

const defaultResolver = createDefaultResolver();

module.exports = {
    MediaSource,
    MediaResolver,
    createDefaultResolver,
    defaultResolver
};