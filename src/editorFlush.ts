/** Each WebView registers its editor, so undo, sync, vault switching and quit drain every draft. */
const flushers = new Set<() => Promise<void>>();
export function registerEditorFlush(flush: () => Promise<void>) {
  flushers.add(flush);
  return () => { flushers.delete(flush); };
}
export async function flushEditors() { for (const flush of [...flushers]) await flush(); }

/** The board's pending saves (boardCards.tsx registers them once it is loaded), drained after the editors. A window that
 *  never showed a board has none, and does not load the board's code to find that out. */
let boardFlush: (() => Promise<void>) | null = null;
export function registerBoardFlush(flush: () => Promise<void>) { boardFlush = flush; }
export async function flushBoards() { await boardFlush?.(); }
