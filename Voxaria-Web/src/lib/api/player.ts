import { request, PlaybackAction, toNumber, toBoolean, toStringValue, toOptionalString, pick } from './auth-client';
import type { ApiPlayer } from './auth-client';

type RawPlayerPayload = {
  success?: boolean;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

export const normalizePlayerPayload = (payload: RawPlayerPayload): ApiPlayer => {
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
    id: toOptionalString(pick("id", data, root)) ?? toOptionalString(pick("identifier", data, root)),
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

export const playerApi = {
  getPlayer: async (): Promise<ApiPlayer> => {
    const payload = await request<RawPlayerPayload>("/music/player");
    return normalizePlayerPayload(payload);
  },
  playback: (action: PlaybackAction) =>
    request<{ ok: boolean }>("/music/playback", { method: "POST", body: JSON.stringify({ action }) }),
  previousTrack: () => request<{ success: true }>("/player/previous", { method: "POST" }),
  setVolume: (volume: number) =>
    request<{ ok: boolean; volume: number }>("/music/volume", {
      method: "POST",
      body: JSON.stringify({ volume }),
    }),
};
