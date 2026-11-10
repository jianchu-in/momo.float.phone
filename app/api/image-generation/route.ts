import { NextRequest, NextResponse } from "next/server";
import { ProxyAgent, type Dispatcher } from "undici";
import JSZip from "jszip";
import {
  DASHSCOPE_DEFAULT_MODEL,
  DASHSCOPE_SUBMIT_PATH,
  DASHSCOPE_TASK_PATH,
  normalizeDashScopeBaseUrl,
  toDashScopeSize,
} from "@/lib/dashscope-image-config";
import {
  NOVELAI_DEFAULT_MODEL,
  getNovelAiResolution,
  isNovelAiNoiseSchedule,
  isNovelAiResolution,
  isNovelAiSampler,
  isValidNovelAiModel,
  normalizeNovelAiNoiseSchedule,
  normalizeNovelAiSampler,
  normalizeNovelAiScale,
  normalizeNovelAiSteps,
} from "@/lib/novelai-image-config";

export const maxDuration = 120;

type ImageGenerationRequest = {
  provider?: "openai" | "novelai" | "dashscope";
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  prompt?: string;
  size?: string;
  quality?: string;
  referenceImageDataUrl?: string;
  // NovelAI 专属参数
  negativePrompt?: string;
  steps?: number;
  scale?: number;
  sampler?: string;
  noiseSchedule?: string;
  qualityToggle?: boolean;
  smea?: boolean;
  smeaDyn?: boolean;
  // 百炼 DashScope 专属参数
  negativePrompt?: string;
  promptExtend?: boolean;
  watermark?: boolean;
};

type ExtractedImage =
  | { kind: "b64"; b64: string; mimeType?: string; revisedPrompt?: string }
  | { kind: "url"; url: string; revisedPrompt?: string };

function getProxyDispatcher(): Dispatcher | undefined {
  const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY
    || process.env.http_proxy || process.env.HTTP_PROXY;
  return proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/images\/(?:generations|edits)$/i, "")
    .replace(/\/images$/i, "");
}

function buildImageUrl(baseUrl: string, mode: "generations" | "edits"): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (/\/images\/(?:generations|edits)$/i.test(trimmed)) {
    return trimmed.replace(/\/images\/(?:generations|edits)$/i, `/images/${mode}`);
  }
  if (/\/images$/i.test(trimmed)) return `${trimmed}/${mode}`;
  return `${normalizeBaseUrl(trimmed)}/images/${mode}`;
}

function dataUrlToBlob(dataUrl: string): { blob: Blob; mimeType: string } | null {
  const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!match) return null;
  const mimeType = match[1] || "image/png";
  const buffer = Buffer.from(match[2], "base64");
  return { blob: new Blob([buffer], { type: mimeType }), mimeType };
}

function cleanBase64(value: string): { b64: string; mimeType?: string } {
  const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(value.trim());
  if (match) return { mimeType: match[1], b64: match[2] };
  return { b64: value.trim() };
}

function extractFromObject(data: unknown): ExtractedImage | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const revisedPrompt = typeof record.revised_prompt === "string" ? record.revised_prompt : undefined;

  for (const key of ["b64_json", "base64", "b64", "image", "result"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      if (/^https?:\/\//i.test(value.trim())) return { kind: "url", url: value.trim(), revisedPrompt };
      const cleaned = cleanBase64(value);
      return { kind: "b64", ...cleaned, revisedPrompt };
    }
  }

  for (const key of ["url", "image_url"]) {
    const value = record[key];
    if (typeof value === "string" && /^https?:\/\//i.test(value.trim())) {
      return { kind: "url", url: value.trim(), revisedPrompt };
    }
    if (value && typeof value === "object") {
      const nested = (value as Record<string, unknown>).url;
      if (typeof nested === "string" && /^https?:\/\//i.test(nested.trim())) {
        return { kind: "url", url: nested.trim(), revisedPrompt };
      }
    }
  }

  for (const key of ["data", "images", "output", "content"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) {
          if (/^https?:\/\//i.test(item.trim())) return { kind: "url", url: item.trim(), revisedPrompt };
          const cleaned = cleanBase64(item);
          return { kind: "b64", ...cleaned, revisedPrompt };
        }
        const nested = extractFromObject(item);
        if (nested) return { ...nested, revisedPrompt: nested.revisedPrompt || revisedPrompt };
      }
    }
  }

  return null;
}

async function externalFetch(url: string, init: RequestInit): Promise<Response> {
  const dispatcher = getProxyDispatcher();
  return dispatcher
    ? fetch(url, { ...init, dispatcher } as RequestInit & { dispatcher: Dispatcher })
    : fetch(url, init);
}

async function fetchImageUrl(url: string): Promise<{ b64: string; mimeType: string }> {
  const res = await externalFetch(url, { method: "GET", signal: AbortSignal.timeout(45_000) });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`图片 URL 下载失败 ${res.status}: ${err.slice(0, 160)}`);
  }
  const mimeType = res.headers.get("content-type") || "image/png";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { b64: buffer.toString("base64"), mimeType };
}

async function runNovelAiGeneration(input: ImageGenerationRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    if (input.apiKey !== undefined && typeof input.apiKey !== "string") {
      return { status: 400, body: { error: "NovelAI API Token 格式无效" } };
    }
    if (input.model !== undefined && typeof input.model !== "string") {
      return { status: 400, body: { error: "NovelAI 模型名格式无效" } };
    }
    if (input.prompt !== undefined && typeof input.prompt !== "string") {
      return { status: 400, body: { error: "NovelAI 提示词格式无效" } };
    }
    if (input.size !== undefined && typeof input.size !== "string") {
      return { status: 400, body: { error: "NovelAI 分辨率格式无效" } };
    }
    if (input.negativePrompt !== undefined && typeof input.negativePrompt !== "string") {
      return { status: 400, body: { error: "NovelAI 负面提示词格式无效" } };
    }
    if (input.steps !== undefined && typeof input.steps !== "number") {
      return { status: 400, body: { error: "NovelAI Steps 格式无效" } };
    }
    if (input.scale !== undefined && typeof input.scale !== "number") {
      return { status: 400, body: { error: "NovelAI CFG Scale 格式无效" } };
    }
    if (input.sampler !== undefined && typeof input.sampler !== "string") {
      return { status: 400, body: { error: "NovelAI 采样器格式无效" } };
    }
    if (input.noiseSchedule !== undefined && typeof input.noiseSchedule !== "string") {
      return { status: 400, body: { error: "NovelAI 调度器格式无效" } };
    }
    for (const [label, value] of [
      ["Quality Toggle", input.qualityToggle],
      ["SMEA", input.smea],
      ["SMEA DYN", input.smeaDyn],
    ] as const) {
      if (value !== undefined && typeof value !== "boolean") {
        return { status: 400, body: { error: `NovelAI ${label} 格式无效` } };
      }
    }

    const apiKey = input.apiKey?.trim();
    const model = input.model?.trim() || NOVELAI_DEFAULT_MODEL;
    const prompt = input.prompt?.trim();

    if (!apiKey) return { status: 400, body: { error: "缺少 NovelAI API Token" } };
    if (!prompt) return { status: 400, body: { error: "缺少提示词" } };
    if (prompt.length > 60_000) return { status: 400, body: { error: "NovelAI 提示词过长" } };
    if (!isValidNovelAiModel(model)) return { status: 400, body: { error: "NovelAI 模型名格式无效" } };
    if (input.negativePrompt && input.negativePrompt.length > 60_000) {
      return { status: 400, body: { error: "NovelAI 负面提示词过长" } };
    }
    if (input.size && !isNovelAiResolution(input.size)) {
      return { status: 400, body: { error: "不支持的 NovelAI 分辨率" } };
    }
    if (input.steps !== undefined && (!Number.isFinite(input.steps) || input.steps < 1 || input.steps > 50)) {
      return { status: 400, body: { error: "NovelAI Steps 必须在 1 到 50 之间" } };
    }
    if (input.scale !== undefined && (!Number.isFinite(input.scale) || input.scale < 1 || input.scale > 30)) {
      return { status: 400, body: { error: "NovelAI CFG Scale 必须在 1 到 30 之间" } };
    }
    if (input.sampler && !isNovelAiSampler(input.sampler)) {
      return { status: 400, body: { error: "不支持的 NovelAI 采样器" } };
    }
    if (input.noiseSchedule && !isNovelAiNoiseSchedule(input.noiseSchedule)) {
      return { status: 400, body: { error: "不支持的 NovelAI 调度器" } };
    }

    const { width, height } = getNovelAiResolution(input.size);

    const customUrl = input.baseUrl?.trim();
    if (customUrl && !/^https?:\/\//i.test(customUrl)) {
      return { status: 400, body: { error: "NovelAI 自定义 URL 必须以 http:// 或 https:// 开头" } };
    }
    const url = customUrl || "https://image.novelai.net/ai/generate-image";
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    if (!customUrl) {
      headers.Origin = "https://novelai.net";
      headers.Referer = "https://novelai.net/";
    }

    const parameters: Record<string, unknown> = {
      width,
      height,
      scale: normalizeNovelAiScale(input.scale),
      sampler: normalizeNovelAiSampler(input.sampler),
      steps: normalizeNovelAiSteps(input.steps),
      n_samples: 1,
      ucPreset: 0,
      qualityToggle: input.qualityToggle !== false,
      sm: input.smea === true,
      sm_dyn: input.smeaDyn === true,
      dynamic_thresholding: false,
      controlnet_strength: 1,
      legacy: false,
      add_original_image: false,
      uncond_scale: 1,
      cfg_rescale: 0,
      noise_schedule: normalizeNovelAiNoiseSchedule(input.noiseSchedule),
      negative_prompt: input.negativePrompt || "",
    };

    const body = JSON.stringify({
      input: prompt,
      model,
      action: "generate",
      parameters,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    let res: Response;
    try {
      res = await externalFetch(url, { method: "POST", headers, body, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { status: 502, body: { error: `NovelAI 生图失败 ${res.status}: ${errText.slice(0, 600)}` } };
    }

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    const buffer = Buffer.from(await res.arrayBuffer());

    // NovelAI 原生返回的是 zip 压缩包（内含 png）
    if (contentType.includes("zip") || buffer.slice(0, 4).toString("hex") === "504b0304") {
      const zip = await JSZip.loadAsync(buffer);
      const files = Object.keys(zip.files);
      const pngFilename = files.find(f => f.endsWith(".png")) || files[0];
      if (!pngFilename) {
        return { status: 502, body: { error: "NovelAI 返回的 ZIP 压缩包内未找到图片文件" } };
      }
      const imageBuffer = await zip.files[pngFilename].async("nodebuffer");
      return {
        status: 200,
        body: {
          b64: imageBuffer.toString("base64"),
          mimeType: "image/png",
        },
      };
    }

    if (contentType.startsWith("image/")) {
      return { status: 200, body: { b64: buffer.toString("base64"), mimeType: contentType } };
    }

    return { status: 502, body: { error: `NovelAI 返回了未知格式的响应 (${contentType || "unknown"})` } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.toLowerCase().includes("abort") ? 504 : 502;
    return { status, body: { error: message } };
  }
}

// 百炼 DashScope 文生图：异步任务协议。
// 提交任务（必须带 X-DashScope-Async: enable）→ 轮询 /api/v1/tasks/{id} → 取 results[].url。
// 整体受 110s 超时约束，低于本路由 maxDuration = 120；Netlify 侧由心跳流式机制保活。
async function runDashScopeGeneration(input: ImageGenerationRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  const apiKey = input.apiKey?.trim();
  const model = input.model?.trim() || DASHSCOPE_DEFAULT_MODEL;
  const prompt = input.prompt?.trim();
  if (!apiKey) return { status: 400, body: { error: "缺少 DashScope API Key" } };
  if (!prompt) return { status: 400, body: { error: "缺少提示词" } };

  const base = normalizeDashScopeBaseUrl(input.baseUrl);
  const size = toDashScopeSize(input.size);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 110_000);

  try {
    const submitRes = await externalFetch(`${base}${DASHSCOPE_SUBMIT_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify({
        model,
        input: {
          prompt,
          ...(input.negativePrompt?.trim() ? { negative_prompt: input.negativePrompt.trim() } : {}),
        },
        parameters: {
          n: 1,
          ...(size ? { size } : {}),
          prompt_extend: input.promptExtend === true,
          watermark: input.watermark === true,
        },
      }),
      signal: controller.signal,
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text().catch(() => "");
      return { status: 502, body: { error: `百炼任务提交失败 ${submitRes.status}: ${errText.slice(0, 600)}` } };
    }

    const submitJson = await submitRes.json() as { output?: { task_id?: string } };
    const taskId = submitJson.output?.task_id;
    if (!taskId) {
      return { status: 502, body: { error: `百炼未返回 task_id：${JSON.stringify(submitJson).slice(0, 400)}` } };
    }

    // 轮询间隔固定 2s。PENDING / RUNNING 继续等，其余终态立即返回。
    for (;;) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (controller.signal.aborted) {
        return { status: 504, body: { error: "百炼生图超时（110 秒未完成）" } };
      }

      const taskRes = await externalFetch(`${base}${DASHSCOPE_TASK_PATH}/${taskId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      const taskJson = await taskRes.json().catch(() => ({})) as {
        output?: { task_status?: string; results?: Array<{ url?: string }>; code?: string; message?: string };
        code?: string;
        message?: string;
      };
      if (!taskRes.ok) {
        return { status: 502, body: { error: `百炼任务查询失败 ${taskRes.status}: ${JSON.stringify(taskJson).slice(0, 400)}` } };
      }

      const taskStatus = taskJson.output?.task_status;
      if (taskStatus === "SUCCEEDED") {
        const url = taskJson.output?.results?.find(item => item.url)?.url;
        if (!url) return { status: 502, body: { error: "百炼任务成功但没有返回图片地址" } };
        try {
          const downloaded = await fetchImageUrl(url);
          return { status: 200, body: downloaded };
        } catch {
          // 与 OpenAI 分支保持一致的降级语义：图已生成，允许前端只补下载，避免重复计费。
          return { status: 502, body: { error: "图片已生成，但服务端下载失败", generationCompleted: true, imageUrl: url } };
        }
      }
      if (taskStatus === "FAILED" || taskStatus === "CANCELED" || taskStatus === "UNKNOWN") {
        const detail = taskJson.output?.message || taskJson.message || taskStatus || "未知错误";
        const code = taskJson.output?.code || taskJson.code;
        return { status: 502, body: { error: `百炼生图失败${code ? ` (${code})` : ""}: ${detail}` } };
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.toLowerCase().includes("abort") ? 504 : 502;
    return { status, body: { error: message } };
  } finally {
    clearTimeout(timeout);
  }
}

async function runImageGeneration(input: ImageGenerationRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  if (input.provider === "dashscope") {
    return runDashScopeGeneration(input);
  }
  if (input.provider === "novelai") {
    return runNovelAiGeneration(input);
  }

  try {
    const apiKey = input.apiKey?.trim();
    const baseUrl = input.baseUrl?.trim();
    const model = input.model?.trim();
    const prompt = input.prompt?.trim();
    const hasReference = Boolean(input.referenceImageDataUrl?.trim());

    if (!apiKey) return { status: 400, body: { error: "缺少 API Key" } };
    if (!baseUrl) return { status: 400, body: { error: "缺少 Base URL" } };
    if (!model) return { status: 400, body: { error: "缺少模型名" } };
    if (!prompt) return { status: 400, body: { error: "缺少提示词" } };

    const url = buildImageUrl(baseUrl, hasReference ? "edits" : "generations");
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
    let body: BodyInit;

    if (hasReference) {
      const converted = dataUrlToBlob(input.referenceImageDataUrl || "");
      if (!converted) return { status: 400, body: { error: "参考图格式无效" } };
      const form = new FormData();
      form.set("model", model);
      form.set("prompt", prompt);
      if (input.size && input.size !== "auto") form.set("size", input.size);
      if (input.quality && input.quality !== "auto") form.set("quality", input.quality);
      form.append("image", converted.blob, `reference.${converted.mimeType.split("/")[1] || "png"}`);
      body = form;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify({
        model,
        prompt,
        ...(input.size && input.size !== "auto" ? { size: input.size } : {}),
        ...(input.quality && input.quality !== "auto" ? { quality: input.quality } : {}),
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    let res: Response;
    try {
      res = await externalFetch(url, { method: "POST", headers, body, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { status: 502, body: { error: `生图 API 错误 ${res.status}: ${errText.slice(0, 600)}` } };
    }

    if (contentType.startsWith("image/")) {
      const buffer = Buffer.from(await res.arrayBuffer());
      return { status: 200, body: { b64: buffer.toString("base64"), mimeType: contentType } };
    }

    const json = await res.json();
    const extracted = extractFromObject(json);
    if (!extracted) {
      return { status: 502, body: { error: `生图 API 返回中没有找到图片字段：${JSON.stringify(Object.keys(json || {})).slice(0, 200)}` } };
    }

    if (extracted.kind === "url") {
      // Preserve a completed generation even when downloading the CDN result fails.
      try {
        const downloaded = await fetchImageUrl(extracted.url);
        return { status: 200, body: { ...downloaded, revisedPrompt: extracted.revisedPrompt } };
      } catch {
        return { status: 502, body: {
          error: "图片已生成，但服务端下载失败", generationCompleted: true,
          imageUrl: extracted.url, revisedPrompt: extracted.revisedPrompt,
        } };
      }
    }

    return {
      status: 200,
      body: {
        b64: extracted.b64,
        mimeType: extracted.mimeType || "image/png",
        revisedPrompt: extracted.revisedPrompt,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.toLowerCase().includes("abort") ? 504 : 502;
    return { status, body: { error: message } };
  }
}

const IMAGE_STREAM_RESULT_MARKER = "@@RESULT@@";

export async function POST(req: NextRequest) {
  let input: ImageGenerationRequest;
  try {
    input = await req.json() as ImageGenerationRequest;
  } catch {
    return NextResponse.json({ error: "请求体不是有效 JSON" }, { status: 400 });
  }

  // 心跳流式模式:立刻开始返回响应并周期性发送心跳字节,把真正的结果附在流末尾。
  // 这样托管平台(Netlify 等)按"流式响应"计时,不会因为上游生图慢(30~120s)
  // 而在缓冲模式的 10~26s 上限处直接 504。旧客户端不带该头时行为不变。
  if (req.headers.get("x-stream-heartbeat") === "1") {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let finished = false;
        const heartbeat = setInterval(() => {
          if (!finished) {
            try { controller.enqueue(encoder.encode(" ")); } catch { /* 流已关闭 */ }
          }
        }, 3000);
        runImageGeneration(input)
          .then(({ status, body }) => {
            controller.enqueue(encoder.encode("\n" + IMAGE_STREAM_RESULT_MARKER + JSON.stringify({ httpStatus: status, ...body })));
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            try {
              controller.enqueue(encoder.encode("\n" + IMAGE_STREAM_RESULT_MARKER + JSON.stringify({ httpStatus: 502, error: message })));
            } catch { /* 流已关闭 */ }
          })
          .finally(() => {
            finished = true;
            clearInterval(heartbeat);
            try { controller.close(); } catch { /* 已关闭 */ }
          });
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  }

  const { status, body } = await runImageGeneration(input);
  return NextResponse.json(body, { status });
}
