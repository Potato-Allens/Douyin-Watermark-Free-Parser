export type MediaType = "video" | "image" | "unknown";

export interface DouyinVideoInfo {
  aweme_id: string | null;
  comment_count: number | null;
  digg_count: number | null;
  share_count: number | null;
  collect_count: number | null;
  nickname: string | null;
  signature: string | null;
  desc: string | null;
  create_time: string | null;
  video_url: string | null;
  type: "video" | "img" | null;
  image_url_list: string[];
}

export interface ParsedDouyinInfo {
  source: {
    input_url: string;
    resolved_url: string;
    aweme_id: string | null;
  };
  author: {
    nickname: string | null;
    signature: string | null;
  };
  stats: {
    comment_count: number | null;
    digg_count: number | null;
    share_count: number | null;
    collect_count: number | null;
  };
  content: {
    desc: string | null;
    create_timestamp: number | null;
    created_at: string | null;
  };
  media: {
    type: MediaType;
    video_url: string | null;
    image_url_list: string[];
  };
  compat: DouyinVideoInfo;
}

export interface ApiSuccessResponse<T> {
  ok: true;
  code: "OK";
  message: "success";
  data: T;
}

export type ApiErrorCode =
  | "MISSING_URL"
  | "INVALID_URL"
  | "FETCH_FAILED"
  | "PARSE_FAILED"
  | "UNSUPPORTED_CONTENT"
  | "INTERNAL_ERROR";

export interface ApiErrorResponse {
  ok: false;
  code: ApiErrorCode;
  message: string;
  error: {
    detail: string;
  };
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ParseOptions {
  fetcher?: FetchLike;
  userAgent?: string;
  timeoutMs?: number;
  allowedHosts?: string[];
  validateMedia?: boolean;
}

export interface ParseHtmlOptions {
  inputUrl?: string;
  resolvedUrl?: string;
}
