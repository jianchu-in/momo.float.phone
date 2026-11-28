"use client";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "@/styles/reverse-phone.css";

/** All portal entries share one safe-area frame, including standalone settings pages. */
export function ReversePhoneLayer({ children, overlay = false }: { children: ReactNode; overlay?: boolean }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setTarget(document.querySelector<HTMLElement>('[data-ui="phone-screen"]') ?? document.body); }, []);
  return target ? createPortal(<div className={`rp-external-layer${target === document.body ? " rp-viewport-layer" : ""}${overlay ? " rp-notice-layer" : ""}`} data-reverse-phone-layer="" role={overlay?"presentation":"dialog"} aria-label={overlay?undefined:"共享手机"} aria-modal={overlay?undefined:true}><div className="rp-app rp-safe-frame">{children}</div></div>, target) : null;
}
