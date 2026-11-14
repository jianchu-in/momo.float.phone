/**
 * 壳环境与运行平台检测。
 * 用于现实桥根据设备类型（iOS 快捷指令路线 vs 安卓本机桥路线）切换向导与展示。
 */

export type BridgePlatform = {
  home: "ios" | "android" | "other";
  androidBridge: "ready" | "unavailable";
  iosBridge: "ready" | "unavailable";
};

/** 是否运行在安卓壳（FloatShell App）的 WebView 里 */
export function isShellEnvironment(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.userAgent.includes("FloatShell/");
}

/** 描述当前设备所适用的桥接平台 */
export function describeBridgePlatform(): BridgePlatform {
  if (typeof navigator === "undefined") {
    return {
      home: "other",
      androidBridge: "unavailable",
      iosBridge: "unavailable",
    };
  }

  const ua = navigator.userAgent;
  const isAndroid = /Android/i.test(ua);
  const isIos = /iPhone|iPad|iPod/i.test(ua);
  const isShell = ua.includes("FloatShell/");

  const home = isAndroid ? "android" : isIos ? "ios" : "other";
  const androidBridge = isShell ? "ready" : "unavailable";
  const iosBridge = isIos ? "ready" : "unavailable";

  return {
    home,
    androidBridge,
    iosBridge,
  };
}
