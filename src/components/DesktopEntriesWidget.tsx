import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { DayEditor } from './DayEditor';
import { WidgetEditorClient } from '../editorBridge';
import { changeOperation } from '../dayOperations';
import { registerEditorFlush } from '../editorFlush';
import { updateDesktopWidget } from '../desktopWidgets';
import type { DesktopWidgetInstance, DesktopWidgetState } from '../desktopWidgets';
import { formatDate, localDate, shiftDate } from '../journal';
import type { Entry, EntryKind } from '../journal';
import type { EntryChange } from './JournalEntry';
import { entryLabels } from './JournalEntry';
import { useTags, useHiddenTags, manageTags } from '../tagStore';
import { isShown, tagOf } from '../tags';
import { moveEntryByOffset, sameGroup } from '../entries';
import { loadSettings, swipeAvailable } from '../settings';
import { usePopupLook } from '../popupLook';
import { t, useLanguage } from '../i18n';
import { useEntryDrag } from './useEntryDrag';
import { useListMotion } from './useListMotion';
import { TagFilter } from './TagFilter';
import { MiniCalendarPicker } from './MiniCalendarPicker';
import { NavCluster } from './NavCluster';
import { useViewHistory } from '../viewHistory';
import { DesktopWidgetFrame, ensureWidgetSurface } from './DesktopWidgetFrame';

function useLatest<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn); ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}

export function DesktopEntriesWidget({ widget, registry }: {widget: DesktopWidgetInstance; registry: DesktopWidgetState}) {
  const en = useLanguage() === 'en';
  const [client] = useState(() => new WidgetEditorClient());
  const editor = useSyncExternalStore(client.subscribe, client.snapshot);
  const [hostError, setHostError] = useState('');
  const [date, setDate] = useState(localDate), [today, setToday] = useState(localDate), [followToday, setFollowToday] = useState(true);
  const [newEntryId, setNewEntryId] = useState<string | null>(null), [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState(''), [picker, setPicker] = useState(false), [recovery, setRecovery] = useState(false);
  const navigating = useRef(false);
  const focusEntryId = useRef<string | null>(null), focusMoveEntryId = useRef<string | null>(null);
  const entriesRef = useRef<HTMLDivElement>(null), scrollRef = useRef<HTMLDivElement>(null), dateButton = useRef<HTMLButtonElement>(null);
  const captureLayout = useListMotion(entriesRef);
  const tags = useTags(), [hiddenTags, setHiddenTags] = useHiddenTags(`widget-${widget.id}`);
  const popupLook = usePopupLook(), settings = loadSettings();
  const nebula = popupLook.startsWith('nebula-');
  const layout = settings.actionLayout === 'swipe' && swipeAvailable() ? 'swipe' : popupLook === 'classic-a' ? 'orbit' : popupLook === 'classic-b' ? 'inline' : 'sheet';
  const day = editor.day;
  const navigate = useLatest(async (target: string, follow: boolean = target === localDate()) => {
    if (navigating.current) return;
    navigating.current = true;
    try {
      await client.flush();
      if (target !== date) { await client.open(target); setDate(target); setNewEntryId(null); setOpenEntryId(null); drag.handlers.cancel(); }
      setFollowToday(follow);
    } catch (reason) { setHostError(String(reason)); }
    finally { navigating.current = false; }
  });
  useViewHistory({ date, followToday }, value => navigate(value.date, value.followToday));
  const close = useLatest(async () => {
    try { await client.flush(); await updateDesktopWidget({ enabled: false }, widget.id); }
    catch (reason) { setHostError(String(reason)); }
  });
  useEffect(() => {
    void Promise.all([client.open(date), ensureWidgetSurface()]).catch(reason => setHostError(String(reason))).finally(() => void invoke('desktop_widget_ready').catch(reason => setHostError(String(reason))));
    const unregister = registerEditorFlush(() => client.flush());
    const stop = listen('desktop-widget:close', () => void close());
    const blur = () => { void client.flush().catch(() => {}); };
    globalThis.addEventListener('blur', blur);
    return () => { unregister(); client.dispose(); void stop.then(unlisten => unlisten()); globalThis.removeEventListener('blur', blur); };
  }, []);
  useEffect(() => manageTags.register(() => { void invoke('desktop_widget_open_settings', { tab: 'tags' }).catch(reason => setHostError(String(reason))); }), []);
  useEffect(() => {
    if (!day || !editor.unsaved || editor.error || editor.paused) return;
    const timer = globalThis.setTimeout(() => { void client.flush().catch(() => {}); }, 700);
    return () => globalThis.clearTimeout(timer);
  }, [day?.title, day?.entries, editor.unsaved]);
  const checkMidnight = useLatest(() => {
    const next = localDate();
    if (next !== today) setToday(next);
    if (followToday && next !== date) void navigate(next, true);
  });
  useEffect(() => { const timer = globalThis.setInterval(checkMidnight, 15000); globalThis.addEventListener('focus', checkMidnight); return () => { globalThis.clearInterval(timer); globalThis.removeEventListener('focus', checkMidnight); }; }, []);
  const shown = (entry: Entry) => entry.showInJournal !== false && (isShown(hiddenTags, entry.tag) || entry.id === newEntryId);
  const visible = day?.entries.filter(shown) ?? [];
  const create = useLatest((kind: EntryKind, afterId?: string, withoutTag = false) => {
    if (!day) return;
    const after = day.entries.find(entry => entry.id === afterId);
    const tag = withoutTag ? null : after ? tagOf(tags, after.tag)?.id ?? null : isShown(hiddenTags, null) ? null : tags.find(tag => !hiddenTags.has(tag.id))?.id ?? null;
    const entry: Entry = { id: crypto.randomUUID(), kind, text: '', done: false, cancelled: false, priority: false, time: null, reminder: false, plan: null, tag };
    focusEntryId.current = entry.id; setNewEntryId(entry.id); setOpenEntryId(null); captureLayout();
    client.submit({ kind: 'create', entry, after: afterId });
  });
  const change = useLatest((id: string, patch: EntryChange) => {
    const entry = day?.entries.find(entry => entry.id === id);
    if (entry) { if ('kind' in patch || 'tag' in patch || 'priority' in patch) captureLayout(); client.submit(changeOperation(entry, patch)); }
  });
  const remove = useLatest((id: string) => { const entry = day?.entries.find(entry => entry.id === id); if (entry) { captureLayout(); client.submit({ kind: 'remove', id, before: entry }); setOpenEntryId(null); } });
  const move = useLatest((id: string, target: string, placement: 'before' | 'after', keepTextFocus = false) => {
    if (!day) return false;
    const source = day.entries.find(entry => entry.id === id), other = day.entries.find(entry => entry.id === target);
    if (!source || !other || !sameGroup(source, other)) return false;
    captureLayout(); focusMoveEntryId.current = keepTextFocus ? null : id; setOpenEntryId(null);
    client.submit({ kind: 'move', id, target, placement }); setAnnouncement(t('{0} verschoben.', entryLabels()[source.kind])); return true;
  });
  const moveOffset = useLatest((id: string, offset: -1 | 1, keepTextFocus = false) => {
    if (!day) return false;
    const reordered = moveEntryByOffset(day.entries, id, offset, shown);
    if (reordered === day.entries) return false;
    const siblings = visible.filter(entry => { const source = day.entries.find(item => item.id === id); return source && sameGroup(source, entry); });
    const target = siblings[siblings.findIndex(entry => entry.id === id) + offset];
    return target ? move(id, target.id, offset < 0 ? 'before' : 'after', keepTextFocus) : false;
  });
  const drag = useEntryDrag(scrollRef, (source, target, placement) => { move(source, target, placement); });
  const changeOpen = useCallback((id: string, open: boolean) => setOpenEntryId(current => open ? id : current === id ? null : current), []);
  const linked = useCallback((others: { id: string; date: string }[], action: Parameters<WidgetEditorClient['linked']>[1]) => { void client.linked(others, action); }, [client]);
  const onKey = useLatest((event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    const kinds: Record<string, EntryKind> = { KeyA: 'task', KeyE: 'event', KeyN: 'note' };
    if (event.altKey && !event.ctrlKey && !event.shiftKey && event.code in kinds) create(kinds[event.code], (event.target as Element).closest<HTMLElement>('[data-entry-id]')?.dataset.entryId);
    else if (event.altKey && !event.ctrlKey && event.key === 'ArrowLeft') void navigate(shiftDate(date, -1), false);
    else if (event.altKey && !event.ctrlKey && event.key === 'ArrowRight') void navigate(shiftDate(date, 1), false);
    else if (event.altKey && !event.ctrlKey && event.code === 'KeyH') void navigate(localDate(), true);
    else if (event.ctrlKey && event.code === 'KeyG') setPicker(open => !open);
    else if (event.ctrlKey && event.code === 'KeyS') void client.flush().catch(() => {});
    else if (event.ctrlKey && event.key === ',') void invoke('desktop_widget_open_settings', {});
    else return;
    event.preventDefault();
  });
  useEffect(() => { globalThis.addEventListener('keydown', onKey); return () => globalThis.removeEventListener('keydown', onKey); }, []);
  const error = editor.conflict ? en ? 'This text changed in another window. Your local draft is retained below.' : 'Dieser Text wurde inzwischen in einem anderen Fenster geändert. Dein lokaler Entwurf bleibt erhalten.' : editor.error || hostError;
  return <DesktopWidgetFrame widget={widget} registry={registry} command={`./entries.sh --day ${date}`} onError={setHostError}
    onOpen={() => void client.flush().then(() => invoke('show_day', { date, entry: null })).catch(reason => setHostError(String(reason)))} onClose={() => void close()}
    footer={<><span>{followToday ? en ? 'Follows today' : 'Folgt dem heutigen Tag' : date.split('-').reverse().join('.')}</span><span role="status">{error ? t('Nicht gespeichert') : editor.saving ? t('Wird gespeichert ?') : editor.pending || editor.unsaved ? t('Wird gleich gespeichert ?') : day ? t('Gespeichert') : t('Wird ge?ffnet ?')}</span></>}>
    <div className="desktop-widget-nav">
      <NavCluster label={t('Tagesnavigation')} prev={{ label: t('Vorheriger Tag'), tip: t('Vorheriger Tag · Alt ←') }} next={{ label: t('Nächster Tag'), tip: t('Nächster Tag · Alt →') }} today={{ tip: t('Heute · Alt H'), disabled: followToday && date === today }} atToday={date === today} onPrev={() => void navigate(shiftDate(date, -1), false)} onToday={() => void navigate(localDate(), true)} onNext={() => void navigate(shiftDate(date, 1), false)} />
      <MiniCalendarPicker date={date} open={picker} onOpenChange={setPicker} onPick={target => void navigate(target)} buttonRef={dateButton} className="widget-date">{formatDate(date)}</MiniCalendarPicker>
      <TagFilter label={t('Tags im Journal')} hidden={hiddenTags} onChange={next => { setNewEntryId(null); setHiddenTags(next); }} />
    </div>
    {editor.paused && <p className="widget-message" role="status">{en ? 'Applying changes. Editing will resume shortly.' : 'Änderungen werden übernommen. Gleich kannst du weiter bearbeiten.'}</p>}
    {error && <div className="widget-message is-error" role="alert"><p>{error}</p>{editor.error && <div className="widget-recovery"><button type="button" onClick={() => setRecovery(open => !open)}>{en ? 'Show local draft' : 'Lokalen Entwurf anzeigen'}</button><button type="button" onClick={() => { setHostError(''); void client.reload().catch(() => {}); }}>{en ? 'Discard draft and reload' : 'Entwurf verwerfen und neu laden'}</button></div>}
      {recovery && <textarea className="widget-draft" readOnly aria-label={en ? 'Local draft (copy before reloading)' : 'Lokaler Entwurf (vor dem Neuladen kopieren)'} value={JSON.stringify(day, null, 2)} onFocus={event => event.target.select()} />}</div>}
    <div className={`desktop-widget-body${nebula ? ' nebula-terminal-body' : ''}`} ref={scrollRef} inert={editor.paused || !!editor.error}>
      {day?.date === date ? <DayEditor day={day} entries={visible} tags={tags} layout={layout} hiddenCount={day.entries.filter(entry => entry.showInJournal !== false && !shown(entry)).length} onShowAll={() => setHiddenTags(new Set())}
        savedTraces={new Set(editor.savedTraces)} newEntryId={newEntryId} openEntryId={openEntryId} focusEntryId={focusEntryId} focusMoveEntryId={focusMoveEntryId} entriesRef={entriesRef} drag={drag} announcement={announcement}
        onTitle={value => client.submit({ kind: 'title', before: day.title, value })} onCreate={create} onNavigate={target => void navigate(target)} onChange={change} onRemove={remove} onLinkedChange={linked} onMoveOffset={moveOffset} onOpenChange={changeOpen} />
        : !error && <p className="loading" role="status">{t('Tagesnotiz wird geöffnet …')}</p>}
    </div>
  </DesktopWidgetFrame>;
}
