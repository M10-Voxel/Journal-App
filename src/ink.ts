import { decodeBase64, encodeBase64 } from './base64.ts';

// Handwriting on a note (tested in tests/ink.test.mjs). A stroke keeps its points in note-local world pixels, measured
// from the top left of the drawing area, so resizing the note only changes how much of the drawing shows.
// Points are stored compactly: delta-coded Int16 triples (x·4, y·4, pressure·1000) as Base64, about 6 bytes a point.

/** x, y in world pixels, pressure 0…1. */
export type InkPoint = [number, number, number];
/** The kinds of pen: a fountain pen (default, also for strokes without `tool`), a pencil and a highlighter. */
export type InkPen = 'pen' | 'pencil' | 'marker';
/**
 * `pressure`: drawn with a varying width (else constant). `mouse`: the width follows the speed, not the pen.
 * `tool`: the kind of pen (missing: fountain pen). `color`: a hex colour (missing: the design's ink).
 */
export type InkStroke = { size: number; pressure: boolean; mouse?: boolean; tool?: InkPen; color?: string; points: string };
export type Ink = { v: 1; strokes: InkStroke[] };
export type InkTool = InkPen | 'eraser' | 'select';
/** A note's background for writing: lines, a grid or dots, `step` world pixels apart (missing: blank). */
export type InkPaper = { kind: 'lines' | 'grid' | 'dots'; step: number };
export const paperSteps = [12, 16, 20, 24, 32, 40, 48] as const;
/** A card's background, when it is a valid one. */
export function inkPaperOf(value: unknown): InkPaper | null {
  const paper = value as Partial<InkPaper> | null | undefined;
  return paper && (paper.kind === 'lines' || paper.kind === 'grid' || paper.kind === 'dots') && typeof paper.step === 'number' && paper.step >= 4 && paper.step <= 200 ? { kind: paper.kind, step: paper.step } : null;
}
/** The next spacing step up (+1) or down (-1) from a spacing (also from one between the steps). */
export function nextPaperStep(step: number, direction: 1 | -1): number {
  if (direction > 0) return paperSteps.find(value => value > step) ?? paperSteps[paperSteps.length - 1];
  return [...paperSteps].reverse().find(value => value < step) ?? paperSteps[0];
}
const hexColor = /^#[0-9a-f]{6}$/i;
/** The colour a stroke is filled with: its own when it is a valid hex colour, else the design's ink. */
export const strokeColor = (stroke: Pick<InkStroke, 'color'>) => stroke.color && hexColor.test(stroke.color) ? stroke.color : 'currentColor';
export const penOf = (stroke: Pick<InkStroke, 'tool'>): InkPen => stroke.tool === 'pencil' || stroke.tool === 'marker' ? stroke.tool : 'pen';

export const emptyInk = (): Ink => ({ v: 1, strokes: [] });
/** A card's drawing, also when it is missing or from a newer, unknown format (then shown empty, never overwritten blindly). */
export function inkOf(value: unknown): Ink {
  const ink = value as Partial<Ink> | null | undefined;
  return ink && ink.v === 1 && Array.isArray(ink.strokes) ? { v: 1, strokes: ink.strokes.filter(s => s && typeof s.points === 'string' && s.size > 0) } : emptyInk();
}

const limit = 32767;
const clampPressure = (p: number) => Math.max(0, Math.min(1, Number.isFinite(p) ? p : .5));
/** Encodes points; jumps too long for one Int16 step get points in between. */
export function encodePoints(points: InkPoint[]): string {
  const values: number[] = [];
  let px = 0, py = 0, pp = 0;
  for (const [x, y, p] of points) {
    const qx = Math.round(x * 4), qy = Math.round(y * 4), qp = Math.round(clampPressure(p) * 1000);
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(qx - px), Math.abs(qy - py)) / limit)), sx = px, sy = py;
    for (let i = 1; i <= steps; i++) {
      // Intermediate points (only for huge jumps, e.g. from the origin) take the pressure of the target.
      const nx = sx + Math.round((qx - sx) * i / steps), ny = sy + Math.round((qy - sy) * i / steps);
      values.push(nx - px, ny - py, qp - pp);
      px = nx; py = ny; pp = qp;
    }
  }
  const bytes = new Uint8Array(values.length * 2), view = new DataView(bytes.buffer);
  values.forEach((value, i) => view.setInt16(i * 2, value, true));
  return encodeBase64(bytes);
}
export function decodePoints(encoded: string): InkPoint[] {
  let bytes: Uint8Array;
  try { bytes = decodeBase64(encoded); } catch { return []; }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), points: InkPoint[] = [];
  let x = 0, y = 0, p = 0;
  for (let i = 0; i + 6 <= bytes.length; i += 6) {
    x += view.getInt16(i, true); y += view.getInt16(i + 2, true); p += view.getInt16(i + 4, true);
    points.push([x / 4, y / 4, p / 1000]);
  }
  return points;
}

/** The note-local point under a pointer: the client offset divided by the on-screen scale (board zoom and more). */
export function canvasPoint(client: { x: number; y: number }, rect: { left: number; top: number; width: number }, layoutWidth: number): { x: number; y: number } {
  const scale = layoutWidth > 0 && rect.width > 0 ? rect.width / layoutWidth : 1;
  return { x: (client.x - rect.left) / scale, y: (client.y - rect.top) / scale };
}

/**
 * perfect-freehand's settings per pen; the tip always stays under the pen (little streamline). Fountain pen: a swell
 * with pressure. Pencil: only a light pressure influence, a little smoother. Highlighter: an even band with flat ends.
 */
export function strokeOptions(stroke: Pick<InkStroke, 'size' | 'pressure' | 'mouse' | 'tool'>, last = true) {
  const pen = penOf(stroke);
  if (pen === 'marker') return {
    size: stroke.size, thinning: 0, smoothing: .5, streamline: .15, simulatePressure: false, easing: (t: number) => t,
    start: { cap: false, taper: 0 }, end: { cap: false, taper: 0 }, last,
  };
  return {
    size: stroke.size, thinning: stroke.pressure ? pen === 'pencil' ? .3 : .6 : 0, smoothing: pen === 'pencil' ? .65 : .5, streamline: .15,
    simulatePressure: stroke.pressure && !!stroke.mouse, easing: (t: number) => t,
    start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 }, last,
  };
}
/** An outline (perfect-freehand's polygon) as an SVG path of quadratic curves through the midpoints. */
export function outlinePath(outline: number[][]): string {
  const n = outline.length;
  if (!n) return '';
  const f = (v: number) => Math.round(v * 100) / 100;
  if (n < 3) return `M${f(outline[0][0])} ${f(outline[0][1])}Z`;
  let d = `M${f(outline[0][0])} ${f(outline[0][1])}Q`;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = outline[i], [x1, y1] = outline[(i + 1) % n];
    d += `${f(x0)} ${f(y0)} ${f((x0 + x1) / 2)} ${f((y0 + y1) / 2)} `;
  }
  return d.trimEnd() + 'Z';
}

/** The lowest point of the drawing (for a note that grows with its content). */
export function inkBottom(ink: Ink): number {
  let bottom = 0;
  for (const stroke of ink.strokes) for (const [, y] of decodePoints(stroke.points)) bottom = Math.max(bottom, y + stroke.size / 2);
  return bottom;
}

type Vec = { x: number; y: number };
function distanceToSegment(p: Vec, a: Vec, b: Vec) {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
/** Points closer together than a step, so the eraser cannot slip between two points of a fast stroke. Added points are
 *  marked, so the pieces that remain keep only their own points plus the new ends at the cut. */
function densify(points: InkPoint[], step: number): { point: InkPoint; added: boolean }[] {
  const out: { point: InkPoint; added: boolean }[] = [];
  points.forEach((point, i) => {
    const previous = points[i - 1];
    if (previous) {
      const gaps = Math.floor(Math.hypot(point[0] - previous[0], point[1] - previous[1]) / step);
      for (let k = 1; k <= gaps; k++) {
        const t = k / (gaps + 1);
        out.push({ point: [previous[0] + (point[0] - previous[0]) * t, previous[1] + (point[1] - previous[1]) * t, previous[2] + (point[2] - previous[2]) * t], added: true });
      }
    }
    out.push({ point, added: false });
  });
  return out;
}
/**
 * The partial eraser: removes the ink within `radius` of the eraser's path (segment by segment, so also between two
 * pointer events). A stroke cut through falls apart into several; strokes not touched stay the same objects.
 */
export function eraseStrokes(strokes: InkStroke[], path: Vec[], radius: number): { strokes: InkStroke[]; changed: boolean } {
  if (!path.length) return { strokes, changed: false };
  const segments = path.length === 1 ? [[path[0], path[0]]] : path.slice(1).map((point, i) => [path[i], point]);
  const box = { left: Math.min(...path.map(p => p.x)), right: Math.max(...path.map(p => p.x)), top: Math.min(...path.map(p => p.y)), bottom: Math.max(...path.map(p => p.y)) };
  let changed = false;
  const result: InkStroke[] = [];
  for (const stroke of strokes) {
    const reach = radius + stroke.size / 2, points = decodePoints(stroke.points);
    // Bounding boxes first: most strokes are nowhere near the eraser.
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const near = points.length > 0 && Math.min(...xs) <= box.right + reach && Math.max(...xs) >= box.left - reach && Math.min(...ys) <= box.bottom + reach && Math.max(...ys) >= box.top - reach;
    const hit = (point: InkPoint) => segments.some(([a, b]) => distanceToSegment({ x: point[0], y: point[1] }, a, b) <= reach);
    const dense = near ? densify(points, Math.max(.5, reach / 2)) : [];
    const erased = dense.map(({ point }) => hit(point));
    if (!erased.includes(true)) { result.push(stroke); continue; }
    changed = true;
    let piece: { point: InkPoint; added: boolean }[] = [];
    const flush = () => {
      const kept = piece.filter((item, i) => !item.added || i === 0 || i === piece.length - 1).map(item => item.point);
      if (kept.length > 1) result.push({ ...stroke, points: encodePoints(kept) });
      piece = [];
    };
    dense.forEach((item, i) => { if (erased[i]) flush(); else piece.push(item); });
    flush();
  }
  return { strokes: changed ? result : strokes, changed };
}

// Selecting. A stroke is known by its index in the drawing; the actions below take a set of indices and keep every
// stroke not named the same object.

export type Box = { left: number; top: number; right: number; bottom: number };
/** The area a stroke covers, its width included (null for a stroke without points). */
export function strokeBounds(stroke: InkStroke): Box | null {
  const points = decodePoints(stroke.points);
  if (!points.length) return null;
  const half = stroke.size / 2;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const [x, y] of points) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  return { left: left - half, top: top - half, right: right + half, bottom: bottom + half };
}
/** The box around the named strokes (all when none are named), null when there is nothing. */
export function selectionBox(strokes: InkStroke[], ids?: Iterable<number>): Box | null {
  const list = ids ? [...ids].map(id => strokes[id]).filter(Boolean) : strokes;
  let box: Box | null = null;
  for (const stroke of list) {
    const b = strokeBounds(stroke);
    if (b) box = box ? { left: Math.min(box.left, b.left), top: Math.min(box.top, b.top), right: Math.max(box.right, b.right), bottom: Math.max(box.bottom, b.bottom) } : b;
  }
  return box;
}
/** A box from two corners in any order. */
export const boxOf = (a: Vec, b: Vec): Box => ({ left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) });
/** Whether the rectangle catches a stroke: at least 60 % of its points lie inside. */
export function inRect(stroke: InkStroke, rect: Box): boolean {
  const points = decodePoints(stroke.points);
  if (!points.length) return false;
  const inside = points.filter(([x, y]) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom).length;
  return inside >= points.length * .6;
}
/** The strokes a rectangle catches. */
export const selectInRect = (strokes: InkStroke[], rect: Box): number[] => strokes.flatMap((stroke, i) => inRect(stroke, rect) ? [i] : []);

/** Whether a point lies inside a polygon (ray test; the polygon closes itself). */
export function insidePolygon(point: Vec, polygon: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
/** Where the segment a→b first crosses the polygon's outline, as a share of the way (0…1); null when it does not. */
function crossing(a: Vec, b: Vec, polygon: Vec[]): number | null {
  let best: number | null = null;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const c = polygon[j], d = polygon[i];
    const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y, denominator = rx * sy - ry * sx;
    if (!denominator) continue;
    const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denominator, u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denominator;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && (best === null || t < best)) best = t;
  }
  return best;
}
/**
 * The lasso cuts: every stroke is split exactly at the lasso's outline. The pieces inside are selected, the pieces
 * outside stay; `origin` names each result's stroke in the input. Both pieces at a cut share an interpolated point on the outline, so no gap opens. Strokes wholly inside
 * or outside stay the same objects; a split stroke's pieces take its place in the order.
 */
export function cutByLasso(strokes: InkStroke[], polygon: Vec[]): { strokes: InkStroke[]; selected: number[]; origin: number[]; changed: boolean } {
  if (polygon.length < 3) return { strokes, selected: [], origin: strokes.map((_, i) => i), changed: false };
  const xs = polygon.map(p => p.x), ys = polygon.map(p => p.y);
  const area: Box = { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  const result: InkStroke[] = [], selected: number[] = [], origin: number[] = [];
  let changed = false;
  strokes.forEach((stroke, from) => {
    const push = (piece: InkStroke, within: boolean) => { if (within) selected.push(result.length); origin.push(from); result.push(piece); };
    const points = decodePoints(stroke.points);
    const box = strokeBounds(stroke);
    if (!box || box.right < area.left || box.left > area.right || box.bottom < area.top || box.top > area.bottom) { push(stroke, false); return; }
    const dense = densify(points, 2);
    const inside = dense.map(({ point }) => insidePolygon({ x: point[0], y: point[1] }, polygon));
    if (inside.every(Boolean)) { push(stroke, true); return; }
    if (!inside.includes(true)) { push(stroke, false); return; }
    changed = true;
    let piece: { point: InkPoint; added: boolean }[] = [];
    const flush = (within: boolean) => {
      const kept = piece.filter((item, i) => !item.added || i === 0 || i === piece.length - 1).map(item => item.point);
      if (kept.length) push({ ...stroke, points: encodePoints(kept) }, within);
      piece = [];
    };
    dense.forEach((item, i) => {
      if (i > 0 && inside[i] !== inside[i - 1]) {
        // The point on the outline ends this piece and starts the next one.
        const a = dense[i - 1].point, b = item.point, t = crossing({ x: a[0], y: a[1] }, { x: b[0], y: b[1] }, polygon) ?? .5;
        const edge: InkPoint = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        piece.push({ point: edge, added: false });
        flush(inside[i - 1]);
        piece.push({ point: edge, added: false });
      }
      piece.push(item);
    });
    flush(inside[inside.length - 1]);
  });
  return { strokes: changed ? result : strokes, selected, origin, changed };
}

/** Moves and scales the named strokes (scale about `origin`, then move); the width scales along. */
export function transformStrokes(strokes: InkStroke[], ids: Iterable<number>, { dx = 0, dy = 0, scale = 1, origin = { x: 0, y: 0 } }: { dx?: number; dy?: number; scale?: number; origin?: Vec }): InkStroke[] {
  const named = new Set(ids);
  if (!named.size || (!dx && !dy && scale === 1)) return strokes;
  return strokes.map((stroke, i) => {
    if (!named.has(i)) return stroke;
    const points = decodePoints(stroke.points).map(([x, y, p]): InkPoint => [origin.x + (x - origin.x) * scale + dx, origin.y + (y - origin.y) * scale + dy, p]);
    return { ...stroke, size: Math.max(.25, Math.round(stroke.size * scale * 100) / 100), points: encodePoints(points) };
  });
}
/** Gives the named strokes another colour (null: back to the design's ink) and/or width. */
export function restyleStrokes(strokes: InkStroke[], ids: Iterable<number>, { color, size }: { color?: string | null; size?: (size: number) => number }): InkStroke[] {
  const named = new Set(ids);
  if (!named.size) return strokes;
  return strokes.map((stroke, i) => {
    if (!named.has(i)) return stroke;
    const next: InkStroke = { ...stroke };
    if (color === null) delete next.color; else if (color !== undefined) next.color = color;
    if (size) next.size = Math.max(.25, Math.min(160, Math.round(size(stroke.size) * 100) / 100));
    return next;
  });
}
/** Removes the named strokes. */
export function deleteStrokes(strokes: InkStroke[], ids: Iterable<number>): InkStroke[] {
  const named = new Set(ids);
  return named.size ? strokes.filter((_, i) => !named.has(i)) : strokes;
}
