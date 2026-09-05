const { MediaSource } = require('../media-source');

const INVIDIOUS_INSTANCES = [
    'https://yewtu.be',
    'https://invidious.snopyta.org',
    'https://invidious.nerdvpn.de',
    'https://invidious.fdn.fr',
    'https://invidious.projectsegfau.lt',
    'https://invidious.perflystis.de',
    'https://invidious.esmailelbob.org'
];

class InvidiousSource extends MediaSource {
    constructor() {
        super('invidious');
        this.instances = [...INVIDIOUS_INSTANCES];
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
                console.warn(`[InvidiousSource] Instance ${instance} failed:`, err.message);
                continue;
            }
        }
        
        throw lastError || new Error('All Invidious instances failed');
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
            const data = await this._fetchWithFallback('/api/v1/search', {
                q: query,
                type: 'video',
                page: 1
            });

            if (!data || !data.length) return [];

            return data.map(item => ({
                url: `https://www.youtube.com/watch?v=${item.videoId}`,
                title: item.title || 'Unknown Title',
                duration: item.lengthSeconds || 0,
                thumbnail: item.videoThumbnails?.[item.videoThumbnails.length - 1]?.url || `https://img.youtube.com/vi/${item.videoId}/maxresdefault.jpg`,
                source: 'invidious',
                quality: 'high',
                id: item.videoId,
                author: item.author,
                authorId: item.authorId
            }));
        } catch (err) {
            console.warn('[InvidiousSource] Search failed:', err.message);
            return [];
        }
    }

    async _resolveById(videoId) {
        try {
            const data = await this._fetchWithFallback(`/api/v1/videos/${videoId}`);
            
            if (!data) return [];

            const formats = data.adaptiveFormats || [];
            const audioFormats = formats.filter(f => f.type?.includes('audio') || f.mimeType?.includes('audio'));
            
            return [{
                url: data.videoId ? `https://www.youtube.com/watch?v=${data.videoId}` : `https://www.youtube.com/watch?v=${videoId}`,
                title: data.title || 'Unknown Title',
                duration: data.lengthSeconds || 0,
                thumbnail: data.videoThumbnails?.[data.videoThumbnails.length - 1]?.url || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
                source: 'invidious',
                quality: audioFormats.length > 0 ? 'high' : 'medium',
                id: videoId,
                author: data.author,
                authorId: data.authorId,
                audioFormats: audioFormats.map(f => ({
                    url: f.url,
                    bitrate: f.bitrate,
                    mimeType: f.mimeType,
                    quality: f.quality
                }))
            }];
        } catch (err) {
            console.warn('[InvidiousSource] Resolve by ID failed:', err.message);
            return [];
        }
    }

    async probe(url) {
        const videoId = this._extractVideoId(url);
        if (!videoId) return null;

        try {
            const data = await this._fetchWithFallback(`/api/v1/videos/${videoId}`);
            if (!data) return null;

            const formats = data.adaptiveFormats || [];
            const audioFormats = formats.filter(f => f.type?.includes('audio') || f.mimeType?.includes('audio'));
            const bestAudio = audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

            return {
                codec: bestAudio?.mimeType?.includes('opus') ? 'opus' : 'unknown',
                bitrate: bestAudio?.bitrate || 0,
                duration: data.lengthSeconds || 0,
                isStudioCut: true,
                fingerprint: '',
                source: 'invidious'
            };
        } catch (err) {
            console.warn(`[InvidiousSource] Probe failed for ${url}:`, err.message);
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

module.exports = InvidiousSource;