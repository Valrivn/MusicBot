import { request, postJson, toNumber, toStringValue, toOptionalString } from './auth-client';
import type { ApiSearchResult } from './auth-client';

export const normalizeSearchCatalogPayload = (payload: unknown): ApiSearchResult[] => {
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

export const searchLibraryApi = {
  search: (query: string, guildId: string, userId?: string) =>
    postJson<{ ok: boolean; queued?: number }, { query: string; guildId: string }>(
      "/music/search",
      { query, guildId },
      guildId,
      userId,
    ),
  searchOnly: (query: string) =>
    request<unknown>("/playlist/search", {
      method: "POST",
      body: JSON.stringify({ query }),
    }).then(normalizeSearchCatalogPayload),
  searchCatalog: (query: string) =>
    request<unknown>("/music/search/results", {
      method: "POST",
      body: JSON.stringify({ query }),
    }).then(normalizeSearchCatalogPayload),
};
