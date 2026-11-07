import { useEffect } from 'react';

/** Pause visual work when the window is hidden or another app has the focus. */
export function WindowActivity() {
  useEffect(() => {
    const update = () => { document.documentElement.toggleAttribute('data-window-idle', document.hidden || !document.hasFocus()); };
    update();
    window.addEventListener('focus', update); window.addEventListener('blur', update);
    document.addEventListener('visibilitychange', update);
    return () => { window.removeEventListener('focus', update); window.removeEventListener('blur', update); document.removeEventListener('visibilitychange', update); };
  }, []);
  return null;
}
