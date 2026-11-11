import { emit, listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { journal } from './journal';
import type { Day, LinkedAction } from './journal';
import { DaySessions } from './daySessions';
import type { CurrentDayEditor } from './daySessions';
import { applyDayOperation, EditConflict } from './dayOperations';
import type { DayOperation } from './dayOperations';
import { registerEditorFlush } from './editorFlush';

interface Snapshot { day: Day; sequence: number; epoch: string; savedTraces: string[]; unsaved: boolean }
type Request = { id: string; date: string } & (
  | { kind: 'open' | 'flush' }
  | { kind: 'operation'; operation: DayOperation }
  | { kind: 'linked'; others: { id: string; date: string }[]; action: LinkedAction }
);
interface Result { id: string; snapshot?: Snapshot; error?: string; conflict?: boolean }
let host: DaySessions | null = null;
export const hasEditorDrafts = () => host?.hasDrafts() ?? false;
export const flushEditorSessions = () => host ? host.run(() => host!.flush()) : Promise.resolve();
export const publishEditorDay = (day: Day) => host?.adopted(day);
export const reloadEditorSessions = (dates?: readonly string[]) => host ? host.run(() => host!.reload(dates)) : Promise.resolve();
export async function loadEditorDay(date: string, accept: (day: Day) => void) {
  if (!host) { accept(await journal.load(date)); return; }
  const sessions = host;
  await sessions.run(async () => { await sessions.flush(); accept(await sessions.read(date)); });
}
export async function serializeEditorMutation<T>(work: () => Promise<T>): Promise<T> {
  if (!host) return work();
  const sessions = host;
  return sessions.run(async () => { await sessions.flush(); const result = await work(); await sessions.reload(); return result; });
}

/** Only installed in the resident main window; widgets never call save_day. */
export async function installEditorHost(editor: CurrentDayEditor) {
  let sequence = 0;
  const epoch = crypto.randomUUID();
  const snapshots = new Map<string, Snapshot>();
  const publish = (day: Day) => {
    const snapshot = { day, sequence: ++sequence, epoch, savedTraces: journal.cached(day.date)?.entries.filter(entry => entry.plan).map(entry => entry.id) ?? [], unsaved: sessions.isDirty(day.date) };
    snapshots.set(day.date, snapshot);
    if (snapshots.size > 32) snapshots.delete(snapshots.keys().next().value!);
    void emit('editor:snapshot', snapshot);
  };
  const sessions = new DaySessions(editor, journal, publish);
  let saveTimer = 0;
  const scheduleSave = () => {
    window.clearTimeout(saveTimer);
    // A fallback in the resident host also saves accepted edits if Explorer closes/recreates the widget.
    saveTimer = window.setTimeout(() => { void sessions.run(() => sessions.flush()).catch(reason => editor.onError?.(String(reason))); }, 900);
  };
  const results = new Map<string, Promise<Result>>();
  const stop = await listen<Request>('editor:request', event => {
    const request = event.payload;
    if (!request.id || !/^\d{4}-\d{2}-\d{2}$/.test(request.date)) return;
    let result = results.get(request.id);
    if (!result) {
      result = sessions.run(async () => {
        try {
          if (request.kind === 'operation') await sessions.apply(request.date, request.operation);
          else if (request.kind === 'linked') await sessions.linked(request.others, request.action);
          else if (request.kind === 'flush') await sessions.flush();
          if (request.kind === 'operation' || request.kind === 'linked') scheduleSave();
          publish(await sessions.read(request.date));
          return { id: request.id, snapshot: snapshots.get(request.date) };
        } catch (reason) { return { id: request.id, error: String(reason), conflict: reason instanceof EditConflict }; }
      });
      results.set(request.id, result);
      if (results.size > 64) results.delete(results.keys().next().value!);
    }
    void result.then(value => emit('editor:result', value));
  });
  host = sessions;
  const changed = await listen<string[]>('journal:changed', event => {
    void sessions.run(async () => {
      journal.invalidateDates(event.payload.filter(date => date !== editor.current()?.date));
      await sessions.reload(event.payload);
    }).catch(() => {});
  });
  const unregister = registerEditorFlush(flushEditorSessions);
  // Restore only once the writer and all its request listeners are ready.
  void invoke('desktop_widget_restore').catch(() => {});
  void emit('editor:ready', { epoch });
  return () => { window.clearTimeout(saveTimer); stop(); changed(); unregister(); if (host === sessions) host = null; };
}

interface ClientState { day: Day | null; savedTraces: string[]; error: string; conflict: boolean; pending: boolean; unsaved: boolean; saving: boolean; paused: boolean }
/** An optimistic view with a serialized field-operation queue and explicit conflict recovery. */
export class WidgetEditorClient {
  private base: Snapshot | null = null;
  private epoch = '';
  private retiredEpochs = new Set<string>();
  private date = '';
  private pending: { id: string; operation: DayOperation }[] = [];
  private blockedDraft: Day | null = null;
  private sending: Promise<void> | null = null;
  private replies = new Map<string, { request: Request; resolve(result: Result): void; reject(reason: Error): void }>();
  private listeners = new Set<() => void>();
  private stops: (() => void)[] = [];
  private ready: Promise<void>;
  private disposed = false;
  private edits = 0;
  private state: ClientState = { day: null, savedTraces: [], error: '', conflict: false, pending: false, unsaved: false, saving: false, paused: false };
  constructor() {
    this.ready = Promise.all([
      listen<Result>('editor:result', event => this.replies.get(event.payload.id)?.resolve(event.payload)),
      listen<Snapshot>('editor:snapshot', event => this.receive(event.payload)),
      listen<boolean>('editor:paused', event => this.update({ paused: event.payload })),
      listen<{ epoch: string }>('editor:ready', event => {
        if (!this.date || this.disposed) return;
        if (this.retiredEpochs.has(event.payload.epoch)) return;
        this.acceptEpoch(event.payload.epoch);
        // Sync reloads the resident WebView. Keep the selected widget date and reattach to its new writer.
        this.update({ paused: true });
        void this.request({ id: crypto.randomUUID(), date: this.date, kind: 'open' }).then(snapshot => {
          this.receive(snapshot); this.update({ paused: false });
          for (const reply of this.replies.values()) void emit('editor:request', reply.request);
        }).catch(reason => this.update({ error: String(reason), paused: false }));
      }),
    ]).then(stops => { if (this.disposed) stops.forEach(stop => stop()); else this.stops = stops; });
  }
  private acceptEpoch(epoch: string) {
    if (this.epoch && this.epoch !== epoch) this.retiredEpochs.add(this.epoch);
    this.epoch = epoch;
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private update(patch: Partial<ClientState> = {}) {
    let day = this.blockedDraft ?? this.base?.day ?? null;
    if (day && !this.blockedDraft) for (const pending of this.pending) day = applyDayOperation(day, pending.operation, true);
    this.state = { ...this.state, ...patch, day, savedTraces: this.base?.savedTraces ?? [], pending: this.pending.length > 0 };
    for (const listener of this.listeners) listener();
  }
  private receive(snapshot: Snapshot) {
    if (this.retiredEpochs.has(snapshot.epoch) || snapshot.day.date !== this.date || (this.base?.epoch === snapshot.epoch && snapshot.sequence < this.base.sequence)) return;
    this.acceptEpoch(snapshot.epoch);
    this.base = snapshot; this.update({ unsaved: this.pending.length > 0 || snapshot.unsaved });
  }
  private async request(request: Request): Promise<Snapshot> {
    await this.ready;
    let timer: number | undefined;
    const response = new Promise<Result>((resolve, reject) => {
      this.replies.set(request.id, { request, resolve, reject });
      timer = window.setTimeout(() => reject(new Error('Die Haupt-App antwortet nicht. Dein Entwurf bleibt erhalten.')), 30000);
    });
    try {
      await emit('editor:request', request);
      const result = await response;
      if (result.error) { if (result.conflict) throw new EditConflict(); throw new Error(result.error); }
      if (!result.snapshot) throw new Error('Der Tageseditor hat keinen Stand zurückgegeben.');
      if (this.retiredEpochs.has(result.snapshot.epoch)) return await this.request(request);
      return result.snapshot;
    } finally { clearTimeout(timer); this.replies.delete(request.id); }
  }
  async open(date: string) {
    if (this.date && this.date !== date) await this.flush();
    this.date = date; this.base = null; this.blockedDraft = null; this.update({ error: '', conflict: false });
    try { this.receive(await this.request({ id: crypto.randomUUID(), date, kind: 'open' })); }
    catch (reason) { this.update({ error: String(reason) }); throw reason; }
  }
  submit(operation: DayOperation) {
    if (!this.state.day || this.state.error || this.state.paused) return;
    this.edits++; this.pending.push({ id: crypto.randomUUID(), operation }); this.update({ unsaved: true });
    void this.pump().catch(() => {});
  }
  private pump(): Promise<void> {
    if (this.sending) return this.sending;
    this.sending = (async () => {
      while (this.pending.length) {
        if (this.state.error) throw new Error(this.state.error);
        const next = this.pending[0];
        try {
          const snapshot = await this.request({ ...next, date: this.date, kind: 'operation' });
          this.pending.shift(); this.receive(snapshot); this.update();
        } catch (reason) {
          this.blockedDraft = this.state.day;
          this.update({ error: String(reason), conflict: reason instanceof EditConflict });
          throw reason;
        }
      }
    })().finally(() => { this.sending = null; });
    return this.sending;
  }
  async linked(others: { id: string; date: string }[], action: LinkedAction) {
    try {
      this.edits++; this.update({ unsaved: true });
      await this.pump();
      this.receive(await this.request({ id: crypto.randomUUID(), date: this.date, kind: 'linked', others, action }));
    } catch (reason) { this.update({ error: String(reason) }); }
  }
  async flush() {
    if (!this.date) return;
    if (this.state.error) throw new Error(this.state.error);
    this.update({ saving: true });
    const edits = this.edits;
    try { await this.pump(); this.receive(await this.request({ id: crypto.randomUUID(), date: this.date, kind: 'flush' })); if (edits === this.edits) this.update({ unsaved: false }); }
    catch (reason) { this.update({ error: String(reason) }); throw reason; }
    finally { this.update({ saving: false }); }
  }
  async reload() {
    // This is an explicit user choice, offered next to the recoverable local draft.
    this.pending = []; this.blockedDraft = null; this.base = null;
    this.update({ error: '', conflict: false, unsaved: false });
    await this.open(this.date);
  }
  dispose() { this.disposed = true; for (const stop of this.stops) stop(); this.listeners.clear(); }
}
