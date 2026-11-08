import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n';
import { startupUpdate } from '../startupUpdate';
import type { UpdateNotice as AvailableUpdate } from '../startupUpdate';
import { Icon } from './Icon';

export function UpdateNotice({ onOpen }: { onOpen: () => void }) {
  const en = useLanguage() === 'en';
  const [available, setAvailable] = useState<AvailableUpdate | null>(null);
  useEffect(() => {
    let mounted = true;
    void startupUpdate().then(update => { if (mounted) setAvailable(update); });
    return () => { mounted = false; };
  }, []);
  if (!available) return null;
  return <aside className="mail-import-toast update-notice" role="status" aria-live="polite" data-update-notice>
    <Icon name="down" />
    <div><strong>{en ? 'An update is available' : 'Ein Update ist verfügbar'}</strong>
      <p>{en ? `Version ${available.version} is ready to download.` : `Version ${available.version} steht zum Herunterladen bereit.`}</p>
      <button type="button" className="notice-action" onClick={() => { setAvailable(null); onOpen(); }}>{en ? 'Download update…' : 'Update herunterladen…'}</button>
    </div>
    <button type="button" aria-label={en ? 'Dismiss notification' : 'Hinweis schließen'} onClick={() => setAvailable(null)}><Icon name="done" /></button>
  </aside>;
}
