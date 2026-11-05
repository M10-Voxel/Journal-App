// Nebula's desk as a grid of windows (NebulaDesk.tsx), without the interface (tested in tests/nebulaLayout.test.mjs).
// The middle holds the day's windows (entries, data, board) or the overview's (note, activities) in an order of their
// own; the calendar and the notebook can join it ("docked") or float over the desk, and the day's own windows can float
// too. The grid has twelve columns: each docked window takes some of them (`spans`, the whole row by default), and can
// be minimized to its bar. The layout is remembered on the device.

export type PanelId = 'entries' | 'data' | 'board' | 'notes' | 'activities' | 'calendar' | 'notebook';
export type Family = 'day' | 'period';
export type WindowId = 'calendar' | 'notebook';
export interface NebulaLayout {
  /** The order of the docked windows for days and for overviews; the calendar and notebook appear here while docked. */
  order: Record<Family, PanelId[]>;
  /** Minimized windows (only their bar shows). */
  minimized: PanelId[];
  /** Columns (of twelve) a docked window takes; without an entry it takes the whole row. */
  spans: Partial<Record<PanelId, number>>;
  /** The calendar and notebook docked in the grid (else they float). */
  docked: WindowId[];
  /** The day's (or overview's) own windows floating over the desk instead of standing in the grid. */
  floating: PanelId[];
  /** Heights chosen for docked windows (px); without one a window takes its content's height (calendar, notebook: a default). */
  heights: Partial<Record<PanelId, number>>;
}

export const own: Record<Family, PanelId[]> = { day: ['entries', 'data', 'board'], period: ['notes', 'activities'] };
export const windows: readonly WindowId[] = ['calendar', 'notebook'];
export const columns = 12, minSpan = 3;
export const defaultLayout = (): NebulaLayout => ({ order: { day: [...own.day], period: [...own.period] }, minimized: [], spans: { data: 6, board: 6 }, docked: [], floating: [], heights: {} });
export const spanOf = (layout: NebulaLayout, id: PanelId) => layout.spans[id] ?? columns;
const isOwn = (id: PanelId) => !windows.includes(id as WindowId);

const isPanel = (value: unknown, family: Family): value is PanelId => typeof value === 'string' && ([...own[family], ...windows] as string[]).includes(value);
/** A stored layout made whole: unknown ids go, the family's own windows are always there (missing ones at the end). */
export function normalizeLayout(raw: unknown): NebulaLayout {
  const base = defaultLayout();
  if (!raw || typeof raw !== 'object') return base;
  const value = raw as Partial<NebulaLayout> & { half?: unknown };
  const docked = Array.isArray(value.docked) ? windows.filter(id => value.docked!.includes(id)) : [];
  const order = (family: Family) => {
    const list = Array.isArray(value.order?.[family]) ? [...new Set(value.order![family].filter(id => isPanel(id, family)))] : [];
    const kept = list.filter(id => !windows.includes(id as WindowId) || docked.includes(id as WindowId));
    return [...kept, ...own[family].filter(id => !kept.includes(id)), ...docked.filter(id => !kept.includes(id))];
  };
  const ids = (list: unknown) => Array.isArray(list) ? [...new Set(list.filter((id): id is PanelId => isPanel(id, 'day') || isPanel(id, 'period')))] : [];
  const heights: NebulaLayout['heights'] = {};
  for (const [id, height] of Object.entries(value.heights ?? {})) if ((isPanel(id, 'day') || isPanel(id, 'period')) && Number.isFinite(height) && (height as number) >= 120) heights[id as PanelId] = Math.round(height as number);
  // Widths: whole columns between the minimum and the row; an older layout's half windows take six.
  const spans: NebulaLayout['spans'] = {};
  if (value.spans && typeof value.spans === 'object') {
    for (const [id, span] of Object.entries(value.spans)) if ((isPanel(id, 'day') || isPanel(id, 'period')) && Number.isFinite(span)) spans[id as PanelId] = Math.max(minSpan, Math.min(columns, Math.round(span as number)));
  } else if (Array.isArray(value.half)) for (const id of ids(value.half)) spans[id] = 6;
  else Object.assign(spans, base.spans);
  return { order: { day: order('day'), period: order('period') }, minimized: ids(value.minimized), spans, docked, floating: ids(value.floating).filter(isOwn), heights };
}

/** The windows shown in the grid, in order: the family's own, and the calendar or notebook while docked and open. */
export function visiblePanels(layout: NebulaLayout, family: Family, open: Record<WindowId, boolean>): PanelId[] {
  return layout.order[family].filter(id => isOwn(id) ? !layout.floating.includes(id) : layout.docked.includes(id as WindowId) && open[id as WindowId]);
}

/**
 * Moves a window to a place among the shown ones (`index` counts the shown windows, without the one moved); windows not
 * shown (a docked calendar while closed) keep their place relative to the others.
 */
export function movePanel(layout: NebulaLayout, family: Family, id: PanelId, index: number, open: Record<WindowId, boolean>): NebulaLayout {
  const shown = visiblePanels(layout, family, open).filter(other => other !== id);
  const target = Math.max(0, Math.min(index, shown.length));
  const rest = layout.order[family].filter(other => other !== id);
  // Put it before the shown window that will follow it, or after the last shown one.
  const before = shown[target];
  const at = before ? rest.indexOf(before) : shown.length ? rest.indexOf(shown[shown.length - 1]) + 1 : rest.length;
  return { ...layout, order: { ...layout.order, [family]: [...rest.slice(0, at), id, ...rest.slice(at)] } };
}

/** The calendar or notebook joins the grid of both families (at `index` in this one, at the end of the other). */
export function dockWindow(layout: NebulaLayout, family: Family, id: WindowId, index: number, open: Record<WindowId, boolean>): NebulaLayout {
  const other: Family = family === 'day' ? 'period' : 'day';
  const docked: NebulaLayout = { ...layout, docked: layout.docked.includes(id) ? layout.docked : [...layout.docked, id],
    order: { ...layout.order, [other]: layout.order[other].includes(id) ? layout.order[other] : [...layout.order[other], id] } };
  return movePanel(docked, family, id, index, { ...open, [id]: true });
}
/** The calendar or notebook leaves the grid and floats again (and is no longer minimized). */
export function undockWindow(layout: NebulaLayout, id: WindowId): NebulaLayout {
  return { ...layout, docked: layout.docked.filter(other => other !== id), minimized: layout.minimized.filter(other => other !== id),
    order: { day: layout.order.day.filter(other => other !== id), period: layout.order.period.filter(other => other !== id) } };
}
const toggle = (list: PanelId[], id: PanelId) => list.includes(id) ? list.filter(other => other !== id) : [...list, id];
export const toggleMinimized = (layout: NebulaLayout, id: PanelId): NebulaLayout => ({ ...layout, minimized: toggle(layout.minimized, id) });
/** Half a row, or the whole row again (from any other width: half). */
export const toggleHalf = (layout: NebulaLayout, id: PanelId): NebulaLayout => setSpan(layout, id, spanOf(layout, id) === columns / 2 ? columns : columns / 2);
export function setSpan(layout: NebulaLayout, id: PanelId, span: number): NebulaLayout {
  const spans = { ...layout.spans }, value = Math.max(minSpan, Math.min(columns, Math.round(span)));
  if (value === columns) delete spans[id]; else spans[id] = value;
  return { ...layout, spans };
}
/** A window leaves the grid and floats over the desk (the calendar and notebook: undocked; the others: floating). */
export function floatPanel(layout: NebulaLayout, id: PanelId): NebulaLayout {
  if (!isOwn(id)) return undockWindow(layout, id as WindowId);
  return { ...layout, floating: layout.floating.includes(id) ? layout.floating : [...layout.floating, id], minimized: layout.minimized.filter(other => other !== id) };
}
/** A floating window joins the grid at `index` among the shown ones. */
export function dockPanel(layout: NebulaLayout, family: Family, id: PanelId, index: number, open: Record<WindowId, boolean>): NebulaLayout {
  if (!isOwn(id)) return dockWindow(layout, family, id as WindowId, index, open);
  return movePanel({ ...layout, floating: layout.floating.filter(other => other !== id) }, family, id, index, open);
}
export const setHeight = (layout: NebulaLayout, id: PanelId, height: number | null): NebulaLayout => {
  const heights = { ...layout.heights };
  if (height == null) delete heights[id]; else heights[id] = Math.max(120, Math.round(height));
  return { ...layout, heights };
};

/**
 * Where a window dropped at `point` lands among the shown windows (their boxes in reading order): before the first box
 * the point comes before. A box below the point, or beside it on the left, is after it; over a box, a wide one is split
 * at its middle from top to bottom, a half one from left to right. Past every box: at the end.
 */
export type Box = { left: number; top: number; width: number; height: number; wide?: boolean };
export function dropIndex(boxes: readonly Box[], point: { x: number; y: number }): number {
  const index = boxes.findIndex(box => {
    if (point.y < box.top) return true;
    if (point.y > box.top + box.height) return false;
    if (point.x < box.left) return true;
    if (point.x > box.left + box.width) return false;
    return box.wide ? point.y < box.top + box.height / 2 : point.x < box.left + box.width / 2;
  });
  return index < 0 ? boxes.length : index;
}

/**
 * The shown windows as the grid lays them out: rows of twelve columns, filled in order (a window that does not fit
 * starts the next row).
 */
export function rowsOf(layout: NebulaLayout, ids: readonly PanelId[]): PanelId[][] {
  const rows: PanelId[][] = [];
  let used = columns;
  for (const id of ids) {
    const span = spanOf(layout, id);
    if (used + span > columns) { rows.push([]); used = 0; }
    rows[rows.length - 1].push(id);
    used += span;
  }
  return rows;
}
/** The window sharing the row with `id` that gives or takes width: the next one, else the one before. */
function neighbourOf(layout: NebulaLayout, ids: readonly PanelId[], id: PanelId): PanelId | null {
  const row = rowsOf(layout, ids).find(list => list.includes(id)) ?? [];
  const at = row.indexOf(id);
  return row[at + 1] ?? row[at - 1] ?? null;
}
/**
 * A new width for a window in its row: its neighbour takes up the difference, so the row stays as wide as it was (both
 * at least the minimum). Alone in its row, only the window changes.
 */
export function resizeInRow(layout: NebulaLayout, ids: readonly PanelId[], id: PanelId, span: number): NebulaLayout {
  const neighbour = neighbourOf(layout, ids, id);
  if (!neighbour) return setSpan(layout, id, span);
  const pair = spanOf(layout, id) + spanOf(layout, neighbour);
  const own = Math.max(minSpan, Math.min(pair - minSpan, Math.round(span)));
  return setSpan(setSpan(layout, id, own), neighbour, pair - own);
}
/** A window leaving its row (moved, floating, pulled out) leaves its width to its neighbour there. */
export function leaveRow(layout: NebulaLayout, ids: readonly PanelId[], id: PanelId): NebulaLayout {
  const neighbour = neighbourOf(layout, ids, id);
  return neighbour ? setSpan(layout, neighbour, Math.min(columns, spanOf(layout, neighbour) + spanOf(layout, id))) : layout;
}
/**
 * Where a dragged window lands: beside a window (`side`) when the pointer is on its outer quarter left or right, sharing
 * its width; otherwise between windows at `index` (dropIndex), in a row of its own.
 */
export type Drop = { index: number; beside?: { id: PanelId; side: 'left' | 'right' } };
export function dropTarget(boxes: readonly (Box & { id: PanelId })[], point: { x: number; y: number }): Drop {
  const over = boxes.find(box => point.x >= box.left && point.x <= box.left + box.width && point.y >= box.top && point.y <= box.top + box.height);
  if (over) {
    const edge = Math.min(140, over.width / 4);
    if (point.x <= over.left + edge) return { index: boxes.indexOf(over), beside: { id: over.id, side: 'left' } };
    if (point.x >= over.left + over.width - edge) return { index: boxes.indexOf(over) + 1, beside: { id: over.id, side: 'right' } };
  }
  return { index: dropIndex(boxes, point) };
}
/**
 * Puts a window where it was dropped (`ids`: the shown windows before; `index` counts them without the window). Its old
 * row closes the gap; between rows it takes a row of its own, beside a window the two share that window's width.
 */
export function placePanel(layout: NebulaLayout, family: Family, ids: readonly PanelId[], id: PanelId, drop: Drop, open: Record<WindowId, boolean>, fromGrid: boolean): NebulaLayout {
  let next = fromGrid ? leaveRow(layout, ids, id) : layout;
  next = isOwn(id) ? { ...next, floating: next.floating.filter(other => other !== id) } : next.docked.includes(id as WindowId) ? next : dockWindow(next, family, id as WindowId, drop.index, open);
  next = movePanel(next, family, id, drop.index, { ...open, ...(!isOwn(id) ? { [id]: true } : {}) });
  if (!drop.beside) return setSpan(next, id, columns);
  const total = spanOf(next, drop.beside.id), own = Math.max(minSpan, Math.floor(total / 2));
  return setSpan(setSpan(next, drop.beside.id, Math.max(minSpan, total - own)), id, own);
}
