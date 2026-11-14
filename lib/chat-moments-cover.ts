import { throwIfAborted } from "./abort-utils";
import { getChatImageFromIndexedDB, saveChatImageToIndexedDB } from "./chat-asset-storage";
import { isCoverUserImage, isCoverUserMessage, type CoverAction, type CoverRequest } from "./chat-moments-cover-intent";
import { loadChatMessages, loadChatSessions, updateMessageMediaData, type ChatSession } from "./chat-storage";
import { resolveChatAccountUserIdentity } from "./chat-scope-storage";
import { generateCharacterMomentCover } from "./character-moments-generation";
import { loadCharacterMomentsProfile, saveCharacterMomentsCover } from "./character-moments-profile";
import { isMediaStoreRef, loadMediaBlob } from "./media-cache-storage";

async function readCoverImage(url: string, signal?: AbortSignal): Promise<Blob> {
  let blob: Blob | undefined;
  if (isMediaStoreRef(url)) {
    blob = (await loadMediaBlob(url))?.blob;
  } else {
    const source = url.startsWith("asset://") ? await getChatImageFromIndexedDB(url.slice(8)) : url;
    if (source && /^(?:https?:\/\/|data:image\/)/i.test(source)) {
      const response = await fetch(source, { signal });
      if (response.ok) blob = await response.blob();
    }
  }
  if (!blob?.size || !blob.type.startsWith("image/")) throw new Error("无法读取这张图片，请重新发送。");
  return blob;
}

export async function applyChatMomentsCover(
  session: ChatSession, request: CoverRequest, action: CoverAction, signal?: AbortSignal,
): Promise<boolean> {
  if (session.isGroup || request.kind !== action.kind) return false;
  const canApply = () => loadChatSessions().some(item => item.id === session.id && !item.isGroup && !item.isBlacklisted
    && item.contactId === session.contactId && item.chatAccountId === session.chatAccountId);
  throwIfAborted(signal);
  if (!canApply()) return false;
  const history = loadChatMessages(session.id);
  const source = history.find(item => item.id === request.messageId && isCoverUserMessage(item));
  if (!source || source.mediaData?.momentsCoverAttempted) return false;
  const imageUrl = request.imageId ? history.find(item => item.id === request.imageId && isCoverUserImage(item))?.mediaUrl : undefined;
  const previousCover = loadCharacterMomentsProfile(session.contactId).coverAssetId;
  // Preserve the attempt across reply regeneration, which deletes assistant messages.
  updateMessageMediaData(source.id, { ...source.mediaData, momentsCoverAttempted: true });

  let blob: Blob;
  if (action.kind === "use_image") {
    if (!imageUrl) throw new Error("要使用的图片已找不到，请重新发送。");
    blob = await readCoverImage(imageUrl, signal);
  } else {
    const result = await generateCharacterMomentCover(session.contactId, action.description, signal, {
      character: action.subject === "角色" || action.subject === "合照",
      user: action.subject === "用户" || action.subject === "合照",
      identity: resolveChatAccountUserIdentity(session.chatAccountId, session.contactId, "chat"),
    });
    blob = result.blob;
  }
  throwIfAborted(signal);
  const assetId = await saveChatImageToIndexedDB(blob);
  if (!await getChatImageFromIndexedDB(assetId)) throw new Error("封面保存后无法读取。");
  throwIfAborted(signal);
  if (!canApply()) return false;
  if (!loadChatMessages(session.id).some(item => item.id === source.id && isCoverUserMessage(item))) return false;
  if (loadCharacterMomentsProfile(session.contactId).coverAssetId !== previousCover) throw new Error("封面已在其他页面更新，本次图片未应用。");
  await saveCharacterMomentsCover(session.contactId, assetId);
  return true;
}
