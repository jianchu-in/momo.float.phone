"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FacingAsset } from "@/lib/facing-storage";
import { getThemeAssetDataUrl } from "@/lib/theme-storage";
import { downloadFile } from "@/lib/download-utils";
import { FacingMedia, useFacingMediaUrl } from "./facing-stage";

function Product({ asset, onPreview }: { asset: FacingAsset; onPreview: (opener: HTMLButtonElement) => void }) {
  const url = useFacingMediaUrl(asset);
  return <article className="facing-life-card facing-product-card">
    <button type="button" className="facing-product-preview" aria-label={`查看成品${asset.name}`} onClick={event => onPreview(event.currentTarget)}>
      <div className="facing-product-thumbnail">
        {url ? asset.mediaType.startsWith("video/")
          ? <video src={url} muted playsInline preload="metadata" aria-label={asset.name} />
          : <img src={url} alt={asset.name} loading="lazy" decoding="async" />
          : <span>图片暂未载入</span>}
      </div>
      <h3>{asset.name}</h3>
      {asset.location && <small>{asset.location}</small>}
      {asset.description && <p className="facing-product-description">{asset.description}</p>}
    </button>
  </article>;
}

function ProductPreview({ asset, opener, onClose }: { asset: FacingAsset; opener: HTMLButtonElement; onClose: () => void }) {
  const url = useFacingMediaUrl(asset);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const downloadButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    closeButton.current?.focus({ preventScroll: true });
    return () => { if (opener.isConnected) opener.focus({ preventScroll: true }); };
  }, [opener]);

  async function download() {
    if (downloading) return;
    setDownloading(true);
    setError("");
    try {
      const src = await getThemeAssetDataUrl(asset.mediaId);
      if (!src) throw new Error("原图暂时无法读取，请重试。");
      const response = await fetch(src);
      if (!response.ok) throw new Error("原图暂时无法读取，请重试。");
      const blob = await response.blob();
      const type = blob.type || asset.mediaType;
      const extension = ({ "image/jpeg": "jpg", "image/svg+xml": "svg", "video/quicktime": "mov" } as Record<string, string>)[type]
        ?? type.split("/")[1]?.split(";")[0] ?? "png";
      await downloadFile(blob, `${asset.name}.${extension}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "下载失败，请重试。");
    } finally {
      setDownloading(false);
    }
  }

  return <div className="facing-overlay facing-overlay-center facing-product-overlay" onClick={onClose}>
    <section className="facing-sheet facing-product-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}
      onClick={event => event.stopPropagation()} onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
        if (event.key === "Tab") {
          const last = downloading ? closeButton.current : downloadButton.current;
          if (event.shiftKey && event.target === closeButton.current) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && event.target === last) { event.preventDefault(); closeButton.current?.focus(); }
        }
      }}>
      <header><h2 id={titleId}>{asset.name}</h2><button ref={closeButton} type="button" onClick={onClose}>关闭</button></header>
      {url ? <FacingMedia url={url} mediaType={asset.mediaType} name={asset.name} /> : <p>图片暂未载入，仍可尝试下载原图。</p>}
      {asset.location && <small>{asset.location}</small>}
      {asset.description && <p className="facing-product-full-description">{asset.description}</p>}
      <button ref={downloadButton} type="button" className="facing-primary" disabled={downloading} onClick={() => void download()}>
        {downloading ? "正在下载…" : "下载原图"}
      </button>
      {error && <p className="facing-error" role="alert">{error}</p>}
    </section>
  </div>;
}

export function FacingProducts({ assets, onBack }: { assets: FacingAsset[]; onBack: () => void }) {
  const [preview, setPreview] = useState<{ asset: FacingAsset; opener: HTMLButtonElement }>();
  const products = assets.filter(asset => asset.generated);
  return <section className="facing-life-panel">
    <header className="facing-header"><button type="button" aria-label="返回" onClick={onBack}>‹</button><h1>生图成品</h1></header>
    <main className="facing-scroll" inert={!!preview}>
      <div className="facing-products-grid">{products.map(asset => <Product asset={asset} key={asset.id} onPreview={opener => setPreview({ asset, opener })} />)}</div>
      {!products.length && <p className="facing-empty">已生成的生活画面会保存在这里，点击成品可查看完整描述并下载原图。</p>}
    </main>
    {preview && <ProductPreview key={preview.asset.id} {...preview} onClose={() => setPreview(undefined)} />}
  </section>;
}
