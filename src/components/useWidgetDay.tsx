import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { localDate, shiftDate } from '../journal';
import { useViewHistory } from '../viewHistory';
import { WidgetDayNav } from './WidgetDayNav';

/**
 * The day a day widget shows (pinboard, day values, activities) and its header navigation: "today" follows midnight,
 * a day picked by the arrows stays; Alt ← / Alt → / Alt H turn the day, Ctrl+G opens the date picker, Ctrl+, the settings.
 * (The daily note has its own: it saves before turning.)
 */
export function useWidgetDay() {
  const [date, setDate] = useState(localDate), [today, setToday] = useState(localDate), [followToday, setFollowToday] = useState(true);
  const [picker, setPicker] = useState(false);
  const dateButton = useRef<HTMLButtonElement>(null);
  const navigate = (target: string, follow = target === localDate()) => { setDate(target); setFollowToday(follow); };
  useViewHistory({ date, followToday }, value => navigate(value.date, value.followToday));
  const latest = useRef({ date, today, followToday }); latest.current = { date, today, followToday };
  useEffect(() => {
    const check = () => {
      const next = localDate(), now = latest.current;
      if (next !== now.today) setToday(next);
      if (now.followToday && next !== now.date) navigate(next, true);
    };
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable=true]'))) return;
      const now = latest.current;
      if (event.altKey && !event.ctrlKey && event.key === 'ArrowLeft') navigate(shiftDate(now.date, -1), false);
      else if (event.altKey && !event.ctrlKey && event.key === 'ArrowRight') navigate(shiftDate(now.date, 1), false);
      else if (event.altKey && !event.ctrlKey && event.code === 'KeyH') navigate(localDate(), true);
      else if (event.ctrlKey && event.code === 'KeyG') setPicker(open => !open);
      else if (event.ctrlKey && event.key === ',') void invoke('desktop_widget_open_settings', {});
      else return;
      event.preventDefault();
    };
    const timer = globalThis.setInterval(check, 15000);
    globalThis.addEventListener('focus', check); globalThis.addEventListener('keydown', key);
    return () => { globalThis.clearInterval(timer); globalThis.removeEventListener('focus', check); globalThis.removeEventListener('keydown', key); };
  }, []);
  const nav = <WidgetDayNav date={date} today={today} followToday={followToday} picker={picker} onPickerChange={setPicker} onNavigate={navigate} dateRef={dateButton} />;
  return { date, nav };
}
