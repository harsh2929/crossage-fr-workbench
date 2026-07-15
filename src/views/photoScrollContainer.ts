export function nearestPhotoScrollContainer(node: HTMLElement | null): HTMLElement | Window | null {
  if (typeof window === "undefined" || !node) return null;
  let current = node.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    if (/(auto|scroll|overlay)/.test(style.overflowY)) {
      return current;
    }
    current = current.parentElement;
  }
  return window;
}
