/** Focus non-editable dialog controls without revealing a docked/offscreen launcher. */
export function focusWithoutScroll(element: HTMLElement | null) {
  if (!element) return;
  const positions: { element: HTMLElement; left: number; top: number }[] = [];
  for (let parent = element.parentElement; parent; parent = parent.parentElement) positions.push({ element: parent, left: parent.scrollLeft, top: parent.scrollTop });
  const x = window.scrollX, y = window.scrollY;
  element.focus({ preventScroll: true });
  // Also cover WebKit versions that still scroll an overflow-hidden ancestor on focus.
  for (const saved of positions) {
    if (saved.element.scrollLeft !== saved.left) saved.element.scrollLeft = saved.left;
    if (saved.element.scrollTop !== saved.top) saved.element.scrollTop = saved.top;
  }
  if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
}
