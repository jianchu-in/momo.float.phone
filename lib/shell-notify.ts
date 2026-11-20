/**
 * 壳系统通知桥（网页 ↔ 原生 Android NotificationManager）。
 *
 * 在安卓壳环境（FloatShell）下，WebView 内置的 Notification API 不可用，
 * 借由 window.AndroidShell.notify 直接触发原生通知栏提醒；
 * 在普通浏览器下回退到 Web Notification。
 */

type ShellNotifyBridge = {
  notify?: (title: string, body: string, avatarUrl: string, sessionId: string | null) => boolean;
};

declare global {
  interface Window {
    AndroidShell?: ShellNotifyBridge;
  }
}

/** 是否具备安卓壳原生通知能力 */
export function hasShellNotificationBridge(): boolean {
  return typeof window !== "undefined" && typeof window.AndroidShell?.notify === "function";
}

/**
 * 发送一条系统通知。
 * 优先走安卓壳原生通知，次之尝试浏览器原生 Notification。
 *
 * @param title 标题
 * @param body 正文
 * @param avatarUrl 角色头像链接或 base64
 * @param sessionId 会话 ID（用于通知栏点击直达或快捷回复）
 */
export function sendShellNotification(
  title: string,
  body: string,
  avatarUrl?: string | null,
  sessionId?: string | null,
): boolean {
  if (typeof window === "undefined") return false;

  // 1. 安卓壳原生通道
  if (typeof window.AndroidShell?.notify === "function") {
    try {
      return Boolean(window.AndroidShell.notify(title, body, avatarUrl || "", sessionId || null));
    } catch (err) {
      console.warn("[ShellNotify] 原生通知发送失败", err);
    }
  }

  // 2. 浏览器 Web Notification 降级
  if (typeof window.Notification !== "undefined" && window.Notification.permission === "granted") {
    try {
      new window.Notification(title, {
        body,
        icon: avatarUrl || "/icons/icon-192.png",
      });
      return true;
    } catch {
      return false;
    }
  }

  return false;
}
