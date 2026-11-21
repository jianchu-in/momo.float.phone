import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { GeneratedImagePromptDialog } from "@/components/chat/generated-image-prompt-dialog";
import { MediaPreviewOverlay } from "@/components/chat/media-preview-overlay";
import { ShownImage } from "@/components/ui/shown-image";
import { generatedImageFilename } from "@/lib/image-generation-service";
import { loadMediaBlob } from "@/lib/media-cache-storage";
import { resolveStoryIllustrationReferences } from "@/lib/story-illustration";
import type { StoryIllustration, StoryIllustrationDetails } from "@/lib/story-storage";

export function StoryIllustrationView({ leadId, illustration, pending, onRegenerate, selecting, textOnly = false }: {
  textOnly?: boolean;
  leadId: string;
  illustration?: StoryIllustration;
  pending: boolean;
  onRegenerate: (details: StoryIllustrationDetails) => Promise<void>;
  selecting: boolean;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const [preview, setPreview] = useState<{ ref: string; url: string; name: string } | { ref: string; missing: true }>();
  const [draft, setDraft] = useState<StoryIllustrationDetails>();
  const [error, setError] = useState("");
  const mediaRef = illustration?.state === "ready" ? illustration.mediaRef : undefined;
  const previewRef = showPreview ? mediaRef : undefined;

  useEffect(() => {
    if (!previewRef) return;
    let active = true;
    let url: string | undefined;
    void loadMediaBlob(previewRef).then(media => {
      if (!active) return;
      if (!media) { setPreview({ ref: previewRef, missing: true }); return; }
      url = URL.createObjectURL(media.blob);
      setPreview({ ref: previewRef, url, name: generatedImageFilename("剧情插图", media.mimeType) });
    }).catch(() => { if (active) setPreview({ ref: previewRef, missing: true }); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [previewRef]);

  const original = illustration?.details;
  const focusId = original?.characterId ?? leadId;
  const references = draft ? resolveStoryIllustrationReferences(leadId, draft.characterId) : undefined;

  function closePreview() {
    setShowPreview(false);
    setPreview(undefined);
  }

  function openEditor() {
    const { hasCharacterReference, hasUserReference } = resolveStoryIllustrationReferences(leadId, focusId);
    closePreview();
    setError("");
    setDraft({
      characterId: focusId,
      referenceMode: textOnly ? "text" : original?.referenceMode,
      description: original?.description ?? "",
      useCharacterReference: !textOnly && original?.referenceMode !== "text" && hasCharacterReference && (original?.useCharacterReference ?? true),
      useUserReference: !textOnly && original?.referenceMode !== "text" && hasUserReference && (original?.useUserReference ?? false),
    });
  }

  async function regenerate() {
    if (!draft?.description.trim() || pending) return;
    setError("");
    try {
      await onRegenerate({ ...draft, description: draft.description.trim(),
        useCharacterReference: draft.useCharacterReference && references?.hasCharacterReference === true,
        useUserReference: draft.useUserReference && references?.hasUserReference === true,
      });
      setDraft(undefined);
      setShowPreview(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "图片生成失败，请重试。");
    }
  }

  const displayedPreview = preview?.ref === mediaRef ? preview : undefined;
  const loadedPreview = displayedPreview && "url" in displayedPreview ? displayedPreview : undefined;
  return <>
    {mediaRef ? <button className="story-illustration story-illustration-preview" type="button" aria-label="查看剧情图片原图"
      disabled={selecting} onPointerDown={event => event.stopPropagation()} onClick={() => setShowPreview(true)}>
      <ShownImage mediaRef={mediaRef} alt="本轮剧情插图" />
    </button> : pending ? <div className="story-illustration-pending" role="status">画面生成中…</div> : illustration?.state === "failed" ?
      <div className="story-illustration-failure">
        <span>剧情图未生成</span>
        {!selecting && <button type="button" onPointerDown={event => event.stopPropagation()} onClick={openEditor}>重试图片</button>}
      </div> : null}
    {showPreview && <div onPointerDown={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()}>
      <MediaPreviewOverlay imageUrl={loadedPreview?.url}
        description={displayedPreview && "missing" in displayedPreview ? "图片文件无法读取，可以重新生成。" : undefined}
        saveFilename={loadedPreview?.name} onClose={closePreview}
        onRegenerate={openEditor} regenerating={pending} />
    </div>}
    {draft && typeof document !== "undefined" && createPortal(<GeneratedImagePromptDialog
      value={draft.description}
      descriptionLabel="画面描述"
      textOnly={draft.referenceMode === "text"}
      userReferenceLabel="使用用户参考图（用户出镜）"
      onChange={description => setDraft({ ...draft, description })}
      useReferenceImage={draft.useCharacterReference}
      onUseReferenceImageChange={useCharacterReference => setDraft({ ...draft, useCharacterReference })}
      hasReferenceImage={references?.hasCharacterReference === true}
      useUserReferenceImage={draft.useUserReference}
      onUseUserReferenceImageChange={useUserReference => setDraft({ ...draft, useUserReference })}
      hasUserReference={references?.hasUserReference === true}
      busy={pending}
      error={error}
      onConfirm={() => void regenerate()}
      onCancel={() => { if (!pending) setDraft(undefined); }}
    />, document.body)}
  </>;
}
