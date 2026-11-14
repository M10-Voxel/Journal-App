import { useEffect, useState } from 'react';
import { isLook } from './designs';
import type { Look } from './designs';

/**
 * The popup look in this window: the look (`data-look`) and its popup variant (`data-popups`, settings.ts). Each one
 * has popups of its own build (not only colours): Normal · Karte keeps the orbit around an entry's dot, the others lay
 * out the same actions their own way (PopupSheet in EntryActionDock, PopupFrame for planner, composer and pickers).
 * The journal look has four: Karteikarte (a), Sticker (b), Sticker-Bogen (c), Papierschnipsel (d).
 */
export type PopupLook = 'classic-a' | 'classic-b' | 'journal-a' | 'journal-b' | 'journal-c' | 'journal-d' | 'nebula-a' | 'nebula-b';
export const looks: readonly PopupLook[] = ['classic-a', 'classic-b', 'journal-a', 'journal-b', 'journal-c', 'journal-d', 'nebula-a', 'nebula-b'];
export function currentLook(): PopupLook {
  const root = typeof document === 'undefined' ? null : document.documentElement;
  const look = `${root?.dataset.look ?? 'classic'}-${root?.dataset.popups ?? 'a'}` as PopupLook;
  return looks.includes(look) ? look : 'classic-a';
}
export function usePopupLook(): PopupLook {
  const [look, setLook] = useState(currentLook);
  useEffect(() => {
    const observer = new MutationObserver(() => setLook(currentLook()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-look', 'data-popups'] });
    return () => observer.disconnect();
  }, []);
  return look;
}

/** The look (`data-look`) alone: for parts a layout draws differently per look (the desk's heads, the search). */
export function currentPageLook(): Look {
  const look = typeof document === 'undefined' ? null : document.documentElement.dataset.look;
  return isLook(look) ? look : 'classic';
}
export function useLook(): Look {
  const [look, setLook] = useState(currentPageLook);
  useEffect(() => {
    const observer = new MutationObserver(() => setLook(currentPageLook()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-look'] });
    return () => observer.disconnect();
  }, []);
  return look;
}
