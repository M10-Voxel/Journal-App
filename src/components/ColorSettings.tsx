import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { colorGroups, colorOverrides, colorThemeBase, colorThemes, contrastRatio, createCustomTheme, discardColorDraft, isCustomColorTheme, isHexColor, paletteOf, removeCustomTheme, renameCustomTheme, resolvePalette, saveColorDraft, savedColors } from '../colors';
import type { ColorToken, Palette } from '../colors';
import { paletteFixed } from '../settings';
import type { Settings } from '../settings';
import { t, useLanguage } from '../i18n';
import { Icon } from './Icon';
import { ColorButton } from './ColorPicker';

function ColorField({ token, label, value, customized, swatches, onChange, onReset }: {
  token: ColorToken; label: string; value: string; customized: boolean; swatches: string[]; onChange: (value: string) => void; onReset: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const invalid = !isHexColor(draft);
  return <div className={`color-field${customized ? ' is-customized' : ''}`} data-color-field={token}>
    <label htmlFor={id}>{t(label)}{customized && <span className="color-changed" title={t('Angepasst')} aria-label={t('Angepasst')} />}</label>
    <div className="color-field-controls">
      <ColorButton value={value} label={t(label)} alpha={value.length === 9 || ['edge', 'line', 'md-highlight-background'].includes(token)} swatches={swatches} onChange={onChange} />
      <input id={id} className="color-hex" type="text" value={draft} spellCheck={false} autoComplete="off" maxLength={9}
        aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={event => { const next = event.target.value; setDraft(next); if (isHexColor(next)) onChange(next.toLowerCase()); }}
        onBlur={() => { if (invalid) setDraft(value); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} />
      <button type="button" className="color-reset" disabled={!customized} title={t('{0} zurücksetzen', t(label))} aria-label={t('{0} zurücksetzen', t(label))} onClick={onReset}><Icon name="undo" /></button>
    </div>
    {invalid && <small id={`${id}-error`} className="color-input-error">{t('Hex: #RRGGBB oder #RRGGBBAA')}</small>}
    {['edge', 'line', 'md-highlight-background'].includes(token) && <label className="color-opacity">
      <span>{t('Deckkraft')}</span><input type="range" min="0" max="255" value={value.length === 9 ? parseInt(value.slice(7), 16) : 255}
        aria-label={t('{0}: Deckkraft', t(label))} onChange={event => onChange(value.slice(0, 7) + Number(event.target.value).toString(16).padStart(2, '0'))} />
      <output>{Math.round((value.length === 9 ? parseInt(value.slice(7), 16) : 255) / 255 * 100)}%</output>
    </label>}
  </div>;
}

/**
 * A palette's card picture in the colours it really shows: its paper and panels, text, accent and an event – and in the
 * journal look the three sticker colours (tabs, buttons, blots) on the panel.
 */
function ThemePreview({ palette, look }: { palette: Palette; look: Settings['look'] }) {
  return <span className={`color-theme-preview${look === 'journal' ? ' is-journal' : ''}`} aria-hidden="true" style={{ '--preview-background': palette.background, '--preview-surface': palette.surface,
    '--preview-text': palette.text, '--preview-strong': palette.strong, '--preview-accent': palette.accent, '--preview-event': palette['event-background'], '--preview-event-text': palette['event-text'],
    '--preview-violet': palette.violet, '--preview-pink': palette.pink, '--preview-mint': palette.mint, '--preview-line': palette['sticker-line'], '--preview-edge': palette['sticker-edge'] } as CSSProperties}>
    <span className="color-preview-sidebar"><i /><i /><i /></span>
    <span className="color-preview-document"><b>Journal</b><i /><i /><em>09:30</em></span>
    {look === 'journal' && <span className="color-preview-stickers"><i /><i /><i /></span>}
  </span>;
}

/** Naming a new palette and choosing what it starts from: the colours on screen (with unsaved changes) or any palette. */
function NewThemeForm({ settings, withDraft, onCreate, onCancel }: { settings: Settings; withDraft: boolean; onCreate: (name: string, from: string, draft: boolean) => void; onCancel: () => void }) {
  const nameId = useId(), fromId = useId();
  const current = themeName(settings, settings.colorTheme);
  const [name, setName] = useState(withDraft ? t('{0} (eigene)', current) : t('Mein Farbschema'));
  const [from, setFrom] = useState(withDraft ? 'draft' : settings.colorTheme);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const submit = () => { if (name.trim()) onCreate(name, from === 'draft' ? settings.colorTheme : from, from === 'draft'); };
  return <form className="color-new-form" onSubmit={event => { event.preventDefault(); submit(); }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); } }}>
    <label htmlFor={nameId}>{t('Name')}</label>
    <input ref={input} id={nameId} className="color-new-name" type="text" value={name} maxLength={40} onChange={event => setName(event.target.value)} />
    <label htmlFor={fromId}>{t('Ausgangspunkt')}</label>
    <select id={fromId} className="color-new-from" value={from} onChange={event => setFrom(event.target.value)}>
      {withDraft && <option value="draft">{t('Aktuelle Farben mit Änderungen')}</option>}
      {allThemes(settings).map(id => <option key={id} value={id}>{themeName(settings, id)}</option>)}
    </select>
    <div className="color-new-actions">
      <button type="button" className="color-bar-button" onClick={onCancel}>{t('Abbrechen')}</button>
      <button type="submit" className="color-bar-button is-primary" disabled={!name.trim()}>{t('Erstellen')}</button>
    </div>
  </form>;
}

const allThemes = (settings: Settings) => [...colorThemes.map(theme => theme.id as string), ...(settings.customThemes ?? []).map(theme => theme.id)];
const themeName = (settings: Settings, id: string) => isCustomColorTheme(id) ? settings.customThemes?.find(theme => theme.id === id)?.name ?? '' : t(colorThemes.find(theme => theme.id === id)!.name);

export function ColorSettings({ settings, onChange }: { settings: Settings; onChange: (next: Settings) => void }) {
  useLanguage();
  const [creating, setCreating] = useState<null | 'new' | 'draft'>(null);
  const [removing, setRemoving] = useState(false);
  const selected = settings.colorTheme, custom = isCustomColorTheme(selected);
  const palette = resolvePalette(settings);
  const base = colorThemeBase(settings);
  const saved = savedColors(settings), draft = settings.colorDrafts?.[selected] ?? {};
  const changes = Object.keys(draft).length;
  useEffect(() => setRemoving(false), [selected]);
  // The theme's own colours as suggestions: picking one keeps a custom colour in the family.
  const swatches = [...new Set((['accent', 'priority', 'success', 'error', 'cancelled', 'md-red', 'md-orange', 'md-yellow', 'md-green', 'md-cyan', 'md-blue', 'md-purple', 'md-pink', 'text', 'muted', 'surface'] as const).map(token => palette[token].slice(0, 7)))];
  // A colour changed goes into the unsaved changes; set back to what the palette has saved, it leaves them again. Reset
  // gives the colour the base would have without any change of its own.
  const merged = colorOverrides(settings);
  const reference = (token: ColorToken) => { const others = { ...merged }; delete others[token]; return paletteOf(base, others)[token]; };
  const setColor = (token: ColorToken, value: string | null) => {
    const target = value ?? reference(token);
    const savedValue = paletteOf(base, saved)[token];
    const next = { ...draft };
    if (target.toLowerCase() === savedValue) delete next[token]; else next[token] = target.toLowerCase();
    const colorDrafts = { ...settings.colorDrafts };
    if (Object.keys(next).length) colorDrafts[selected] = next; else delete colorDrafts[selected];
    onChange({ ...settings, colorDrafts });
  };
  const changed = (token: ColorToken) => merged[token] !== undefined && merged[token] !== reference(token);
  const choose = (id: string) => { setCreating(null); onChange({ ...settings, colorTheme: id }); };
  const themes = allThemes(settings);

  if (paletteFixed(settings)) return <div className="color-settings is-fixed">
    <h3 id="settings-colors-title">{t('Basis-Farbtheme')}</h3>
    <p className="settings-hint color-fixed-hint" role="note">{t('Nebula hat feste Farben: Schwarz, Papiergrau und Violett. Deine Farbwahl bleibt gespeichert und gilt wieder in Normal und Journal.')}</p>
    <span className="nebula-fixed-swatches" aria-hidden="true"><i /><i /><i /><i /></span>
  </div>;
  return <div className="color-settings">
    {/* Unsaved changes: saved into this palette, made a palette of their own, or thrown away. */}
    {changes > 0 && <div className="color-draft-bar" role="region" aria-label={t('Ungespeicherte Farbänderungen')}>
      <div className="color-draft-text"><strong>{t('Ungespeicherte Änderungen')}</strong><span>{t('{0} · {1} Farben geändert', themeName(settings, selected), String(changes))}</span></div>
      <div className="color-draft-actions">
        <button type="button" className="color-bar-button" data-color-draft="discard" onClick={() => { setCreating(null); onChange(discardColorDraft(settings)); }}>{t('Verwerfen')}</button>
        <button type="button" className="color-bar-button" data-color-draft="new" aria-expanded={creating === 'draft'} onClick={() => setCreating(creating === 'draft' ? null : 'draft')}>{t('Als neues Farbschema …')}</button>
        <button type="button" className="color-bar-button is-primary" data-color-draft="save" onClick={() => { setCreating(null); onChange(saveColorDraft(settings)); }}><Icon name="save" />{t('Speichern')}</button>
      </div>
      {creating === 'draft' && <NewThemeForm key="draft" settings={settings} withDraft onCancel={() => setCreating(null)}
        onCreate={(name, from, withDraft) => { setCreating(null); onChange(createCustomTheme(settings, name, from, withDraft)); }} />}
    </div>}
    <h3 id="settings-colors-title">{t('Basis-Farbtheme')}</h3>
    <p className="settings-hint">{t('Wähle eine Basis oder ein eigenes Farbschema und passe einzelne Farben an. Funktioniert mit Klassisch, Pixel und Journal.')}</p>
    <div className="color-theme-options" role="radiogroup" aria-labelledby="settings-colors-title" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || !(event.target as Element).matches('[role=radio]')) return;
      event.preventDefault();
      const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? themes.length - 1 : (themes.indexOf(selected) + step + themes.length) % themes.length;
      choose(themes[index]);
      event.currentTarget.querySelector<HTMLButtonElement>(`[data-color-theme-choice="${themes[index]}"]`)?.focus();
    }}>
      {themes.map(id => {
        const builtIn = colorThemes.find(theme => theme.id === id);
        const adjusted = Object.keys(builtIn ? settings.customColors[builtIn.id] ?? {} : {}).length > 0, unsaved = Object.keys(settings.colorDrafts?.[id] ?? {}).length > 0;
        return <button type="button" key={id} role="radio" data-color-theme-choice={id} className={builtIn ? undefined : 'is-custom'}
          aria-checked={selected === id} tabIndex={selected === id ? 0 : -1} onClick={() => choose(id)}>
          <ThemePreview palette={resolvePalette(settings, id)} look={settings.look} />
          <strong>{themeName(settings, id)}</strong>
          <small>{builtIn ? t(builtIn.description) : t('Eigenes Farbschema · Basis: {0}', t(colorThemes.find(theme => theme.id === colorThemeBase(settings, id))!.name))}</small>
          {(adjusted || unsaved) && <span className="color-custom-label">{unsaved ? t('Ungespeichert') : t('Angepasst')}</span>}
        </button>;
      })}
      <button type="button" className="color-theme-new" data-color-theme-new aria-expanded={creating === 'new'} onClick={() => setCreating(creating === 'new' ? null : 'new')}>
        <span className="color-theme-new-mark" aria-hidden="true">+</span><strong>{t('Neues Farbschema')}</strong><small>{t('Aus einem vorhandenen Farbschema, mit eigenem Namen.')}</small>
      </button>
    </div>
    {creating === 'new' && <div className="color-new-panel"><NewThemeForm key="new" settings={settings} withDraft={false} onCancel={() => setCreating(null)}
      onCreate={(name, from) => { setCreating(null); onChange(createCustomTheme(settings, name, from)); }} /></div>}
    <div className="color-live-preview" aria-label={t('Farbvorschau')}>
      <div><strong>{t('Dein Journal')}</strong><span className="color-preview-date">{t('Ein Tag voller Möglichkeiten.')}</span></div>
      <p><i className="color-preview-dot" />{t('Zeit für etwas Gutes')}<span className="color-preview-tag">09:30 – 10:00</span></p>
      <div className="color-preview-markdown">{colorGroups[4].colors.slice(0, 8).map(([token, label]) => <span key={token} style={{ color: `var(--${token})` }}>{t(label)}</span>)}<mark>{t('Markiert')}</mark></div>
    </div>
    {Math.min(contrastRatio(palette.text, palette.background), contrastRatio(palette.text, palette.surface)) < 4.5 && <p className="color-contrast-hint" role="status">{t('Text und Hintergrund haben wenig Kontrast. Eine hellere Textfarbe oder dunklere Fläche verbessert die Lesbarkeit.')}</p>}
    <div className="color-custom-head">
      {custom ? <label className="color-theme-rename"><span>{t('Name')}</span>
        <input key={selected} type="text" defaultValue={themeName(settings, selected)} maxLength={40} aria-label={t('Name des Farbschemas')}
          onBlur={event => { if (event.target.value.trim() && event.target.value.trim() !== themeName(settings, selected)) onChange(renameCustomTheme(settings, selected, event.target.value)); else event.target.value = themeName(settings, selected); }}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} /></label>
        : <h3>{t('Einzelne Farben')}</h3>}
      {custom ? <button type="button" className={`color-reset-all${removing ? ' is-confirm' : ''}`} data-color-theme-remove onClick={() => removing ? onChange(removeCustomTheme(settings, selected)) : setRemoving(true)}
        onBlur={() => setRemoving(false)}><Icon name="trash" />{removing ? t('Wirklich löschen?') : t('Farbschema löschen')}</button>
        : <button type="button" className="color-reset-all" disabled={!Object.keys(saved).length && !changes}
          onClick={() => { const customColors = { ...settings.customColors }; delete customColors[base]; onChange(discardColorDraft({ ...settings, customColors })); }}><Icon name="undo" />{t('Basis wiederherstellen')}</button>}
    </div>
    <p className="settings-hint">{t('Änderungen werden sofort angezeigt; oben speicherst du sie in diesem Farbschema oder als neues. Hexwerte unterstützen auch Deckkraft (AA).')}</p>
    {colorGroups.map((group, index) => <details className="color-group" key={group.id} open={index === 0 || group.id === 'markdown'} data-color-group={group.id}>
      <summary><Icon name="right" /><span>{t(group.label)}</span><small>{group.colors.length}</small></summary>
      <div className="color-fields">{group.colors.map(([token, label]) => <ColorField key={`${selected}-${token}`} token={token} label={label} value={palette[token]} customized={changed(token)} swatches={swatches}
        onChange={value => setColor(token, value)} onReset={() => setColor(token, null)} />)}</div>
    </details>)}
    <p className="settings-hint color-markdown-hint">{t('Markdown-Farben gelten auch für vorhandene Texte und das Formatmenü. Der Inhalt deiner Einträge bleibt erhalten.')}</p>
  </div>;
}
