import { useEffect } from 'react';

/**
 * Pause visual work (CSS animations, see styles.css) when the window is hidden or another app has the focus.
 *
 * A window that opens without the focus (from the tray icon, behind other windows, or simply before the first click)
 * is not idle: its entrance animations start from invisible (the entries' editor fades in), and paused at their first
 * frame they would leave the page blank until it is clicked. Only a loss of the focus, which the window has to have
 * had first, or a hidden window, pauses.
 */
export function WindowActivity() {
  useEffect(() => {
    let blurred = false;
    const update = () => { document.documentElement.toggleAttribute('data-window-idle', document.hidden || blurred); };
    const onBlur = () => { blurred = true; update(); };
    const onFocus = () => { blurred = false; update(); };
    update();
    window.addEventListener('focus', onFocus); window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', update);
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('blur', onBlur); document.removeEventListener('visibilitychange', update); };
  }, []);
  return null;
}
