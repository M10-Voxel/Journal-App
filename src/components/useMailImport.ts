import { useEffect, useRef, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import type { CalendarImport } from '../journal';
import { latestMailCandidates, recognizeMail } from '../mail';
import { mailApi } from '../mailApi';

/** Native polling continues in the tray. Mail events wake extraction in the main webview; imports use the editor's save/merge path. */
export function useMailImport(onImport: (entries: CalendarImport[]) => Promise<void>) {
  const latest = useRef(onImport); latest.current = onImport;
  const [status, setStatus] = useState({ count: 0, error: '' });
  useEffect(() => {
    let disposed = false, running = false, again = false;
    const process = async () => {
      if (running) { again = true; return; }
      running = true;
      try {
        do {
          again = false;
          const pending = await mailApi.pending() ?? [];
          let processed = 0, deferredError = '';
          for (const item of pending) {
            if (disposed) return;
            let result;
            try { result = await recognizeMail(item, undefined, mailApi.analyze); }
            catch (error) { deferredError = String(error); continue; }
            await mailApi.stage(item.account.id, item.message.key, result.candidates, result.notice);
            processed++;
          }
          // Leave deferred free text queued, while attachments and existing suggestions continue to work.
          if (pending.length === 50 && processed === pending.length) again = true;
          const candidates = await mailApi.candidates() ?? [];
          const automatic = latestMailCandidates(candidates);
          if (automatic.length && !disposed) {
            await latest.current(automatic.map(({ date, entry }) => ({ date, entry })));
            const uids = new Set(automatic.map(item => item.entry.calendarUid));
            await mailApi.resolve(candidates.filter(item => uids.has(item.entry.calendarUid)).map(item => item.id), true);
            await emit('journal:mail-imported', automatic.map(item => ({ id:item.id, text:item.entry.text, date:item.date, time:item.entry.time, end:item.entry.end })));
          }
          if (!disposed) setStatus({ count: latestMailCandidates(await mailApi.candidates() ?? []).length, error: deferredError });
        } while (again && !disposed);
      } catch (error) { if (!disposed) setStatus(current => ({ ...current, error: String(error) })); }
      finally { running = false; }
    };
    const stop = listen('mail:changed', () => { void process(); });
    void process();
    // Also retries an import deferred while a save was in flight and drains batches after a restart.
    const interval = window.setInterval(() => { void process(); }, 60_000);
    return () => { disposed = true; clearInterval(interval); void stop.then(fn => fn()); };
  }, []);
  return status;
}
