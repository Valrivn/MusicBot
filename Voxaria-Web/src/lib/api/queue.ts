import { request, postJson, toNumber } from './auth-client';
import type { ApiTrack } from './auth-client';

type RawQueuePayload = {
  success?: boolean;
  data?: unknown;
  queue?: unknown;
  tracks?: unknown;
  items?: unknown;
  [key: string]: unknown;
};

export const normalizeQueuePayload = (payload: RawQueuePayload): ApiTrack[] => {
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

export const queueApi = {
  getQueue: async (): Promise<ApiTrack[]> => {
    const payload = await request<RawQueuePayload>("/music/queue");
    return normalizeQueuePayload(payload);
  },
  getHistory: async (): Promise<ApiTrack[]> => {
    const payload = await request<RawQueuePayload>("/music/history");
    return normalizeQueuePayload(payload);
  },
  requestSong: (query: string, guildId: string, userId?: string) =>
    postJson<{ ok: boolean; queued?: number }, { query: string; guildId: string }>(
      "/music/request",
      { query, guildId },
      guildId,
      userId,
    ),
  clearQueue: () => request<{ ok: boolean }>("/music/queue/clear", { method: "POST" }),
  reorderQueue: (oldIndex: number, newIndex: number) =>
    request<{ ok: boolean }>("/queue/reorder", {
      method: "POST",
      body: JSON.stringify({ oldIndex, newIndex }),
    }),
  deleteQueueItem: (index: number) =>
    request<{ ok: boolean }>(`/queue/${index}`, { method: "DELETE" }),
  shuffleQueue: () => request<{ ok: boolean }>("/queue/shuffle", { method: "POST" }),
};
