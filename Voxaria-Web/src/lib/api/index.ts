export * from './auth-client';
export * from './player';
export * from './queue';
export * from './search-library';
export * from './presets-playlists';
export * from './karaoke';
export * from './system-settings';
export * from './metrics-audit';

import { queueApi } from './queue';
import { systemSettingsApi } from './system-settings';
import { playerApi } from './player';
import { searchLibraryApi } from './search-library';
import { presetsPlaylistsApi } from './presets-playlists';
import { karaokeApi } from './karaoke';
import { metricsAuditApi } from './metrics-audit';
import type { ApiTrack, ApiStatus, ApiCache, ApiSettings, ApiPlayer, ApiLyrics, ApiPreset } from './auth-client';

export const voxariaApi = {
  getQueue: queueApi.getQueue,
  getHistory: queueApi.getHistory,
  getStatus: systemSettingsApi.getStatus,
  getCache: systemSettingsApi.getCache,
  getSettings: systemSettingsApi.getSettings,
  getPlayer: playerApi.getPlayer,
  search: searchLibraryApi.search,
  requestSong: queueApi.requestSong,
  playback: playerApi.playback,
  clearQueue: queueApi.clearQueue,
  summonBot: systemSettingsApi.summonBot,
  leaveVoice: systemSettingsApi.leaveVoice,
  cleanAudioCache: systemSettingsApi.cleanAudioCache,
  setVolume: playerApi.setVolume,
  getLyrics: karaokeApi.getLyrics,
  fetchLyrics: karaokeApi.fetchLyrics,
  startKaraoke: karaokeApi.startKaraoke,
  reorderQueue: queueApi.reorderQueue,
  deleteQueueItem: queueApi.deleteQueueItem,
  previousTrack: playerApi.previousTrack,
  shuffleQueue: queueApi.shuffleQueue,
  getPresets: presetsPlaylistsApi.getPresets,
  savePreset: presetsPlaylistsApi.savePreset,
  loadPreset: presetsPlaylistsApi.loadPreset,
  createPreset: presetsPlaylistsApi.createPreset,
  searchOnly: searchLibraryApi.searchOnly,
  addTrackToPreset: presetsPlaylistsApi.addTrackToPreset,
  importPlaylistToPreset: presetsPlaylistsApi.importPlaylistToPreset,
  removeTrackFromPreset: presetsPlaylistsApi.removeTrackFromPreset,
  deletePreset: presetsPlaylistsApi.deletePreset,
  getPitchMap: karaokeApi.getPitchMap,
  getRecords: karaokeApi.getRecords,
  submitRecord: karaokeApi.submitRecord,
  searchCatalog: searchLibraryApi.searchCatalog,
  getAuditLog: metricsAuditApi.getAuditLog,
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
      { timeSeconds: 13, text: "Streetlights whisper in the static glow" },
      { timeSeconds: 18, text: "We keep moving through electric veins" },
    ],
  } as ApiLyrics,
};
