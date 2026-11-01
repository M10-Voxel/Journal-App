import { t, useLanguage, locale } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { CalendarImport } from '../journal';
import { formatDate } from '../dates';
import { latestMailCandidates, mailProviders, newMailAccount } from '../mail';
import type { MailAccount, MailCandidate } from '../mail';
import { mailApi } from '../mailApi';
import { Icon } from './Icon';
import { MailModelSetup } from './MailModelSetup';

export function MailSettings({ onImport, importError }: { onImport: (entries: CalendarImport[]) => Promise<void>; importError: string }) {
  useLanguage();
  const [accounts, setAccounts] = useState<MailAccount[]>([]), [candidates, setCandidates] = useState<MailCandidate[]>([]), [notices, setNotices] = useState<string[]>([]);
  const [adding, setAdding] = useState(false), [draft, setDraft] = useState<MailAccount | null>(null), [password, setPassword] = useState(''), [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [editing, setEditing] = useState<MailCandidate | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const previousView = useRef<string | null>(null);
  const mounted = useRef(true), authorizing = useRef(false);
  useEffect(() => {
    const view = draft?.id ?? (adding ? 'providers' : 'accounts');
    const changed = previousView.current !== null && previousView.current !== view;
    previousView.current = view;
    if (!changed) return;
    const frame = requestAnimationFrame(() => {
      const root = sectionRef.current;
      (root?.querySelector<HTMLElement>('.mail-form input:not(:disabled)') ?? root?.querySelector<HTMLElement>('button:not(:disabled)'))?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [draft?.id, adding]);
  const reload = async () => {
    const [accounts, candidates, notices] = await Promise.all([mailApi.accounts(), mailApi.candidates(), mailApi.notices()]);
    if (mounted.current) { setAccounts(accounts ?? []); setCandidates(candidates ?? []); setNotices(notices ?? []); }
  };
  useEffect(() => {
    mounted.current = true;
    void reload().catch(reason => { if (mounted.current) setError(String(reason)); });
    const stop = listen('mail:changed', () => { void reload().catch(reason => { if (mounted.current) setError(String(reason)); }); });
    return () => { mounted.current = false; if (authorizing.current) void mailApi.cancel(); void stop.then(fn => fn()); };
  }, []);
  const run = async (name: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(name); setError(''); setMessage('');
    try { await action(); await reload(); } catch (reason) { if (mounted.current) setError(String(reason)); }
    finally {
      authorizing.current = false;
      if (mounted.current) {
        setBusy('');
        // Connecting or accepting removes its focused button. Keep Escape and the next Tab inside Settings.
        requestAnimationFrame(() => { if (mounted.current && document.activeElement === document.body) sectionRef.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true }); });
      }
    }
  };
  const open = (account: MailAccount) => { setDraft({ ...account }); setPassword(''); setClientSecret(''); setError(''); setMessage(''); setAdding(false); };
  const patch = (change: Partial<MailAccount>) => setDraft(current => current && { ...current, ...change });
  const preset = mailProviders().find(item => item.id === draft?.provider);
  const oauth = draft?.protocol === 'gmail' || draft?.protocol === 'microsoft';
  const saved = accounts.some(account => account.id === draft?.id);
  const changeProtocol = (protocol: MailAccount['protocol']) => {
    patch({ protocol, host: protocol === 'pop3' ? preset?.pop || draft?.host || '' : preset?.host || draft?.host || '', port: protocol === 'pop3' ? 995 : draft?.provider === 'proton' ? 1143 : 993,
      security: draft?.provider === 'proton' ? 'bridge' : 'tls' });
  };
  const accept = async (item: MailCandidate) => {
    if (!item.entry.text.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) throw new Error(t("Bitte Titel und Datum prüfen."));
    if (item.entry.time && item.entry.end && item.entry.end <= item.entry.time) throw new Error(t("Das Ende muss nach dem Beginn liegen."));
    await onImport([{ date: item.date, entry: { ...item.entry, text: item.entry.text.trim(), end: item.entry.time ? item.entry.end : null } }]);
    await mailApi.resolve(candidates.filter(candidate => candidate.entry.calendarUid === item.entry.calendarUid).map(candidate => candidate.id), true);
    setEditing(null); setMessage(t("Termin im Kalender übernommen."));
  };
  const suggestions = latestMailCandidates(candidates);
  return <section className="mail-settings" aria-label={t("E-Mail-Konten")} ref={sectionRef}>
    <MailModelSetup />
    <p className="mail-intro">{t("Verbinde deine Postfächer und übernimm Lieferungen und Termine in den Kalender. Der Abruf läuft alle fünf Minuten, solange Journal auch im Hintergrund geöffnet ist.")}</p>
    {!draft && !adding && <>
      <div className="mail-section-head"><h3>{t("Verbundene Konten")}</h3><button type="button" className="mail-button is-primary" onClick={() => { setAdding(true); setError(''); }}>{t("Konto hinzufügen")}</button></div>
      {!accounts.length && <p className="mail-empty">{t("Noch kein Konto verbunden.")}</p>}
      <div className="mail-accounts">{accounts.map(account => <article className="mail-account" key={account.id}>
        <div className="mail-account-summary"><span className={`mail-dot${account.error ? ' is-error' : account.enabled ? ' is-on' : ''}`} /><div><strong>{account.label}</strong><span>{account.email} · {{ gmail: 'Google', microsoft: 'Microsoft', imap: 'IMAP', pop3: 'POP3' }[account.protocol]}</span></div></div>
        <p>{!account.enabled ? t("Abruf pausiert") : account.lastSync ? t("Zuletzt abgerufen: {0}", new Date(account.lastSync * 1000).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' })) : t("Bereit für den ersten Abruf")}</p>
        {account.error && <p className="mail-error">{account.error}</p>}
        <div className="mail-actions"><button type="button" className="mail-button" disabled={Boolean(busy)} onClick={() => void run(account.id, async () => { await mailApi.sync(account.id); setMessage(t("Postfach abgerufen. Termine werden ausgewertet.")); })}><Icon name="repeat" />{t("Abrufen")}</button>
          <button type="button" className="mail-button" disabled={Boolean(busy)} onClick={() => open(account)}>{t("Bearbeiten")}</button>
          <button type="button" className="mail-button" disabled={Boolean(busy)} onClick={() => void run(account.id, () => mailApi.enabled(account.id, !account.enabled))}>{account.enabled ? t("Pausieren") : t("Aktivieren")}</button>
          <button type="button" className="mail-button is-danger" disabled={Boolean(busy)} aria-label={t("{0} entfernen", account.label)} onClick={() => { if (window.confirm(t("Kontoverbindung, Zugangsdaten und offene Mailvorschläge entfernen? Bereits übernommene Kalendereinträge bleiben erhalten."))) void run(account.id, () => mailApi.remove(account.id)); }}><Icon name="trash" /></button></div>
      </article>)}</div>
    </>}
    {adding && !draft && <>
      <div className="mail-section-head"><h3>{t("Anbieter auswählen")}</h3><button type="button" className="mail-button" onClick={() => setAdding(false)}>{t("Zurück")}</button></div>
      <div className="mail-providers">{mailProviders().map(provider => <button type="button" className={`mail-provider mail-provider-${provider.id}`} key={provider.id} onClick={() => open(newMailAccount(provider.id))}>
        <span className="mail-provider-mark" aria-hidden="true">{provider.id === 'custom' ? '@' : provider.name[0]}</span><span><strong>{provider.name}</strong><small>{provider.caption}</small></span><Icon name="right" />
      </button>)}</div>
    </>}
    {draft && <form className="mail-form" onSubmit={event => {
      event.preventDefault();
      void run('connect', async () => {
        authorizing.current = Boolean(oauth);
        const value = await mailApi.save(draft, password, clientSecret, Boolean(oauth && !saved));
        if (mounted.current) { setDraft(null); setPassword(''); setClientSecret(''); setMessage(t("Konto verbunden. Der erste Abruf startet jetzt.")); }
        await mailApi.sync(value.id);
      });
    }}>
      <div className="mail-section-head"><h3>{saved ? t("Konto bearbeiten") : t("{0} verbinden", preset?.name ?? t("Konto"))}</h3><button type="button" className="mail-button" disabled={Boolean(busy)} onClick={() => { setDraft(null); setAdding(!saved); setPassword(''); setClientSecret(''); }}>{t("Zurück")}</button></div>
      <p className="mail-provider-help">{preset?.help}{preset?.url && <> <button className="mail-link" type="button" onClick={() => void run('help', () => mailApi.help(preset.id))}>{t("Anbieterhilfe öffnen")}</button></>}</p>
      <fieldset disabled={Boolean(busy)}>
        <div className="mail-fields"><label>{t("E-Mail-Adresse")}<input type="email" required autoComplete="username" value={draft.email} onChange={event => patch({ email: event.target.value })} /></label>
          <label>{t("Kontoname")}<input maxLength={120} placeholder={t("z. B. Privat")} value={draft.label} onChange={event => patch({ label: event.target.value })} /></label></div>
        <label>{t("Verbindung")}<select value={draft.protocol} onChange={event => changeProtocol(event.target.value as MailAccount['protocol'])}>
          {draft.provider === 'gmail' && <option value="gmail">{t("Google · Browseranmeldung")}</option>}{draft.provider === 'microsoft' && <option value="microsoft">{t("Microsoft · Browseranmeldung")}</option>}
          <option value="imap">IMAP</option>{draft.provider !== 'icloud' && draft.provider !== 'proton' && <option value="pop3">POP3</option>}
        </select></label>
        {oauth ? <details className="mail-oauth" open={!saved || undefined}>
          <summary>{t("Anmeldung konfigurieren")}</summary>
          <p>{t("Dieser Build benötigt eine OAuth-App-Registrierung beim Anbieter. Die Client-ID identifiziert Journal und wird lokal gespeichert.")}</p>
          <label>OAuth-Client-ID<input required value={draft.clientId} autoComplete="off" onChange={event => patch({ clientId: event.target.value })} /></label>
          {draft.protocol === 'gmail' ? <>
            <p>{t("In Google Cloud die Gmail API aktivieren, den Zugriff konfigurieren und einen OAuth-Client vom Typ „Desktop-App“ erstellen. Berechtigung: ")}<code>gmail.readonly</code>{t(". Im Testbetrieb das eigene Konto als Testnutzer eintragen; dort kann eine erneute Anmeldung nach sieben Tagen nötig sein.")}</p>
            <label>{t("Client-Secret, falls vom Google-Client benötigt")}<input type="password" autoComplete="new-password" value={clientSecret} placeholder={saved ? t("Gespeicherten Wert beibehalten") : ''} onChange={event => setClientSecret(event.target.value)} /></label>
          </> : <>
            <p>{t("In Microsoft Entra eine öffentliche Desktop-App registrieren, den gewünschten Kontotyp erlauben und die Umleitungsadresse ")}<code>http://localhost:42813/</code>{t(" hinzufügen. Delegierte Berechtigungen: ")}<code>User.Read</code>, <code>Mail.Read</code>{t(" und ")}<code>offline_access</code>{t(". Ein Client-Secret wird nicht verwendet.")}</p>
            <label>{t("Verzeichnis / Mandant")}<input value={draft.tenant} placeholder="common" onChange={event => patch({ tenant: event.target.value })} /></label>
          </>}
        </details> : <>
          <div className="mail-server"><label>{t("Posteingangsserver")}<input required autoComplete="off" value={draft.host} onChange={event => patch({ host: event.target.value })} /></label><label>Port<input required type="number" min={1} max={65535} value={draft.port} onChange={event => patch({ port: Number(event.target.value) })} /></label></div>
          <label>{t("Verschlüsselung")}<select value={draft.security} onChange={event => { const security = event.target.value as MailAccount['security']; patch({ security, port: draft.protocol === 'pop3' ? security === 'tls' ? 995 : 110 : security === 'tls' ? 993 : security === 'bridge' ? 1143 : 143 }); }}><option value="tls">SSL/TLS</option><option value="starttls">STARTTLS</option>{draft.provider === 'proton' && draft.protocol === 'imap' && <option value="bridge">{t("Proton Bridge · lokales STARTTLS")}</option>}</select></label>
          <label>{t("Benutzername")}<input value={draft.username} placeholder={draft.provider === 'proton' ? t("Aus Proton Bridge übernehmen") : t("E-Mail-Adresse, falls leer")} autoComplete="username" onChange={event => patch({ username: event.target.value })} /></label>
          <label>{draft.provider === 'proton' ? 'Bridge-Passwort' : t("Passwort / App-Passwort")}<input type="password" required={!saved} autoComplete="new-password" value={password} placeholder={saved ? t("Leer lassen, um gespeichertes Passwort zu behalten") : ''} onChange={event => setPassword(event.target.value)} /></label>
          {draft.protocol === 'imap' && <label>{t("Ordner")}<input required value={draft.folder} onChange={event => patch({ folder: event.target.value })} /></label>}
          {draft.protocol === 'pop3' && <p>{t("POP3 hat keine Ordnerauswahl. Pro Abruf werden bis zu 50 neue Nachrichten unter den letzten 500 Postfachnachrichten geprüft.")}</p>}
        </>}
        <details className="mail-filter"><summary>{t("Abruf und Terminerkennung")}</summary>
          <label>{t("Absender, optional")}<input value={draft.senders} placeholder="mail@anbieter.de, @versanddienst.de" onChange={event => patch({ senders: event.target.value })} /></label>
          <label>{t("Betreff enthält, optional")}<input value={draft.subjectFilter} placeholder={t("z. B. Lieferung")} onChange={event => patch({ subjectFilter: event.target.value })} /></label>
          <label>{t("Zeitraum in Tagen")}<input type="number" min={1} max={90} required value={draft.days} onChange={event => patch({ days: Number(event.target.value) })} /></label>
          <label className="mail-check"><input type="checkbox" checked={draft.enabled} onChange={event => patch({ enabled: event.target.checked })} />{t("Regelmäßig abrufen")}</label>
          <p>{t("Erkannte Termine und Aktualisierungen werden automatisch in den Kalender eingetragen. Ein Hinweis unten bestätigt die Übernahme. Die Auswertung läuft lokal.")}</p>
        </details>
      </fieldset>
      <p className="mail-storage">{t("Zugangsdaten werden mit dem Windows-Benutzerschutz verschlüsselt gespeichert. Mails werden weder gelöscht noch als gelesen markiert.")}</p>
      <div className="mail-actions"><button type="submit" className="mail-button is-primary" disabled={Boolean(busy)}>{oauth ? saved ? t("Anmeldung prüfen und speichern") : t("Mit {0} anmelden", draft.protocol === 'gmail' ? 'Google' : 'Microsoft') : t("Verbinden und speichern")}</button>
        {oauth && saved && <button type="button" className="mail-button" disabled={Boolean(busy)} onClick={() => void run('connect', async () => { authorizing.current = true; await mailApi.save(draft, password, clientSecret, true); setDraft(null); setPassword(''); setClientSecret(''); setMessage(t("Anmeldung erneuert.")); })}>{t("Erneut anmelden")}</button>}
        {busy === 'connect' && oauth && <button type="button" className="mail-button" onClick={() => void mailApi.cancel()}>{t("Anmeldung abbrechen")}</button>}</div>
    </form>}
    {!draft && !adding && <>
      <div className="mail-section-head"><h3>{t("Ausstehende Übernahmen ")}<span>{suggestions.length}</span></h3></div>
      {!suggestions.length && <p className="mail-empty">{t("Erkannte Termine werden automatisch im Kalender gespeichert. Falls eine Übernahme fehlschlägt, kannst du den Eintrag hier prüfen und erneut übernehmen.")}</p>}
      <div className="mail-suggestions">{suggestions.map(item => <article className="mail-suggestion" key={item.id}>
        <div><strong>{item.entry.text}</strong><p className="mail-when">{formatDate(item.date)}{item.entry.time ? ` · ${item.entry.time}${item.entry.end ? `–${item.entry.end}` : ''}` : t(" · ganztägig")}</p></div>
        <p className="mail-source">{accounts.find(a => a.id === item.accountId)?.label} · {item.sender}</p><blockquote>{item.evidence}</blockquote>
        {editing?.id === item.id && <div className="mail-proposal-edit">
          <label>{t("Titel")}<input value={editing.entry.text} onChange={event => setEditing({ ...editing, entry: { ...editing.entry, text: event.target.value } })} /></label>
          <div className="mail-fields"><label>{t("Datum")}<input type="date" value={editing.date} onChange={event => setEditing({ ...editing, date: event.target.value })} /></label><label>{t("Beginn")}<input type="time" value={editing.entry.time ?? ''} onChange={event => setEditing({ ...editing, entry: { ...editing.entry, time: event.target.value || null } })} /></label><label>{t("Ende")}<input type="time" value={editing.entry.end ?? ''} onChange={event => setEditing({ ...editing, entry: { ...editing.entry, end: event.target.value || null } })} /></label></div>
        </div>}
        <div className="mail-actions"><button type="button" className="mail-button is-primary" disabled={Boolean(busy)} onClick={() => void run(item.id, () => accept(editing?.id === item.id ? editing : item))}><Icon name="check" />{t("Übernehmen")}</button>
          <button type="button" className="mail-button" disabled={Boolean(busy)} onClick={() => setEditing(editing?.id === item.id ? null : { ...item, entry: { ...item.entry } })}>{editing?.id === item.id ? t("Bearbeitung schließen") : t("Bearbeiten")}</button>
          <button type="button" className="mail-button" disabled={Boolean(busy)} onClick={() => void run(item.id, () => mailApi.resolve(candidates.filter(candidate => candidate.entry.calendarUid === item.entry.calendarUid).map(candidate => candidate.id), false))}>{t("Ignorieren")}</button></div>
      </article>)}</div>
      {suggestions.length > 0 && <p className="mail-storage">{t("Ein bereits vorhandener Eintrag mit derselben Kalenderkennung wird beim Übernehmen aktualisiert.")}</p>}
      {notices.length > 0 && <details className="mail-notices"><summary>{t("Hinweise zur Auswertung")}</summary>{[...new Set(notices)].map((notice, index) => <p key={index}>{notice}</p>)}</details>}
    </>}
    {busy && <p className="mail-progress" role="status">{busy === 'connect' ? oauth ? t("Bitte die Anmeldung im Browser abschließen …") : t("Verbindung wird geprüft …") : t("Wird verarbeitet …")}</p>}
    {message && <p className="mail-success" role="status">{message}</p>}
    {(error || importError) && <p className="mail-error" role="alert">{error || importError}</p>}
  </section>;
}
