"use client";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "@/styles/reverse-phone.css";

/** All portal entries share one safe-area frame, including standalone settings pages. */
export function ReversePhoneLayer({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setTarget(document.querySelector<HTMLElement>('[data-ui="phone-screen"]') ?? document.body); }, []);
  return target ? createPortal(<div className={`rp-external-layer${target === document.body ? " rp-viewport-layer" : ""}`} data-reverse-phone-layer="" role="dialog" aria-label="共享手机" aria-modal="true"><div className="rp-app rp-safe-frame">{children}</div></div>, target) : null;
}
