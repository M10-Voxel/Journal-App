import type { Day, LinkedAction } from './journal.ts';
import { applyDayOperation, changeOperation } from './dayOperations.ts';
import type { DayOperation } from './dayOperations.ts';
import { mergeCalendarImport } from './entries.ts';

export interface CurrentDayEditor {
  current(): Day | null;
  replace(day: Day): void;
  flush(): Promise<void>;
  refresh(before: Day, refreshed: Day): void;
  onError?(message: string): void;
  isDirty?(): boolean;
}
interface Session { day: Day; persisted: Day; dirty: boolean }
/** The resident main WebView owns all daily-note drafts and all their writes. */
export class DaySessions {
  private editor: CurrentDayEditor;
  private storage: { load(date: string): Promise<Day>; save(day: Day): Promise<Day> };
  private publish: (day: Day) => void;
  private sessions = new Map<string, Session>();
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;
  constructor(editor: CurrentDayEditor, storage: { load(date: string): Promise<Day>; save(day: Day): Promise<Day> }, publish: (day: Day) => void) {
    this.editor = editor; this.storage = storage; this.publish = publish;
  }
  run<T>(work: () => Promise<T>): Promise<T> {
    this.queued++;
    const result = this.tail.then(work);
    this.tail = result.catch(() => {});
    return result.finally(() => { this.queued--; });
  }
  hasDrafts() { return this.queued > 0 || [...this.sessions.values()].some(session => session.dirty); }
  isDirty(date: string) { return this.editor.current()?.date === date ? this.editor.isDirty?.() ?? false : this.sessions.get(date)?.dirty ?? false; }
  async read(date: string): Promise<Day> {
    const current = this.editor.current();
    if (current?.date === date) return current;
    let session = this.sessions.get(date);
    if (!session) { const day = await this.storage.load(date); session = { day, persisted: day, dirty: false }; this.sessions.set(date, session); }
    this.sessions.delete(date); this.sessions.set(date, session);
    if (this.sessions.size > 16) { const oldest = [...this.sessions].find(([key, value]) => key !== date && !value.dirty); if (oldest) this.sessions.delete(oldest[0]); }
    return session.day;
  }
  async apply(date: string, operation: DayOperation) {
    const before = await this.read(date), next = applyDayOperation(before, operation);
    if (next !== before) {
      if (this.editor.current()?.date === date) this.editor.replace(next);
      else { const session = this.sessions.get(date)!; session.day = next; session.dirty = true; }
    }
    this.publish(next);
    return next;
  }
  async linked(others: { id: string; date: string }[], action: LinkedAction) {
    for (const other of others) {
      const day = await this.read(other.date), entry = day.entries.find(entry => entry.id === other.id);
      if (entry) await this.apply(other.date, action === 'remove' ? { kind: 'remove', id: entry.id, before: entry }
        : changeOperation(entry, { done: action === 'done', cancelled: action === 'cancelled' }));
    }
  }
  /** Queue this after incoming operations; callers never acknowledge a flush before it is durable. */
  async flush() {
    await this.editor.flush();
    for (const session of this.sessions.values()) {
      if (!session.dirty) continue;
      // The main editor can type while another date is saved. Merge linked changes back into that editor.
      const current = this.editor.current();
      const saved = await this.storage.save(session.day);
      session.day = saved; session.persisted = saved; session.dirty = false;
      this.publish(saved);
      for (const date of saved.touched ?? []) {
        if (date === saved.date) continue;
        const refreshed = await this.storage.load(date);
        if (current?.date === date) this.editor.refresh(current, refreshed);
        const other = this.sessions.get(date);
        if (other) {
          other.day = other.dirty ? mergeCalendarImport(other.day, other.persisted, refreshed) : refreshed;
          other.persisted = refreshed;
          this.publish(other.day);
        }
      }
    }
    await this.editor.flush();
  }
  /** Called after calendar/sync/history writes, after the flush barrier. */
  async reload(dates?: readonly string[]) {
    for (const [date, session] of this.sessions) {
      if (dates && !dates.includes(date)) continue;
      if (this.editor.current()?.date === date) { if (!session.dirty) this.sessions.delete(date); continue; }
      const refreshed = await this.storage.load(date);
      session.day = session.dirty ? mergeCalendarImport(session.day, session.persisted, refreshed) : refreshed;
      session.persisted = refreshed;
      this.publish(session.day);
    }
  }
  adopted(day: Day) {
    const previous = this.sessions.get(day.date);
    if (previous && !previous.dirty) this.sessions.delete(day.date);
    this.publish(day);
  }
}
