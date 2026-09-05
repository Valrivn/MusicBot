import { trpc } from './client';

export const usePlaylists = {
  getAll: () => trpc.playlist.getAll.useQuery(),
  getMyPlaylists: () => trpc.playlist.getMyPlaylists.useQuery(),
  getPublicPlaylists: () => trpc.playlist.getPublicPlaylists.useQuery(),
  getById: (id: string) => trpc.playlist.getById.useQuery({ id }),
  create: () => trpc.playlist.create.useMutation(),
  addTrack: () => trpc.playlist.addTrack.useMutation(),
  search: () => trpc.playlist.search.useMutation(),
  delete: () => trpc.playlist.delete.useMutation(),
};

export const useQueue = {
  get: () => trpc.queue.get.useQuery(),
  getHistory: () => trpc.queue.getHistory.useQuery(),
  reorder: () => trpc.queue.reorder.useMutation(),
  remove: () => trpc.queue.remove.useMutation(),
  shuffle: () => trpc.queue.shuffle.useMutation(),
  clear: () => trpc.queue.clear.useMutation(),
};

export const usePlayer = {
  get: () => trpc.player.get.useQuery(undefined, { refetchInterval: 2000 }),
  playback: () => trpc.player.playback.useMutation(),
  previous: () => trpc.player.previous.useMutation(),
  setVolume: () => trpc.player.setVolume.useMutation(),
  seek: () => trpc.player.seek.useMutation(),
};

export const useMusic = {
  search: () => trpc.music.search.useMutation(),
  request: () => trpc.music.request.useMutation(),
  searchCatalog: () => trpc.music.searchCatalog.useMutation(),
  getLyrics: () => trpc.music.getLyrics.useMutation(),
};

export const useKaraoke = {
  prepare: () => trpc.karaoke.prepare.useMutation(),
  getStatus: (jobId: string) => trpc.karaoke.getStatus.useQuery({ jobId }, { refetchInterval: 3000 }),
  getPitchData: (trackId?: string) => trpc.karaoke.getPitchData.useQuery({ trackId }, { refetchInterval: 5000 }),
};

export const usePresets = {
  getAll: () => trpc.presets.getAll.useQuery(),
  save: () => trpc.presets.save.useMutation(),
  load: () => trpc.presets.load.useMutation(),
};

export const useBot = {
  getStatus: () => trpc.bot.getStatus.useQuery(undefined, { refetchInterval: 10000 }),
  getCache: () => trpc.bot.getCache.useQuery(undefined, { refetchInterval: 30000 }),
  getSettings: () => trpc.bot.getSettings.useQuery(),
  cleanCache: () => trpc.bot.cleanCache.useMutation(),
  updateSessionRestore: () => trpc.bot.updateSessionRestore.useMutation(),
  setRole: () => trpc.bot.setRole.useMutation(),
  getAuditLog: () => trpc.bot.getAuditLog.useQuery(undefined, { refetchInterval: 30000 }),
};

export const useAuth = {
  discord: () => trpc.auth.discord.useMutation(),
  session: () => trpc.auth.session.useQuery(),
};

export const useDiscord = {
  join: () => trpc.discord.join.useMutation(),
  leave: () => trpc.discord.leave.useMutation(),
};

export const useSystem = {
  getSettings: () => trpc.system.getSettings.useQuery(),
  updateSettings: () => trpc.system.updateSettings.useMutation(),
};