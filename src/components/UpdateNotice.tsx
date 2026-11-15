import { useEffect, useState } from 'react';
import { useLanguage, t } from '../i18n';
import { startupUpdate } from '../startupUpdate';
import type { UpdateNotice as AvailableUpdate } from '../startupUpdate';
import { Icon } from './Icon';

export function UpdateNotice({ onOpen }: { onOpen: () => void }) {
  useLanguage();
  const [available, setAvailable] = useState<AvailableUpdate | null>(null);
  useEffect(() => {
    let mounted = true;
    void startupUpdate().then(update => { if (mounted) setAvailable(update); });
    return () => { mounted = false; };
  }, []);
  if (!available) return null;
  return <aside className="mail-import-toast update-notice" role="status" aria-live="polite" data-update-notice>
    <Icon name="down" />
    <div><strong>{t("Ein Update ist verfügbar")}</strong>
      <p>{t("Version {0} steht zum Herunterladen bereit.", available.version)}</p>
      <button type="button" className="notice-action" onClick={() => { setAvailable(null); onOpen(); }}>{t("Update herunterladen…")}</button>
    </div>
    <button type="button" aria-label={t("Hinweis schließen")} onClick={() => setAvailable(null)}><Icon name="done" /></button>
  </aside>;
}
