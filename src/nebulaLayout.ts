// Nebula's desk as a grid of windows (NebulaDesk.tsx), without the interface (tested in tests/nebulaLayout.test.mjs).
// The middle holds the day's windows (entries, rating, day values, activities, board) or the overview's (note, ratings,
// activities, board) in an order of their own; windows can stand in a stack (one column, one above the other); the calendar and the notebook can join it ("docked") or float over the desk, and the day's own windows can float
// too. The grid has twelve columns: each docked window takes some of them (`spans`, the whole row by default), and can
// be minimized to its bar. The layout is remembered on the device.

/** `activities` is the day's checklist in a day and the activity overview in an overview (one window, its content per family). */
export type PanelId = 'entries' | 'rating' | 'scales' | 'activities' | 'board' | 'notes' | 'ratings' | 'calendar' | 'notebook';
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
  /**
   * Stacked windows per family: a stacked window belongs to the column of the shown window before it in `order` (a cell:
   * its first window, the head, with the ones stacked below it). The cell takes the head's width; rows, widths and
   * neighbours count cells.
   */
  stacked: Record<Family, PanelId[]>;
}

export const own: Record<Family, PanelId[]> = { day: ['entries', 'rating', 'scales', 'activities', 'board'], period: ['notes', 'ratings', 'activities', 'board'] };
export const windows: readonly WindowId[] = ['calendar', 'notebook'];
export const columns = 12, minSpan = 3;
/** By default the entries stand left, the day's rating, values and checklist stacked right of them; in an overview the note
 *  with the ratings below it left, the activities right. The board takes the row below. */
export const defaultLayout = (): NebulaLayout => ({ order: { day: [...own.day], period: [...own.period] }, minimized: [], spans: { entries: 7, rating: 5, notes: 7, activities: 5 }, docked: [], floating: [], heights: { board: 620 },
  stacked: { day: ['scales', 'activities'], period: ['ratings'] } });
export const spanOf = (layout: NebulaLayout, id: PanelId) => layout.spans[id] ?? columns;
const isOwn = (id: PanelId) => !windows.includes(id as WindowId);

const isPanel = (value: unknown, family: Family): value is PanelId => typeof value === 'string' && ([...own[family], ...windows] as string[]).includes(value);
/** The day's former data window (rating and checklist in one) is now three windows: rating, day values, activities. */
const fromData: PanelId[] = ['rating', 'scales', 'activities'];
const withoutData = (list: unknown[]): unknown[] => list.flatMap(id => id === 'data' ? fromData : [id]);
/** Where an own window missing from a stored order joins it: after this one (else at the end). */
const after: Record<Family, Partial<Record<PanelId, PanelId>>> = { day: { rating: 'entries', scales: 'rating', activities: 'scales' }, period: { ratings: 'notes' } };
/**
 * A stored layout made whole: unknown ids go, the family's own windows are always there (new ones after the window they
 * belong to, others at the end). An older layout's data window becomes the rating, day values and activities, taking
 * its place, width, and whether it was minimized or floating.
 */
export function normalizeLayout(raw: unknown): NebulaLayout {
  const base = defaultLayout();
  if (!raw || typeof raw !== 'object') return base;
  const value = raw as Partial<Omit<NebulaLayout, 'stacked'>> & { half?: unknown; stacked?: unknown };
  const docked = Array.isArray(value.docked) ? windows.filter(id => value.docked!.includes(id)) : [];
  const order = (family: Family) => {
    const stored: unknown[] = Array.isArray(value.order?.[family]) ? value.order![family] : [];
    const list = [...new Set((family === 'day' ? withoutData(stored) : stored).filter((id): id is PanelId => isPanel(id, family)))];
    const kept = list.filter(id => !windows.includes(id as WindowId) || docked.includes(id as WindowId));
    for (const id of own[family]) {
      if (kept.includes(id)) continue;
      const before = after[family][id], at = before ? kept.indexOf(before) : -1;
      if (at >= 0) kept.splice(at + 1, 0, id); else kept.push(id);
    }
    return [...kept, ...docked.filter(id => !kept.includes(id))];
  };
  const ids = (list: unknown) => Array.isArray(list) ? [...new Set(withoutData(list).filter((id): id is PanelId => isPanel(id, 'day') || isPanel(id, 'period')))] : [];
  const heights: NebulaLayout['heights'] = {};
  for (const [id, height] of Object.entries(value.heights ?? {})) if ((isPanel(id, 'day') || isPanel(id, 'period')) && Number.isFinite(height) && (height as number) >= minPanelHeight(id as PanelId)) heights[id as PanelId] = Math.round(height as number);
  // Widths: whole columns between the minimum and the row; an older layout's half windows take six (the data window's
  // width goes to the rating, which heads the stack now).
  const spans: NebulaLayout['spans'] = {};
  if (value.spans && typeof value.spans === 'object') {
    for (const [stored, span] of Object.entries(value.spans)) {
      const id = stored === 'data' ? 'rating' : stored;
      if ((isPanel(id, 'day') || isPanel(id, 'period')) && Number.isFinite(span)) spans[id as PanelId] = Math.max(minSpan, Math.min(columns, Math.round(span as number)));
    }
  } else if (Array.isArray(value.half)) for (const id of ids(value.half.map(id => id === 'data' ? 'rating' : id))) spans[id] = 6;
  else Object.assign(spans, base.spans);
  // Stacks: as stored; an older layout (without them) gets the default ones.
  const stack = value.stacked && typeof value.stacked === 'object' ? value.stacked as Partial<Record<Family, unknown>> : null;
  const stacked = (family: Family): PanelId[] => !stack ? [...base.stacked[family]]
    : [...new Set(Array.isArray(stack[family]) ? (stack[family] as unknown[]).filter((id): id is PanelId => isPanel(id, family) && isOwn(id)) : [])];
  return { order: { day: order('day'), period: order('period') }, minimized: ids(value.minimized), spans, docked, floating: ids(value.floating).filter(isOwn), heights,
    stacked: { day: stacked('day'), period: stacked('period') } };
}

/** The windows shown in the grid, in order: the family's own, and the calendar or notebook while docked and open. */
export function visiblePanels(layout: NebulaLayout, family: Family, open: Record<WindowId, boolean> & { board?: boolean }): PanelId[] {
  return layout.order[family].filter(id => id === 'board' && open.board === false ? false : isOwn(id) ? !layout.floating.includes(id) : layout.docked.includes(id as WindowId) && open[id as WindowId]);
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
export const minPanelHeight = (id: PanelId) => ['rating', 'scales', 'activities'].includes(id) ? 64 : 120;
export const setHeight = (layout: NebulaLayout, id: PanelId, height: number | null): NebulaLayout => {
  const heights = { ...layout.heights };
  if (height == null) delete heights[id]; else heights[id] = Math.max(minPanelHeight(id), Math.round(height));
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

/** The family of a list of shown windows (from the windows only one family has). */
export const familyOf = (ids: readonly PanelId[]): Family => ids.some(id => id === 'notes' || id === 'ratings') ? 'period' : 'day';
/**
 * The shown windows in cells: a window stacked (`stacked`) joins the cell of the window before it, the others start one
 * (the first window always does).
 */
export function cellsOf(layout: NebulaLayout, ids: readonly PanelId[], family: Family = familyOf(ids)): PanelId[][] {
  const cells: PanelId[][] = [];
  for (const id of ids) {
    if (cells.length && layout.stacked[family].includes(id)) cells[cells.length - 1].push(id);
    else cells.push([id]);
  }
  return cells;
}
/** The first window of the cell `id` stands in (its width is the cell's). */
export const headOf = (layout: NebulaLayout, ids: readonly PanelId[], id: PanelId, family: Family = familyOf(ids)) => cellsOf(layout, ids, family).find(cell => cell.includes(id))?.[0] ?? id;
/**
 * The shown cells as the grid lays them out, each by its head: rows of twelve columns, filled in order (a cell that does
 * not fit starts the next row).
 */
export function rowsOf(layout: NebulaLayout, ids: readonly PanelId[], family: Family = familyOf(ids)): PanelId[][] {
  const rows: PanelId[][] = [];
  let used = columns;
  for (const [id] of cellsOf(layout, ids, family)) {
    const span = spanOf(layout, id);
    if (used + span > columns) { rows.push([]); used = 0; }
    rows[rows.length - 1].push(id);
    used += span;
  }
  return rows;
}
/** The cell sharing the row with `id`'s cell that gives or takes width: the next one, else the one before. */
function neighbourOf(layout: NebulaLayout, ids: readonly PanelId[], id: PanelId, family: Family): PanelId | null {
  const head = headOf(layout, ids, id, family);
  const row = rowsOf(layout, ids, family).find(list => list.includes(head)) ?? [];
  const at = row.indexOf(head);
  return row[at + 1] ?? row[at - 1] ?? null;
}
/**
 * A new width for a window's cell in its row: its neighbour takes up the difference, so the row stays as wide as it was
 * (both at least the minimum). Alone in its row, only the cell changes.
 */
export function resizeInRow(layout: NebulaLayout, ids: readonly PanelId[], id: PanelId, span: number, family: Family = familyOf(ids)): NebulaLayout {
  const head = headOf(layout, ids, id, family);
  const neighbour = neighbourOf(layout, ids, head, family);
  if (!neighbour) return setSpan(layout, head, span);
  const pair = spanOf(layout, head) + spanOf(layout, neighbour);
  const own = Math.max(minSpan, Math.min(pair - minSpan, Math.round(span)));
  return setSpan(setSpan(layout, head, own), neighbour, pair - own);
}
/**
 * A window leaving its place (moved, floating, pulled out). Stacked, its cell just closes up; heading a stack, the next
 * window of the stack heads it now (with the cell's width); alone in its cell, it leaves its width to its neighbour.
 */
export function leaveRow(layout: NebulaLayout, ids: readonly PanelId[], id: PanelId, family: Family = familyOf(ids)): NebulaLayout {
  const cell = cellsOf(layout, ids, family).find(list => list.includes(id));
  const unstack = (next: NebulaLayout, other: PanelId): NebulaLayout => next.stacked[family].includes(other) ? { ...next, stacked: { ...next.stacked, [family]: next.stacked[family].filter(item => item !== other) } } : next;
  if (!cell || cell[0] !== id) return unstack(layout, id);
  if (cell.length > 1) return unstack(setSpan(layout, cell[1], spanOf(layout, id)), cell[1]);
  const neighbour = neighbourOf(layout, ids, id, family);
  return neighbour ? setSpan(layout, neighbour, Math.min(columns, spanOf(layout, neighbour) + spanOf(layout, id))) : layout;
}
/**
 * Where a dragged window lands: beside a window's cell (`side`) when the pointer is on its outer quarter left or right,
 * sharing its width; into a stack (`stack`) above or below a window when the pointer is on its upper or lower rim;
 * otherwise between cells at `index` (dropIndex over the cells), in a row of its own. `index` counts the windows.
 */
export type Drop = { index: number; beside?: { id: PanelId; side: 'left' | 'right' }; stack?: { id: PanelId; side: 'above' | 'below' } };
export function dropTarget(boxes: readonly (Box & { id: PanelId; cell?: PanelId })[], point: { x: number; y: number }): Drop {
  const cellOf = (box: { id: PanelId; cell?: PanelId }) => box.cell ?? box.id;
  const over = boxes.find(box => point.x >= box.left && point.x <= box.left + box.width && point.y >= box.top && point.y <= box.top + box.height);
  if (over) {
    const members = boxes.filter(box => cellOf(box) === cellOf(over));
    const edge = Math.min(140, over.width / 4), rim = Math.min(36, over.height / 4);
    if (point.x <= over.left + edge) return { index: boxes.indexOf(members[0]), beside: { id: cellOf(over), side: 'left' } };
    if (point.x >= over.left + over.width - edge) return { index: boxes.indexOf(members[members.length - 1]) + 1, beside: { id: cellOf(over), side: 'right' } };
    if (point.y < over.top + rim) return { index: boxes.indexOf(over), stack: { id: over.id, side: 'above' } };
    if (point.y > over.top + over.height - rim) return { index: boxes.indexOf(over) + 1, stack: { id: over.id, side: 'below' } };
  }
  // Between cells: each cell as one box (the union of its windows).
  const cells: { first: number; box: Box }[] = [];
  boxes.forEach((box, index) => {
    const last = cells[cells.length - 1];
    if (last && cellOf(boxes[last.first]) === cellOf(box)) {
      const left = Math.min(last.box.left, box.left), top = Math.min(last.box.top, box.top);
      const right = Math.max(last.box.left + last.box.width, box.left + box.width), bottom = Math.max(last.box.top + last.box.height, box.top + box.height);
      last.box = { left, top, width: right - left, height: bottom - top, wide: last.box.wide };
    } else cells.push({ first: index, box: { left: box.left, top: box.top, width: box.width, height: box.height, wide: box.wide } });
  });
  const at = dropIndex(cells.map(cell => cell.box), point);
  return { index: at < cells.length ? cells[at].first : boxes.length };
}
/**
 * Puts a window where it was dropped (`ids`: the shown windows before; `index` counts them without the window). Its old
 * place closes the gap; between rows it takes a row of its own, beside a cell the two share that cell's width, in a
 * stack it takes the stack's width (above the head: it heads the stack now).
 */
export function placePanel(layout: NebulaLayout, family: Family, ids: readonly PanelId[], id: PanelId, drop: Drop, open: Record<WindowId, boolean>, fromGrid: boolean): NebulaLayout {
  let next = fromGrid ? leaveRow(layout, ids, id, family) : layout;
  next = { ...next, stacked: { ...next.stacked, [family]: next.stacked[family].filter(other => other !== id) } };
  next = isOwn(id) ? { ...next, floating: next.floating.filter(other => other !== id) } : next.docked.includes(id as WindowId) ? next : dockWindow(next, family, id as WindowId, drop.index, open);
  next = movePanel(next, family, id, drop.index, { ...open, ...(!isOwn(id) ? { [id]: true } : {}) });
  if (drop.stack) {
    const target = drop.stack.id, stacked = next.stacked[family];
    // Above a stack's head (or a window alone): the dropped window heads the cell, with its width; the other is stacked below it.
    if (drop.stack.side === 'above' && !stacked.includes(target)) return setSpan({ ...next, stacked: { ...next.stacked, [family]: [...stacked, target] } }, id, spanOf(next, target));
    return { ...next, stacked: { ...next.stacked, [family]: [...stacked, id] } };
  }
  if (!drop.beside) return setSpan(next, id, columns);
  const total = spanOf(next, drop.beside.id), own = Math.max(minSpan, Math.floor(total / 2));
  return setSpan(setSpan(next, drop.beside.id, Math.max(minSpan, total - own)), id, own);
}

/**
 * The widths as shown: a minimized window that shares its row with an open one lies on its side as a narrow bar (one
 * column), and the open window next to it (the next one, else the one before) takes the columns it gives up. A row of
 * only minimized windows, or a minimized window alone, keeps its widths (bars lying flat). The stored widths stay as
 * they are, so restoring a window gives back the row it had.
 */
export function displaySpans(layout: NebulaLayout, ids: readonly PanelId[], family: Family = familyOf(ids)): { spans: Partial<Record<PanelId, number>>; upright: PanelId[]; pull: Partial<Record<PanelId, [number, number]>> } {
  const spans: Partial<Record<PanelId, number>> = {}, upright: PanelId[] = [];
  // Rows are made of cells (by their heads); a cell lies on its side only as a single minimized window, never a stack.
  const cells = cellsOf(layout, ids, family);
  const view = { minimized: cells.filter(cell => cell.length === 1 && layout.minimized.includes(cell[0])).map(cell => cell[0]) };
  // How many bar widths an element moves in from its left and right column edge: a bar is narrower than a column, so
  // the bars close up towards their open window and that window reaches over the rest (see nebula-grid.css).
  const pull: Partial<Record<PanelId, [number, number]>> = {};
  for (const row of rowsOf(layout, ids, family)) {
    for (const id of row) spans[id] = spanOf(layout, id);
    const open = row.filter(id => !view.minimized.includes(id));
    if (!open.length || open.length === row.length) continue;
    row.forEach((id, at) => {
      if (!view.minimized.includes(id)) return;
      const taker = row.slice(at + 1).find(other => open.includes(other)) ?? row.slice(0, at).reverse().find(other => open.includes(other))!;
      spans[taker] = (spans[taker] ?? 0) + spanOf(layout, id) - 1;
      spans[id] = 1;
      upright.push(id);
    });
    row.forEach((id, at) => {
      if (view.minimized.includes(id)) return;
      let left = 0, right = 0;
      while (at - left - 1 >= 0 && view.minimized.includes(row[at - left - 1])) left++;
      if (row.slice(at + 1).every(other => view.minimized.includes(other))) right = row.length - at - 1;
      if (!left && !right) return;
      pull[id] = [left, right];
      for (let i = 0; i < left; i++) pull[row[at - left + i]] = [i, -1];
      for (let i = 0; i < right; i++) pull[row[at + right - i]] = [-1, i];
    });
  }
  // The windows stacked in a cell take its width.
  for (const cell of cells) for (const id of cell.slice(1)) spans[id] = spans[cell[0]];
  return { spans, upright, pull };
}

