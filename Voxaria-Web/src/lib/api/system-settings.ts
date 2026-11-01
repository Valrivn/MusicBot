import { request, postJson } from './auth-client';
import type { ApiStatus, ApiCache, ApiSettings } from './auth-client';

export const systemSettingsApi = {
  getStatus: () => request<ApiStatus>("/bot/status"),
  getCache: () => request<ApiCache>("/system/audio-cache"),
  getSettings: () => request<ApiSettings>("/system/settings"),
  summonBot: (guildId: string, userId?: string) =>
    postJson<{ ok: boolean; message?: string }, { guildId: string }>("/discord/join", { guildId }, guildId, userId),
  leaveVoice: () => request<{ ok: boolean }>("/discord/leave", { method: "POST" }),
  cleanAudioCache: () => request<{ ok: boolean; removedMb?: number }>("/system/audio-cache/clean", { method: "POST" }),
};
