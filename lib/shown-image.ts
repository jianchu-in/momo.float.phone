import { loadMediaBlob, storeMediaBlob } from "./media-cache-storage";
import { fileToUserAvatarDataUrl } from "./user-avatar-image";

export const SHOWN_IMAGE_CONTEXT = "用户在当前场景当面把这张图给在场角色看。结合用户同一句话和图中可见细节作出自然反应，例如看发型、穿搭、手作或饭菜。把它理解为现场互动，不描写收到线上消息。看不清的细节可以询问，勿凭空断定。";

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
