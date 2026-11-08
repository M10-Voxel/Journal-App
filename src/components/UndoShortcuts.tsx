import { useEffect } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { getAllWindows, getCurrentWindow } from '@tauri-apps/api/window';
import { flushBoardData } from '../boardCards';
import { flushPeriodData } from '../periodStore';

/** Drain every window's pending writes before replaying the database transaction. */
export async function flushHistoryWindows() {
  const pending = new Set((await getAllWindows()).map(w => w.label));
  const id = crypto.randomUUID();
  let finish!: () => void, fail!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
  const stop = await listen<{ id: string; window: string; error?: string }>('history:flushed', e => {
    if (e.payload.id !== id) return;
    if (e.payload.error) { fail(new Error(e.payload.error)); return; }
    pending.delete(e.payload.window);
    if (!pending.size) finish();
  });
  const timeout = window.setTimeout(() => fail(new Error('Ein Fenster konnte seine Änderungen nicht rechtzeitig speichern.')), 5000);
  try { await emit('history:flush', { id }); await done; }
  finally { clearTimeout(timeout); stop(); }
}

export function UndoShortcuts() {
  useEffect(() => {
    const flush = listen<{ id: string }>('history:flush', async e => {
      let error: string | undefined;
      try { await flushBoardData(); await flushPeriodData(); } catch (reason) { error = String(reason); }
      await emit('history:flushed', { id: e.payload.id, window: getCurrentWindow().label, error });
    });
    const key = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || !['z', 'y'].includes(e.key.toLowerCase())) return;
      const field = e.target instanceof Element ? e.target.closest<HTMLElement>('input,textarea,[contenteditable=true]') : null;
      const redo = e.key.toLowerCase() === 'y' || e.shiftKey;
      const emptyEntry = !redo && field?.classList.contains('entry-text') && !(field as HTMLElement & { value?: string; readOnly?: boolean }).readOnly && (field as HTMLElement & { value?: string }).value === ''
        ? field.closest<HTMLElement>('[data-entry-id]')?.dataset.entryId : undefined;
      if (field && !emptyEntry) return;
      e.preventDefault(); e.stopPropagation();
      if (!e.repeat) void emit('history:request', { redo, emptyEntry });
    };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); void flush.then(fn => fn()); };
  }, []);
  return null;
}
