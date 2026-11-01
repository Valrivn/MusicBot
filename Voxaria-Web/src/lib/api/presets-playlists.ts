import { request, toNumber, toStringValue, toOptionalString } from './auth-client';
import type { ApiPreset, ApiSearchResult } from './auth-client';
import { normalizeSearchCatalogPayload } from './search-library';

export const normalizePresetsPayload = (payload: unknown): ApiPreset[] => {
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

export const presetsPlaylistsApi = {
  getPresets: async (): Promise<ApiPreset[]> => {
    const payload = await request<unknown>("/presets");
    return normalizePresetsPayload(payload);
  },
  savePreset: (name: string) =>
    request<{ ok: boolean; preset?: ApiPreset }>("/presets/save", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  loadPreset: (name: string) =>
    request<{ ok: boolean }>("/presets/load", { method: "POST", body: JSON.stringify({ name }) }),
  createPreset: (name: string) =>
    request<{ ok: boolean; preset?: ApiPreset }>("/presets/create", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
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
    request<{ ok: boolean }>("/presets/delete", {
      method: "DELETE",
      body: JSON.stringify({ presetId }),
    }),
};
