"use client";

import { useEffect, useRef, useState } from "react";
import { generateCharacterMomentCover, generateCharacterMomentText, loadMomentCoverReferences } from "@/lib/character-moments-generation";
import type { UserIdentity } from "@/components/settings/user-identity";
import { saveCharacterMomentsSignature } from "@/lib/character-moments-profile";

export function CharacterMomentsActions({ characterId, characterName, identity, coverOpen, uploadingCover, onCoverClose, onUpload, onSaveCover }: {
  characterId: string; characterName: string; coverOpen: boolean; uploadingCover: boolean; onCoverClose: () => void;
  identity: UserIdentity | null;
  onUpload: () => void; onSaveCover: (blob: Blob) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [savingCover, setSavingCover] = useState(false);
  const coverBusy = savingCover || uploadingCover;
  const [description, setDescription] = useState(""), [signature, setSignature] = useState<string | null>(null);
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  const [references, setReferences] = useState<Awaited<ReturnType<typeof loadMomentCoverReferences>> | null>(null);
  const [useCharacter, setUseCharacter] = useState(false);
  const [useUser, setUseUser] = useState(false);
  const identityId = identity?.id;
  const run = useRef<AbortController | null>(null);
  useEffect(() => () => run.current?.abort(), []);
  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url); }, [image]);
  useEffect(() => {
    setReferences(null);
    setUseCharacter(false);
    setUseUser(false);
    setImage(null);
    if (!coverOpen) return;
    let active = true;
    void loadMomentCoverReferences(characterId, identityId).then(value => {
      if (active) setReferences(value);
    }).catch(() => { if (active) setError("无法读取生图参考图设置"); });
    return () => { active = false; };
  }, [characterId, identityId, coverOpen]);
  const generate = async (kind: "signature" | "description" | "image") => {
    if (busy) return;
    run.current?.abort(); const controller = new AbortController(); run.current = controller;
    setBusy(true); setError("");
    try {
      if (kind === "image") {
        const result = await generateCharacterMomentCover(characterId, description, controller.signal, { character: useCharacter, user: useUser, identity });
        if (!controller.signal.aborted) setImage({ blob: result.blob, url: URL.createObjectURL(result.blob) });
      } else {
        const content = await generateCharacterMomentText(characterId, kind === "signature" ? "signature" : "cover", controller.signal);
        if (!controller.signal.aborted) { if (kind === "signature") setSignature(content); else { setDescription(content); setImage(null); } }
      }
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "生成失败，原设置保留"); }
    finally { if (run.current === controller) setBusy(false); }
  };
  const closeCover = () => { run.current?.abort(); setBusy(false); onCoverClose(); setImage(null); };
  return <div className="character-moments-actions">
    <button type="button" disabled={busy || coverBusy} onClick={() => void generate("signature")}>刷新签名</button>
    {busy && <span role="status">正在生成… <button type="button" onClick={() => { run.current?.abort(); setBusy(false); }}>停止</button></span>}
    {error && <p role="status">{error}</p>}
    {signature !== null && <section><label>签名预览<input aria-label="生成的角色签名" value={signature} onChange={event => setSignature(event.target.value)} /></label>
      <button type="button" disabled={!signature.trim() || busy} onClick={() => { saveCharacterMomentsSignature(characterId, characterName, signature); setSignature(null); }}>应用签名</button><button type="button" onClick={() => setSignature(null)}>取消签名</button></section>}
    {coverOpen && <section aria-label="角色朋友圈封面设置"><div><button type="button" disabled={busy || coverBusy} onClick={onUpload}>上传图片</button><button type="button" disabled={busy || coverBusy} onClick={() => void generate("description")}>根据角色设定构思封面</button></div>
      <p>构思使用角色文字 API；生成图片使用角色绑定的生图 API。</p>
      <textarea aria-label="角色封面画面描述" rows={4} value={description} placeholder="生成构思后可修改，也可直接填写画面描述" onChange={event => { setDescription(event.target.value); setImage(null); }} disabled={busy || coverBusy} />
      <div className="moment-cover-references">
        <label><input type="checkbox" checked={useCharacter} disabled={busy || coverBusy || !references?.supported || !references.characterImage} onChange={event => { setUseCharacter(event.target.checked); setImage(null); }} />角色参考图
          {references?.characterImage && <img src={references.characterImage} alt="" />}
        </label>
        <label><input type="checkbox" checked={useUser} disabled={busy || coverBusy || !references?.supported || !references.userImage} onChange={event => { setUseUser(event.target.checked); setImage(null); }} />当前用户参考图
          {references?.userImage && <img src={references.userImage} alt="" />}
        </label>
      </div>
      {references && (!references.supported || !references.characterImage || !references.userImage) && <p>{!references.supported ? "当前生图方式无法使用人像参考图。" : "可在生图设置中上传并启用参考图。"}</p>}
      <button type="button" disabled={busy || coverBusy || !description.trim()} onClick={() => void generate("image")}>生成封面图片</button>
      {image && <><img src={image.url} alt="生成的角色朋友圈封面预览" /><button type="button" disabled={busy || coverBusy} onClick={async () => {
        setSavingCover(true); setError("");
        try { await onSaveCover(image.blob); closeCover(); }
        catch (reason) { setError(reason instanceof Error ? reason.message : "封面保存失败"); }
        finally { setSavingCover(false); }
      }}>{savingCover ? "正在保存封面…" : "应用封面"}</button></>}
      <button type="button" disabled={coverBusy} onClick={closeCover}>关闭封面设置</button>
    </section>}
  </div>;
}
