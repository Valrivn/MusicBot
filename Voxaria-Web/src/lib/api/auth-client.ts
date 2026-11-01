import { getAccessToken, setAccessToken, fetchWithAuth } from '../auth';
import { VoxariaErrorCode } from '@/contracts';

export { VoxariaErrorCode };

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
  user?: import('../auth').AuthUser;
};

export type ApiPlayer = {
  id?: string | null;
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

export type PlaybackAction = "previous" | "play_pause" | "next" | "stop";

export type ApiAuthContext = {
  guildId?: string;
  userId?: string;
  sessionToken?: string;
  accessToken?: string;
};

export let accessToken: string | null = getAccessToken();

export function getOrUpdateAccessToken(): string | null {
  if (accessToken) return accessToken;
  const token = getAccessToken();
  if (token) {
    accessToken = token;
    return token;
  }
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('accessToken') || localStorage.getItem('access_token') || localStorage.getItem('token') || localStorage.getItem('sessionToken');
    if (stored) {
      accessToken = stored;
      setAccessToken(stored);
      return stored;
    }
  }
  return null;
}

export const BASE_URL =
  import.meta.env.VITE_VOXARIA_API_BASE_URL?.trim() ||
  import.meta.env.VITE_API_URL?.trim() ||
  "http://localhost:3002";
export const OWNER_USER_ID = "owner";
export const DEFAULT_GUILD_ID = import.meta.env.VITE_VOXARIA_GUILD_ID?.trim() || "owner";

let apiAuthContext: ApiAuthContext = {};

export const setApiAuthContext = (context: ApiAuthContext) => {
  const token = context.sessionToken || context.accessToken;
  if (token) {
    accessToken = token;
    setAccessToken(token);
  }
  apiAuthContext = {
    guildId: context.guildId?.trim() || undefined,
    userId: context.userId?.trim() || undefined,
    sessionToken: context.sessionToken?.trim() || undefined,
  };
};

export class ApiClientError extends Error {
  status: number;
  code?: string;
  fallback: boolean;
  apiMessage: string;

  constructor(status: number, apiMessage: string, code?: string) {
    super(apiMessage || `API ${status}`);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.apiMessage = apiMessage;
    this.fallback = status >= 500;
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BASE_URL) throw new Error("Set VITE_VOXARIA_API_BASE_URL to enable live API mode.");

  try {
    const extraHeaders = new Headers(init?.headers);
    const activeGuildId = toStringValue(extraHeaders.get("x-guild-id")) ?? apiAuthContext.guildId ?? DEFAULT_GUILD_ID;
    const activeUserId = toStringValue(extraHeaders.get("x-user-id")) ?? apiAuthContext.userId ?? OWNER_USER_ID;

    const defaultHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      "x-user-id": activeUserId,
      "x-guild-id": activeGuildId,
    };

    const headers = {
      ...defaultHeaders,
      ...Object.fromEntries(extraHeaders.entries()),
    };

    return fetchWithAuth<T>(path, {
      ...init,
      headers
    });
  } catch (error) {
    console.error("Fetch failed:", error);
    throw error;
  }
}

export async function postJson<TResponse, TBody extends Record<string, unknown>>(
  path: string,
  body: TBody,
  guildId: string,
  userId?: string,
): Promise<TResponse> {
  try {
    const activeGuildId = guildId?.trim() || DEFAULT_GUILD_ID;
    const activeUserId = userId?.trim() || OWNER_USER_ID;

    return fetchWithAuth<TResponse>(path, {
      method: "POST",
      headers: {
        "x-user-id": activeUserId,
        "x-guild-id": activeGuildId,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error("Fetch failed:", error);
    throw error;
  }
}

export const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

export const toBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return null;
};

export const toStringValue = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
};

export const toOptionalString = (value: unknown): string | undefined => toStringValue(value) ?? undefined;

export const pick = <T = unknown,>(
  key: string,
  data: Record<string, unknown>,
  root: Record<string, unknown>,
): T | undefined => {
  if (data[key] !== undefined) return data[key] as T;
  if (root[key] !== undefined) return root[key] as T;
  return undefined;
};
