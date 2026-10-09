export const ERROR_CODES = {
  OTP_INVALID: 400,
  OTP_EXPIRED: 400,
  OTP_TOO_MANY_ATTEMPTS: 429,
  AUTH_EXPIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  TASK_BASELINE_LOCKED: 409,
  MESSAGE_EDIT_WINDOW_PASSED: 409,
  CHANNEL_READ_ONLY: 403,
  CHANNEL_NAME_TAKEN: 409,
  CHANNEL_PRIVATE: 403,
  PROJECT_ARCHIVED: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/** Client-side codes that never come from the server. */
export type ClientErrorCode = 'OFFLINE' | 'TIMEOUT' | 'DEPENDENCY_FAILED' | 'UNKNOWN';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: { fields?: Record<string, string> } & Record<string, unknown>;
    request_id: string;
  };
}
