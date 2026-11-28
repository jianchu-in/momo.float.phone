"use client";
import { useState } from "react";
import { addImageFavorite } from "@/lib/favorites-storage";
export function ImageFavoriteButton(props: Parameters<typeof addImageFavorite>[0]) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  return <span className="image-favorite-action" onPointerDown={event=>event.stopPropagation()}><button type="button" disabled={busy} onClick={event=>{
    event.stopPropagation(); setBusy(true);
    void addImageFavorite(props).then(()=>setStatus("已收藏")).catch(()=>setStatus("收藏失败，请重试")).finally(()=>setBusy(false));
  }}>{busy ? "保存中…" : "加入收藏"}</button>{status && <small role="status">{status}</small>}</span>;
}
