/**
 * The desk's tickets in their tag's colour (NebulaDesk: Ticket). The tag's colour is only lightened where it is too dark
 * for the black print; Nebula's holo foil gets the tag's hue in its middle bands and the complementary hue in its veins
 * (like the built-in foils' mint and lilac, see scripts/nebula-holo.mjs).
 */

import { contrastRatio } from './colors.ts';

type Hsl = [number, number, number];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function toHsl(hex: string): Hsl {
  const [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function toHex([h, s, l]: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [r, g, b].map(value => Math.round(clamp(value + m, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
}

/** Lighter until the black print reads on it (pure blues and violets need more lightness than yellows). */
function readable([h, s, l]: Hsl, min: number): string {
  let color = toHex([h, s, l]);
  while (contrastRatio('#141414', color) < min && l < .96) color = toHex([h, s, l += .01]);
  return color;
}

/** The tag's colour, at least as light as the built-in tickets' (a pastel), so dark print stays readable on it. */
export function lightTagColor(color: string): string {
  const [h, s, l] = toHsl(color);
  return readable([h, Math.min(s, .75), clamp(l, .72, .88)], 7);
}

/** Bands from the noise's low to its high values (as in nebula-holo.mjs): the outer ones are the veins. */
export function foilPalette(color: string): string[] {
  const [h, rawS, rawL] = toHsl(color);
  const s = clamp(rawS, .3, .7), l = clamp(rawL, .74, .84), other = (h + 180) % 360;
  const tag = (dl: number, ds = 0) => readable([h, clamp(s + ds, 0, 1), clamp(l + dl, 0, .92)], 7);
  const complement = (light: number) => readable([other, s, light], 6);
  return [complement(.67), complement(.76), complement(.8), tag(0), tag(.07, -.05), tag(.01), complement(.74), complement(.68)];
}

const foils = new Map<string, { foil: string; ground: string }>();
/** The marbled foil as a CSS image and its ground colour; built once per colour. */
export function tagFoil(color: string): { foil: string; ground: string } {
  let made = foils.get(color);
  if (made) return made;
  const colors = foilPalette(color);
  const channel = (index: number) => colors.map(value => (parseInt(value.slice(1 + index * 2, 3 + index * 2), 16) / 255).toFixed(3)).join(' ');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='520' height='380'>`
    + `<filter id='h' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'>`
    + `<feTurbulence type='fractalNoise' baseFrequency='0.0055 0.0082' numOctaves='3' seed='23'/>`
    + `<feColorMatrix values='1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 0 1'/>`
    + `<feComponentTransfer><feFuncR type='linear' slope='3.2' intercept='-1.1'/><feFuncG type='linear' slope='3.2' intercept='-1.1'/><feFuncB type='linear' slope='3.2' intercept='-1.1'/></feComponentTransfer>`
    + `<feComponentTransfer><feFuncR type='discrete' tableValues='${channel(0)}'/><feFuncG type='discrete' tableValues='${channel(1)}'/><feFuncB type='discrete' tableValues='${channel(2)}'/></feComponentTransfer>`
    + `</filter><rect width='100%' height='100%' filter='url(%23h)'/></svg>`;
  made = { foil: `url("data:image/svg+xml,${svg.replace(/</g, '%3C').replace(/>/g, '%3E')}")`, ground: colors[3] };
  foils.set(color, made);
  return made;
}
