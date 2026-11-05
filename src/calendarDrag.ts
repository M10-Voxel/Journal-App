import { layoutTimed, minutesOf, slotMinutes } from './calendar';
import { shiftDate, type Entry } from './journal';
import { formatSpan, timeOfMinutes } from './planning';

type Destination = { date: string; time: string | null; end: string | null };
function setStyles(node: HTMLElement, styles: Record<string, string>) {
  for (const [name, value] of Object.entries(styles)) node.style.setProperty(name, value, 'important');
}

/** Keep the grabbed entry's actual appearance, including theme and container styles. */
function copyAppearance(source: HTMLElement): HTMLElement {
  const copy = source.cloneNode(true) as HTMLElement;
  const originals = [source, ...source.querySelectorAll<HTMLElement>('*')];
  const copies = [copy, ...copy.querySelectorAll<HTMLElement>('*')];
  originals.forEach((node, index) => {
    const target = copies[index], computed = getComputedStyle(node);
    for (const property of computed) target.style.setProperty(property, computed.getPropertyValue(property), 'important');
    target.removeAttribute('id');
    setStyles(target, { 'pointer-events': 'none', transition: 'none', animation: 'none' });
  });
  copy.querySelectorAll('.popover').forEach(node => node.remove());
  copy.removeAttribute('title');
  copy.setAttribute('aria-hidden', 'true');
  copy.setAttribute('inert', '');
  return copy;
}

export function beginCalendarDrag({ element, pointerId, startX, startY, entry, date, shownDate, onDrop, onDragEnd }: {
  element: HTMLElement; pointerId: number; startX: number; startY: number;
  entry: Entry; date: string; shownDate: string;
  onDrop: (destination: Destination) => void; onDragEnd: () => void;
}): () => void {
  const root = element.closest<HTMLElement>('.cal')!;
  const initialColumn = element.closest<HTMLElement>('.cal-time-column');
  const rect = element.getBoundingClientRect();
  const allDayCells = () => [...root.querySelectorAll<HTMLElement>('.cal-time-allday-cell')];
  const cellAt = (x: number) => allDayCells().find(cell => { const r = cell.getBoundingClientRect(); return x >= r.left && x < r.right; });
  const monthCellAt = (x: number, y: number) => [...root.querySelectorAll<HTMLElement>('.cal-month-day')].find(cell => { const r = cell.getBoundingClientRect(); return x >= r.left && x < r.right && y >= r.top && y < r.bottom; });
  const monthSpan = element.closest<HTMLElement>('.cal-month-span');
  const grabbedDay = monthSpan ? monthCellAt(startX, startY)?.dataset.rangeDate ?? shownDate : element.closest('.cal-time-allday') ? cellAt(startX)?.dataset.rangeDate ?? shownDate : shownDate;
  let moved = false, preview: HTMLElement | null = null, markers: HTMLElement[] = [], destination: Destination | null = null;
  let continuations: HTMLElement[] = [], floatingLabel: HTMLElement | null = null;
  let x = startX, y = startY;
  const makePreview = () => {
    const copy = copyAppearance(element); copy.classList.add('cal-drag-preview');
    setStyles(copy, { position: 'fixed', 'z-index': '1000', margin: '0', right: 'auto', bottom: 'auto', width: `${rect.width}px`, height: `${rect.height}px`, transform: 'none', opacity: '1' });
    const badge = copy.querySelector<HTMLElement>('.cal-item-time');
    if (badge) setStyles(badge, { display: 'none' });
    document.body.append(copy); return copy;
  };
  const marker = (parent: HTMLElement, left: number, top: number, width: number, height: number) => {
    const mark = document.createElement('div');
    mark.className = 'cal-drop-outline'; mark.setAttribute('aria-hidden', 'true');
    Object.assign(mark.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`, '--drop-color': getComputedStyle(element).getPropertyValue('--tag').trim() || getComputedStyle(element).getPropertyValue('--accent') });
    parent.append(mark); markers.push(mark);
  };
  const update = () => {
    if (!preview) return;
    setStyles(preview, { left: `${rect.left + x - startX}px`, top: `${rect.top + y - startY}px`, width: `${rect.width}px`, height: `${rect.height}px`, display: 'flex', 'clip-path': 'none' });
    continuations.forEach(node => setStyles(node, { display: 'none' }));
    if (floatingLabel) setStyles(floatingLabel, { display: 'none' });
    markers.forEach(node => node.remove()); markers = []; destination = null;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !root.contains(hit)) return;
    const timed = hit.closest<HTMLElement>('.cal-time-column');
    const cell = hit.closest<HTMLElement>('[data-range-date],[data-date]');
    let day = cell?.dataset.rangeDate ?? cell?.dataset.date;
    if (!day && hit.closest('.cal-time-allday')) day = cellAt(x)?.dataset.rangeDate;
    if (!day && hit.closest('.cal-month-span')) day = monthCellAt(x, y)?.dataset.rangeDate;
    if (!day) return;
    const dayDelta = Math.round((Date.parse(day) - Date.parse(grabbedDay)) / 86400000);
    let to = shiftDate(date, dayDelta), time = entry.time ?? null, end = entry.end ?? null;
    let labelAnchor = preview;
    if (timed) {
      const grid = timed.closest<HTMLElement>('.cal-time');
      const hour = Number.parseFloat(grid ? getComputedStyle(grid).getPropertyValue('--hour') : '');
      if (hour > 0) {
        const duration = time && end ? minutesOf(end) - minutesOf(time) : null;
        // Preserve the grab offset, including when a continued block was grabbed after midnight.
        const offset = initialColumn ? (startY - rect.top) * 60 / hour : 0;
        const visibleStart = Math.round(((y - timed.getBoundingClientRect().top) * 60 / hour - offset) / 15) * 15;
        const continuation = Math.round((Date.parse(shownDate) - Date.parse(date)) / 86400000) * 1440;
        const start = initialColumn && time && continuation > 0 ? visibleStart - (continuation - minutesOf(time)) : visibleStart;
        const carry = Math.floor(start / 1440), minute = ((start % 1440) + 1440) % 1440;
        to = shiftDate(day, carry); time = timeOfMinutes(minute); end = duration == null ? null : timeOfMinutes(minute + duration);
        const length = duration ?? Math.min(slotMinutes, 1440 - minute);
        // Split the destination at midnight just as the calendar splits its blocks.
        let segmentIndex = 0;
        root.querySelectorAll<HTMLElement>('.cal-time-column').forEach(column => {
          const columnDay = column.dataset.date!;
          const delta = Math.round((Date.parse(columnDay) - Date.parse(to)) / 86400000) * 1440;
          const from = Math.max(0, minute - delta), until = Math.min(1440, minute + length - delta);
          if (until > from) {
            const existing = [...column.querySelectorAll<HTMLElement>('.cal-item.is-block')]
              .filter(node => node.dataset.calendarEntry !== entry.id && node.dataset.calendarTime)
              .map(node => ({ id: node.dataset.calendarEntry!, time: node.dataset.calendarTime!, end: node.dataset.calendarEnd }));
            const candidate = { id: entry.id, time: timeOfMinutes(from), end: timeOfMinutes(until) };
            const placed = layoutTimed([...existing, candidate]).find(item => item.item === candidate)!;
            marker(column, column.clientWidth * placed.left / 100 + 2, from / 60 * hour + 1, column.clientWidth * placed.width / 100 - 4, Math.max(10, (until - from) / 60 * hour - 3));
            // Rebuild each visible part from the complete duration, never from the grabbed fragment's height.
            const part = segmentIndex === 0 ? preview! : (continuations[segmentIndex - 1] ??= makePreview());
            const target = markers[markers.length - 1].getBoundingClientRect();
            const viewport = grid!.getBoundingClientRect();
            const clipTop = Math.max(0, viewport.top - target.top), clipBottom = Math.max(0, target.bottom - viewport.bottom);
            setStyles(part, { display: 'flex', left: `${target.left}px`, top: `${target.top}px`, width: `${target.width}px`, height: `${target.height}px`, 'clip-path': `inset(${clipTop}px 0 ${clipBottom}px 0)`, 'border-radius': `${from === 0 && delta > 0 ? 0 : 4}px ${from === 0 && delta > 0 ? 0 : 4}px ${until === 1440 && minute + length - delta > 1440 ? 0 : 4}px ${until === 1440 && minute + length - delta > 1440 ? 0 : 4}px` });
            if (column === timed) labelAnchor = part;
            segmentIndex++;
          }
        });
      }
    } else if (hit.closest('.cal-time-allday')) {
      const span = time && end ? Math.floor((minutesOf(end) - 1) / 1440) : 0;
      const band = root.querySelector<HTMLElement>('.cal-time-allday')!;
      const bandRect = band.getBoundingClientRect();
      const cells = allDayCells().filter(cell => cell.dataset.rangeDate! >= to && cell.dataset.rangeDate! <= shiftDate(to, span));
      if (cells.length) {
        const first = cells[0].getBoundingClientRect(), last = cells[cells.length - 1].getBoundingClientRect();
        const top = span ? Math.max(first.bottom - bandRect.top, rect.top - bandRect.top) : first.bottom - bandRect.top - rect.height;
        marker(band, first.left - bandRect.left + 3, Math.max(0, top), last.right - first.left - 6, rect.height);
      }
    } else if (monthSpan) {
      const last = shiftDate(to, end ? Math.floor((minutesOf(end) - 1) / 1440) : 0);
      root.querySelectorAll<HTMLElement>('.cal-month-week').forEach(week => {
        const cells = [...week.querySelectorAll<HTMLElement>('.cal-month-day')].filter(cell => cell.dataset.rangeDate! >= to && cell.dataset.rangeDate! <= last);
        if (!cells.length) return;
        const parent = week.getBoundingClientRect(), first = cells[0].getBoundingClientRect(), final = cells[cells.length - 1].getBoundingClientRect();
        marker(week, first.left - parent.left + 2, parseFloat(getComputedStyle(monthSpan).marginTop), final.right - first.left - 4, rect.height);
      });
    } else if (cell) {
      // Month entries occupy lines underneath the date and the existing entries.
      const cellRect = cell.getBoundingClientRect();
      const last = [...cell.querySelectorAll<HTMLElement>('.cal-month-day-head,.cal-item')].filter(node => node !== element).at(-1);
      const top = last ? last.getBoundingClientRect().bottom - cellRect.top : 2;
      marker(cell, 2, Math.min(top, cell.clientHeight - rect.height - 2), cell.clientWidth - 4, rect.height);
    }
    destination = { date: to, time, end };
    const dateLabel = !timed && Boolean(element.closest('.cal-time-allday,.cal-month-span'));
    if (time || dateLabel) {
      if (!floatingLabel) {
        const original = element.querySelector<HTMLElement>('.cal-item-time');
        floatingLabel = original ? copyAppearance(original) : document.createElement('time');
        floatingLabel.className = 'cal-item-time cal-drag-label';
        floatingLabel.replaceChildren(document.createElement('span'));
        floatingLabel.setAttribute('aria-hidden', 'true');
        document.body.append(floatingLabel);
      }
      const span = time && end ? Math.floor((minutesOf(end) - 1) / 1440) : 0;
      const dayLabel = (value: string) => `${value.slice(8, 10)}.${value.slice(5, 7)}.`;
      floatingLabel.firstElementChild!.textContent = dateLabel ? span ? `${dayLabel(to)} – ${dayLabel(shiftDate(to, span))}` : dayLabel(to) : formatSpan(time, end);
      const sourceStyle = getComputedStyle(element);
      setStyles(floatingLabel, { position: 'fixed', display: 'block', 'z-index': '1002', left: '0', top: '0', right: 'auto', bottom: 'auto', width: 'max-content', height: 'auto', 'min-height': '0', 'max-height': 'none', 'max-width': 'calc(100vw - 16px)', overflow: 'visible', padding: '0 3px', opacity: '1', transform: 'none', 'pointer-events': 'none', color: sourceStyle.color, background: sourceStyle.getPropertyValue('--event-background').trim() || sourceStyle.getPropertyValue('--focus').trim() });
      const anchor = labelAnchor.getBoundingClientRect(), badge = floatingLabel.getBoundingClientRect();
      const viewport = timed?.closest('.cal-time')?.getBoundingClientRect();
      setStyles(floatingLabel, { left: `${Math.max(8, Math.min(innerWidth - badge.width - 8, anchor.right - badge.width - 2))}px`, top: `${Math.max(viewport?.top ?? 8, Math.min(innerHeight - badge.height - 8, viewport ? viewport.bottom - badge.height - 2 : Infinity, anchor.bottom - badge.height - 2))}px` });
    }
    preview.dataset.dropDate = to;
    preview.dataset.dropTime = time ?? '';
  };
  const follow = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    x = event.clientX; y = event.clientY;
    if (!moved && Math.hypot(x - startX, y - startY) > 5) {
      moved = true; preview = makePreview(); element.classList.add('is-drag-source');
    }
    if (moved) { event.preventDefault(); update(); }
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', follow); window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key); window.removeEventListener('blur', cancel);
    root.removeEventListener('scroll', update, true);
    preview?.remove(); continuations.forEach(node => node.remove()); floatingLabel?.remove(); markers.forEach(node => node.remove()); element.classList.remove('is-drag-source');
  };
  const cancel = () => { cleanup(); if (moved) onDragEnd(); };
  const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } };
  const finish = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    x = event.clientX; y = event.clientY; if (moved) update();
    cleanup(); if (!moved) return;
    onDragEnd();
    if (destination && (destination.date !== date || destination.time !== (entry.time ?? null) || destination.end !== (entry.end ?? null))) onDrop(destination);
  };
  window.addEventListener('pointermove', follow, { passive: false }); window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', key); window.addEventListener('blur', cancel);
  root.addEventListener('scroll', update, true);
  return cleanup;
}
