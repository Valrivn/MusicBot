export interface StatusResponse {
    online: boolean;
    activeShard: number;
    pingMs: number;
}

export interface GenericResponse {
    success: boolean;
    message?: string;
    error?: string;
}

export interface User {
    id: string;
    username: string;
    global_name?: string;
    avatar?: string;
    role: number;
}

export interface AuthResponse {
    token: string;
    user: User;
}

export interface SearchResult {
    title: string;
    artist: string;
    url: string;
    duration: number;
    thumbnail: string;
    thumbnailFallback?: string;
    platform: string;
    id: string;
    views?: number;
    uploadDate?: string;
}

export interface SearchResponse {
    results: SearchResult[];
    count: number;
}

export interface TrackInfo {
    id: string | null;
    title: string | null;
    artist: string | null;
    url: string | null;
    trackUrl: string | null;
    durationSec: number;
    positionSec: number;
    startTime: number;
    serverTime: number;
    lastPausedAt: number | null;
    isPaused: boolean;
    playing: boolean;
    art: string | null;
    thumbnail: string | null;
    volume: number;
    requesterName: string | null;
    requesterAvatar: string | null;
}

export interface QueueTrack {
    id: string;
    title: string;
    artist: string;
    url: string | null;
    trackUrl: string | null;
    thumbnail: string | null;
    art: string | null;
    artworkUrl: string | null;
    duration: number;
    length: number;
    requestedBy: string;
    requesterName: string;
    requesterAvatar: string | null;
}

export interface PitchFrame {
    timeMs: number;
    midi: number;
}

export interface KaraokePrepareResponse {
    status: 'ready' | 'processing' | 'error';
    jobId: string;
    stems?: {
        vocals: string;
        instrumental: string;
    };
    frames?: PitchFrame[];
    pitchMap?: {
        title: string;
        artist: string;
        frames: PitchFrame[];
    };
    error?: string;
}

export interface LyricsResponse {
    title: string;
    artist: string;
    source: string;
    synced: string;
    plain: string;
    hasSynced: boolean;
    lines: Array<{ timeSeconds: number; text: string }>;
}

export interface AudioCacheInfo {
    sizeMb: number;
}

export interface SystemSettings {
    sessionRestoreEnabled: boolean;
}

// Local API (dev) vs Tunnel (prod)
const isDev = import.meta.env.DEV || window.location.hostname === 'localhost';
const API_BASE_URL = isDev ? 'http://localhost:3002' : 'https://unhitched-shrink-dorsal.ngrok-free.dev';

async function fetchApi<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true',
            ...options.headers,
        },
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(error.error || `Error: ${response.statusText}`);
    }
    return response.json();
}

// Auth
export async function discordLogin(code: string, redirectUri: string): Promise<AuthResponse> {
    return fetchApi<AuthResponse>('/auth/discord', {
        method: 'POST',
        body: JSON.stringify({ code, redirectUri }),
    });
}

export async function validateSession(token: string): Promise<{ user: User }> {
    return fetchApi<{ user: User }>('/auth/session', {
        headers: { Authorization: `Bearer ${token}` },
    });
}

// System
export async function getStatus(): Promise<StatusResponse> {
    return fetchApi<StatusResponse>('/bot/status');
}

export async function getSystemSettings(): Promise<SystemSettings> {
    return fetchApi<SystemSettings>('/system/settings');
}

export async function getAudioCacheInfo(): Promise<AudioCacheInfo> {
    return fetchApi<AudioCacheInfo>('/system/audio-cache');
}

export async function cleanAudioCache(): Promise<GenericResponse> {
    return fetchApi<GenericResponse>('/api/cache/clean', { method: 'POST' });
}

export async function setSessionRestore(enabled: boolean): Promise<GenericResponse> {
    return fetchApi<GenericResponse>('/api/settings/session-restore', {
        method: 'POST',
        body: JSON.stringify({ enabled }),
    });
}

// Lyrics
export async function fetchLyrics(title: string, artist: string, trackUrl: string, forceResync?: boolean): Promise<LyricsResponse> {
    return fetchApi<LyricsResponse>('/music/lyrics', {
        method: 'POST',
        body: JSON.stringify({ title, artist, trackUrl, forceResync }),
    });
}

// Music
export async function getPlayer(): Promise<TrackInfo | null> {
    return fetchApi<TrackInfo | null>('/music/player');
}

export async function getQueue(): Promise<QueueTrack[]> {
    return fetchApi<QueueTrack[]>('/music/queue');
}

export async function getHistory(): Promise<QueueTrack[]> {
    return fetchApi<QueueTrack[]>('/music/history');
}

export async function searchLibrary(query: string): Promise<SearchResponse> {
    return fetchApi<SearchResponse>(`/library/search?q=${encodeURIComponent(query)}`);
}

export async function requestTrack(query: string, guildId?: string): Promise<GenericResponse> {
    return fetchApi<GenericResponse>('/music/request', {
        method: 'POST',
        body: JSON.stringify({ query, guildId }),
    });
}

export async function searchAndPlay(query: string, guildId?: string): Promise<GenericResponse> {
    return fetchApi<GenericResponse>('/music/search', {
        method: 'POST',
        body: JSON.stringify({ query, guildId }),
    });
}

export async function controlPlayback(action: 'play_pause' | 'next' | 'previous' | 'stop'): Promise<GenericResponse> {
    return fetchApi<GenericResponse>('/music/playback', {
        method: 'POST',
        body: JSON.stringify({ action }),
    });
}

export async function skipTrack(): Promise<GenericResponse> {
    return fetchApi<GenericResponse>('/music/skip', { method: 'POST' });
}

export async function previousTrack(): Promise<GenericResponse> {
    return fetchApi<GenericResponse>('/music/previous', { method: 'POST' });
}

export async function stopPlayback(): Promise<GenericResponse> {
    return fetchApi<GenericResponse>('/music/stop', { method: 'POST' });
}

export async function setVolume(volume: number): Promise<GenericResponse> {
    return fetchApi<GenericResponse>('/music/volume', {
        method: 'POST',
        body: JSON.stringify({ volume }),
    });
}

export async function seekTrack(positionMs: number): Promise<GenericResponse> {
    return fetchApi<GenericResponse>('/music/seek', {
        method: 'POST',
        body: JSON.stringify({ positionMs }),
    });
}

export async function reorderQueue(oldIndex: number, newIndex: number): Promise<GenericResponse> {
    return fetchApi<GenericResponse>('/queue/reorder', {
        method: 'POST',
        body: JSON.stringify({ oldIndex, newIndex }),
    });
}

export async function removeQueueItem(index: number): Promise<GenericResponse> {
    return fetchApi<GenericResponse>(`/queue/${index}`, { method: 'DELETE' });
}

export async function shuffleQueue(): Promise<GenericResponse> {
    return fetchApi<GenericResponse>('/queue/shuffle', { method: 'POST' });
}

export async function goToPreviousTrack(): Promise<GenericResponse> {
    return fetchApi<GenericResponse>('/player/previous', { method: 'POST' });
}

// Karaoke
export async function prepareKaraoke(trackUrl: string): Promise<KaraokePrepareResponse> {
    return fetchApi<KaraokePrepareResponse>('/karaoke/prepare', {
        method: 'POST',
        body: JSON.stringify({ trackUrl }),
    });
}

export async function getKaraokeStatus(jobId: string): Promise<KaraokePrepareResponse> {
    return fetchApi<KaraokePrepareResponse>(`/karaoke/status/${jobId}`);
}

export async function getPitchData(trackId: string): Promise<PitchFrame[]> {
    return fetchApi<PitchFrame[]>(`/music/karaoke/pitch-data?trackId=${encodeURIComponent(trackId)}`);
}

export function getStemUrl(jobId: string, type: 'vocals' | 'instrumental'): string {
    return `${API_BASE_URL}/karaoke/stems/${jobId}/${type === 'vocals' ? 'vocals.wav' : 'no_vocals.wav'}`;
}