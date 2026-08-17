import type { ApiErrorCode, ApiErrorResponse } from "./types.ts";

const DEFAULT_MESSAGES: Record<ApiErrorCode, string> = {
  MISSING_URL: "url query parameter is required",
  INVALID_URL: "invalid douyin url",
  FETCH_FAILED: "failed to fetch douyin page",
  PARSE_FAILED: "failed to parse douyin page",
  UNSUPPORTED_CONTENT: "unsupported douyin content",
  INTERNAL_ERROR: "internal server error",
};

const DEFAULT_STATUS: Record<ApiErrorCode, number> = {
  MISSING_URL: 400,
  INVALID_URL: 400,
  FETCH_FAILED: 502,
  PARSE_FAILED: 422,
  UNSUPPORTED_CONTENT: 415,
  INTERNAL_ERROR: 500,
};

export class DouyinServiceError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly detail: string;

  constructor(code: ApiErrorCode, detail = "", status = DEFAULT_STATUS[code]) {
    super(DEFAULT_MESSAGES[code]);
    this.name = "DouyinServiceError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export function toServiceError(error: unknown): DouyinServiceError {
  if (error instanceof DouyinServiceError) return error;
  if (error instanceof Error) return new DouyinServiceError("INTERNAL_ERROR", error.message);
  return new DouyinServiceError("INTERNAL_ERROR", String(error));
}

export function makeErrorResponse(error: DouyinServiceError): ApiErrorResponse {
  return {
    ok: false,
    code: error.code,
    message: error.message,
    error: {
      detail: error.detail,
    },
  };
}

export function messageFor(code: ApiErrorCode): string {
  return DEFAULT_MESSAGES[code];
}
