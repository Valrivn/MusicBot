import { request, toNumber, toStringValue, toBoolean, DEFAULT_GUILD_ID, OWNER_USER_ID } from './auth-client';
import { fetchWithAuth } from '../auth';
import type { ApiLyrics, ApiKaraokeResponse, ApiPitchMap } from './auth-client';

const cleanLyricsTitle = (title: string) =>
  title
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/official\s*video/gi, " ")
    .replace(/lyrics?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

export const normalizeLyricsPayload = (payload: unknown): ApiLyrics => {
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

export type KaraokeRecord = {
  id?: string;
  guildId: string;
  trackId: string;
  trackTitle?: string;
  userId: string;
  username: string;
  avatar?: string;
  score: number;
  accuracy: number;
  maxCombo: number;
  grade: "S+" | "S" | "A" | "B" | "C";
  dateSet: string;
};

export type ServerRecordsResponse = {
  champion: KaraokeRecord | null;
  topRecords: KaraokeRecord[];
  userRecord?: KaraokeRecord | null;
  isNewRecord?: boolean;
};

const getLocalRecordsStorageKey = (guildId: string, trackId: string) =>
  `voxaria.karaoke.records.${guildId}.${trackId}`;

export const getLocalRecords = (guildId: string, trackId: string): ServerRecordsResponse => {
  if (typeof window === "undefined" || !window.localStorage) {
    return { champion: null, topRecords: [] };
  }
  try {
    const raw = window.localStorage.getItem(getLocalRecordsStorageKey(guildId, trackId));
    if (raw) {
      const parsed = JSON.parse(raw) as ServerRecordsResponse;
      return parsed;
    }
  } catch (e) {
    console.error("Failed to read local records:", e);
  }

  const defaultChampion: KaraokeRecord = {
    guildId,
    trackId,
    userId: "server-champ-1",
    username: "VoxariaLegend",
    score: 82500,
    accuracy: 91,
    maxCombo: 84,
    grade: "S",
    dateSet: "2 days ago",
  };

  const defaultRunnerUp: KaraokeRecord = {
    guildId,
    trackId,
    userId: "server-runner-1",
    username: "AriaEcho",
    score: 68400,
    accuracy: 82,
    maxCombo: 52,
    grade: "A",
    dateSet: "Last week",
  };

  return {
    champion: defaultChampion,
    topRecords: [defaultChampion, defaultRunnerUp],
  };
};

export const saveLocalRecord = (
  guildId: string,
  trackId: string,
  record: Omit<KaraokeRecord, "dateSet">
): ServerRecordsResponse => {
  const current = getLocalRecords(guildId, trackId);
  const nowFormatted = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const fullRecord: KaraokeRecord = {
    ...record,
    dateSet: nowFormatted,
  };

  const allRecords = [...current.topRecords, fullRecord]
    .sort((a, b) => b.score - a.score);

  const userBestMap = new Map<string, KaraokeRecord>();
  for (const r of allRecords) {
    if (!userBestMap.has(r.userId) || (userBestMap.get(r.userId)!.score < r.score)) {
      userBestMap.set(r.userId, r);
    }
  }

  const topRecords = Array.from(userBestMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const prevChamp = current.champion;
  const isNewRecord = !prevChamp || record.score > prevChamp.score;
  const newChamp = isNewRecord ? fullRecord : (topRecords[0] ?? fullRecord);

  const result: ServerRecordsResponse = {
    champion: newChamp,
    topRecords,
    userRecord: fullRecord,
    isNewRecord,
  };

  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(getLocalRecordsStorageKey(guildId, trackId), JSON.stringify(result));
    }
  } catch (e) {
    console.error("Failed to write local records:", e);
  }

  return result;
};

export const karaokeApi = {
  getLyrics: (title: string, artist: string) =>
    request<unknown>("/music/lyrics", {
      method: "POST",
      body: JSON.stringify({ title: cleanLyricsTitle(title), artist }),
    }).then(normalizeLyricsPayload),
  fetchLyrics: async (title: string, artist: string, guildId = DEFAULT_GUILD_ID, userId = OWNER_USER_ID) => {
    const normalizedTitle = cleanLyricsTitle(title);
    const normalizedArtist = artist?.trim();
    if (!normalizedTitle) throw new Error("Missing search query for lyrics");

    try {
      const activeGuildId = guildId?.trim() || DEFAULT_GUILD_ID;
      const activeUserId = userId?.trim() || OWNER_USER_ID;

      return fetchWithAuth<ApiLyrics>("/music/lyrics", {
        method: "POST",
        headers: {
          "x-user-id": activeUserId,
          "x-guild-id": activeGuildId,
        },
        body: JSON.stringify({ title: normalizedTitle, artist: normalizedArtist }),
      }).then(normalizeLyricsPayload);
    } catch (error) {
      console.error("fetchLyrics request failed:", error);
      throw error;
    }
  },
  startKaraoke: async (guildId: string, trackUrl: string, userId = OWNER_USER_ID) => {
    if (!guildId?.trim() || !trackUrl?.trim()) throw new Error("Missing guildId or trackUrl");

    try {
      const activeGuildId = guildId?.trim() || DEFAULT_GUILD_ID;
      const activeUserId = userId?.trim() || OWNER_USER_ID;

      return fetchWithAuth<ApiKaraokeResponse>('/music/karaoke', {
        method: "POST",
        headers: {
          "x-user-id": activeUserId,
          "x-guild-id": activeGuildId,
        },
        body: JSON.stringify({ guildId: activeGuildId, trackUrl: trackUrl.trim() }),
      });
    } catch (error) {
      console.error("startKaraoke request failed:", error);
      throw error;
    }
  },
  getPitchMap: (title: string, artist: string) =>
    request<ApiPitchMap>("/music/pitch-map", {
      method: "POST",
      body: JSON.stringify({ title, artist }),
    }),
  getRecords: async (guildId: string, trackId: string): Promise<ServerRecordsResponse> => {
    const activeGuild = guildId?.trim() || DEFAULT_GUILD_ID;
    const activeTrack = trackId?.trim() || "unknown";
    try {
      return await fetchWithAuth<ServerRecordsResponse>(
        `/api/karaoke/records/${encodeURIComponent(activeGuild)}/${encodeURIComponent(activeTrack)}`,
        { method: "GET" }
      );
    } catch {
      return getLocalRecords(activeGuild, activeTrack);
    }
  },
  submitRecord: async (
    guildId: string,
    trackId: string,
    record: Omit<KaraokeRecord, "dateSet">
  ): Promise<ServerRecordsResponse> => {
    const activeGuild = guildId?.trim() || DEFAULT_GUILD_ID;
    const activeTrack = trackId?.trim() || "unknown";
    try {
      return await fetchWithAuth<ServerRecordsResponse>(
        `/api/karaoke/records/${encodeURIComponent(activeGuild)}/${encodeURIComponent(activeTrack)}`,
        {
          method: "POST",
          body: JSON.stringify(record),
        }
      );
    } catch {
      return saveLocalRecord(activeGuild, activeTrack, record);
    }
  },
};
