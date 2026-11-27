import { getCharacterWorldGroup } from "./character-world-storage";
import { listFavoriteItems, type FavoriteItem } from "./favorites-storage";
import { getChatImageFromIndexedDB } from "./chat-asset-storage";
import { loadMediaBlob } from "./media-cache-storage";
import { assertReverseScope, resolveReversePermissions } from "./reverse-phone-storage";
import type { ReverseScope } from "./reverse-phone-types";

export async function reverseAllowedFavorites(characterId: string, scope: ReverseScope): Promise<FavoriteItem[]> {
  assertReverseScope(scope);
  const p = resolveReversePermissions(characterId, scope);
  if (p.modes.favorites !== "open") return [];
  const targets = new Set(p.chat.targets ?? getCharacterWorldGroup(characterId)?.memberIds ?? [characterId]);
  return (await listFavoriteItems()).filter(item => (item.chatAccountId || null) === scope.chatAccountId
    && (item.userIdentityId || null) === scope.identityId
    && item.participantIds.length > 0 && item.participantIds.every(id => targets.has(id)));
}

export async function favoriteImageDataUrl(ref: string): Promise<string | undefined> {
  if (/^data:image\//i.test(ref)) return ref;
  let blob: Blob | undefined;
  if (ref.startsWith("media-store://")) blob = (await loadMediaBlob(ref))?.blob;
  else if (!/^(?:https?:|blob:|\/)/i.test(ref)) return await getChatImageFromIndexedDB(ref.replace(/^(?:theme-asset|asset):\/\//, "")) ?? undefined;
  else {
    const response = await fetch(ref, { credentials: "omit", signal: AbortSignal.timeout(8000) });
    if (!response.ok) return;
    blob = await response.blob();
  }
  if (!blob?.type.startsWith("image/")) return;
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob!);
  });
}

/** Read only glyphs inside the current viewport, excluding collapsed entries and off-screen text. */
export function reverseFavoriteVisibleText(root: HTMLElement): string {
  const bounds = root.getBoundingClientRect();
  const scroll = root.querySelector<HTMLElement>("[data-rp-favorites-scroll]");
  const clip = scroll?.getBoundingClientRect() ?? bounds;
  const visibleRoot = root.querySelector<HTMLElement>(".rp-favorite-full") ?? root;
  const walker = document.createTreeWalker(visibleRoot, NodeFilter.SHOW_TEXT);
  const output: string[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || parent.closest("[hidden], [aria-hidden=true], select, option, script, style")) continue;
    const style = window.getComputedStyle?.(parent);
    if (style?.visibility === "hidden" || style?.display === "none") continue;
    const text = node.textContent ?? "";
    const range = document.createRange();
    let line = "";
    for (let i = 0; i < Math.min(text.length, 4000); i++) {
      range.setStart(node, i); range.setEnd(node, i + 1);
      const rect = range.getBoundingClientRect();
      const area = scroll?.contains(parent) ? clip : bounds;
      if (rect.width && rect.height && rect.top >= area.top && rect.bottom <= area.bottom && rect.left >= area.left && rect.right <= area.right) line += text[i];
    }
    range.detach(); if (line.trim()) output.push(line.trim());
    if (output.join("\n").length >= 6000) break;
  }
  return output.join("\n").slice(0, 6000);
}

/** Capture the actual rendered phone page. No screenshot is persisted in media storage. */
export async function captureReverseFavorites(root: HTMLElement, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  await Promise.all([...root.querySelectorAll("img")].map(image => image.decode?.().catch(()=>{})));
  signal.throwIfAborted();
  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(root, { backgroundColor: "#fff", scale: Math.min(1.5, 1200 / Math.max(root.clientWidth, root.clientHeight)),
    width: root.clientWidth, height: root.clientHeight, logging: false, useCORS: true, allowTaint: false });
  try { signal.throwIfAborted(); return canvas.toDataURL("image/jpeg", .82); }
  finally { canvas.width = 0; canvas.height = 0; }
}
