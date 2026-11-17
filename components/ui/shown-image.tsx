"use client";

import { useEffect, useState } from "react";
import { loadMediaObjectUrl } from "@/lib/media-cache-storage";

export function ShownImage({ mediaRef, file, className }: { mediaRef?: string; file?: File; className?: string }) {
  const [image, setImage] = useState<{ source: string | File; url: string }>();
  const source = file ?? mediaRef;
  useEffect(() => {
    let current = true;
    let objectUrl: string | null = null;
    if (source) void (typeof source === "string" ? loadMediaObjectUrl(source) : Promise.resolve(URL.createObjectURL(source)))
      .then(url => {
        if (!url) return;
        if (!current) { URL.revokeObjectURL(url); return; }
        objectUrl = url;
        setImage({ source, url });
      }).catch(() => {});
    return () => { current = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [source]);
  if (!source) return null;
  return image?.source === source ? <img className={className} src={image.url} alt="当面展示的图片" draggable={false} /> : null;
}
