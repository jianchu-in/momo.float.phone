import { loadMediaBlob, storeMediaBlob } from "./media-cache-storage";
import { fileToUserAvatarDataUrl } from "./user-avatar-image";

export const SHOWN_IMAGE_CONTEXT = "用户在当前场景当面把这张图给在场角色看。结合用户同一句话和图中可见细节作出自然反应，例如看发型、穿搭、手作或饭菜。把它理解为现场互动，不描写收到线上消息。看不清的细节可以询问，勿凭空断定。";

export const STORY_REFERENCE_IMAGE_CONTEXT = "这张上传图片是本轮剧情的视觉参考，不预设它在故事中以什么载体出现。结合用户本轮文字、当前剧情、角色设定与提示词决定它的用途：例如用户说拿出衣服，图中衣服就是现场的衣物；说端来草莓蛋糕或做好的饭菜，图中内容就是对应的实物；也可以参考穿搭、外观或环境。只有用户文字或当前剧情明确是在展示手机照片、相片或屏幕时，才按照片或屏幕内容回应。不要仅因附图就自动补写用户举起手机、打开相册、展示照片或角色收到线上消息，也不要把图中无关人物和背景自动引入现场。文字未交代具体用法时顺着当前剧情理解，不强加展示动作；不确定或看不清的细节可以自然询问，不凭空断定。";

/** Neutral attachment text; also remove the old automatic photo-showing action from prompt history. */
export function formatStoryImageInput(text: string): string {
  const content = text.replace(/^（(?:当面展示了一张图片|剧情参考图)）\s*/, "").trim();
  return ["（剧情参考图）", content].filter(Boolean).join("\n");
}

export async function storeShownImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("请选择图片文件。");
  const preview = await fileToUserAvatarDataUrl(file, 1300);
  const blob = await (await fetch(preview)).blob();
  return storeMediaBlob(blob, blob.type, "image");
}

export async function loadShownImageDataUrl(ref: string): Promise<string | undefined> {
  const media = await loadMediaBlob(ref);
  if (!media?.mimeType.startsWith("image/")) return;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("无法读取这张图片。"));
    reader.readAsDataURL(media.blob);
  });
}
