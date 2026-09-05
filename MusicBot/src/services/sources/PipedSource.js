const { MediaSource } = require('../media-source');

const PIPED_INSTANCES = [
    'https://piped.kavin.rocks',
    'https://piped-api.garudalinux.org',
    'https://piped.mha.fi',
    'https://piped.privacydev.net',
    'https://piped.esmailelbob.org',
    'https://piped.projectsegfau.lt',
    'https://piped.adminforge.de'
];

class PipedSource extends MediaSource {
    constructor() {
        super('piped');
        this.instances = [...PIPED_INSTANCES];
        this.currentInstanceIndex = 0;
    }

    _getNextInstance() {
        const instance = this.instances[this.currentInstanceIndex];
        this.currentInstanceIndex = (this.currentInstanceIndex + 1) % this.instances.length;
        return instance;
    }

    async _fetchWithFallback(endpoint, params = {}) {
        let lastError;
        
        for (let i = 0; i < this.instances.length; i++) {
            const instance = this.instances[i];
            try {
                const url = new URL(`${instance}${endpoint}`);
                Object.entries(params).forEach(([key, value]) => {
                    if (value !== undefined && value !== null) {
                        url.searchParams.append(key, value);
                    }
                });

                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000);
                
                const response = await fetch(url.toString(), {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/json'
                    },
                    signal: controller.signal
                });
                
                clearTimeout(timeout);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                return await response.json();
            } catch (err) {
                lastError = err;
                console.warn(`[PipedSource] Instance ${instance} failed:`, err.message);
                continue;
            }
        }
        
        throw lastError || new Error('All Piped instances failed');
    }

    async resolve(query) {
        if (!query || !query.trim()) {
            return [];
        }

        const isUrl = this._isYouTubeURL(query);
        
        if (isUrl) {
            const videoId = this._extractVideoId(query);
            if (videoId) {
                return await this._resolveById(videoId);
            }
            return [];
        }

        return await this._search(query.trim());
    }

    async _search(query) {
        try {
            const data = await this._fetchWithFallback('/search', {
                q: query,
                filter: 'video',
                page: 1
            });

            if (!data || !data.items || !data.items.length) return [];

            return data.items.map(item => ({
                url: `https://www.youtube.com/watch?v=${item.url}`,
                title: item.title || 'Unknown Title',
                duration: item.duration || 0,
                thumbnail: item.thumbnail || `https://img.youtube.com/vi/${item.url}/maxresdefault.jpg`,
                source: 'piped',
                quality: 'high',
                id: item.url,
                uploader: item.uploader,
                uploaderUrl: item.uploaderUrl
            }));
        } catch (err) {
            console.warn('[PipedSource] Search failed:', err.message);
            return [];
        }
    }

    async _resolveById(videoId) {
        try {
            const data = await this._fetchWithFallback(`/streams/${videoId}`);
            
            if (!data) return [];

            const audioStreams = data.audioStreams || [];
            
            return [{
                url: `https://www.youtube.com/watch?v=${videoId}`,
                title: data.title || 'Unknown Title',
                duration: data.duration || 0,
                thumbnail: data.thumbnail || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
                source: 'piped',
                quality: audioStreams.length > 0 ? 'high' : 'medium',
                id: videoId,
                uploader: data.uploader,
                uploaderUrl: data.uploaderUrl,
                audioStreams: audioStreams.map(s => ({
                    url: s.url,
                    bitrate: s.bitrate,
                    mimeType: s.mimeType,
                    quality: s.quality
                }))
            }];
        } catch (err) {
            console.warn('[PipedSource] Resolve by ID failed:', err.message);
            return [];
        }
    }

    async probe(url) {
        const videoId = this._extractVideoId(url);
        if (!videoId) return null;

        try {
            const data = await this._fetchWithFallback(`/streams/${videoId}`);
            if (!data) return null;

            const audioStreams = data.audioStreams || [];
            const bestAudio = audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

            return {
                codec: bestAudio?.mimeType?.includes('opus') ? 'opus' : 'unknown',
                bitrate: bestAudio?.bitrate || 0,
                duration: data.duration || 0,
                isStudioCut: true,
                fingerprint: '',
                source: 'piped'
            };
        } catch (err) {
            console.warn(`[PipedSource] Probe failed for ${url}:`, err.message);
            return null;
        }
    }

    _isYouTubeURL(url) {
        const patterns = [
            /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/playlist\?list=)/,
            /^https?:\/\/(www\.)?youtube\.com\/embed\/[a-zA-Z0-9_-]+/,
            /^https?:\/\/(www\.)?youtube\.com\/v\/[a-zA-Z0-9_-]+/,
        ];
        return patterns.some(pattern => pattern.test(url));
    }

    _extractVideoId(url) {
        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/,
            /youtube\.com\/embed\/([a-zA-Z0-9_-]+)/,
            /youtube\.com\/v\/([a-zA-Z0-9_-]+)/,
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
        return null;
    }
}

module.exports = PipedSource;