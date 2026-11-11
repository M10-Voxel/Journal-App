/** Each WebView registers its editor, so undo, sync, vault switching and quit drain every draft. */
const flushers = new Set<() => Promise<void>>();
export function registerEditorFlush(flush: () => Promise<void>) {
  flushers.add(flush);
  return () => { flushers.delete(flush); };
}
export async function flushEditors() { for (const flush of [...flushers]) await flush(); }
