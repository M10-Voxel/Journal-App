import { useEffect, useRef, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import type { CalendarImport } from '../journal';
import { latestMailCandidates, recognizeMail } from '../mail';
import { mailApi } from '../mailApi';
import { getLanguage } from '../i18n';
import { saveTags } from '../tagStore';
import { classifyMailTag, ensureMailTags, mailTagId } from '../mailTags';
import { mailText } from '../mail';

/** Native polling continues in the tray. Mail events wake extraction in the main webview; imports use the editor's save/merge path. */
export function useMailImport(onImport: (entries: CalendarImport[]) => Promise<void>) {
  const latest = useRef(onImport); latest.current = onImport;
  const [status, setStatus] = useState({ count: 0, error: '' });
  useEffect(() => {
    let disposed = false, running = false, again = false;
    let notified = new Set<string>();
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
            if (result.candidates.length) {
              const tags = await saveTags(current => ensureMailTags(current, getLanguage()));
              const message = item.message;
              const kind = classifyMailTag(message.subject, message.sender, message.text || mailText(message.html), /"(?:https?:\/\/schema\.org\/)?ParcelDelivery"/i.test(message.html));
              for (const candidate of result.candidates) candidate.entry.tag ??= mailTagId(tags, kind);
            }
            await mailApi.stage(item.account.id, item.message.key, result.candidates, result.notice);
            processed++;
          }
          // Leave deferred free text queued, while attachments and existing suggestions continue to work.
          if (pending.length === 50 && processed === pending.length) again = true;
          const candidates = await mailApi.candidates() ?? [];
          // Read current account preferences, rather than the snapshot attached to a queued mail.
          const accounts = await mailApi.accounts() ?? [];
          const automatic = latestMailCandidates(candidates).filter(candidate => accounts.some(account => account.id === candidate.accountId && account.autoImport === true));
          if (automatic.length && !disposed) {
            await latest.current(automatic.map(({ date, entry }) => ({ date, entry })));
            const uids = new Set(automatic.map(item => item.entry.calendarUid));
            await mailApi.resolve(candidates.filter(item => uids.has(item.entry.calendarUid)).map(item => item.id), true);
            await emit('journal:mail-imported', automatic.map(item => ({ id:item.id, text:item.entry.text, date:item.date, time:item.entry.time, end:item.entry.end })));
          }
          if (!disposed) {
            const remaining = latestMailCandidates(await mailApi.candidates() ?? []);
            setStatus({ count: remaining.length, error: deferredError });
            const fresh = remaining.filter(item => !notified.has(item.id));
            notified = new Set(remaining.map(item => item.id));
            // Full pending list also removes accepted/rejected suggestions from a visible notice.
            await emit('journal:mail-suggestions', { count: remaining.length, fresh: fresh.length });
          }
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
