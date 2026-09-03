export type ApiTrack = {
  id: string;
  title: string;
  artist: string;
  author?: string;
  length?: number;
  artworkUrl?: string;
  duration: string | number;
  requestedBy: string;
  requesterName?: string;
  requesterAvatar?: string;
  art?: string;
};

export type ApiStatus = {
  activeShard: number;
  pingMs: number;
  uptime: string;
  online: boolean;
};

export type ApiCache = {
  sizeMb: number;
  maxMb: number;
};

export type ApiSettings = {
  guildId?: string;
  sessionToken?: string;
  loggedInUser?: {
    discordId?: string;
    sessionToken?: string;
  };
};

export type ApiPlayer = {
  title: string | null;
  artist: string | null;
  cleanedTitle?: string | null;
  cleanedArtist?: string | null;
  url?: string | null;
  uri?: string | null;
  trackUrl?: string | null;
  durationSec: number;
  positionSec: number;
  currentPositionMs: number;
  currentPositionSec: number;
  serverTimestampMs: number | null;
  startTime?: number | null;
  lastPausedAt?: number | null;
  isPaused?: boolean;
  playing: boolean;
  art?: string;
  thumbnail?: string;
  requesterName?: string;
  requesterAvatar?: string;
  volume: number;
};

type RawPlayerPayload = {
  success?: boolean;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

type RawQueuePayload = {
  success?: boolean;
  data?: unknown;
  queue?: unknown;
  tracks?: unknown;
  items?: unknown;
  [key: string]: unknown;
};

export type ApiPreset = {
  id?: string;
  name: string;
  tracks?: number;
  items?: ApiSearchResult[];
};

export type ApiLyrics = {
  title: string;
  artist: string;
  source: string;
  plain: string;
  synced: string;
  hasSynced: boolean;
  lines: Array<{ timeSeconds: number; text: string }>;
};

export type ApiPitchFrame = {
  timeMs: number;
  midi: number;
};

export type ApiPitchMap = {
  title: string;
  artist: string;
  frames: ApiPitchFrame[];
};

export type ApiKaraokeResponse = {
  title?: string;
  artist?: string;
  frames?: ApiPitchFrame[];
  pitchMap?: {
    title?: string;
    artist?: string;
    frames?: ApiPitchFrame[];
  };
};

export type ApiSearchResult = {
  id: string;
  title: string;
  artist: string;
  duration?: number;
  thumbnail?: string;
  cover?: string;
  url?: string;
  platform?: string;
};

export type ApiAuditTrack = {
  id: string;
  title: string;
  requesterAvatar?: string;
  requestedAt?: string;
  createdAt?: string;
  timestamp?: string;
};

type PlaybackAction = "previous" | "play_pause" | "next" | "stop";

// 🌐 Fallback link points to your active permanent Ngrok domain
export const BASE_URL =
  import.meta.env.VITE_VOXARIA_API_BASE_URL?.trim() || "https://unhitched-shrink-dorsal.ngrok-free.dev";
const OWNER_USER_ID = "owner";
const OWNER_API_KEY = "owner";
const DEFAULT_GUILD_ID = import.meta.env.VITE_VOXARIA_GUILD_ID?.trim() || "owner";

type ApiAuthContext = {
  guildId?: string;
  userId?: string;
  sessionToken?: string;
};

let apiAuthContext: ApiAuthContext = {};

export const setApiAuthContext = (context: ApiAuthContext) => {
  apiAuthContext = {
    guildId: context.guildId?.trim() || undefined,
    userId: context.userId?.trim() || undefined,
    sessionToken: context.sessionToken?.trim() || undefined,
  };
};

const ENDPOINTS = {
  queue: "/music/queue",
  history: "/music/history",
  status: "/bot/status",
  cache: "/system/audio-cache",
  settings: "/system/settings",
  player: "/music/player",
  search: "/library/search",
  playback: "/music/playback",
  clearQueue: "/music/queue/clear",
  join: "/discord/join",
  leave: "/discord/leave",
  cleanCache: "/system/audio-cache/clean",
  volume: "/music/volume",
  lyrics: "/music/lyrics",
  queueReorder: "/queue/reorder",
  queueDelete: "/queue",
  previousTrack: "/player/previous",
  queueShuffle: "/queue/shuffle",
  presets: "/presets",
  presetsSave: "/presets/save",
  presetsLoad: "/presets/load",
  presetsCreate: "/presets/create",
  presetsDelete: "/presets/delete",
  searchOnly: "/music/search-only",
  pitchMap: "/music/pitch-map",
  searchResults: "/music/search/results",
  audit: "/api/audit",
} as const;

export class ApiClientError extends Error {
  status: number;
  fallback: boolean;
  apiMessage: string;

  constructor(status: number, apiMessage: string) {
    super(apiMessage || `API ${status}`);
    this.name = "ApiClientError";
    this.status = status;
    this.apiMessage = apiMessage;
    this.fallback = status >= 500;
  }
}

const readErrorMessage = async (response: Response) => {
  const raw = await response.text().catch(() => "");
  if (!raw.trim()) return response.statusText || `API ${response.status}`;

  try {
    const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown };
    const candidate = toStringValue(parsed.error) ?? toStringValue(parsed.message);
    return candidate ?? raw;
  } catch {
    return raw;
  }
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BASE_URL) throw new Error("Set VITE_VOXARIA_API_BASE_URL to enable live API mode.");

  try {
    const extraHeaders = new Headers(init?.headers);
    const activeGuildId = toStringValue(extraHeaders.get("x-guild-id")) ?? apiAuthContext.guildId ?? DEFAULT_GUILD_ID;
    const activeUserId = toStringValue(extraHeaders.get("x-user-id")) ?? apiAuthContext.userId ?? OWNER_USER_ID;
    const authHeader = toStringValue(extraHeaders.get("Authorization"));
    const activeSessionToken =
      (authHeader && authHeader.replace(/^Bearer\s+/i, "").trim()) || apiAuthContext.sessionToken;

    const defaultHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      "x-user-id": activeUserId,
      "x-guild-id": activeGuildId,
      "x-api-key": OWNER_API_KEY,
    };

    if (activeSessionToken) {
      defaultHeaders.Authorization = `Bearer ${activeSessionToken}`;
    }

    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...defaultHeaders,
        ...Object.fromEntries(extraHeaders.entries()),
      },
    });

    if (!response.ok) {
      const body = await readErrorMessage(response);
      console.error(`API Error: ${response.status} - ${body}`);
      throw new ApiClientError(response.status, body);
    }

    if (response.status === 204) return {} as T;
    return response.json() as Promise<T>;
  } catch (error) {
    console.error("Fetch failed:", error);
    throw error;
  }
}

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const toBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return null;
};

const toStringValue = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
};

const toOptionalString = (value: unknown): string | undefined => toStringValue(value) ?? undefined;

const pick = <T = unknown,>(
  key: string,
  data: Record<string, unknown>,
  root: Record<string, unknown>,
): T | undefined => {
  if (data[key] !== undefined) return data[key] as T;
  if (root[key] !== undefined) return root[key] as T;
  return undefined;
};

const normalizePlayerPayload = (payload: RawPlayerPayload): ApiPlayer => {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
  const root = payload && typeof payload === "object" ? payload : {};
  const dataInfo = data.info && typeof data.info === "object" ? (data.info as Record<string, unknown>) : {};
  const rootInfo = root.info && typeof root.info === "object" ? (root.info as Record<string, unknown>) : {};

  const currentPositionMsValue =
    toNumber(pick("currentPositionMs", data, root)) ??
    toNumber(pick("position", data, root)) ??
    0;
  const currentPositionSecValue =
    toNumber(pick("currentPositionSec", data, root)) ??
    toNumber(pick("currentTime", data, root)) ??
    currentPositionMsValue / 1000;
  const serverTimestampMs = toNumber(pick("serverTimestampMs", data, root));
  const durationMs = toNumber(pick("duration", data, root));
  const totalTimeSec = toNumber(pick("totalTime", data, root));

  const positionSec = Math.max(0, currentPositionSecValue);
  const durationSec = durationMs !== null ? durationMs / 1000 : (totalTimeSec ?? 0);
  const isPaused = toBoolean(pick("paused", data, root)) ?? toBoolean(pick("isPaused", data, root)) ?? false;
  const playing = toBoolean(pick("playing", data, root)) ?? false;
  const artworkCandidate =
    toOptionalString(pick("thumbnail", data, root)) ??
    toOptionalString(pick("art", data, root)) ??
    toOptionalString(dataInfo.artworkUrl) ??
    toOptionalString(rootInfo.artworkUrl) ??
    toOptionalString(dataInfo.thumbnail) ??
    toOptionalString(rootInfo.thumbnail) ??
    toOptionalString(dataInfo.art) ??
    toOptionalString(rootInfo.art);

  return {
    title: toStringValue(pick("title", data, root)),
    artist: toStringValue(pick("artist", data, root)),
    cleanedTitle: toStringValue(pick("cleanedTitle", data, root)) ?? toStringValue(pick("title", data, root)),
    cleanedArtist:
      toStringValue(pick("cleanedArtist", data, root)) ?? toStringValue(pick("artist", data, root)),
    url: toStringValue(pick("url", data, root)),
    uri: toStringValue(pick("uri", data, root)),
    trackUrl:
      toStringValue(pick("trackUrl", data, root)) ??
      toStringValue(pick("url", data, root)) ??
      toStringValue(pick("uri", data, root)),
    durationSec: Math.max(0, durationSec),
    positionSec: Math.max(0, positionSec),
    currentPositionMs: Math.max(0, currentPositionMsValue),
    currentPositionSec: Math.max(0, currentPositionSecValue),
    serverTimestampMs,
    startTime: (pick<number | null>("startTime", data, root) ?? null) as number | null,
    lastPausedAt: (pick<number | null>("lastPausedAt", data, root) ?? null) as number | null,
    isPaused,
    playing,
    art: artworkCandidate,
    thumbnail: artworkCandidate,
    requesterName:
      toOptionalString(pick("requesterName", data, root)) ?? toOptionalString(pick("requestedBy", data, root)),
    requesterAvatar: toOptionalString(pick("requesterAvatar", data, root)),
    volume: Math.max(0, Math.min(200, toNumber(pick("volume", data, root)) ?? 100)),
  };
};

const normalizeSearchCatalogPayload = (payload: unknown): ApiSearchResult[] => {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const raw = root.data ?? root.results ?? root.items ?? payload;
  const list = Array.isArray(raw) ? raw : [];

  return list
    .map((item, index) => {
      const result = item && typeof item === "object" ? (item as Record<string, unknown>) : {};

      const id =
        toStringValue(result.id) ??
        toStringValue(result.identifier) ??
        toStringValue(result.uri) ??
        `search-${index}`;

      const title = toStringValue(result.title) ?? "Unknown title";
      const artist =
        toStringValue(result.artist) ??
        toStringValue(result.author) ??
        toStringValue(result.requestedBy) ??
        "Unknown artist";

      return {
        id,
        title,
        artist,
        duration: toNumber(result.duration) ?? undefined,
        thumbnail:
          toOptionalString(result.thumbnail) ??
          toOptionalString(result.artworkUrl) ??
          toOptionalString(result.art),
        cover: toOptionalString(result.cover),
        url: toOptionalString(result.url),
        platform: toOptionalString(result.platform),
      };
    })
    .filter((track) => track.id && track.title);
};

const normalizeLyricsPayload = (payload: unknown): ApiLyrics => {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const lyrics = root.lyrics && typeof root.lyrics === "object" ? (root.lyrics as Record<string, unknown>) : root;
  const rawLines = Array.isArray(lyrics.lines) ? lyrics.lines : [];
  const lines = rawLines
    .map((line, idx) => {
      if (typeof line === "string") {
        const regex = /\[(\d+):(\d+)(?:\.(\d+))?\](.*)/;
        const match = line.match(regex);
        if (match) {
          const minutes = parseInt(match[1], 10);
          const seconds = parseInt(match[2], 10);
          const hundredths = match[3] ? parseInt(match[3], 10) : 0;
          const text = match[4].trim();
          const timeSeconds = minutes * 60 + seconds + (hundredths / 100);
          return { timeSeconds, text };
        }
        return { timeSeconds: idx * 5, text: line.trim() };
      }
      const item = line && typeof line === "object" ? (line as Record<string, unknown>) : {};
      const timeSeconds = toNumber(item.timeSeconds);
      const text = toStringValue(item.text);

      if (timeSeconds === null || text === null) return null;
      return { timeSeconds, text };
    })
    .filter((line): line is { timeSeconds: number; text: string } => Boolean(line));

  return {
    title: toStringValue(lyrics.title) ?? "",
    artist: toStringValue(lyrics.artist) ?? "",
    source: toStringValue(lyrics.source) ?? "unknown",
    plain: toStringValue(lyrics.plain) ?? "",
    synced: toStringValue(lyrics.synced) ?? "",
    hasSynced: toBoolean(lyrics.hasSynced) ?? lines.length > 0,
    lines,
  };
};

const normalizePresetsPayload = (payload: unknown): ApiPreset[] => {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const raw = root.data ?? root.presets ?? root.items ?? payload;
  const list = Array.isArray(raw) ? raw : [];

  return list.map((item, index) => {
    const preset = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const name = toStringValue(preset.name) ?? `Preset ${index + 1}`;
    const rawItems = preset.items ?? preset.tracks ?? preset.queue ?? preset.songs;
    const parsedItems = Array.isArray(rawItems)
      ? normalizeSearchCatalogPayload(rawItems)
      : normalizeSearchCatalogPayload(preset.data ?? []);
    const tracks =
      (Array.isArray(rawItems) ? rawItems.length : null) ??
      toNumber(preset.count ?? preset.trackCount ?? preset.tracks) ??
      parsedItems.length;

    return {
      id: toOptionalString(preset.id),
      name,
      tracks,
      items: parsedItems,
    };
  });
};

const normalizeQueuePayload = (payload: RawQueuePayload): ApiTrack[] => {
  const root = payload && typeof payload === "object" ? payload : {};
  const raw = (root.data ?? root.queue ?? root.tracks ?? root.items ?? root) as unknown;
  const list = Array.isArray(raw) ? raw : [];

  return list.map((item, index) => {
    const track = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const info = track.info && typeof track.info === "object" ? (track.info as Record<string, unknown>) : {};

    const title = String(track.title ?? info.title ?? `Track ${index + 1}`);
    const author = String(track.author ?? track.artist ?? info.author ?? info.artist ?? "Unknown artist");
    const length = toNumber(track.length ?? info.length ?? track.duration ?? info.duration) ?? 0;
    const artworkUrl = (track.artworkUrl ??
      track.thumbnail ??
      track.art ??
      info.artworkUrl ??
      info.thumbnail ??
      info.art) as string | undefined;
    const requesterName = String(
      track.requesterName ?? track.requestedBy ?? info.requesterName ?? info.requestedBy ?? "Unknown",
    );

    return {
      id: String(track.id ?? info.identifier ?? info.id ?? `${index}`),
      title,
      artist: author,
      author,
      length,
      artworkUrl,
      duration: length,
      requestedBy: requesterName,
      requesterName,
      requesterAvatar: (track.requesterAvatar ?? info.requesterAvatar) as string | undefined,
      art: (track.art ?? info.art ?? artworkUrl) as string | undefined,
    };
  });
};

async function postJson<TResponse, TBody extends Record<string, unknown>>(
  path: string,
  body: TBody,
  guildId: string,
  userId?: string,
): Promise<TResponse> {
  try {
    const activeGuildId = guildId?.trim() || apiAuthContext.guildId || DEFAULT_GUILD_ID;
    const activeUserId = userId?.trim() || apiAuthContext.userId || OWNER_USER_ID;
    const authHeader = apiAuthContext.sessionToken ? { Authorization: `Bearer ${apiAuthContext.sessionToken}` } : {};

    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
        "x-user-id": activeUserId,
        "x-guild-id": activeGuildId,
        "x-api-key": OWNER_API_KEY,
        ...authHeader,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const fallbackMessage = await readErrorMessage(response);
      console.error(`API Error: ${response.status} - ${fallbackMessage}`);
      throw new ApiClientError(response.status, fallbackMessage);
    }

    return response.json() as Promise<TResponse>;
  } catch (error) {
    console.error("Fetch failed:", error);
    throw error;
  }
}

const cleanLyricsTitle = (title: string) =>
  title
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/official\s*video/gi, " ")
    .replace(/lyrics?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

export const voxariaApi = {
  getQueue: async () => {
    const payload = await request<RawQueuePayload>(ENDPOINTS.queue);
    return normalizeQueuePayload(payload);
  },
  getHistory: async () => {
    const payload = await request<RawQueuePayload>(ENDPOINTS.history);
    return normalizeQueuePayload(payload);
  },
  getStatus: () => request<ApiStatus>(ENDPOINTS.status),
  getCache: () => request<ApiCache>(ENDPOINTS.cache),
  getSettings: () => request<ApiSettings>(ENDPOINTS.settings),
  getPlayer: async () => {
    const payload = await request<RawPlayerPayload>(ENDPOINTS.player);
    return normalizePlayerPayload(payload);
  },
  search: (query: string, guildId: string, userId?: string) =>
    postJson<{ ok: boolean; queued?: number }, { query: string; guildId: string }>(
      "/music/search",
      { query, guildId },
      guildId,
      userId,
    ),
  requestSong: (query: string, guildId: string, userId?: string) =>
    postJson<{ ok: boolean; queued?: number }, { query: string; guildId: string }>(
      "/music/request",
      { query, guildId },
      guildId,
      userId,
    ),
  playback: (action: PlaybackAction) =>
    request<{ ok: boolean }>(ENDPOINTS.playback, { method: "POST", body: JSON.stringify({ action }) }),
  clearQueue: () => request<{ ok: boolean }>(ENDPOINTS.clearQueue, { method: "POST" }),
  summonBot: (guildId: string, userId?: string) =>
    postJson<{ ok: boolean; message?: string }, { guildId: string }>(ENDPOINTS.join, { guildId }, guildId, userId),
  leaveVoice: () => request<{ ok: boolean }>(ENDPOINTS.leave, { method: "POST" }),
  cleanAudioCache: () => request<{ ok: boolean; removedMb?: number }>(ENDPOINTS.cleanCache, { method: "POST" }),
  setVolume: (volume: number) =>
    request<{ ok: boolean; volume: number }>(ENDPOINTS.volume, {
      method: "POST",
      body: JSON.stringify({ volume }),
    }),
  getLyrics: (title: string, artist: string) =>
    request<unknown>(ENDPOINTS.lyrics, {
      method: "POST",
      body: JSON.stringify({ title: cleanLyricsTitle(title), artist }),
    }).then(normalizeLyricsPayload),
  fetchLyrics: async (title: string, artist: string, guildId = DEFAULT_GUILD_ID, userId = OWNER_USER_ID) => {
    const normalizedTitle = cleanLyricsTitle(title);
    const normalizedArtist = artist?.trim();
    if (!normalizedTitle) throw new Error("Missing search query for lyrics");

    try {
      const activeGuildId = guildId?.trim() || apiAuthContext.guildId || DEFAULT_GUILD_ID;
      const activeUserId = userId?.trim() || apiAuthContext.userId || OWNER_USER_ID;
      const authHeader = apiAuthContext.sessionToken ? { Authorization: `Bearer ${apiAuthContext.sessionToken}` } : {};

      const response = await fetch(`${BASE_URL}${ENDPOINTS.lyrics}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true",
          "x-user-id": activeUserId,
          "x-guild-id": activeGuildId,
          "x-api-key": OWNER_API_KEY,
          ...authHeader,
        },
        body: JSON.stringify({ title: normalizedTitle, artist: normalizedArtist }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        console.error(`fetchLyrics failed: HTTP ${response.status}`, errorText || response.statusText);
        throw new Error("Failed to fetch lyrics");
      }

      const payload = (await response.json()) as unknown;
      return normalizeLyricsPayload(payload);
    } catch (error) {
      console.error("fetchLyrics request failed:", error);
      throw error;
    }
  },
  startKaraoke: async (guildId: string, trackUrl: string, userId = OWNER_USER_ID) => {
    if (!guildId?.trim() || !trackUrl?.trim()) throw new Error("Missing guildId or trackUrl");

    try {
      const activeGuildId = guildId?.trim() || apiAuthContext.guildId || DEFAULT_GUILD_ID;
      const activeUserId = userId?.trim() || apiAuthContext.userId || OWNER_USER_ID;
      const authHeader = apiAuthContext.sessionToken ? { Authorization: `Bearer ${apiAuthContext.sessionToken}` } : {};

      const response = await fetch(`${BASE_URL}/music/karaoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true",
          "x-user-id": activeUserId,
          "x-guild-id": activeGuildId,
          "x-api-key": OWNER_API_KEY,
          ...authHeader,
        },
        body: JSON.stringify({ guildId: activeGuildId, trackUrl: trackUrl.trim() }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        console.error(`startKaraoke failed: HTTP ${response.status}`, errorText || response.statusText);
        throw new Error("Failed to generate pitch map");
      }

      return response.json() as Promise<ApiKaraokeResponse>;
    } catch (error) {
      console.error("startKaraoke request failed:", error);
      throw error;
    }
  },
  reorderQueue: (oldIndex: number, newIndex: number) =>
    request<{ ok: boolean }>(ENDPOINTS.queueReorder, {
      method: "POST",
      body: JSON.stringify({ oldIndex, newIndex }),
    }),
  deleteQueueItem: (index: number) =>
    request<{ ok: boolean }>(`${ENDPOINTS.queueDelete}/${index}`, { method: "DELETE" }),
  previousTrack: () => request<{ ok: boolean }>(ENDPOINTS.previousTrack, { method: "POST" }),
  shuffleQueue: () => request<{ ok: boolean }>(ENDPOINTS.queueShuffle, { method: "POST" }),
  getPresets: async () => {
    const payload = await request<unknown>(ENDPOINTS.presets);
    return normalizePresetsPayload(payload);
  },
  savePreset: (name: string) =>
    request<{ ok: boolean; preset?: ApiPreset }>(ENDPOINTS.presetsSave, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  loadPreset: (name: string) =>
    request<{ ok: boolean }>(ENDPOINTS.presetsLoad, { method: "POST", body: JSON.stringify({ name }) }),
  createPreset: (name: string) =>
    request<{ ok: boolean; preset?: ApiPreset }>(ENDPOINTS.presetsCreate, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  searchOnly: (query: string) =>
    request<unknown>(ENDPOINTS.searchOnly, {
      method: "POST",
      body: JSON.stringify({ query }),
    }).then(normalizeSearchCatalogPayload),
  addTrackToPreset: (presetId: string, track: ApiSearchResult) =>
    request<{ ok: boolean; preset?: ApiPreset }>(`/music/playlist/add-track`, {
      method: "POST",
      body: JSON.stringify({ playlistId: presetId, track }),
    }),
  importPlaylistToPreset: (presetId: string, url: string) =>
    request<{ ok: boolean; added?: number; preset?: ApiPreset }>(`/presets/${encodeURIComponent(presetId)}/import`, {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  removeTrackFromPreset: (presetId: string, trackIndex: number) =>
    request<{ ok: boolean; preset?: ApiPreset }>(
      `/presets/${encodeURIComponent(presetId)}/remove/${encodeURIComponent(String(trackIndex))}`,
      { method: "DELETE" },
    ),
  deletePreset: (presetId: string) =>
    request<{ ok: boolean }>(ENDPOINTS.presetsDelete, {
      method: "DELETE",
      body: JSON.stringify({ presetId }),
    }),
  getPitchMap: (title: string, artist: string) =>
    request<ApiPitchMap>(ENDPOINTS.pitchMap, {
      method: "POST",
      body: JSON.stringify({ title, artist }),
    }),
  searchCatalog: (query: string) =>
    request<unknown>(ENDPOINTS.searchResults, {
      method: "POST",
      body: JSON.stringify({ query }),
    }).then(normalizeSearchCatalogPayload),
  getAuditLog: () => request<ApiAuditTrack[]>(ENDPOINTS.audit),
};

export const mockData = {
  queue: [
    {
      id: "q1",
      title: "Night Circuit",
      artist: "Mira Kade",
      duration: "3:48",
      requestedBy: "Rex",
      art: "",
      requesterAvatar: "",
    },
    {
      id: "q2",
      title: "Static Bloom",
      artist: "Luma Echo",
      duration: "4:12",
      requestedBy: "Nyx",
      art: "",
      requesterAvatar: "",
    },
    {
      id: "q3",
      title: "Volt Heart",
      artist: "Astra Vale",
      duration: "2:59",
      requestedBy: "Kai",
      art: "",
      requesterAvatar: "",
    },
  ] as ApiTrack[],
  history: [] as ApiTrack[],
  status: { activeShard: 0, pingMs: 42, uptime: "24h 12m", online: true } as ApiStatus,
  cache: { sizeMb: 142, maxMb: 300 } as ApiCache,
  settings: {} as ApiSettings,
  player: {
    title: "Night Circuit",
    artist: "Mira Kade",
    durationSec: 252,
    positionSec: 65,
    playing: true,
    volume: 68,
  } as ApiPlayer,
  lyrics: {
    title: "Night Circuit",
    artist: "Mira Kade",
    source: "Temporary adapter",
    plain: "Streetlights whisper in the static glow\nPulse of midnight running through the low\nNeon hearts and engines in the rain\nWe keep moving through electric veins",
    synced: "[00:03.00] Streetlights whisper in the static glow\n[00:08.00] Pulse of midnight running through the low\n[00:13.00] Neon hearts and engines in the rain\n[00:18.00] We keep moving through electric veins",
    hasSynced: true,
    lines: [
      { timeSeconds: 3, text: "Streetlights whisper in the static glow" },
      { timeSeconds: 8, text: "Pulse of midnight running through the low" },
      { timeSeconds: 13, text: "Neon hearts and engines in the rain" },
      { timeSeconds: 18, text: "We keep moving through electric veins" },
    ],
  } as ApiLyrics,
};
