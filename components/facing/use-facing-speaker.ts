import { useEffect, useState } from "react";
import { getChatImageFromIndexedDB } from "@/lib/chat-asset-storage";
import type { Character } from "@/lib/character-types";
import { groupFacingScenes, loadFacingAssets, loadFacingSettings, type FacingAsset } from "@/lib/facing-storage";
import { resolveConfiguredImageGenerationSettings } from "@/lib/image-generation-service";
import { loadShownImageDataUrl } from "@/lib/shown-image";

/** Selecting a speaker uses local media and never starts image generation. */
export function useFacingSpeaker(character: Character, location: string, multi: boolean, reactionId?: string) {
  const settings = loadFacingSettings().characters[character.id] ?? {};
  const assets = loadFacingAssets(character.id);
  const groups = groupFacingScenes(assets, settings.portraitId);
  const group = groups.find(item => item.name === location) ?? groups.find(item => item.name === location.split(" · ").at(-1));
  const portrait = group?.portrait;
  const config = resolveConfiguredImageGenerationSettings(character.id, "facing");
  const reference = config.characterReferences?.[character.id];
  const upload = settings.autoVisual?.referenceMediaRef;
  const refId = reference?.enabled !== false ? reference?.assetId : undefined;
  const key = `${character.id}:${refId ?? ""}:${upload ?? ""}`;
  const [referenceImage, setReferenceImage] = useState<{ key: string; url?: string }>();
  useEffect(() => {
    if (!multi || portrait) return;
    let active = true;
    void (async () => {
      let url: string | undefined;
      if (refId) url = await getChatImageFromIndexedDB(refId).catch(() => undefined) ?? undefined;
      if (!url && upload) url = await loadShownImageDataUrl(upload).catch(() => undefined);
      if (active) setReferenceImage({ key, url });
    })();
    return () => { active = false; };
  }, [multi, portrait?.id, key, refId, upload]);
  return { portrait, backdrop: group?.backdrop,
    reaction: assets.find((item: FacingAsset) => item.id === reactionId && (item.generated || group?.reactions.some(allowed => allowed.id === item.id))),
    reference: referenceImage?.key === key ? referenceImage.url : undefined };
}
