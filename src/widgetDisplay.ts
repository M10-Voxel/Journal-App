// The canvas spans the desktop; automatic UI scaling follows the monitor containing the visible widget.
let logicalWidth: number | null = null;
export const widgetScreenWidth = () => logicalWidth;
export function setWidgetScreenWidth(width: number) {
  if (logicalWidth === width) return;
  logicalWidth = width;
  window.dispatchEvent(new Event('widget:monitor'));
}
