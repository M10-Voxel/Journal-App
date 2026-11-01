/** A colour as the picker works with it: hue (0–360), saturation, brightness and opacity (0–1). */
export interface Hsva { h: number; s: number; v: number; a: number }
export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const byte = (value: number) => Math.round(clamp(value) * 255).toString(16).padStart(2, '0');
export function rgbOf({ h, s, v }: Hsva): [number, number, number] {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}
/** `#rrggbb`, with `alpha` and less than full opacity `#rrggbbaa`. */
export function hexOf(color: Hsva, alpha: boolean): string {
  const [r, g, b] = rgbOf(color);
  return `#${byte(r)}${byte(g)}${byte(b)}${alpha && color.a < 1 ? byte(color.a) : ''}`;
}
/** `#rrggbb(aa)` as hue, saturation, brightness and opacity; grey has no hue of its own and keeps `hue`. */
export function hsvaOf(hex: string, hue = 0): Hsva {
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const a = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1;
  const max = Math.max(r, g, b), delta = max - Math.min(r, g, b);
  let h = hue;
  if (delta) h = 60 * (max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4);
  return { h: (h + 360) % 360, s: max ? delta / max : 0, v: max, a };
}
