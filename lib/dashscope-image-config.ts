// 百炼 DashScope 文生图（通义万相 / qwen-image）协议常量与工具函数。
// 与 OpenAI 兼容分支的本质区别：百炼是**异步任务式**——先提交任务拿 task_id，
// 再轮询任务状态，成功后才拿到图片 URL；它没有同步的 /images/generations 返回图。

/** 默认地域端点（北京）。新加坡地域请把 baseUrl 填 https://dashscope-intl.aliyuncs.com */
export const DASHSCOPE_DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com";

export const DASHSCOPE_SUBMIT_PATH = "/api/v1/services/aigc/text2image/image-synthesis";
export const DASHSCOPE_TASK_PATH = "/api/v1/tasks";

export const DASHSCOPE_DEFAULT_MODEL = "wanx2.1-t2i-turbo";
export const DASHSCOPE_DEFAULT_SIZE = "1024*1024";

/** 常用模型。官方型号迭代较快，以百炼控制台为准，此处仅作下拉提示。 */
export const DASHSCOPE_COMMON_MODELS = [
    "wanx2.1-t2i-turbo",
    "wanx2.1-t2i-plus",
    "wanx2.0-t2i-turbo",
    "wanx-v1",
    "qwen-image",
];

/** 常用尺寸。注意百炼用星号分隔，不是 x。 */
export const DASHSCOPE_SIZE_OPTIONS = [
    { value: "1024*1024", label: "1024×1024 正方形" },
    { value: "1280*720", label: "1280×720 横向" },
    { value: "720*1280", label: "720×1280 竖向" },
    { value: "1024*768", label: "1024×768 横向" },
    { value: "768*1024", label: "768×1024 竖向" },
];

/**
 * 把 OpenAI 风格的 "1024x1536" / "1024×1536" / "1024*1536"
 * 统一转成百炼要求的 "1024*1536"。无法识别时返回 undefined（不下发 size，
 * 让服务端用模型默认分辨率，避免因非法尺寸整单失败）。
 */
export function toDashScopeSize(size?: string): string | undefined {
    const raw = size?.trim();
    if (!raw || raw === "auto") return undefined;
    const match = /^(\d{2,5})\s*[x×*]\s*(\d{2,5})$/.exec(raw);
    if (!match) return undefined;
    return `${match[1]}*${match[2]}`;
}

/**
 * 容错清洗用户粘贴的 Base URL：容忍结尾斜杠、以及误贴的完整接口路径
 * （例如把 .../api/v1/services/aigc/text2image/image-synthesis 整条贴进来）。
 */
export function normalizeDashScopeBaseUrl(baseUrl?: string): string {
    const raw = baseUrl?.trim();
    if (!raw) return DASHSCOPE_DEFAULT_BASE_URL;
    const stripped = raw.replace(/\/+$/, "").replace(/\/api\/v1(\/.*)?$/i, "");
    return /^https?:\/\//i.test(stripped) ? stripped : DASHSCOPE_DEFAULT_BASE_URL;
}
