import { z } from 'zod';

/**
 * Structured taxonomy of error codes across Voxaria services.
 */
export enum VoxariaErrorCode {
  // AUTH
  AUTH_UNAUTHORIZED = 'AUTH_UNAUTHORIZED',
  AUTH_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED',
  AUTH_FORBIDDEN = 'AUTH_FORBIDDEN',

  // PLAYER
  PLAYER_BOT_NOT_IN_VOICE = 'PLAYER_BOT_NOT_IN_VOICE',
  PLAYER_QUEUE_EMPTY = 'PLAYER_QUEUE_EMPTY',
  TRACK_NOT_FOUND = 'TRACK_NOT_FOUND',
  SOURCE_EXTRACT_FAILED = 'SOURCE_EXTRACT_FAILED',

  // KARAOKE
  KARAOKE_REDIS_UNAVAILABLE = 'KARAOKE_REDIS_UNAVAILABLE',
  KARAOKE_STEM_FAILED = 'KARAOKE_STEM_FAILED',
  KARAOKE_NO_PITCH_DATA = 'KARAOKE_NO_PITCH_DATA',

  // RECORDS & PLAYLISTS
  RECORD_INVALID_SCORE = 'RECORD_INVALID_SCORE',
  PLAYLIST_DUPLICATE_NAME = 'PLAYLIST_DUPLICATE_NAME',
  PLAYLIST_NOT_FOUND = 'PLAYLIST_NOT_FOUND',
}

export const VoxariaErrorCodeSchema = z.nativeEnum(VoxariaErrorCode);

/**
 * Standard typed API error response envelope.
 */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: VoxariaErrorCode;
    message: string;
    details?: unknown;
  };
}

export const ApiErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: VoxariaErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

/**
 * Helper to construct a standard ApiErrorResponse object.
 */
export function createApiError(
  code: VoxariaErrorCode,
  message: string,
  details?: unknown,
): ApiErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

/**
 * Custom error class carrying standard VoxariaErrorCode.
 */
export class VoxariaApiError extends Error {
  public readonly code: VoxariaErrorCode;
  public readonly details?: unknown;

  constructor(code: VoxariaErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'VoxariaApiError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toResponse(): ApiErrorResponse {
    return createApiError(this.code, this.message, this.details);
  }
}

/**
 * Type guard for ApiErrorResponse.
 */
export function isApiErrorResponse(obj: unknown): obj is ApiErrorResponse {
  if (typeof obj !== 'object' || obj === null) return false;
  const cast = obj as Record<string, unknown>;
  return (
    cast.success === false &&
    typeof cast.error === 'object' &&
    cast.error !== null &&
    'code' in (cast.error as Record<string, unknown>)
  );
}
