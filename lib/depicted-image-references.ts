import { getChatImageFromIndexedDB } from "./chat-asset-storage";
import { loadCharacters } from "./character-storage";
import { loadFacingSettings } from "./facing-storage";
import { resolveConfiguredImageGenerationSettings } from "./image-generation-service";
import { loadShownImageDataUrl } from "./shown-image";
import { resolveUserIdentity } from "./settings-storage";

export function validateDepictedCharacters(value: unknown, participants: readonly string[]): string[] {
  if (!Array.isArray(value) || value.some(id => typeof id !== "string" || !participants.includes(id))) {
    throw new Error("出镜角色名单缺失或包含本次对话以外的角色，请调整名单或选择纯文字生图。");
  }
  return [...new Set(value as string[])];
}

async function readableReference(source: string, name: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  try {
    let dataUrl=source;
    if(!source.startsWith("data:image/")) {
      const response=await fetch(source,{signal,credentials:"omit"});
      if(!response.ok)throw new Error("无法读取图片");
      const blob=await response.blob();
      if(!blob.type.startsWith("image/"))throw new Error("图片类型不支持");
      dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(blob);});
    }
    await new Promise<void>((resolve,reject)=>{
      const image=new Image();
      const finish=(error?:unknown)=>{clearTimeout(timer);signal?.removeEventListener("abort",cancel);image.onload=null;image.onerror=null;error?reject(error):resolve();};
      const cancel=()=>finish(new Error("已取消读取参考图"));
      const timer=setTimeout(()=>finish(new Error("图片读取超时")),8000);
      signal?.addEventListener("abort",cancel,{once:true});
      image.onload=()=>finish(image.naturalWidth?undefined:new Error("图片无效"));image.onerror=()=>finish(new Error("图片无法解码"));image.src=dataUrl;
    });
    signal?.throwIfAborted();return dataUrl;
  } catch {
    signal?.throwIfAborted();throw new Error(`“${name}”参考图无法读取，请重新绑定图片或选择纯文字生图。`);
  }
}

/** Resolve every labeled reference from its own character binding, never from speaker order. */
export async function depictedImageReferences(options: {
  appId: "story" | "facing"; leadId: string; participantIds: string[]; depictedCharacterIds: unknown;
  userVisible?: boolean; includeUser?: boolean; source?: "character" | "avatar" | "upload"; signal?: AbortSignal;
}) {
  const ids = validateDepictedCharacters(options.depictedCharacterIds, options.participantIds);
  const characters = loadCharacters();
  const refs: { dataUrl: string; label: string }[] = [];
  for (const id of ids) {
    options.signal?.throwIfAborted();
    const character = characters.find(item => item.id === id);
    if (!character) throw new Error("出镜角色已移除，请调整名单。");
    const config = resolveConfiguredImageGenerationSettings(id, options.appId);
    const bound = config.characterReferences?.[id];
    let dataUrl: string | null | undefined;
    if (options.appId === "facing" && options.source === "avatar") dataUrl = character.avatar;
    else if (options.appId === "facing" && options.source === "upload") {
      const ref = loadFacingSettings().characters[id]?.autoVisual?.referenceMediaRef;
      dataUrl = ref ? await loadShownImageDataUrl(ref) : undefined;
    } else {
      dataUrl = bound?.enabled !== false && bound?.assetId ? await getChatImageFromIndexedDB(bound.assetId) : undefined;
      if (!dataUrl && options.appId === "facing") dataUrl = character.avatar;
    }
    if (!dataUrl) throw new Error(`“${character.name}”缺少人物参考图，请为该角色绑定图片或选择纯文字生图。`);
    refs.push({ dataUrl: await readableReference(dataUrl,character.name,options.signal), label: `角色 ${character.name}（ID: ${id}）外貌参考，仅画面中出现时使用` });
  }
  if (options.includeUser && options.userVisible) {
    const config = resolveConfiguredImageGenerationSettings(options.leadId, options.appId);
    const user = resolveUserIdentity(options.leadId, options.appId);
    const ref = user?.id ? config.userReferences?.[user.id] : undefined;
    const dataUrl = ref?.enabled !== false && ref?.assetId ? await getChatImageFromIndexedDB(ref.assetId) : undefined;
    if (!dataUrl) throw new Error("用户实际出镜，但缺少用户参考图，请绑定图片或取消用户参考。");
    refs.push({ dataUrl: await readableReference(dataUrl,user?.name??"用户",options.signal), label: `用户 ${user?.name ?? "我"} 外貌参考` });
  }
  return refs;
}
