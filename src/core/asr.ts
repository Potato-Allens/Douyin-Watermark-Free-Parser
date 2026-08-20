import { DouyinServiceError } from "./errors.ts";
import type { LlmSettings } from "./creator.ts";
import type { FetchLike, ParsedDouyinInfo } from "./types.ts";

export type AsrLanguage = "auto" | "zh" | "en";

export interface SpeechTranscriptResult {
  provider: "xiaomi_asr";
  transcript: string;
  model: string;
  language: AsrLanguage;
  duration_seconds: number | null;
  media_bytes: number;
  audio_bytes: number;
  queue_wait_ms: number;
  usage: {
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_tokens: number | null;
    audio_tokens: number | null;
  };
}

export interface VideoTranscriberOptions {
  parsed: ParsedDouyinInfo;
  settings: LlmSettings;
  apiKey: string;
  fetcher?: FetchLike;
}

export type VideoTranscriber = (options: VideoTranscriberOptions) => Promise<SpeechTranscriptResult>;

interface AsrApiResult {
  transcript: string;
  model: string;
  language: AsrLanguage;
  duration_seconds: number | null;
  usage: SpeechTranscriptResult["usage"];
}

interface QueueWaiter {
  resolve: (release: () => void) => void;
}

const ASR_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

let activeAsrJobs = 0;
const asrWaiters: QueueWaiter[] = [];

export const transcribeDouyinVideo: VideoTranscriber = async (options) => {
  if (!isNodeRuntime()) {
    throw new DouyinServiceError("UNSUPPORTED_CONTENT", "真实语音识别需要 Node.js 运行时和 FFmpeg", 501);
  }
  if (options.parsed.media.type !== "video" || !options.parsed.media.video_url) {
    throw new DouyinServiceError("UNSUPPORTED_CONTENT", "当前内容没有可用于语音识别的视频音轨", 415);
  }

  const env = getEnv();
  const maxConcurrency = readPositiveInt(env.ASR_MAX_CONCURRENCY, 1, 1, 16);
  const maxQueue = readPositiveInt(env.ASR_MAX_QUEUE, 20, 0, 1_000);
  const queuedAt = Date.now();
  const release = await acquireAsrSlot(maxConcurrency, maxQueue);
  const queueWaitMs = Date.now() - queuedAt;
  let fs: any = null;
  let tempDir: string | null = null;
  try {
    fs = await dynamicImport("node:fs/promises");
    const os = await dynamicImport("node:os");
    const path = await dynamicImport("node:path");
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "douyin-asr-"));
    const videoPath = path.join(tempDir, "source.mp4");
    const audioPath = path.join(tempDir, "audio.mp3");
    const mediaBytes = await downloadMediaToFile({
      url: options.parsed.media.video_url,
      outputPath: videoPath,
      fetcher: options.fetcher,
      timeoutMs: readPositiveInt(env.ASR_MEDIA_TIMEOUT_MS, 120_000, 5_000, 600_000),
      maxBytes: readPositiveInt(env.ASR_MAX_VIDEO_BYTES, 120 * 1024 * 1024, 1_000_000, 1024 * 1024 * 1024),
    });

    await extractMp3(videoPath, audioPath, {
      ffmpegPath: env.FFMPEG_PATH?.trim() || "ffmpeg",
      timeoutMs: readPositiveInt(env.FFMPEG_TIMEOUT_MS, 120_000, 5_000, 600_000),
    });

    const stat = await fs.stat(audioPath);
    const maxAudioBytes = readPositiveInt(env.ASR_MAX_AUDIO_BYTES, 24 * 1024 * 1024, 64_000, 256 * 1024 * 1024);
    if (!stat.size || stat.size > maxAudioBytes) {
      throw new DouyinServiceError("UNSUPPORTED_CONTENT", `提取后的音频大小 ${stat.size} 字节，超过限制 ${maxAudioBytes} 字节`, 413);
    }
    const audio = new Uint8Array(await fs.readFile(audioPath));
    const asr = await callMimoAsr({
      settings: options.settings,
      apiKey: options.apiKey,
      audio,
      mimeType: "audio/mpeg",
      format: "mp3",
      fetcher: options.fetcher,
    });
    return {
      provider: "xiaomi_asr",
      ...asr,
      media_bytes: mediaBytes,
      audio_bytes: audio.byteLength,
      queue_wait_ms: queueWaitMs,
    };
  } finally {
    release();
    if (fs && tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

export async function callMimoAsr(options: {
  settings: LlmSettings;
  apiKey: string;
  audio: Uint8Array;
  mimeType: "audio/mpeg" | "audio/mp3" | "audio/wav";
  format: "mp3" | "wav";
  fetcher?: FetchLike;
}): Promise<AsrApiResult> {
  if (!options.audio.byteLength) throw new DouyinServiceError("UNSUPPORTED_CONTENT", "音频内容为空", 400);
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (!fetcher) throw new DouyinServiceError("FETCH_FAILED", "fetch is not available");
  const baseUrl = options.settings.asr_base_url || options.settings.base_url;
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const language = normalizeLanguage(options.settings.asr_language);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.settings.asr_timeout_ms);
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api-key": options.apiKey,
        authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: options.settings.asr_model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "input_audio",
                input_audio: {
                  data: `data:${options.mimeType};base64,${bytesToBase64(options.audio)}`,
                  format: options.format,
                },
              },
            ],
          },
        ],
        asr_options: { language },
        stream: false,
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new DouyinServiceError("FETCH_FAILED", `小米语音识别接口返回 ${response.status}: ${trimText(text, 240)}`, 502);
    }
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new DouyinServiceError("PARSE_FAILED", `小米语音识别返回了无效 JSON: ${trimText(text, 160)}`, 502);
    }
    const transcript = typeof data?.choices?.[0]?.message?.content === "string" ? data.choices[0].message.content.trim() : "";
    if (!transcript) throw new DouyinServiceError("PARSE_FAILED", "小米语音识别未返回文本", 502);
    return {
      transcript,
      model: String(data?.model || options.settings.asr_model),
      language,
      duration_seconds: asNullableNumber(data?.usage?.seconds),
      usage: {
        prompt_tokens: asNullableNumber(data?.usage?.prompt_tokens),
        completion_tokens: asNullableNumber(data?.usage?.completion_tokens),
        total_tokens: asNullableNumber(data?.usage?.total_tokens),
        audio_tokens: asNullableNumber(data?.usage?.prompt_tokens_details?.audio_tokens),
      },
    };
  } catch (error) {
    if (error instanceof DouyinServiceError) throw error;
    const detail = error instanceof Error && error.name === "AbortError" ? "小米语音识别请求超时" : error instanceof Error ? error.message : String(error);
    throw new DouyinServiceError("FETCH_FAILED", detail, 502);
  } finally {
    clearTimeout(timer);
  }
}

export async function testMimoAsrSettings(options: { settings: LlmSettings; apiKey: string; fetcher?: FetchLike }) {
  const started = Date.now();
  const result = await callMimoAsr({
    ...options,
    audio: createSilentWav(0.25),
    mimeType: "audio/wav",
    format: "wav",
  });
  return {
    connected: true,
    base_url: options.settings.asr_base_url,
    model: result.model,
    language: result.language,
    latency_ms: Date.now() - started,
    sample: trimText(result.transcript, 80),
  };
}

export function createSilentWav(seconds = 0.25, sampleRate = 16_000): Uint8Array {
  const sampleCount = Math.max(1, Math.floor(seconds * sampleRate));
  const dataSize = sampleCount * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(bytes, 8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, dataSize, true);
  return bytes;
}

async function downloadMediaToFile(options: { url: string; outputPath: string; fetcher?: FetchLike; timeoutMs: number; maxBytes: number }): Promise<number> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (!fetcher) throw new DouyinServiceError("FETCH_FAILED", "fetch is not available");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const fs = await dynamicImport("node:fs/promises");
  let file: any;
  try {
    const response = await fetcher(options.url, {
      redirect: "follow",
      headers: {
        "user-agent": ASR_USER_AGENT,
        referer: "https://www.douyin.com/",
        accept: "video/*,audio/*;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new DouyinServiceError("FETCH_FAILED", `视频取流返回 ${response.status}`, 502);
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > options.maxBytes) throw new DouyinServiceError("UNSUPPORTED_CONTENT", `视频大小 ${declared} 字节，超过限制 ${options.maxBytes} 字节`, 413);
    if (!response.body) throw new DouyinServiceError("FETCH_FAILED", "视频响应没有可读取的数据流", 502);

    file = await fs.open(options.outputPath, "w", 0o600);
    const reader = response.body.getReader();
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > options.maxBytes) {
        await reader.cancel("media size limit exceeded").catch(() => undefined);
        throw new DouyinServiceError("UNSUPPORTED_CONTENT", `视频超过 ${options.maxBytes} 字节限制`, 413);
      }
      await file.write(value);
    }
    if (!total) throw new DouyinServiceError("FETCH_FAILED", "视频响应为空", 502);
    return total;
  } catch (error) {
    if (error instanceof DouyinServiceError) throw error;
    const detail = error instanceof Error && error.name === "AbortError" ? "视频取流超时" : error instanceof Error ? error.message : String(error);
    throw new DouyinServiceError("FETCH_FAILED", detail, 502);
  } finally {
    clearTimeout(timer);
    await file?.close().catch(() => undefined);
  }
}

async function extractMp3(inputPath: string, outputPath: string, options: { ffmpegPath: string; timeoutMs: number }): Promise<void> {
  const childProcess = await dynamicImport("node:child_process");
  await new Promise<void>((resolve, reject) => {
    let stderr = "";
    let settled = false;
    const child = childProcess.spawn(
      options.ffmpegPath,
      ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-codec:a", "libmp3lame", "-b:a", "64k", outputPath],
      { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
    );
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve();
    };
    child.stderr?.on("data", (chunk: unknown) => {
      if (stderr.length < 8_000) stderr += String(chunk);
    });
    child.once("error", (error: Error & { code?: string }) => {
      const detail = error.code === "ENOENT" ? `找不到 FFmpeg：${options.ffmpegPath}` : error.message;
      finish(new DouyinServiceError("FETCH_FAILED", detail, 503));
    });
    child.once("close", (code: number | null) => {
      if (code === 0) finish();
      else finish(new DouyinServiceError("PARSE_FAILED", `FFmpeg 提取音频失败（退出码 ${code ?? "unknown"}）：${trimText(stderr, 300)}`, 422));
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new DouyinServiceError("FETCH_FAILED", "FFmpeg 提取音频超时", 504));
    }, options.timeoutMs);
  });
}

async function acquireAsrSlot(maxActive: number, maxQueue: number): Promise<() => void> {
  if (activeAsrJobs < maxActive) {
    activeAsrJobs += 1;
    return makeRelease();
  }
  if (asrWaiters.length >= maxQueue) {
    throw new DouyinServiceError("FETCH_FAILED", "语音识别队列已满，请稍后重试", 503);
  }
  return await new Promise<() => void>((resolve) => asrWaiters.push({ resolve }));
}

function makeRelease(): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = asrWaiters.shift();
    if (next) next.resolve(makeRelease());
    else activeAsrJobs = Math.max(0, activeAsrJobs - 1);
  };
}

function normalizeLanguage(value: unknown): AsrLanguage {
  return value === "zh" || value === "en" ? value : "auto";
}

function bytesToBase64(bytes: Uint8Array): string {
  const BufferCtor = (globalThis as any).Buffer;
  if (BufferCtor) return BufferCtor.from(bytes).toString("base64");
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) target[offset + index] = value.charCodeAt(index);
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readPositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
}

function trimText(value: string, maxLength: number): string {
  const text = value.trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function getEnv(): Record<string, string | undefined> {
  return ((globalThis as any).process?.env ?? {}) as Record<string, string | undefined>;
}

function isNodeRuntime(): boolean {
  return Boolean((globalThis as any).process?.versions?.node);
}

async function dynamicImport(specifier: string): Promise<any> {
  return await import(specifier);
}
