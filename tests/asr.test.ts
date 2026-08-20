import { describe, expect, it } from "vitest";
import { callMimoAsr, createMemoryCreatorStore, createSilentWav, generateAiCopy } from "../src/core/index.ts";
import type { FetchLike, LlmSettings, ParsedDouyinInfo } from "../src/core/index.ts";

const SETTINGS: LlmSettings = {
  base_url: "https://token-plan-cn.xiaomimimo.com/v1",
  api_key_masked: "sk-t****test",
  model: "mimo-v2.5",
  asr_base_url: "https://api.xiaomimimo.com/v1",
  asr_model: "mimo-v2.5-asr",
  asr_language: "zh",
  asr_timeout_ms: 180_000,
  asr_enabled: true,
  timeout_ms: 30_000,
  max_tokens: 900,
  temperature: 0.75,
  enabled: true,
  updated_at: null,
};

const PARSED: ParsedDouyinInfo = {
  source: { input_url: "https://v.douyin.com/test/", resolved_url: "https://www.douyin.com/video/1", aweme_id: "1" },
  author: { nickname: "作者", signature: null },
  stats: { comment_count: 1, digg_count: 2, share_count: 3, collect_count: 4 },
  content: { desc: "示例标题", create_timestamp: null, created_at: null },
  media: { type: "video", video_url: "https://v3-web.douyinvod.com/video.mp4", cover_url: null, image_url_list: [] },
  music: { title: null, author: null, cover_url: null, play_url: null },
  download: { video_proxy_url: null, download_url: null, filename: null },
  compat: {
    aweme_id: "1",
    comment_count: 1,
    digg_count: 2,
    share_count: 3,
    collect_count: 4,
    nickname: "作者",
    signature: null,
    desc: "示例标题",
    create_time: null,
    video_url: "https://v3-web.douyinvod.com/video.mp4",
    cover_url: null,
    music_title: null,
    music_author: null,
    type: "video",
    image_url_list: [],
  },
};

describe("Xiaomi MiMo speech recognition", () => {
  it("creates a valid mono PCM WAV fixture", () => {
    const wav = createSilentWav(0.25, 16_000);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    expect(wav.byteLength).toBe(8_044);
  });

  it("sends MiMo-V2.5-ASR input_audio and parses the transcript", async () => {
    let requestUrl = "";
    let requestBody: any;
    let authorization = "";
    let apiKeyHeader = "";
    const fetcher: FetchLike = async (input, init) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body));
      const headers = new Headers(init?.headers);
      authorization = headers.get("authorization") ?? "";
      apiKeyHeader = headers.get("api-key") ?? "";
      return new Response(
        JSON.stringify({
          model: "mimo-v2.5-asr",
          choices: [{ message: { content: "这是从视频音轨识别出的真实口播。" } }],
          usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20, seconds: 6, prompt_tokens_details: { audio_tokens: 10 } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await callMimoAsr({
      settings: SETTINGS,
      apiKey: "sk-asr-test",
      audio: createSilentWav(),
      mimeType: "audio/wav",
      format: "wav",
      fetcher,
    });

    expect(requestUrl).toBe("https://api.xiaomimimo.com/v1/chat/completions");
    expect(authorization).toBe("Bearer sk-asr-test");
    expect(apiKeyHeader).toBe("sk-asr-test");
    expect(requestBody).toMatchObject({ model: "mimo-v2.5-asr", asr_options: { language: "zh" }, stream: false });
    expect(requestBody.messages[0].content[0].type).toBe("input_audio");
    expect(requestBody.messages[0].content[0].input_audio.data).toMatch(/^data:audio\/wav;base64,/);
    expect(result.transcript).toBe("这是从视频音轨识别出的真实口播。");
    expect(result.duration_seconds).toBe(6);
    expect(result.usage.audio_tokens).toBe(10);
  });

  it("feeds a recognized transcript into Xiaomi copy rewriting", async () => {
    const store = createMemoryCreatorStore();
    await store.saveLlmSettings({
      base_url: SETTINGS.base_url,
      model: SETTINGS.model ?? undefined,
      enabled: true,
      api_key: "sk-copy-test",
    });
    let sourceTranscript = "";
    const fetcher: FetchLike = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      sourceTranscript = body.messages[0].content;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: "新标题", transcript: "真实原文", rewritten_script: "改写结果", description: "简介", tags: ["标签"] }) } }] }),
        { status: 200 },
      );
    };

    const result = await generateAiCopy({ parsed: PARSED, sourceTranscript: "这是识别得到的口播原文", prompt: "改得更自然", store, fetcher });

    expect(sourceTranscript).toContain("这是识别得到的口播原文");
    expect(result.provider).toBe("xiaomi");
    expect(result.rewritten_script).toBe("改写结果");
  });
});
