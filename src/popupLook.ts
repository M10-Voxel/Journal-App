import { useEffect, useState } from 'react';

/**
 * The popup look in this window: the design (`data-theme`) and its popup variant (`data-popups`, settings.ts). Each of
 * the six has popups of its own build (not only colours): Normal · Karte keeps the orbit around an entry's dot, the others
 * lay out the same actions their own way (PopupSheet in EntryActionDock, PopupFrame for planner, composer and pickers).
 */
export type PopupLook = 'classic-a' | 'classic-b' | 'journal-a' | 'journal-b' | 'nebula-a' | 'nebula-b';
export const looks: readonly PopupLook[] = ['classic-a', 'classic-b', 'journal-a', 'journal-b', 'nebula-a', 'nebula-b'];
export function currentLook(): PopupLook {
  const root = typeof document === 'undefined' ? null : document.documentElement;
  const look = `${root?.dataset.theme ?? 'classic'}-${root?.dataset.popups === 'b' ? 'b' : 'a'}` as PopupLook;
  return looks.includes(look) ? look : 'classic-a';
}
export function usePopupLook(): PopupLook {
  const [look, setLook] = useState(currentLook);
  useEffect(() => {
    const observer = new MutationObserver(() => setLook(currentLook()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-popups'] });
    return () => observer.disconnect();
  }, []);
  return look;
}
