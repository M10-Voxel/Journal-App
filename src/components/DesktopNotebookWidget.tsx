import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { DesktopWidgetInstance, DesktopWidgetState } from '../desktopWidgets';
import { t } from '../i18n';
import { localDate } from '../dates';
import { Notebook } from './Notebook';
import { DesktopWidgetFrame } from './DesktopWidgetFrame';
import { useWidgetHost } from './useWidgetHost';

/**
 * One note of the notebook on the desktop, the quietest widget: the header switches between the notes (arrows, and the
 * title for the list with search) and has a "+" for a new note; below is only the note, its text and attachments.
 * Folders, paper, the day switch, attaching and deleting are in the note's right-click menu; "open in Journal" opens the
 * note in the app's notebook. Notes are saved as they change.
 */
export function DesktopNotebookWidget({ widget, registry }: {widget: DesktopWidgetInstance; registry: DesktopWidgetState}) {
  const [error, setError] = useState('');
  const [nav, setNav] = useState<HTMLDivElement | null>(null), [tools, setTools] = useState<HTMLDivElement | null>(null);
  const close = useWidgetHost({ id: widget.id, flush: async () => {}, onError: setError });
  const [page, setPage] = useState<string | null>(null);
  const open = () => void (page ? invoke('show_note', { id: page }) : invoke('show_day', { date: localDate(), entry: null })).catch(reason => setError(String(reason)));
  return <DesktopWidgetFrame widget={widget} registry={registry} navRef={setNav} toolsRef={setTools} onError={setError} onClose={() => void close()} onOpen={open}>
    {error && <p className="widget-message is-error" role="alert">{t('Notizen')}: {error}</p>}
    <div className="desktop-widget-notebook">
      <Notebook tagScope={`widget-${widget.id}`} widget={{ id: widget.id, nav, tools, onPage: setPage }} />
    </div>
  </DesktopWidgetFrame>;
}
