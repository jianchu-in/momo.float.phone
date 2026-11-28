export type OverlayRect = { left: number; top: number; right: number; bottom: number };

/** Convert the visible intersection into the scaled container's own CSS pixels. */
export function overlayViewportRect(container: OverlayRect, size: { width: number; height: number }, viewport: OverlayRect, clips: OverlayRect[] = []) {
  if (size.width <= 0 || size.height <= 0) return { left: 0, top: 0, width: 0, height: 0 };
  const scaleX = (container.right - container.left) / size.width || 1;
  const scaleY = (container.bottom - container.top) / size.height || 1;
  const left = Math.min(container.right, Math.max(container.left, viewport.left, ...clips.map(rect => rect.left)));
  const top = Math.min(container.bottom, Math.max(container.top, viewport.top, ...clips.map(rect => rect.top)));
  const right = Math.min(container.right, viewport.right, ...clips.map(rect => rect.right));
  const bottom = Math.min(container.bottom, viewport.bottom, ...clips.map(rect => rect.bottom));
  return { left: Math.max(0, (left - container.left) / scaleX), top: Math.max(0, (top - container.top) / scaleY),
    width: Math.max(0, (right - left) / scaleX), height: Math.max(0, (bottom - top) / scaleY) };
}

export function measureOverlayViewport(container: HTMLElement) {
  const rect = container.getBoundingClientRect();
  const width = container.clientWidth, height = container.clientHeight;
  if (!width || !height || !rect.width || !rect.height) return;
  const scaleX = rect.width / (container.offsetWidth || width), scaleY = rect.height / (container.offsetHeight || height);
  const left = rect.left + container.clientLeft * scaleX, top = rect.top + container.clientTop * scaleY;
  const box = { left, top, right: left + width * scaleX, bottom: top + height * scaleY };
  const viewport = window.visualViewport;
  const visible = { left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
    right: (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth), bottom: (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) };
  const clips: OverlayRect[] = [];
  for (let parent = container.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
    if (!bounds.width || !bounds.height) continue;
    const clipX = /hidden|clip|auto|scroll/.test(style.overflowX || style.overflow);
    const clipY = /hidden|clip|auto|scroll/.test(style.overflowY || style.overflow);
    if (clipX || clipY) clips.push({ left: clipX ? bounds.left : -Infinity, right: clipX ? bounds.right : Infinity,
      top: clipY ? bounds.top : -Infinity, bottom: clipY ? bounds.bottom : Infinity });
  }
  return overlayViewportRect(box, { width, height }, visible, clips);
}
