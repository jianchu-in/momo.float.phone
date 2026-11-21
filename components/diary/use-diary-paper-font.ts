import { useEffect, type CSSProperties } from "react";

const FAMILY = "AIPhoneDiaryEntryUserFont";

export function useDiaryPaperFont(dataUrl: string | null, scale: number): CSSProperties {
  useEffect(() => {
    if (!dataUrl) return;
    const node = document.createElement("style");
    node.textContent = `@font-face{font-family:"${FAMILY}";src:url("${dataUrl}");font-display:swap;}`;
    document.head.append(node);
    return () => { node.remove(); };
  }, [dataUrl]);

  return {
    ...(dataUrl ? { "--diary-entry-font-family": `"${FAMILY}", "NoteWall Ximai", var(--app-font-family)` } : {}),
    "--diary-entry-font-scale": String(scale),
  } as CSSProperties;
}
