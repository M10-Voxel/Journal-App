import { useEffect, useId, useState } from 'react';
import type { CSSProperties } from 'react';
import { colorGroups, colorThemes, contrastRatio, isHexColor, resolvePalette } from '../colors';
import type { ColorToken } from '../colors';
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

export function ColorSettings({ settings, onChange }: { settings: Settings; onChange: (next: Settings) => void }) {
  useLanguage();
  const palette = resolvePalette(settings);
  const overrides = settings.customColors[settings.colorTheme] ?? {};
  const customized = Object.keys(overrides).length;
  // The theme's own colours as suggestions: picking one keeps a custom colour in the family.
  const swatches = [...new Set((['accent', 'priority', 'success', 'error', 'cancelled', 'md-red', 'md-orange', 'md-yellow', 'md-green', 'md-cyan', 'md-blue', 'md-purple', 'md-pink', 'text', 'muted', 'surface'] as const).map(token => palette[token].slice(0, 7)))];
  const setColor = (token: ColorToken, value: string | null) => {
    const next = { ...overrides };
    const base = colorThemes.find(theme => theme.id === settings.colorTheme)!.colors;
    if (value === null || value.toLowerCase() === base[token]) delete next[token];
    else next[token] = value;
    onChange({ ...settings, customColors: { ...settings.customColors, [settings.colorTheme]: next } });
  };
  if (settings.theme === 'nebula') return <div className="color-settings is-fixed">
    <h3 id="settings-colors-title">{t('Basis-Farbtheme')}</h3>
    <p className="settings-hint color-fixed-hint" role="note">{t('Nebula hat feste Farben: Schwarz, Papiergrau und Violett. Deine Farbwahl bleibt gespeichert und gilt wieder in Normal und Journal.')}</p>
    <span className="nebula-fixed-swatches" aria-hidden="true"><i /><i /><i /><i /></span>
  </div>;
  return <div className="color-settings">
    <h3 id="settings-colors-title">{t('Basis-Farbtheme')}</h3>
    <p className="settings-hint">{t('Wähle eine Basis und passe einzelne Farben an. Funktioniert mit Klassisch, Pixel und Journal.')}</p>
    <div className="color-theme-options" role="radiogroup" aria-labelledby="settings-colors-title" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? colorThemes.length - 1
        : (colorThemes.findIndex(theme => theme.id === settings.colorTheme) + step + colorThemes.length) % colorThemes.length;
      const colorTheme = colorThemes[index].id;
      onChange({ ...settings, colorTheme });
      event.currentTarget.querySelector<HTMLButtonElement>(`[data-color-theme-choice="${colorTheme}"]`)?.focus();
    }}>
      {colorThemes.map(theme => <button type="button" key={theme.id} role="radio" data-color-theme-choice={theme.id}
        aria-checked={settings.colorTheme === theme.id} tabIndex={settings.colorTheme === theme.id ? 0 : -1}
        onClick={() => onChange({ ...settings, colorTheme: theme.id })}>
        <span className="color-theme-preview" aria-hidden="true" style={{ '--preview-background': theme.colors.background, '--preview-surface': theme.colors.surface, '--preview-text': theme.colors.text, '--preview-accent': theme.colors.accent, '--preview-event': theme.colors['event-background'] } as CSSProperties}>
          <span className="color-preview-sidebar"><i /><i /><i /></span><span className="color-preview-document"><b>Journal</b><i /><i /><em>09:30</em></span>
        </span>
        <strong>{t(theme.name)}</strong><small>{t(theme.description)}</small>
        {Object.keys(settings.customColors[theme.id] ?? {}).length > 0 && <span className="color-custom-label">{t('Angepasst')}</span>}
      </button>)}
    </div>
    <div className="color-live-preview" aria-label={t('Farbvorschau')}>
      <div><strong>{t('Dein Journal')}</strong><span className="color-preview-date">{t('Ein Tag voller Möglichkeiten.')}</span></div>
      <p><i className="color-preview-dot" />{t('Zeit für etwas Gutes')}<span className="color-preview-tag">09:30 – 10:00</span></p>
      <div className="color-preview-markdown">{colorGroups[4].colors.slice(0, 8).map(([token, label]) => <span key={token} style={{ color: `var(--${token})` }}>{t(label)}</span>)}<mark>{t('Markiert')}</mark></div>
    </div>
    {Math.min(contrastRatio(palette.text, palette.background), contrastRatio(palette.text, palette.surface)) < 4.5 && <p className="color-contrast-hint" role="status">{t('Text und Hintergrund haben wenig Kontrast. Eine hellere Textfarbe oder dunklere Fläche verbessert die Lesbarkeit.')}</p>}
    <div className="color-custom-head"><h3>{t('Einzelne Farben')}</h3><button type="button" className="color-reset-all" disabled={!customized}
      onClick={() => { const next = { ...settings.customColors }; delete next[settings.colorTheme]; onChange({ ...settings, customColors: next }); }}><Icon name="undo" />{t('Basis wiederherstellen')}</button></div>
    <p className="settings-hint">{t('Änderungen werden sofort angezeigt und pro Basis gespeichert. Hexwerte unterstützen auch Deckkraft (AA).')}</p>
    {colorGroups.map((group, index) => <details className="color-group" key={group.id} open={index === 0 || group.id === 'markdown'} data-color-group={group.id}>
      <summary><Icon name="right" /><span>{t(group.label)}</span><small>{group.colors.length}</small></summary>
      <div className="color-fields">{group.colors.map(([token, label]) => <ColorField key={`${settings.colorTheme}-${token}`} token={token} label={label} value={palette[token]} customized={overrides[token] !== undefined} swatches={swatches}
        onChange={value => setColor(token, value)} onReset={() => setColor(token, null)} />)}</div>
    </details>)}
    <p className="settings-hint color-markdown-hint">{t('Markdown-Farben gelten auch für vorhandene Texte und das Formatmenü. Der Inhalt deiner Einträge bleibt erhalten.')}</p>
  </div>;
}
