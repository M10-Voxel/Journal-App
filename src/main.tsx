// Every window of the app starts here; its label decides what it shows. Only that window's code is loaded (each is
// its own chunk): a desktop widget or the reminder popup does not parse and keep the whole journal.
// The components' own stylesheets, here in the order they had when everything was one bundle: imported by the windows'
// chunks alone they would come after the looks below and win over them (the cascade must stay the same in every window).
import './calendar.css';
import './components/contextMenu.css';
import './components/fieldPickers.css';
import './components/periodNotes.css';
import './components/scaleInput.css';
import './components/bulletinBoard.css';
import './components/notebook.css';
import './components/widgetGlass.css';
import './components/desktopWidgetSettings.css';
import './settings.css';
import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { setLanguage } from './i18n.ts';
import { applyTheme, loadSettings } from './settings';
import { applyColors } from './colors';
import { isDesktopWidgetLabel } from './widgetIdentity';
import { detachable } from './detachedKinds';
import type { DetachedKind } from './detachedKinds';
import { WindowActivity } from './components/WindowActivity';
import { ThemeSync } from './components/ThemeSync';
import { UndoShortcuts } from './components/UndoShortcuts';
import { ContextMenuHost } from './components/ContextMenu';
import { HandDrawnFilters } from './components/HandDrawn';
import { installLookFonts } from './lookFonts';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/lilex/400.css';
import '@fontsource/lilex/400-italic.css';
import '@fontsource/lilex/700.css';
import '@fontsource/lilex/700-italic.css';
import './styles.css';
import './mail.css';
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/500.css';
import '@fontsource/pixelify-sans/600.css';
import '@fontsource/pixelify-sans/700.css';
import '@fontsource/vt323/400.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/400-italic.css';
import '@fontsource/source-serif-4/600.css';
import '@fontsource/source-serif-4/700.css';
import '@fontsource/source-serif-4/700-italic.css';
import '@fontsource/fraunces/500.css';
import '@fontsource/fraunces/600.css';
import '@fontsource/fraunces/400-italic.css';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/400-italic.css';
import '@fontsource/space-mono/700.css';
import '@fontsource/space-mono/700-italic.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/mali/500.css';
import '@fontsource/mali/600.css';
import '@fontsource/mali/700.css';
import './mali-fit.css';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/400-italic.css';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/700-italic.css';
import './pixel-sizes.css';
import './pixel.css';
import './colors.css';
import './tags.css';
import './popups.css';
import './journal-theme.css';
import './nebula-theme.css';
import './nebula-grid.css';
import './nebula-holo.css';
import './nebula-ticket.css';
import './popup-styles.css';
import './entryIcons.css';
import './popup-fields.css';
import './popup-sheets.css';
import './popup-chrome.css';
import './search.css';
import './components/mailDetails.css';
import './components/appNotices.css';
import './components/desktopWidgets.css';
// The journal look last: its stickers lie over the component CSS (ContextMenu, BulletinBoard … are imported above).
import './journal-look.css';
import './journal-desk.css';
import './classic-desk.css';

applyTheme(loadSettings());
applyColors(loadSettings());
setLanguage(loadSettings().language);

// Bold and italic would otherwise load on first use, briefly rendering a fallback of a different width under the caret.
// A single document.fonts.load is not enough: the built page links the stylesheet after this script, and the browser
// rebuilds its font faces when styles are added later (CodeMirror), loading again only faces in use. A hidden line in
// each face keeps all four in use.
const fontWarmup = document.createElement('div');
fontWarmup.className = 'font-warmup';
fontWarmup.setAttribute('aria-hidden', 'true');
fontWarmup.innerHTML = '<span>a</span><i>a</i><b>a</b><b><i>a</i></b>';
document.body.append(fontWarmup);

installLookFonts();

const App = lazy(() => import('./App').then(module => ({ default: module.App })));
const DesktopWidgetWindow = lazy(() => import('./components/DesktopWidgetWindow').then(module => ({ default: module.DesktopWidgetWindow })));
const FloatingNote = lazy(() => import('./components/BulletinBoard').then(module => ({ default: module.FloatingNote })));
const DetachedPanel = lazy(() => import('./components/DetachedPanel').then(module => ({ default: module.DetachedPanel })));
const CalendarWindow = lazy(() => import('./components/CalendarWindow').then(module => ({ default: module.CalendarWindow })));
const MiniCalendar = lazy(() => import('./components/MiniCalendar').then(module => ({ default: module.MiniCalendar })));
const ReminderPopup = lazy(() => import('./components/ReminderToasts').then(module => ({ default: module.ReminderPopup })));
const MailImportToast = lazy(() => import('./components/MailImportToast').then(module => ({ default: module.MailImportToast })));

const windowLabel = getCurrentWindow().label;
if (windowLabel === 'reminder') document.documentElement.classList.add('is-popup');
// A window of Nebula's desk pulled out of the journal draws its own frame on a transparent window.
if (isDesktopWidgetLabel(windowLabel)) document.documentElement.classList.add('is-desktop-widget');
if (windowLabel.startsWith('panel-')) document.documentElement.classList.add('is-panel-window');
const panel = windowLabel.startsWith('panel-') && detachable.includes(windowLabel.slice(6) as DetachedKind) ? windowLabel.slice(6) as DetachedKind : null;
const content = isDesktopWidgetLabel(windowLabel) ? <DesktopWidgetWindow /> : windowLabel.startsWith('board-') ? <FloatingNote /> : panel ? <DetachedPanel kind={panel} />
  : windowLabel === 'calendar' ? <CalendarWindow /> : windowLabel === 'mini' ? <MiniCalendar /> : windowLabel === 'reminder' ? <ReminderPopup /> : <App />;
createRoot(document.getElementById('root')!).render(<><WindowActivity /><ThemeSync /><UndoShortcuts /><ContextMenuHost /><HandDrawnFilters />
  <Suspense fallback={null}>{content}{(windowLabel === 'calendar' || windowLabel.startsWith('panel-')) && <MailImportToast />}</Suspense></>);
