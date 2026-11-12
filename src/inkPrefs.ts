import type { InkPen, InkTool } from './ink.ts';

// The handwriting tools a device remembers (`journal.ink` in localStorage; tested in tests/ink.test.mjs): the tool,
// the kind of selection, size and colour per kind of pen, the eraser's size and the colours used last.

export type PenPrefs = { size: number; color: string | null };
export type InkPrefs = {
  tool: InkTool; kind: InkPen; select: 'rect' | 'lasso';
  pen: PenPrefs; pencil: PenPrefs; marker: PenPrefs; eraser: number; recent: string[];
};
export type SizedTool = InkPen | 'eraser';

export const pens = ['pen', 'pencil', 'marker'] as const;
export const sizePresets: Record<SizedTool, number[]> = { pen: [1.5, 3, 6], pencil: [1, 2, 4], marker: [8, 14, 24], eraser: [8, 18, 36] };
export const sizeRanges: Record<SizedTool, [number, number]> = { pen: [.5, 24], pencil: [.5, 16], marker: [4, 48], eraser: [4, 96] };
/** The pen colours, and the highlighter's own suggestions. */
export const penColors = ['#1f1f1f', '#2457c5', '#c9302c', '#2e8b57', '#7b3fb3', '#7a4b28', '#7d7d7d', '#e07b1a'];
export const markerColors = ['#ffe14d', '#7ee07e', '#ff7ac8', '#6cc4ff', '#ffb347'];
const defaults: Record<InkPen, PenPrefs> = { pen: { size: 3, color: null }, pencil: { size: 2, color: null }, marker: { size: 14, color: markerColors[0] } };

const isHex = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export const isPen = (tool: unknown): tool is InkPen => tool === 'pen' || tool === 'pencil' || tool === 'marker';
export const clampSize = (tool: SizedTool, value: number) => Math.round(Math.max(sizeRanges[tool][0], Math.min(sizeRanges[tool][1], value)) * 4) / 4;

/** Stored prefs in any earlier shape (`pen: number` before there were several pens), else the defaults. */
export function normalizePrefs(value: unknown): InkPrefs {
  const stored = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const size = (raw: unknown, tool: SizedTool, fallback: number) => typeof raw === 'number' && raw >= sizeRanges[tool][0] && raw <= sizeRanges[tool][1] ? raw : fallback;
  const pen = (tool: InkPen): PenPrefs => {
    const raw = stored[tool];
    if (typeof raw === 'number') return { size: size(raw, tool, defaults[tool].size), color: defaults[tool].color };
    const object = (raw && typeof raw === 'object' ? raw : {}) as Partial<PenPrefs>;
    return { size: size(object.size, tool, defaults[tool].size), color: object.color === null ? null : isHex(object.color) ? object.color.toLowerCase() : defaults[tool].color };
  };
  const tool: InkTool = isPen(stored.tool) || stored.tool === 'eraser' || stored.tool === 'select' ? stored.tool : 'pen';
  return {
    tool, kind: isPen(stored.kind) ? stored.kind : isPen(tool) ? tool : 'pen', select: stored.select === 'lasso' ? 'lasso' : 'rect',
    pen: pen('pen'), pencil: pen('pencil'), marker: pen('marker'), eraser: size(stored.eraser, 'eraser', sizePresets.eraser[1]),
    recent: Array.isArray(stored.recent) ? stored.recent.filter(isHex).map(color => color.toLowerCase()).slice(0, 6) : [],
  };
}
/** A colour put first among the recent ones (at most six). */
export const withRecent = (recent: string[], color: string) => [color.toLowerCase(), ...recent.filter(other => other !== color.toLowerCase())].slice(0, 6);
/** The next pen when P is pressed again: fountain pen → pencil → highlighter → fountain pen. */
export const nextPen = (pen: InkPen): InkPen => pens[(pens.indexOf(pen) + 1) % pens.length];
