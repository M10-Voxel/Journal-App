// Browser verification of the production frontend with Tauri's official IPC mocks.
// This uses synthetic data only; it never opens the application's SQLite database.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createPortServer } from 'node:net';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';

const root = process.cwd();
const dist = resolve(root, 'dist');
const artifacts = resolve(root, 'src-tauri/target/ui-validation');
await mkdir(artifacts, { recursive: true });
const edge = join(process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe');
assert(existsSync(edge), 'Microsoft Edge is required for this Windows UI check.');
const indexHtml = await readFile(join(dist, 'index.html'), 'utf8');
const entryScript = indexHtml.match(/<script[^>]*src="([^"]+)"[^>]*><\/script>/)?.[1];
assert(entryScript, 'Run npm.cmd run build first.');

const bootstrap = `
  import { mockIPC, mockWindows } from '/__test/mocks.js';
  // The calendar windows are checked by loading the same page as another window (\`?window=calendar\` or \`mini\`).
  const label = new URLSearchParams(location.search).get('window') ?? 'main';
  mockWindows(label);
  const today = new Date();
  const date = [today.getFullYear(), String(today.getMonth()+1).padStart(2,'0'), String(today.getDate()).padStart(2,'0')].join('-');
  const fixture = { date, title: 'Zeit für die kleinen Dinge', body: 'Bestehender Freitext bleibt erhalten.', revision: 1, entries: [
    { id:'10000000-0000-4000-8000-000000000001', kind:'task', text:'Eine Runde durch den Park gehen', done:false, cancelled:false, priority:false },
    { id:'10000000-0000-4000-8000-000000000002', kind:'note', text:'Heute etwas langsamer machen. Ein paar Gedanken sammeln und den Kopf frei bekommen.', done:false, cancelled:false, priority:false },
    { id:'10000000-0000-4000-8000-000000000003', kind:'event', text:'Kaffee am Nachmittag', done:false, cancelled:false, priority:true },
    { id:'10000000-0000-4000-8000-000000000004', kind:'task', text:'Das neue Buch weiterlesen', done:true, cancelled:false, priority:false },
    { id:'10000000-0000-4000-8000-000000000005', kind:'task', text:'Den Schreibtisch umstellen', done:false, cancelled:true, priority:false }
  ]};
  const days = new Map([[date, fixture]]);
  const shift = amount => { const value = new Date(today.getFullYear(), today.getMonth(), today.getDate() + amount, 12); return [value.getFullYear(), String(value.getMonth()+1).padStart(2,'0'), String(value.getDate()).padStart(2,'0')].join('-'); };
  const item = (id, kind, text, extra = {}) => ({ id:\`20000000-0000-4000-8000-\${String(id).padStart(12, '0')}\`, kind, text, done:false, cancelled:false, priority:false, time:null, reminder:false, plan:null, ...extra });
  if (label !== 'main') {
    fixture.entries[2].time = '15:00';
    days.set(shift(1), { date:shift(1), title:'', body:'', revision:1, entries:[item(1, 'event', 'Zahnarzt', { time:'09:00' }), item(2, 'event', 'Telefonat mit **Anna**', { time:'09:30' }), item(3, 'task', 'Bericht abgeben', { priority:true }), item(4, 'note', 'Gute Laune'),
      item(5, 'task', 'Schon verschoben', { plan:{ via:'date', targets:[{ date:shift(9), id:item(6, 'task', '').id }], time:null, reminder:false } })] });
    days.set(shift(-2), { date:shift(-2), title:'', body:'', revision:1, entries:[item(7, 'task', 'Einkaufen', { done:true }), item(8, 'event', 'Kino', { time:'18:30' })] });
    days.set(shift(3), { date:shift(3), title:'Großer Tag', body:'', revision:1, entries:Array.from({ length:7 }, (_, index) => item(10 + index, 'task', \`Aufgabe \${index + 1}\`)) });
    days.set(shift(5), { date:shift(5), title:'Urlaub', body:'', revision:1, entries:[item(20, 'event', 'Flug nach Lissabon')] });
  }
  const invoked = [];
  window.__uiTest = { date, saves: 0, invoked, shift, day: (value = date) => structuredClone(days.get(value)),
    // Stands in for the journal window saving a day: the stored day changes and the calendars hear about it.
    store: value => { days.set(value.date, value); return window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event:'journal:changed', payload:[value.date] }); },
    emit: (event, payload) => window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event, payload }) };
  window.confirm = () => true;
  // The journal saves by itself shortly after changes; the checks count saves, so they save explicitly (Ctrl+S)
  // and shorten this only where saving by itself is checked.
  window.__journalAutosaveDelay = 3600000;
  // Mirrors storage.rs: traces create their target entries once, entries know their trace's day, removing an entry
  // removes only it, and linked groups (load_linked) can be changed together on other days (change_linked).
  const origin = id => { for (const [day, value] of days) if (value.entries.some(entry => entry.plan?.targets.some(target => target.id === id))) return day; };
  const loadDay = date => {
    const value = structuredClone(days.get(date) ?? { date, title:'', body:'', revision:0, entries:[] });
    for (const entry of value.entries) { const from = origin(entry.id); if (from) entry.origin = from; }
    return value;
  };
  const take = id => { for (const [day, value] of days) { const index = value.entries.findIndex(entry => entry.id === id); if (index >= 0) return [day, value.entries.splice(index, 1)[0]]; } };
  mockIPC((command, payload) => {
    if (command === 'load_day') return loadDay(payload.date);
    if (command === 'load_range') return [...days.values()].filter(day => day.date >= payload.from && day.date <= payload.to)
      .map(day => ({ date:day.date, title:day.title, entries:structuredClone(day.entries.filter(entry => !entry.plan)) })).filter(day => day.title || day.entries.length).sort((a, b) => a.date.localeCompare(b.date));
    if (command === 'open_window' || command === 'show_day' || command.startsWith('plugin:window|')) { invoked.push([command, payload]); return null; }
    if (command === 'load_linked') {
      const where = id => { for (const [day, value] of days) { const found = value.entries.find(entry => entry.id === id); if (found) return [day, found]; } };
      const group = [payload.id], queue = [payload.id];
      while (queue.length) {
        const id = queue.shift(), [, current] = where(id) ?? [];
        const next = [...(current?.plan?.targets ?? []).map(target => target.id), ...[...days.values()].flatMap(day => day.entries.filter(entry => entry.plan?.targets.some(target => target.id === id)).map(entry => entry.id))];
        for (const other of next) if (!group.includes(other)) { group.push(other); queue.push(other); }
      }
      return group.map(id => where(id)).filter(Boolean).map(([date, entry]) => ({ id:entry.id, date, kind:entry.kind, done:entry.done, cancelled:entry.cancelled, trace:Boolean(entry.plan) })).sort((a, b) => a.date.localeCompare(b.date));
    }
    if (command === 'change_linked') {
      const changed = new Set();
      for (const { id, action } of payload.changes) for (const [day, value] of days) {
        const index = value.entries.findIndex(entry => entry.id === id);
        if (index < 0) continue;
        const entry = value.entries[index];
        if (action === 'remove') value.entries.splice(index, 1);
        else if (entry.kind === 'task' && !entry.plan) Object.assign(entry, { done:action === 'done', cancelled:action === 'cancelled' });
        else continue;
        changed.add(day);
      }
      for (const day of changed) days.get(day).revision += 1;
      window.__uiTest.linkedChanges = (window.__uiTest.linkedChanges ?? 0) + 1;
      void window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event:'journal:changed', payload:[...changed] });
      return [...changed].sort();
    }
    if (command === 'save_day') {
      const value = structuredClone(payload.day); value.revision += 1;
      for (const entry of value.entries) delete entry.origin;
      const previous = days.get(value.date)?.entries ?? [];
      const created = new Set(previous.flatMap(entry => entry.plan?.targets ?? []).map(target => target.id));
      const kept = new Set(value.entries.map(entry => entry.id));
      const touched = new Set(), linked = new Set();
      for (const entry of value.entries) for (const target of entry.plan?.targets ?? []) {
        if (created.has(target.id)) continue;
        const other = structuredClone(days.get(target.date) ?? { date:target.date, title:'', body:'', revision:0, entries:[] });
        other.revision += 1;
        other.entries.push({ id:target.id, kind:entry.kind, text:entry.text, done:false, cancelled:false, priority:entry.priority, time:entry.plan.time, end:entry.plan.end ?? null, reminder:entry.plan.reminder, plan:null });
        days.set(target.date, other); touched.add(target.date);
      }
      days.set(value.date, value);
      // Edited text, kind or priority reach the linked entries in both directions (sync_linked).
      const find = id => { for (const [day, other] of days) { const found = other.entries.find(entry => entry.id === id); if (found) return [day, found]; } };
      for (const entry of value.entries) {
        const before = previous.find(item => item.id === entry.id);
        if (!before || (before.kind === entry.kind && before.text === entry.text && before.priority === entry.priority)) continue;
        const seenLinks = new Set([entry.id]), links = [entry.id];
        while (links.length) {
          const id = links.shift(), [, current] = find(id) ?? [];
          const next = [...(current?.plan?.targets ?? []).map(target => target.id), ...[...days.values()].flatMap(day => day.entries.filter(other => other.plan?.targets.some(target => target.id === id)).map(other => other.id))];
          for (const other of next) {
            if (seenLinks.has(other)) continue;
            seenLinks.add(other); links.push(other);
            const [day, found] = find(other) ?? [];
            if (!found || (found.kind === entry.kind && found.text === entry.text && found.priority === entry.priority)) continue;
            Object.assign(found, { kind:entry.kind, text:entry.text, priority:entry.priority }, entry.kind === 'task' ? {} : { done:false, cancelled:false });
            if (day !== value.date) { days.get(day).revision += 1; touched.add(day); }
          }
        }
      }
      for (const day of linked) { days.get(day).revision += 1; touched.add(day); }
      window.__uiTest.saves += 1;
      // Like save_day in main.rs: every calendar hears which days changed.
      void window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event:'journal:changed', payload:[value.date, ...touched] });
      return { ...loadDay(value.date), touched:[...touched].sort() };
    }
  }, { shouldMockEvents: true });
  await import(${JSON.stringify(entryScript)});
`;
// Like the Tauri build: inline styles and scripts carry a nonce, which makes 'unsafe-inline' ineffective.
const nonce = 'ui-validation';
const csp = `default-src 'self'; style-src 'self' 'unsafe-inline' 'nonce-${nonce}'; script-src 'self' 'nonce-${nonce}'; connect-src ipc: http://ipc.localhost`;
const html = indexHtml.replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/, `<script type="module" nonce="${nonce}">${bootstrap}</script>`).replace('<style>', `<style nonce="${nonce}">`);
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') { response.setHeader('content-type', 'text/html; charset=utf-8'); response.setHeader('content-security-policy', csp); response.end(html); return; }
    const file = pathname === '/__test/mocks.js' ? resolve(root, 'node_modules/@tauri-apps/api/mocks.js') : resolve(dist, `.${pathname}`);
    if (pathname !== '/__test/mocks.js' && !file.startsWith(dist + sep)) { response.writeHead(403).end(); return; }
    response.setHeader('content-type', ({ '.js':'text/javascript', '.css':'text/css', '.png':'image/png' })[extname(file)] ?? 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const portServer = createPortServer();
await new Promise(resolveListen => portServer.listen(0, '127.0.0.1', resolveListen));
const debugPort = portServer.address().port;
await new Promise(resolveClose => portServer.close(resolveClose));
const browser = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(artifacts, `profile-${process.pid}`)}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let socket;
const errors = [];
const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms));
const pending = new Map();
let sequence = 0;
function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolveCommand, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timeout); resolveCommand(value); }, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + (result.exceptionDetails.exception?.description ?? expression));
  return result.result.value;
}
async function until(expression) {
  for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(expression)) return; await pause(75); }
  throw new Error(`Condition failed: ${expression}`);
}
async function screenshot(name) {
  const result = await command('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(artifacts, name), Buffer.from(result.data, 'base64'));
}
async function key(keyName, code = keyName, modifiers = 0) {
  const virtualKey = keyName === 'Enter' ? { windowsVirtualKeyCode:13, nativeVirtualKeyCode:13 } : {};
  await command('Input.dispatchKeyEvent', { type:'keyDown', key:keyName, code, modifiers, ...virtualKey, ...(keyName === 'Enter' ? { text:'\r', unmodifiedText:'\r' } : {}) });
  await command('Input.dispatchKeyEvent', { type:'keyUp', key:keyName, code, modifiers, ...virtualKey });
}
async function hoverAt(expression) {
  const point = await evaluate(`(() => { const r=(${expression}).getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; })()`);
  await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:point.x, y:point.y });
}
async function closeDock() {
  await key('Escape');
  await until("!document.querySelector('.entry-dock-shell.is-open')");
}
async function hover(selector) {
  const point = await evaluate(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; })()`);
  await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:point.x, y:point.y });
}
async function dragRow(sourceId, targetId, placement = 'before', escape = false) {
  const points = await evaluate(`(() => {
    const source = document.querySelector('[data-entry-id="${sourceId}"] .entry-grip').getBoundingClientRect();
    const target = document.querySelector('[data-entry-id="${targetId}"]').getBoundingClientRect();
    return { x:source.left + source.width/2, y:source.top + source.height/2, tx:target.left+65, ty:${placement === 'before' ? 'target.top+4' : 'target.bottom-4'} };
  })()`);
  await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:points.x, y:points.y });
  await command('Input.dispatchMouseEvent', { type:'mousePressed', x:points.x, y:points.y, button:'left', buttons:1, clickCount:1 });
  await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:points.x+8, y:points.y, button:'left', buttons:1 });
  await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:points.tx, y:points.ty, button:'left', buttons:1 });
  if (escape) {
    await command('Input.dispatchKeyEvent', { type:'keyDown', key:'Escape', code:'Escape' });
    await command('Input.dispatchKeyEvent', { type:'keyUp', key:'Escape', code:'Escape' });
  }
  await command('Input.dispatchMouseEvent', { type:'mouseReleased', x:points.tx, y:points.ty, button:'left', buttons:0, clickCount:1 });
  await until("!document.querySelector('.entry-dragging')");
}

// Calendar window and compact month window: the same page loaded as those windows, with a few days of synthetic entries.
const longDate = date => `new Intl.DateTimeFormat('de-DE', { weekday:'long', day:'numeric', month:'long', year:'numeric' }).format(new Date('${date}T12:00'))`;
async function checkCalendars() {
  const origin = `http://127.0.0.1:${server.address().port}`;
  await command('Emulation.setDeviceMetricsOverride', { width:1180, height:780, deviceScaleFactor:1, mobile:false });
  // The journal saves by itself shortly after a change, and at once before showing another day.
  const headingNow = "document.querySelector('.document-header h1').textContent";
  await key('h', 'KeyH', 1);
  await until(`${headingNow} === ${longDate(await evaluate('window.__uiTest.date'))}`);
  await key('s', 'KeyS', 2);
  await until("document.querySelector('.save-status').textContent === 'Gespeichert'");
  await evaluate('window.__journalAutosaveDelay = 300');
  const autoSaves = await evaluate('window.__uiTest.saves');
  await evaluate("(() => { const title=document.querySelector('#title'); title.focus(); title.setSelectionRange(title.value.length, title.value.length); })()");
  await command('Input.insertText', { text:' – von selbst' });
  assert.equal(await evaluate("document.querySelector('.save-status').textContent"), 'Wird gleich gespeichert …');
  await until(`window.__uiTest.saves === ${autoSaves + 1} && document.querySelector('.save-status').textContent === 'Gespeichert'`);
  assert.match(await evaluate('window.__uiTest.day().title'), /von selbst$/);
  await evaluate('window.__journalAutosaveDelay = 3600000');
  await command('Input.insertText', { text:'!' });
  await key('ArrowRight', 'ArrowRight', 1);
  await until(`${headingNow} === ${longDate(await evaluate('window.__uiTest.shift(1)'))} && window.__uiTest.saves === ${autoSaves + 2}`);
  assert.match(await evaluate('window.__uiTest.day().title'), /von selbst!$/, 'Leaving the day saved it first, without asking.');
  await key('h', 'KeyH', 1);
  await until(`${headingNow} === ${longDate(await evaluate('window.__uiTest.date'))}`);
  // Finishing one of several days offers the following ones too.
  await evaluate("[...document.querySelectorAll('.kind-picker button')].find(button => button.textContent === 'Aufgabe').click()");
  await until("Boolean(document.activeElement?.closest('.entry'))");
  await command('Input.insertText', { text:'Serie' });
  await key('T', 'KeyT', 9);
  await until("Boolean(document.querySelector('.planner.is-multi')) && document.activeElement?.classList.contains('planner-day')");
  await key('ArrowRight', 'ArrowRight'); await key(' ', 'Space');
  await key('ArrowRight', 'ArrowRight'); await key('ArrowRight', 'ArrowRight'); await key(' ', 'Space');
  await until("document.querySelector('.planner-confirm').textContent === '3 Tage'");
  await key('Enter', 'Enter');
  const series = "[...document.querySelectorAll('.entry')].find(row => row.textContent.includes('Serie'))";
  await until(`${series}?.dataset.trace === 'days'`);
  await key('s', 'KeyS', 2);
  await until(`(window.__uiTest.day(window.__uiTest.shift(3))?.entries ?? []).some(entry => entry.text === 'Serie')`);
  await key('ArrowRight', 'ArrowRight', 1);
  await until(`${headingNow} === ${longDate(await evaluate('window.__uiTest.shift(1)'))} && Boolean(${series})`);
  await evaluate(`${series}.querySelector('.entry-text').focus()`);
  await key('d', 'KeyD', 1);
  await until(`Boolean(${series}.querySelector('.scope-choice.is-done'))`);
  assert.deepEqual(await evaluate(`[...${series}.querySelectorAll('.scope-choice button')].map(button => button.textContent)`), ['Nur diesen', 'Auch die 2 folgenden']);
  await key('ArrowRight', 'ArrowRight');
  await key('Enter', 'Enter');
  await until(`${series}.dataset.status === 'done' && [2, 3].every(n => window.__uiTest.day(window.__uiTest.shift(n)).entries.find(entry => entry.text === 'Serie').done)`);
  // Escape cancels the action altogether.
  await evaluate(`${series}.querySelector('.entry-text').focus()`);
  await key('x', 'KeyX', 1);
  await until(`Boolean(${series}.querySelector('.scope-choice.is-cancelled'))`);
  await key('Escape');
  await until(`!${series}.querySelector('.scope-choice') && ${series}.dataset.status === 'done'`);
  await key('s', 'KeyS', 2);
  await key('h', 'KeyH', 1);
  await until(`${headingNow} === ${longDate(await evaluate('window.__uiTest.date'))}`);

  // The journal shows days sent from a calendar window.
  const target = await evaluate('window.__uiTest.shift(4)');
  await evaluate(`window.__uiTest.emit('journal:navigate', { date:'${target}', entry:null })`);
  await until(`document.querySelector('.document-header h1').textContent === ${longDate(target)}`);
  const heading = "document.querySelector('.document-header h1').textContent";
  const wheel = (selector, deltaX, deltaY, modifiers = 0) => evaluate(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+Math.min(r.height/2, 40) }; })()`)
    .then(point => command('Input.dispatchMouseEvent', { type:'mouseWheel', x:point.x, y:point.y, deltaX, deltaY, modifiers }));
  // Days turn with a sideways swipe (one day per gesture, however long it runs on) and with Shift + wheel (a day per notch).
  for (let step = 0; step < 10; step++) await wheel('.document-header', 30, 0);
  await until(`${heading} === ${longDate(await evaluate('window.__uiTest.shift(5)'))}`);
  assert.match(await evaluate("document.querySelector('.document-header').className"), /slide-next/, 'The next day slides in from the right.');
  await pause(300);
  assert.equal(await evaluate(heading), await evaluate(longDate(await evaluate('window.__uiTest.shift(5)'))), 'One swipe is one day.');
  await wheel('.document-header', 0, -100, 8);
  await pause(60);
  await wheel('.document-header', 0, -100, 8);
  await until(`${heading} === ${longDate(await evaluate('window.__uiTest.shift(3)'))}`);
  assert.match(await evaluate("document.querySelector('.document-header').className"), /slide-prev/);
  // The sidebar is the calendar. It follows the journal's day; a day or an entry clicked there opens in the journal.
  const side = selector => `document.querySelector('.sidebar .cal')${selector ? `.querySelector(${JSON.stringify(selector)})` : ''}`;
  await key('h', 'KeyH', 1);
  const sideToday = await evaluate('window.__uiTest.date');
  await until(`${heading} === ${longDate(sideToday)}`);
  await until(`${side()}?.dataset.view === 'month' && ${side('.cal-month-day.is-today')}?.classList.contains('is-journal')`);
  const sideCell = date => `[...document.querySelectorAll('.sidebar .cal-month-day')].find(cell => cell.querySelector('.cal-month-number').getAttribute('aria-label').startsWith(${longDate(date)}))`;
  const other = await evaluate('window.__uiTest.shift(2)');
  await evaluate(`${sideCell(other)}.click()`);
  await until(`${heading} === ${longDate(other)} && ${sideCell(other)}.classList.contains('is-journal')`);
  await key('ArrowRight', 'ArrowRight', 1);
  await until(`${sideCell(await evaluate('window.__uiTest.shift(3)'))}?.classList.contains('is-journal')`);
  // Saving shows up in the sidebar at once; clicking the entry there opens its day with the cursor in it.
  await evaluate("document.querySelector('.kind-picker button').click()");
  await until("Boolean(document.activeElement?.closest('.entry'))");
  await command('Input.insertText', { text:'Aus dem Kalender' });
  await key('s', 'KeyS', 2);
  await until(`[...document.querySelectorAll('.sidebar .cal-item-text')].some(item => item.textContent === 'Aus dem Kalender')`);
  await key('h', 'KeyH', 1);
  await until(`${heading} === ${longDate(sideToday)}`);
  await evaluate("[...document.querySelectorAll('.sidebar .cal-item')].find(item => item.textContent.includes('Aus dem Kalender')).click()");
  await until(`${heading} === ${longDate(await evaluate('window.__uiTest.shift(3)'))} && document.activeElement?.closest('.entry')?.textContent.includes('Aus dem Kalender')`);
  // Views switch inside the sidebar with their keys; a swipe there turns the calendar, not the journal.
  await evaluate(`${side()}.focus()`);
  await key('w', 'KeyW');
  await until(`${side()}.dataset.view === 'week'`);
  const dayShown = await evaluate(heading);
  const weekTitle = await evaluate(`${side('.cal-title')}.textContent`);
  for (let step = 0; step < 10; step++) await wheel('.sidebar .cal-body', 30, 0);
  await until(`${side('.cal-title')}.textContent !== ${JSON.stringify(weekTitle)}`);
  assert.equal(await evaluate(heading), dayShown, 'Swiping the calendar leaves the journal on its day.');
  // Marking a range in the time grid creates an entry there: dragging snaps to quarter hours, the composer opens next to it.
  await key('h', 'KeyH', 1);
  await until(`${heading} === ${longDate(sideToday)}`);
  await evaluate(`${side()}.focus()`);
  await key('t', 'KeyT');
  await until(`${side()}.dataset.view === 'day' && Boolean(${side('.cal-time-column')})`);
  await pause(350);
  const at = minutes => evaluate(`(() => { const r=document.querySelector('.sidebar .cal-time-column').getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+${minutes}/60*48 }; })()`);
  const markRange = async (from, ...through) => {
    const start = await at(from);
    await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:start.x, y:start.y });
    await command('Input.dispatchMouseEvent', { type:'mousePressed', x:start.x, y:start.y, button:'left', buttons:1, clickCount:1 });
    let point = start;
    for (const minutes of through) { point = await at(minutes); await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:point.x, y:point.y, button:'left', buttons:1 }); }
    return point;
  };
  const release = point => command('Input.dispatchMouseEvent', { type:'mouseReleased', x:point.x, y:point.y, button:'left', buttons:0, clickCount:1 });
  const selection = "document.querySelector('.sidebar .cal-selection-time')?.textContent";
  let point = await markRange(9 * 60 + 5, 9 * 60 + 40, 10 * 60 + 20);
  assert.equal(await evaluate(selection), '09:00 – 10:30', 'The range snaps to quarter hours while dragging.');
  assert.equal(await evaluate("document.querySelector('.cal-composer')"), null, 'The composer waits for the release.');
  await release(point);
  await until("document.querySelector('.cal-composer.is-placed') && document.activeElement === document.querySelector('.cal-composer-text')");
  assert.equal(await evaluate("(() => { const c=document.querySelector('.cal-composer').getBoundingClientRect(), s=document.querySelector('.sidebar .cal-selection').getBoundingClientRect(); return c.left >= 0 && c.right <= innerWidth && c.bottom <= innerHeight && (c.left >= s.right || c.right <= s.left || c.top >= s.bottom); })()"), true, 'Next to the range, inside the window.');
  assert.equal(await evaluate("document.querySelector('.cal-composer-length').textContent"), '1 h 30');
  await command('Input.insertText', { text:'Zahnarzt-Test' });
  await key('ArrowDown', 'ArrowDown');
  await until(`${selection} === '09:15 – 10:45'`);
  await key('ArrowUp', 'ArrowUp', 8);
  await until(`${selection} === '09:15 – 10:30'`);
  await key('p', 'KeyP', 1);
  await until("document.querySelector('.cal-composer-priority').getAttribute('aria-pressed') === 'true'");
  await pause(450);
  await screenshot('calendar-composer.png');
  const savesBeforeCreate = await evaluate('window.__uiTest.saves');
  await key('Enter', 'Enter');
  await until(`!document.querySelector('.cal-composer') && window.__uiTest.saves === ${savesBeforeCreate + 1}`);
  const created = "[...document.querySelectorAll('.entry')].find(row => row.textContent.includes('Zahnarzt-Test'))";
  assert.equal(await evaluate(`${created}?.querySelector('.entry-when')?.textContent`), '09:15–10:30', 'On the day shown, the entry joins the journal and is saved.');
  assert.equal(await evaluate(`${created}.dataset.priority`), 'high');
  await until("[...document.querySelectorAll('.sidebar .cal-item.is-block')].some(block => block.textContent.includes('Zahnarzt-Test'))");
  assert.equal(await evaluate("Math.round([...document.querySelectorAll('.sidebar .cal-item.is-block')].find(block => block.textContent.includes('Zahnarzt-Test')).getBoundingClientRect().height)"), 57, 'The block lasts as long as the range (75 min).');
  // A click marks an hour; the edges resize it; Escape discards.
  point = await markRange(14 * 60 + 10);
  await release(point);
  await until(`${selection} === '14:00 – 15:00' && Boolean(document.querySelector('.cal-composer.is-placed'))`);
  const edge = await evaluate("(() => { const r=document.querySelector('.sidebar .cal-selection-edge.is-end').getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; })()");
  await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:edge.x, y:edge.y });
  await command('Input.dispatchMouseEvent', { type:'mousePressed', x:edge.x, y:edge.y, button:'left', buttons:1, clickCount:1 });
  await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:edge.x, y:edge.y + 36, button:'left', buttons:1 });
  await command('Input.dispatchMouseEvent', { type:'mouseReleased', x:edge.x, y:edge.y + 36, button:'left', buttons:0, clickCount:1 });
  await until(`${selection} === '14:00 – 15:45'`);
  await until("Boolean(document.querySelector('.cal-composer.is-placed'))");
  await evaluate("document.querySelector('.cal-composer-text').focus()");
  await key('Enter', 'Enter');
  await until("document.querySelector('.cal-composer-text').classList.contains('is-shaking')");
  assert.equal(await evaluate('window.__uiTest.saves'), savesBeforeCreate + 1, 'Nothing is created without text.');
  await key('Escape');
  await until(`!document.querySelector('.cal-composer') && !document.querySelector('.sidebar .cal-selection')`);
  // Dragging into the bottom edge scrolls the hours along.
  const scrolled = await evaluate("document.querySelector('.sidebar .cal-time').scrollTop");
  const bottom = await evaluate("(() => { const r=document.querySelector('.sidebar .cal-time').getBoundingClientRect(); return r.bottom - 6; })()");
  const startDrag = await markRange(16 * 60);
  await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:startDrag.x, y:bottom, button:'left', buttons:1 });
  await until(`document.querySelector('.sidebar .cal-time').scrollTop > ${scrolled + 100}`);
  await release({ x:startDrag.x, y:bottom });
  assert(await evaluate("Number(document.querySelector('.sidebar .cal-selection-time').textContent.slice(8, 10))") >= 18, 'The range follows the scrolling.');
  await key('Escape');
  await until("!document.querySelector('.cal-composer')");
  // On another day the entry goes straight into the store; the journal stays on its day.
  const journalDay = await evaluate(heading);
  await evaluate(`${side()}.focus()`);
  await key('ArrowRight', 'ArrowRight');
  const nextDay = await evaluate('window.__uiTest.shift(1)');
  await until(`${side('.cal-day-side h2')}?.textContent === ${longDate(nextDay)} || ${side('.cal-time-day')}?.title.startsWith(${longDate(nextDay)})`);
  await evaluate(`${side('.cal-time')}.scrollTop = 0`);
  point = await markRange(60 + 5, 60 + 35);
  await release(point);
  await until("document.activeElement === document.querySelector('.cal-composer-text')");
  await evaluate("document.querySelector('.cal-composer [aria-label^=\"Aufgabe\"]').click()");
  await evaluate("document.querySelector('.cal-composer-text').focus()");
  await command('Input.insertText', { text:'Früh los' });
  await key('Enter', 'Enter');
  await until(`(window.__uiTest.day('${nextDay}')?.entries ?? []).some(entry => entry.text === 'Früh los')`);
  assert.deepEqual(await evaluate(`(({ kind, time, end, priority }) => ({ kind, time, end, priority }))(window.__uiTest.day('${nextDay}').entries.find(entry => entry.text === 'Früh los'))`), { kind:'task', time:'01:00', end:'01:45', priority:false });
  assert.equal(await evaluate(heading), journalDay, 'The journal stays where it was.');
  await until("[...document.querySelectorAll('.sidebar .cal-item.is-block')].some(block => block.textContent.includes('Früh los'))");
  await key('m', 'KeyM');
  await until(`${side()}.dataset.view === 'month'`);
  // Right click edits an entry in the calendar: in the time grid as a range (moved here) with the card in edit mode.
  await evaluate(`${side()}.focus()`);
  await key('h', 'KeyH');
  await key('t', 'KeyT');
  await until(`${side()}.dataset.view === 'day' && ${side('.cal-time-day')}?.title.startsWith(${longDate(sideToday)})`);
  const rightClick = async expression => {
    const target = await evaluate(`(() => { const element=${expression}; element.scrollIntoView({ block:'nearest' }); const r=element.getBoundingClientRect(); return { x:r.left+Math.min(r.width/2, 30), y:r.top+Math.min(r.height/2, 8) }; })()`);
    await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:target.x, y:target.y });
    await command('Input.dispatchMouseEvent', { type:'mousePressed', x:target.x, y:target.y, button:'right', buttons:2, clickCount:1 });
    await command('Input.dispatchMouseEvent', { type:'mouseReleased', x:target.x, y:target.y, button:'right', buttons:0, clickCount:1 });
  };
  const sideBlock = text => `[...document.querySelectorAll('.sidebar .cal-item')].find(item => item.textContent.includes(${JSON.stringify(text)}))`;
  await rightClick(sideBlock('Zahnarzt-Test'));
  await until("document.querySelector('.cal-composer.is-editing.is-placed') && document.activeElement === document.querySelector('.cal-composer-text')");
  assert.equal(await evaluate("document.querySelector('.cal-composer-text').value"), 'Zahnarzt-Test');
  assert.equal(await evaluate(selection), '09:15 – 10:30', 'The entry shows as its range.');
  assert.equal(await evaluate(`${sideBlock('Zahnarzt-Test')}.classList.contains('is-editing')`), true);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.cal-composer-kinds [role=radio]')].map(kind => kind.getAttribute('aria-label') + ':' + kind.getAttribute('aria-checked'))"), ['Ereignis:true', 'Aufgabe:false'], 'A timed entry cannot become a note.');
  await key('a', 'KeyA', 1);
  await key('ArrowDown', 'ArrowDown');
  await until(`${selection} === '09:30 – 10:45'`);
  await command('Input.dispatchKeyEvent', { type:'keyDown', key:'a', code:'KeyA', modifiers:2 }); await command('Input.dispatchKeyEvent', { type:'keyUp', key:'a', code:'KeyA', modifiers:2 });
  await command('Input.insertText', { text:'Zahnarzt verschoben' });
  await pause(400);
  await screenshot('calendar-edit.png');
  await key('Enter', 'Enter');
  await until("!document.querySelector('.cal-composer') && [...document.querySelectorAll('.entry')].some(row => row.textContent.includes('Zahnarzt verschoben'))");
  const moved = "[...document.querySelectorAll('.entry')].find(row => row.textContent.includes('Zahnarzt verschoben'))";
  assert.deepEqual(await evaluate(`[${moved}.dataset.entryKind, ${moved}.querySelector('.entry-when').textContent]`), ['task', '09:30–10:45'], 'Kind, time and text change in the journal.');
  // In the month (another day), the card edits in place and can remove the entry.
  await key('m', 'KeyM');
  await until(`${side()}.dataset.view === 'month'`);
  await rightClick(sideBlock('Früh los'));
  await until("document.querySelector('.cal-composer.is-editing.is-placed') && !document.querySelector('.cal-composer-time')");
  await evaluate("document.querySelector('.cal-composer-text').focus()");
  await command('Input.insertText', { text:'!' });
  await key('Enter', 'Enter');
  await until(`window.__uiTest.day('${nextDay}').entries.some(entry => entry.text === 'Früh los!')`);
  assert.equal(await evaluate(heading), journalDay, 'Editing another day leaves the journal where it was.');
  await until(`Boolean(${sideBlock('Früh los!')})`);
  await rightClick(sideBlock('Früh los!'));
  await until("Boolean(document.querySelector('.cal-composer.is-editing .cal-composer-remove'))");
  await evaluate("document.querySelector('.cal-composer-remove').click()");
  await until(`!window.__uiTest.day('${nextDay}').entries.some(entry => entry.text.startsWith('Früh los'))`);

  // Kinds change in the journal too: Alt ⇧ E / A / N, or the kind cluster next to the orbit's planning (with a preview).
  await evaluate("[...document.querySelectorAll('.kind-picker button')].find(button => button.textContent === 'Aufgabe').click()");
  await until("Boolean(document.activeElement?.closest('.entry'))");
  await command('Input.insertText', { text:'Typwechsel' });
  const kindRow = "[...document.querySelectorAll('.entry')].find(row => row.textContent.includes('Typwechsel'))";
  await key('E', 'KeyE', 9);
  await until(`${kindRow}.dataset.entryKind === 'event'`);
  assert.equal(await evaluate(`document.activeElement === ${kindRow}.querySelector('.entry-text')`), true, 'The cursor stays in the text.');
  await evaluate(`${kindRow}.querySelector('.entry-symbol').click()`);
  await until("Boolean(document.querySelector('.entry-dock-shell.is-open .dock-kind'))");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.entry-dock-shell.is-open .dock-kind button')].map(button => button.getAttribute('aria-label') + ':' + button.getAttribute('aria-pressed'))"), ['Als Ereignis:true', 'Als Aufgabe:false', 'Als Notiz:false']);
  // Hovering another kind previews it on the symbol (once the cluster has sprung into place).
  await pause(500);
  await command('Input.dispatchMouseEvent', { type:'mouseMoved', ...await evaluate("(() => { const r=document.querySelector('.entry-dock-shell.is-open .dock-kind-task').getBoundingClientRect(); return { x:r.left+r.width/2-1, y:r.top+r.height/2 }; })()") });
  await hover('.entry-dock-shell.is-open .dock-kind-task');
  await until(`${kindRow}.querySelector('.entry-symbol svg.icon-ghost')?.dataset.icon === 'task'`);
  await pause(450);
  await screenshot('orbit-kind.png');
  await evaluate("document.querySelector('.entry-dock-shell.is-open .dock-kind-note').click()");
  await until(`${kindRow}.dataset.entryKind === 'note'`);
  await key('Escape');
  // A moved entry stays editable: saving its trace passes text and kind on to the copy.
  await evaluate(`(() => { const text=${kindRow}.querySelector('.entry-text'); text.focus(); text.setSelectionRange(text.value.length, text.value.length); })()`);
  await key('A', 'KeyA', 9);
  await until(`${kindRow}.dataset.entryKind === 'task'`);
  await key('m', 'KeyM', 1);
  await until(`${kindRow}.dataset.trace === 'tomorrow'`);
  await key('s', 'KeyS', 2);
  const copyOf = `window.__uiTest.day(window.__uiTest.date).entries.find(entry => entry.text === 'Typwechsel')?.plan?.targets[0].id`;
  await until(`Boolean(${copyOf})`);
  const copyId = await evaluate(copyOf);
  await evaluate(`(() => { const text=${kindRow}.querySelector('.entry-text'); text.focus(); text.setSelectionRange(text.value.length, text.value.length); })()`);
  await command('Input.insertText', { text:' (neu)' });
  await key('E', 'KeyE', 9);
  await key('s', 'KeyS', 2);
  await until(`(() => { const copy=window.__uiTest.day(window.__uiTest.shift(1))?.entries.find(entry => entry.id === '${copyId}'); return copy?.text === 'Typwechsel (neu)' && copy.kind === 'event'; })()`);

  // Dragging the edge sets the sidebar's width (remembered), within limits that leave the journal room; a double click resets it.
  const widthOf = () => evaluate("Math.round(document.querySelector('.sidebar').getBoundingClientRect().width)");
  const before = await widthOf();
  const dragEdge = async dx => {
    const edge = await evaluate("(() => { const r=document.querySelector('.sidebar-resizer').getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+200 }; })()");
    await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:edge.x, y:edge.y });
    await command('Input.dispatchMouseEvent', { type:'mousePressed', x:edge.x, y:edge.y, button:'left', buttons:1, clickCount:1 });
    const to = Math.max(0, edge.x + dx);
    await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:edge.x + (to - edge.x) / 2, y:edge.y, button:'left', buttons:1 });
    await until("document.querySelector('.app').classList.contains('is-resizing')");
    await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:to, y:edge.y, button:'left', buttons:1 });
    await command('Input.dispatchMouseEvent', { type:'mouseReleased', x:to, y:edge.y, button:'left', buttons:0, clickCount:1 });
  };
  await dragEdge(150);
  await until(`Math.round(document.querySelector('.sidebar').getBoundingClientRect().width) === ${before + 150}`);
  assert.equal(await evaluate("localStorage.getItem('journal.sidebar')"), String(before + 150), 'The width is remembered.');
  await pause(450);
  await screenshot('journal-sidebar-wide.png');
  await dragEdge(5000);
  await until("Math.round(innerWidth - document.querySelector('.main').getBoundingClientRect().width) === Math.round(innerWidth - 420)");
  await dragEdge(-5000);
  assert.equal(await widthOf(), 280, 'The sidebar does not get narrower than 280 px.');
  await pause(450);
  await screenshot('journal-sidebar-narrow.png');
  // Nothing in the toolbar sticks out of the sidebar or overlaps anything else.
  assert.equal(await evaluate(`(() => { const parts=[...document.querySelectorAll('.sidebar .cal-title, .sidebar .cal-views, .sidebar .cal-filter, .sidebar .cal-nav')].map(part => part.getBoundingClientRect()), edge=document.querySelector('.sidebar').getBoundingClientRect().right;
    return parts.every((a, i) => a.right <= edge + 1 && parts.every((b, j) => i === j || a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1)); })()`), true, 'The calendar toolbar fits the narrowest sidebar.');
  await evaluate("document.querySelector('.sidebar-resizer').focus()");
  await key('ArrowRight', 'ArrowRight');
  assert.equal(await widthOf(), 304);
  await evaluate("document.querySelector('.sidebar-resizer').dispatchEvent(new MouseEvent('dblclick', { bubbles:true }))");
  await until(`Math.round(document.querySelector('.sidebar').getBoundingClientRect().width) === ${before}`);
  await pause(450);
  await screenshot('journal-sidebar.png');

  await command('Emulation.setEmulatedMedia', { features:[] });
  await command('Emulation.setDeviceMetricsOverride', { width:1120, height:760, deviceScaleFactor:1, mobile:false });
  await command('Page.navigate', { url:`${origin}/?window=calendar` });
  await until("Boolean(document.querySelector('.cal'))");
  await evaluate("localStorage.removeItem('journal.calendar'); location.reload()");
  await until("document.querySelector('.cal')?.dataset.view === 'month' && document.querySelectorAll('.cal-item').length > 0");
  const [today, tomorrow, crowded, later] = await evaluate('[window.__uiTest.date, window.__uiTest.shift(1), window.__uiTest.shift(3), window.__uiTest.shift(2)]');
  const cell = date => `[...document.querySelectorAll('.cal-month-day')].find(cell => cell.querySelector('.cal-month-number').getAttribute('aria-label').startsWith(${longDate(date)}))`;
  const texts = selector => evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(item => item.querySelector('.cal-item-text').textContent)`);
  assert.equal(await evaluate(`${cell(today)}.classList.contains('is-today')`), true);
  assert.deepEqual(await evaluate(`[...${cell(tomorrow)}.querySelectorAll('.cal-item-text')].map(item => item.textContent)`), ['Bericht abgeben', 'Zahnarzt', 'Telefonat mit Anna'], 'Without time first, priority first; Markdown is plain; traces and (by default) notes are left out.');
  assert.match(await evaluate(`${cell(crowded)}.querySelector('.cal-more').textContent`), /^\+\d+ weitere$/, 'A full day ends with "+n weitere".');
  assert.equal(await evaluate(`${cell(crowded)}.querySelector('.cal-month-title').textContent`), 'Großer Tag');
  assert.equal(await evaluate(`${cell(crowded)}.scrollHeight <= ${cell(crowded)}.clientHeight + 1`), true, 'Entries never overflow a day.');
  await pause(350);
  await screenshot('calendar-month.png');
  // Swiping (or Shift + wheel) steps the view: here a month.
  const monthTitle = "document.querySelector('.cal-title strong').textContent";
  const shown = await evaluate(monthTitle);
  for (let step = 0; step < 10; step++) await wheel('.cal-body', 30, 0);
  await until(`${monthTitle} !== ${JSON.stringify(shown)} && Boolean(document.querySelector('.cal-page.slide-next'))`);
  const next = await evaluate(monthTitle);
  await pause(300);
  assert.equal(await evaluate(monthTitle), next, 'One swipe is one month.');
  await wheel('.cal-body', 0, -100, 8);
  await until(`${monthTitle} === ${JSON.stringify(shown)}`);
  // The time shows only while hovering, in the item's bottom right corner.
  const timeOf = item => `getComputedStyle([...${cell(tomorrow)}.querySelectorAll('.cal-item')][${item}].querySelector('.cal-item-time')).opacity`;
  assert.equal(await evaluate(timeOf(1)), '0', 'No time without hovering.');
  assert.equal(await evaluate(`${cell(tomorrow)}.querySelector('.cal-item-text').textContent.includes(':')`), false);
  await hoverAt(`[...${cell(tomorrow)}.querySelectorAll('.cal-item')][1]`);
  await until(`${timeOf(1)} === '1'`);
  assert.equal(await evaluate(`(() => { const item=[...${cell(tomorrow)}.querySelectorAll('.cal-item')][1], time=item.querySelector('.cal-item-time').getBoundingClientRect(), box=item.getBoundingClientRect(); return Math.abs(time.right - box.right) < 4 && Math.abs(time.bottom - box.bottom) < 4 && !item.querySelector('.cal-item-time').classList.contains('is-scrolling'); })()`), true, 'It sits in the bottom right corner and fits.');
  await evaluate(`[...${cell(tomorrow)}.querySelectorAll('.cal-item')][1].click()`);
  assert.deepEqual(await evaluate('window.__uiTest.invoked.at(-1)'), ['show_day', { date:tomorrow, entry:'20000000-0000-4000-8000-000000000001' }], 'An entry opens in the journal.');

  // The journal saving a day shows up at once.
  await evaluate(`window.__uiTest.store({ ...window.__uiTest.day('${today}'), entries:[...window.__uiTest.day('${today}').entries, { id:'30000000-0000-4000-8000-000000000001', kind:'event', text:'Spontan dazu', done:false, cancelled:false, priority:false, time:'20:00', reminder:false, plan:null }] })`);
  await until(`[...${cell(today)}.querySelectorAll('.cal-item-text')].some(item => item.textContent === 'Spontan dazu') || ${cell(today)}.querySelector('.cal-more')?.textContent !== undefined`);

  // Views by key: J M W A T and 1–5; the choice is remembered.
  await key('w', 'KeyW');
  await until("document.querySelector('.cal').dataset.view === 'week' && document.querySelectorAll('.cal-time-column').length === 7");
  assert.equal(await evaluate("document.querySelector('.cal-views [aria-selected=true]').getAttribute('aria-label')"), 'Woche');
  assert.equal(await evaluate("document.querySelectorAll('.cal-time-column.is-today .cal-now').length"), 1, 'Today shows the current time.');
  assert(await evaluate("document.querySelector('.cal-time').scrollTop") > 200, 'The hours start scrolled to the morning.');
  await pause(350);
  await screenshot('calendar-week.png');
  await key('a', 'KeyA');
  await until("document.querySelector('.cal').dataset.view === 'workweek' && document.querySelectorAll('.cal-time-column').length === 5");
  await pause(350);
  await screenshot('calendar-workweek.png');
  await key('1', 'Digit1');
  await until("document.querySelector('.cal').dataset.view === 'year' && document.querySelectorAll('.cal-year-month').length === 12");
  assert.equal(await evaluate("document.querySelectorAll('.cal-year-day.is-today').length"), 1);
  await pause(350);
  await screenshot('calendar-year.png');
  // The smallest window: the views move below the title, nothing is cut off.
  await command('Emulation.setDeviceMetricsOverride', { width:640, height:460, deviceScaleFactor:1, mobile:false });
  await key('2', 'Digit2');
  await pause(350);
  assert.equal(await evaluate("[...document.querySelectorAll('.cal-toolbar > *')].every(part => part.getBoundingClientRect().right <= innerWidth) && document.querySelector('.cal').scrollWidth <= innerWidth"), true, 'The toolbar fits the narrowest window.');
  await screenshot('calendar-narrow.png');
  // Where the time does not fit (overlapping entries in a narrow week), it runs through the corner from right to left.
  await key('w', 'KeyW');
  await until("document.querySelector('.cal').dataset.view === 'week'");
  if (!await evaluate("document.querySelectorAll('.cal-item.is-block.is-event').length >= 2")) await key('ArrowRight', 'ArrowRight');
  await until("document.querySelectorAll('.cal-item.is-block.is-event').length >= 2");
  await hoverAt("[...document.querySelectorAll('.cal-item.is-block.is-event')].find(item => item.textContent.includes('Telefonat'))");
  await until("[...document.querySelectorAll('.cal-item.is-block.is-event')].find(item => item.textContent.includes('Telefonat')).querySelector('.cal-item-time.is-scrolling')?.firstElementChild.getAnimations().length === 1");
  await pause(500);
  await screenshot('calendar-ticker.png');
  await key('m', 'KeyM');
  await command('Emulation.setDeviceMetricsOverride', { width:1120, height:760, deviceScaleFactor:1, mobile:false });
  await key('j', 'KeyJ');
  // In the year a dot marks tasks, a blue ring events, a dot in a ring both.
  const yearDay = date => `[...document.querySelectorAll('.cal-year-day')].find(day => day.title.startsWith(new Intl.DateTimeFormat('de-DE', { weekday:'short', day:'2-digit', month:'2-digit' }).format(new Date('${date}T12:00'))))`;
  const mark = date => evaluate(`${yearDay(date)}.querySelector('.cal-year-mark')?.className ?? 'none'`);
  await until(`Boolean(${yearDay(crowded)}.querySelector('.cal-year-mark'))`);
  assert.equal(await mark(tomorrow), 'cal-year-mark is-task is-event');
  assert.equal(await mark(crowded), 'cal-year-mark is-task');
  assert.equal(await mark(await evaluate('window.__uiTest.shift(5)')), 'cal-year-mark is-event');
  assert.equal(await mark(await evaluate('window.__uiTest.shift(6)')), 'none');
  // A day clicked in any view opens its note in the journal (the calendar goes there too); T shows that day's hours,
  // where overlapping entries share the width.
  await evaluate(`${yearDay(tomorrow)}.click()`);
  assert.deepEqual(await evaluate('window.__uiTest.invoked.at(-1)'), ['show_day', { date:tomorrow, entry:null }]);
  assert.equal(await evaluate("document.querySelector('.cal').dataset.view"), 'year');
  await key('t', 'KeyT');
  await until("document.querySelector('.cal').dataset.view === 'day' && document.querySelectorAll('.cal-time-column').length === 1");
  const blocks = await evaluate("[...document.querySelectorAll('.cal-item.is-block')].map(block => { const r=block.getBoundingClientRect(); return { left:Math.round(r.left), width:Math.round(r.width) }; })");
  assert.equal(blocks.length, 2); assert(blocks[0].left !== blocks[1].left && Math.abs(blocks[0].width - blocks[1].width) < 2, 'Overlapping entries stand side by side.');
  assert.deepEqual(await texts('.cal-time-allday .cal-item'), ['Bericht abgeben']);
  await evaluate("document.querySelector('.cal-filter-note').click()");
  await until("[...document.querySelectorAll('.cal-time-allday .cal-item-text')].some(item => item.textContent === 'Gute Laune')");
  assert.equal(await evaluate("document.querySelector('.cal-day-notes').textContent.includes('Gute Laune')"), true);
  await pause(350);
  await screenshot('calendar-day.png');
  await evaluate("document.querySelector('.cal-open').click()");
  assert.deepEqual(await evaluate('window.__uiTest.invoked.at(-1)'), ['show_day', { date:tomorrow, entry:null }]);
  await key('ArrowRight', 'ArrowRight');
  await until(`document.querySelector('.cal-day-side h2').textContent === ${longDate(later)}`);
  await evaluate('location.reload()');
  await until("document.querySelector('.cal')?.dataset.view === 'day'");
  assert.equal(await evaluate("document.querySelector('.cal-filter-note').getAttribute('aria-pressed')"), 'true', 'View and filters are remembered.');

  // The compact month: its own small window to click days in.
  await command('Emulation.setDeviceMetricsOverride', { width:292, height:330, deviceScaleFactor:1, mobile:false });
  await command('Page.navigate', { url:`${origin}/?window=mini` });
  await until("document.querySelectorAll('.cal-compact-day').length === 42");
  await evaluate(`window.__uiTest.emit('journal:date', '${tomorrow}')`);
  await until("document.querySelectorAll('.cal-compact-day[aria-selected=true]').length === 1");
  assert.equal(await evaluate("document.querySelector('.cal-compact-day.is-today').getAttribute('aria-current')"), 'date');
  assert.equal(await evaluate("document.querySelector('.mini').scrollHeight <= innerHeight"), true, 'The compact month fits its window.');
  await pause(350);
  await screenshot('calendar-mini.png');
  await evaluate("document.querySelector('.cal-compact-day.is-today').click()");
  assert.deepEqual(await evaluate('window.__uiTest.invoked.at(-1)'), ['show_day', { date:today, entry:null }]);
  await evaluate("document.querySelector('.mini-pin').click()");
  await until("document.querySelector('.mini-pin').getAttribute('aria-pressed') === 'true'");
  assert.equal(await evaluate("window.__uiTest.invoked.at(-1)[0]"), 'plugin:window|set_always_on_top');
  const month = await evaluate("document.querySelector('.mini .cal-title').textContent");
  await key('PageDown', 'PageDown');
  await until(`document.querySelector('.mini .cal-title').textContent !== ${JSON.stringify(month)}`);
}

try {
  let page;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { page = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find(value => value.type === 'page'); } catch {}
    if (page) break;
    await pause(75);
  }
  assert(page, 'Edge did not expose a test page.');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => { socket.addEventListener('open', resolveOpen, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  });
  await command('Runtime.enable');
  await command('Page.enable');
  await command('Emulation.setDeviceMetricsOverride', { width:1180, height:780, deviceScaleFactor:1, mobile:false });
  await command('Page.navigate', { url:`http://127.0.0.1:${server.address().port}/` });
  await until("document.querySelectorAll('.entry').length === 5");
  await pause(250);
  assert.equal(await evaluate("Boolean(document.querySelector('#body'))"), false, 'Freiraum must be absent.');
  assert.equal(await evaluate("Boolean(document.querySelector('.entry-type'))"), false);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.entry-text')).backgroundColor"), 'rgba(0, 0, 0, 0)');
  const expectedColor = 'rgb(86, 158, 255)';
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.entry-symbol')).map(element => getComputedStyle(element).color)"), Array(5).fill(expectedColor));
  const strike = await evaluate("(() => { const line=document.querySelector('.strike-overlay line'); return {left:Number(line.getAttribute('x1')),right:Number(line.getAttribute('x2'))}; })()");
  assert.equal(strike.left, -40); assert(strike.right > 100);
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.entry')).map(row => row.dataset.entryKind)"), ['event','task','task','task','note']);
  const gaps = await evaluate("(() => { const rows=Array.from(document.querySelectorAll('.entry')).map(row => row.getBoundingClientRect()); return { same:rows[2].top-rows[1].bottom, different:rows[1].top-rows[0].bottom }; })()");
  assert(gaps.different > gaps.same + 10, 'Categories must have more space between them.');
  await evaluate('document.fonts.ready.then(() => true)');
  assert.deepEqual(await evaluate("['#title', '.entry-text', '.cm-line'].map(selector => getComputedStyle(document.querySelector(selector)).fontFamily.split(',')[0].replace(/[\"']/g, ''))"), ['Lilex', 'Lilex', 'Lilex'], 'Writing fields use Lilex.');
  assert.equal(await evaluate("Array.from(document.fonts).some(font => font.family.replace(/[\"']/g, '') === 'Lilex' && font.status === 'loaded')"), true, 'Lilex is loaded from the bundle.');
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.entry')).map(row => { const a=row.querySelector('.entry-symbol').getBoundingClientRect(), line=row.querySelector('.cm-line'), b=line.getBoundingClientRect(), first=parseFloat(getComputedStyle(line).lineHeight); return Math.abs(a.top+a.height/2-b.top-first/2) < 1; })"), Array(5).fill(true), 'Symbols sit on the first text line (requires the editor styles under the CSP).');
  assert.deepEqual(await evaluate("(() => { const s=getComputedStyle(document.querySelector('.cm-content')); return [s.paddingTop, s.whiteSpace, getComputedStyle(document.querySelector('.cm-line')).lineHeight, getComputedStyle(document.querySelector('.cm-editor')).fontSize]; })()"), ['6px', 'break-spaces', '24px', '13px']);
  await screenshot('journal.png');

  const firstTaskRow = "document.querySelector('[data-entry-id=\"10000000-0000-4000-8000-000000000001\"]')";
  assert.equal(await evaluate("document.querySelector('[data-entry-kind=event] .entry-symbol svg').dataset.icon"), 'priority-event');
  assert.equal(await evaluate("document.querySelector('[data-entry-kind=event] .entry-symbol svg').getAttribute('fill')"), 'none', 'A priority event must use an outlined asterisk.');
  const closedHeight = await evaluate(`${firstTaskRow}.offsetHeight`);
  const nextTop = await evaluate(`${firstTaskRow}.nextElementSibling.getBoundingClientRect().top`);
  await evaluate("document.querySelector('[data-entry-kind=task] .entry-symbol').click()");
  await until("document.activeElement?.getAttribute('aria-label') === 'Als erledigt markieren'");
  await pause(450);
  assert.equal(await evaluate(`${firstTaskRow}.offsetHeight`), closedHeight, 'The floating actions must not push the layout.');
  assert.equal(await evaluate(`${firstTaskRow}.nextElementSibling.getBoundingClientRect().top`), nextTop);
  assert.equal(await evaluate("Array.from(document.querySelectorAll('.entry-dock-shell.is-open button')).every(button => button.textContent.trim() === '')"), true, 'Actions are icon-only.');
  await pause(300);
  const orbit = await evaluate(`(() => {
    const row=${firstTaskRow}, symbol=row.querySelector('.entry-symbol').getBoundingClientRect(), text=row.querySelector('.cm-line').getBoundingClientRect();
    const cx=symbol.left+symbol.width/2, cy=symbol.top+symbol.height/2;
    const rects=Array.from(row.querySelectorAll('.dock-satellite:not(:disabled)')).map(button => button.getBoundingClientRect());
    const distances=rects.map(r => Math.hypot(r.left+r.width/2-cx, r.top+r.height/2-cy));
    const overlap=rects.some((a, i) => rects.some((b, j) => i !== j && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1));
    const onText=rects.some(r => r.right > text.left + 2 && r.top < text.bottom - 2 && r.bottom > text.top + 2);
    const plan=row.querySelector('.dock-planning').getBoundingClientRect();
    return { count:rects.length, distances, overlap, onText, planRight:Math.abs(plan.right-row.getBoundingClientRect().right), planBelow:plan.top >= row.getBoundingClientRect().bottom - 3 };
  })()`);
  assert.equal(orbit.count, 6, 'A task orbit: up, priority, remove and three states (down is disabled for the last task).');
  assert(orbit.distances.every(distance => Math.abs(distance - 44) < 2), `Satellites sit on the orbit around the symbol (${orbit.distances.map(Math.round)}).`);
  assert.equal(orbit.overlap, false, 'Satellites do not overlap.');
  assert.equal(orbit.onText, false, 'Satellites leave the text of the row free.');
  assert(orbit.planRight < 2 && orbit.planBelow, 'Planning is a separate cluster under the end of the row.');
  await hover('.entry-dock-shell.is-open [aria-label="Aufgabe abbrechen"]');
  await until(`${firstTaskRow}.dataset.preview === 'cancelled' && Boolean(${firstTaskRow}.querySelector('.strike-overlay.is-ghost line'))`);
  await hover('.entry-dock-shell.is-open [aria-label="Als erledigt markieren"]');
  await until(`${firstTaskRow}.dataset.preview === 'done' && Boolean(${firstTaskRow}.querySelector('.entry-symbol .icon-ghost'))`);
  await pause(700);
  await screenshot('menu.png');
  await hover('h1');
  await until(`!${firstTaskRow}.dataset.preview`);
  const priorityTextHeight = await evaluate(`${firstTaskRow}.querySelector('.entry-text').clientHeight`);
  await evaluate(`void (window.__priorityText = ${firstTaskRow}.querySelector('.entry-text'))`);
  await hover('.entry-dock-shell.is-open [aria-label="Als Priorität markieren"]');
  await until(`${firstTaskRow}.dataset.preview === 'priority' && ${firstTaskRow}.querySelector('.entry-symbol svg').dataset.icon === 'priority'`);
  assert.equal(await evaluate(`${firstTaskRow}.dataset.priority`), undefined, 'Previewing priority must not change the entry.');
  await evaluate("document.querySelector('.entry-dock-shell.is-open [aria-label=\"Als Priorität markieren\"]').focus()");
  await key('Enter');
  await until(`${firstTaskRow}.dataset.priority === 'high' && document.querySelector('.entry-dock-shell.is-open .dock-priority').getAttribute('aria-pressed') === 'true'`);
  await hover('h1');
  await pause(300);
  assert.equal(await evaluate(`${firstTaskRow}.querySelector('.entry-text') === window.__priorityText`), true, 'Priority must preserve the existing text element.');
  assert.equal(await evaluate(`${firstTaskRow}.querySelector('.entry-text').clientHeight`), priorityTextHeight, 'The marker must not change text wrapping.');
  assert.equal(await evaluate(`${firstTaskRow}.offsetHeight`), closedHeight);
  assert.equal(await evaluate(`getComputedStyle(${firstTaskRow}.querySelector('.entry-symbol')).color`), expectedColor, 'The type symbol must keep its blue color.');
  assert.equal(await evaluate(`${firstTaskRow}.querySelector('.entry-symbol svg').dataset.icon`), 'priority');
  assert.equal(await evaluate("Boolean(document.querySelector('.entry-priority-marker'))"), false, 'Priority must be shown by the type symbol instead of a separate flag.');
  await screenshot('priority.png');
  await evaluate("document.querySelector('.entry-dock-shell.is-open [aria-label=\"Priorität entfernen\"]').focus()");
  await key('Enter');
  await until(`!${firstTaskRow}.dataset.priority`);
  await key('Enter');
  await until(`${firstTaskRow}.dataset.priority === 'high'`);
  await command('Input.dispatchKeyEvent', { type:'keyDown', key:'Escape', code:'Escape' });
  await command('Input.dispatchKeyEvent', { type:'keyUp', key:'Escape', code:'Escape' });
  await until("!document.querySelector('.entry-dock-shell.is-open')");
  await pause(170);
  assert.equal(await evaluate("document.activeElement.className"), 'entry-symbol');

  const eventId = '10000000-0000-4000-8000-000000000003';
  const firstTask = '10000000-0000-4000-8000-000000000001';
  const doneTask = '10000000-0000-4000-8000-000000000004';
  const cancelledTask = '10000000-0000-4000-8000-000000000005';
  const noteId = '10000000-0000-4000-8000-000000000002';
  const readOrder = () => evaluate("Array.from(document.querySelectorAll('.entry')).map(row => row.dataset.entryId)");
  await evaluate(`document.querySelector('[data-entry-id="${cancelledTask}"] .entry-symbol').click()`);
  await evaluate("document.querySelector('.entry-dock-shell.is-open [aria-label=\"Als Priorität markieren\"]').click()");
  await until(`document.querySelector('[data-entry-id="${cancelledTask}"]').dataset.priority === 'high'`);
  await hover('h1');
  await pause(350);
  assert.deepEqual(await readOrder(), [eventId,firstTask,cancelledTask,doneTask,noteId], 'New priority must move ahead of ordinary entries in its category.');
  assert.equal(await evaluate(`document.querySelector('[data-entry-id="${cancelledTask}"] .entry-symbol svg').dataset.icon`), 'priority');
  assert.equal(await evaluate('document.activeElement.closest(".entry").dataset.entryId'), cancelledTask, 'Automatic sorting must retain focus on the priority action.');
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Priorität entfernen');
  await closeDock();
  await pause(200);
  await dragRow(cancelledTask, doneTask, 'after');
  assert.deepEqual(await readOrder(), [eventId,firstTask,cancelledTask,doneTask,noteId], 'Dragging must not move priority entries below ordinary ones.');
  await evaluate(`document.querySelector('[data-entry-id="${cancelledTask}"] .entry-text').focus()`);
  await key('ArrowDown', 'ArrowDown', 1);
  assert.deepEqual(await readOrder(), [eventId,firstTask,cancelledTask,doneTask,noteId], 'Alt+Down must stop at the priority boundary.');
  for (const id of [cancelledTask, firstTask]) {
    await evaluate(`document.querySelector('[data-entry-id="${id}"] .entry-symbol').click()`);
    await evaluate("document.querySelector('.entry-dock-shell.is-open [aria-label=\"Priorität entfernen\"]').click()");
    await closeDock();
  }
  await hover('h1');
  await pause(350);
  await dragRow(cancelledTask, firstTask);
  assert.deepEqual(await readOrder(), [eventId,cancelledTask,firstTask,doneTask,noteId], 'Pointer dragging must reorder siblings.');
  await dragRow(cancelledTask, noteId);
  assert.deepEqual(await readOrder(), [eventId,cancelledTask,firstTask,doneTask,noteId], 'Dragging into another category must do nothing.');
  await dragRow(cancelledTask, doneTask, 'after', true);
  assert.deepEqual(await readOrder(), [eventId,cancelledTask,firstTask,doneTask,noteId], 'Escape must cancel dragging.');
  await evaluate(`document.querySelector('[data-entry-id="${cancelledTask}"] .entry-grip').focus()`);
  await command('Input.dispatchKeyEvent', { type:'keyDown', key:'ArrowDown', code:'ArrowDown', modifiers:1 });
  await command('Input.dispatchKeyEvent', { type:'keyUp', key:'ArrowDown', code:'ArrowDown', modifiers:1 });
  assert.deepEqual(await readOrder(), [eventId,firstTask,cancelledTask,doneTask,noteId]);
  assert.equal(await evaluate('document.activeElement.closest(".entry").dataset.entryId'), cancelledTask, 'Keyboard reordering must retain focus.');
  await evaluate(`document.querySelector('[data-entry-id="${cancelledTask}"] .entry-symbol').click()`);
  await evaluate("document.querySelector('.entry-dock-shell.is-open [aria-label=\"Nach unten\"]').click()");
  assert.deepEqual(await readOrder(), [eventId,firstTask,doneTask,cancelledTask,noteId], 'Menu must reorder within the category.');

  await evaluate(`(() => { const text=document.querySelector('[data-entry-id="${doneTask}"] .entry-text'); text.focus(); text.setSelectionRange(4, 8, 'forward'); })()`);
  await command('Input.dispatchKeyEvent', { type:'keyDown', key:'ArrowUp', code:'ArrowUp', modifiers:1 });
  await command('Input.dispatchKeyEvent', { type:'keyUp', key:'ArrowUp', code:'ArrowUp', modifiers:1 });
  assert.deepEqual(await readOrder(), [eventId,doneTask,firstTask,cancelledTask,noteId], 'Alt+Up must reorder directly from the text.');
  assert.deepEqual(await evaluate('({id:document.activeElement.closest(".entry").dataset.entryId, tag:document.activeElement.classList.contains("entry-text") ? "EDITOR" : document.activeElement.tagName, start:document.activeElement.selectionStart, end:document.activeElement.selectionEnd})'), { id:doneTask, tag:'EDITOR', start:4, end:8 });
  await command('Input.dispatchKeyEvent', { type:'keyDown', key:'ArrowDown', code:'ArrowDown', modifiers:1 });
  await command('Input.dispatchKeyEvent', { type:'keyUp', key:'ArrowDown', code:'ArrowDown', modifiers:1 });
  assert.deepEqual(await readOrder(), [eventId,firstTask,doneTask,cancelledTask,noteId]);

  await evaluate(`document.querySelector('[data-entry-id="${firstTask}"] .entry-symbol').click()`);
  await until("Boolean(document.querySelector('.entry-dock-shell.is-open'))");
  await evaluate("document.querySelector('.entry-dock-shell.is-open [aria-label=\"Als Priorität markieren\"]').click()");
  await hover('h1');
  await until(`${firstTaskRow}.dataset.priority === 'high'`);
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.entry-dock-shell.is-open .dock-planning button')).map(button => ({label:button.getAttribute('aria-label'), disabled:button.disabled}))"), [{label:'Auf morgen verschieben',disabled:false},{label:'Datum und Uhrzeit planen',disabled:false},{label:'Mehrere Tage',disabled:false}]);
  await evaluate("document.querySelector('.entry-dock-shell.is-open [aria-label=\"Als erledigt markieren\"]').click()");
  await until("document.querySelector('.entry-dock-shell.is-open .status-track').dataset.status === 'done'");
  assert.equal(await evaluate(`${firstTaskRow}.dataset.priority`), 'high', 'Completing a task must retain priority.');
  assert.equal(await evaluate(`${firstTaskRow}.querySelector('.entry-symbol svg').dataset.icon`), 'done', 'Completed tasks must retain their X.');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-entry-id="${firstTask}"] .entry-symbol')).color`), expectedColor);
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-entry-id="${firstTask}"] .strike-overlay'))`), false);
  await evaluate("document.querySelector('.entry-dock-shell.is-open [aria-label=\"Aufgabe abbrechen\"]').click()");
  await until("document.querySelector('.entry-dock-shell.is-open .status-track').dataset.status === 'cancelled'");
  assert.equal(await evaluate(`${firstTaskRow}.dataset.priority`), 'high', 'Cancelling a task must retain priority.');
  assert.equal(await evaluate(`${firstTaskRow}.querySelector('.entry-symbol svg').dataset.icon`), 'priority', 'Cancelling must keep the priority asterisk.');
  await evaluate("document.querySelector('.entry-dock-shell.is-open [aria-label=\"Wieder öffnen\"]').click()");
  await until("document.querySelector('.entry-dock-shell.is-open .status-track').dataset.status === 'open'");
  await closeDock();
  await evaluate(`document.querySelector('[data-entry-id="${eventId}"] .entry-symbol').click()`);
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.entry-dock-shell.is-open .dock-planning button')).map(button => button.getAttribute('aria-label'))"), ['Datum und Uhrzeit planen','Mehrere Tage'], 'Events can be planned but not moved to tomorrow in one click.');
  assert.equal(await evaluate("Boolean(document.querySelector('.entry-dock-shell.is-open .status-track'))"), false);
  assert.equal(await evaluate("document.activeElement.classList.contains('entry-dock-shell')"), true, 'Without a status, the toolbar itself takes focus instead of a destructive action.');
  await pause(450);
  assert.equal(await evaluate(`document.querySelector('[data-entry-id="${firstTask}"] .entry-symbol').querySelectorAll('svg').length`), 1, 'Status changes must leave exactly one symbol icon.');
  await screenshot('event-actions.png');
  await evaluate("document.querySelector('.entry-dock-shell.is-open [aria-label=\"Priorität entfernen\"]').click()");
  await until(`!document.querySelector('[data-entry-id="${eventId}"]').dataset.priority`);
  await hover('h1');
  assert.equal(await evaluate(`document.querySelector('[data-entry-id="${eventId}"] .entry-symbol svg').dataset.icon`), 'event');
  assert.equal(await evaluate(`document.querySelector('[data-entry-id="${eventId}"]').dataset.entryKind`), 'event');
  await closeDock();
  const orderBeforePriority = await readOrder();
  await evaluate(`document.querySelector('[data-entry-id="${noteId}"] .entry-symbol').click()`);
  await evaluate("document.querySelector('.entry-dock-shell.is-open [aria-label=\"Als Priorität markieren\"]').click()");
  await until(`document.querySelector('[data-entry-id="${noteId}"]').dataset.priority === 'high'`);
  await hover('h1');
  assert.equal(await evaluate(`document.querySelector('[data-entry-id="${noteId}"] .entry-symbol svg').dataset.icon`), 'priority-note');
  assert.equal(await evaluate(`document.querySelector('[data-entry-id="${noteId}"] .entry-symbol path').getAttribute('stroke-width')`), '3');
  assert.deepEqual(await readOrder(), orderBeforePriority, 'A single note must remain in its category.');
  await closeDock();

  await evaluate("Array.from(document.querySelectorAll('.kind-picker button')).find(button => button.textContent === 'Aufgabe').click()");
  await until("document.querySelectorAll('.entry').length === 6 && document.activeElement.classList.contains('entry-text')");
  await evaluate("void (window.__editTarget = document.activeElement); window.__newEntryId = document.activeElement.closest('.entry').dataset.entryId;");
  const newRow = `document.querySelector('[data-entry-id="' + window.__newEntryId + '"]')`;
  const longText = 'Ein längerer eigener Testeintrag mit Umlauten: ä, ö und ü. '.repeat(9);
  await command('Input.insertText', { text:longText });
  await until(`document.activeElement.value === ${JSON.stringify(longText)}`);
  assert.equal(await evaluate('document.activeElement === window.__editTarget'), true, 'Typing must retain focus and the DOM node.');
  const dimensions = await evaluate("({height:document.activeElement.clientHeight,scroll:document.activeElement.scrollHeight})");
  assert(dimensions.height > 42); assert(dimensions.scroll <= dimensions.height + 1, 'All text must remain visible.');
  assert.equal(await evaluate("getComputedStyle(document.activeElement).backgroundColor"), 'rgba(0, 0, 0, 0)');
  assert.equal(await evaluate("getComputedStyle(document.activeElement).outlineStyle"), 'none');

  await evaluate(`${newRow}.querySelector('.entry-symbol').click()`);
  await evaluate("document.querySelector('.entry-dock-shell.is-open [aria-label=\"Aufgabe abbrechen\"]').click()");
  await until(`${newRow}.querySelectorAll('.strike-overlay line').length > 1`);
  await closeDock();
  const wideHeight = await evaluate(`${newRow}.querySelector('.entry-text').clientHeight`);
  await command('Emulation.setDeviceMetricsOverride', { width:760, height:780, deviceScaleFactor:1, mobile:false });
  await until(`${newRow}.querySelector('.entry-text').clientHeight > ${wideHeight}`);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'No horizontal overflow.');
  await pause(250);
  const lineBounds = await evaluate(`(() => { const row=${newRow}.querySelector('.entry-edit'); return Array.from(row.querySelectorAll('line')).every(line => Number(line.getAttribute('x2')) <= row.clientWidth + 1); })()`);
  assert(lineBounds, 'Strike lines must follow the wrapped text.');

  await evaluate(`${newRow}.querySelector('.entry-grip').focus()`);
  await command('Input.dispatchKeyEvent', { type:'keyDown', key:'ArrowUp', code:'ArrowUp', modifiers:1 });
  await command('Input.dispatchKeyEvent', { type:'keyUp', key:'ArrowUp', code:'ArrowUp', modifiers:1 });
  const savedOrder = await readOrder();

  await command('Input.dispatchKeyEvent', { type:'keyDown', key:'s', code:'KeyS', modifiers:2 });
  await command('Input.dispatchKeyEvent', { type:'keyUp', key:'s', code:'KeyS', modifiers:2 });
  await until("window.__uiTest.saves === 1 && document.querySelector('.save-status').textContent === 'Gespeichert'");
  assert.equal(await evaluate('window.__uiTest.day().body'), 'Bestehender Freitext bleibt erhalten.');
  assert.equal(await evaluate('new Set(window.__uiTest.day().entries.map(entry => entry.id)).size'), 6);
  assert.deepEqual(await evaluate('window.__uiTest.day().entries.filter(entry => entry.priority).map(entry => entry.id).sort()'), [firstTask,noteId].sort());
  assert.equal(await evaluate(`document.activeElement === ${newRow}.querySelector('.entry-grip')`), true, 'Saving must not move focus away from the editor.');
  await evaluate(`${newRow}.querySelector('.entry-text').focus()`);
  await command('Input.insertText', { text:'!' });
  await command('Input.dispatchKeyEvent', { type:'keyDown', key:'s', code:'KeyS', modifiers:2 });
  await command('Input.dispatchKeyEvent', { type:'keyUp', key:'s', code:'KeyS', modifiers:2 });
  await until("window.__uiTest.saves === 2 && document.querySelector('.save-status').textContent === 'Gespeichert'");
  assert.equal(await evaluate(`document.activeElement === ${newRow}.querySelector('.entry-text')`), true, 'Saving while typing must keep the caret in the text.');
  await command('Input.dispatchKeyEvent', { type:'rawKeyDown', key:'Backspace', code:'Backspace', windowsVirtualKeyCode:8 });
  await command('Input.dispatchKeyEvent', { type:'keyUp', key:'Backspace', code:'Backspace', windowsVirtualKeyCode:8 });
  await command('Input.dispatchKeyEvent', { type:'keyDown', key:'s', code:'KeyS', modifiers:2 });
  await command('Input.dispatchKeyEvent', { type:'keyUp', key:'s', code:'KeyS', modifiers:2 });
  await until("window.__uiTest.saves === 3 && document.querySelector('.save-status').textContent === 'Gespeichert'");
  const navigateWithoutLoading = label => evaluate(`new Promise(resolveSwitch => {
    let loading = false;
    const observer = new MutationObserver(() => { if (document.querySelector('.loading')) loading = true; });
    observer.observe(document.body, { childList:true, subtree:true });
    document.querySelector('[aria-label="${label}"]').click();
    requestAnimationFrame(() => requestAnimationFrame(() => { observer.disconnect(); resolveSwitch(loading); }));
  })`);
  await pause(600);

  assert.equal(await navigateWithoutLoading('Nächster Tag'), false, 'Prefetched days must open without a loading state.');
  await until("Boolean(document.querySelector('.empty'))");
  assert.equal(await navigateWithoutLoading('Vorheriger Tag'), false, 'Saved days must reopen from the cache.');
  await until("document.querySelectorAll('.entry').length === 6");
  assert.equal(await evaluate(`${newRow}.querySelector('.entry-text').value`), longText);
  assert.deepEqual(await readOrder(), savedOrder, 'Order and IDs must survive saving and reopening the day.');
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.entry[data-priority=high]')).map(row => row.dataset.entryId).sort()"), [firstTask,noteId].sort(), 'Setting and clearing priority must survive reopening the day.');

  await evaluate("Array.from(document.querySelectorAll('.kind-picker button')).find(button => button.textContent === 'Notiz').click()");
  await until("document.querySelectorAll('.entry').length === 7");
  await command('Input.insertText', { text:'Wird gleich entfernt' });
  const doomed = await evaluate("document.activeElement.closest('.entry').dataset.entryId");
  await evaluate(`document.querySelector('[data-entry-id="${doomed}"] .entry-symbol').click()`);
  await until("Boolean(document.querySelector('.entry-dock-shell.is-open'))");
  await evaluate("document.querySelector('.entry-dock-shell.is-open [aria-label=\"Eintrag entfernen\"]').click()");
  assert.equal(await evaluate(`document.querySelector('[data-entry-id="${doomed}"]').classList.contains('entry-leaving')`), true, 'Removing must animate the row out.');
  await until(`!document.querySelector('[data-entry-id="${doomed}"]') && document.querySelectorAll('.entry').length === 6`);

  // Planning: previews, calendar with keyboard, time and reminder, traces, undo, tomorrow, events, same-day time, saving and the target day.
  const row = id => `document.querySelector('[data-entry-id="${id}"]')`;
  const symbolIcon = id => evaluate(`${row(id)}.querySelector('.entry-symbol svg').dataset.icon`);
  // Sets a time on the clock dial with real pointer input: tap the hour (inner ring for 13–00), then the minute.
  const clockPoint = (value, ring) => evaluate(`(() => { const face=document.querySelector('.clock-face').getBoundingClientRect(); const a=${value}*Math.PI/6; const r=${ring}; return { x:face.left+face.width/2+r*Math.sin(a), y:face.top+face.height/2-r*Math.cos(a) }; })()`);
  const tap = async point => {
    await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:point.x, y:point.y });
    await command('Input.dispatchMouseEvent', { type:'mousePressed', x:point.x, y:point.y, button:'left', buttons:1, clickCount:1 });
    await command('Input.dispatchMouseEvent', { type:'mouseReleased', x:point.x, y:point.y, button:'left', buttons:0, clickCount:1 });
  };
  const setTime = async value => {
    const [hour, minute] = value.split(':').map(Number);
    if (!(await evaluate("Boolean(document.querySelector('.clock'))"))) await evaluate("document.querySelector('.planner-time-toggle').click()");
    await until("Math.round(document.querySelector('.clock-face')?.getBoundingClientRect().width ?? 0) === 196");
    await evaluate("document.querySelector('.clock-part').click()");
    await until("Math.round(document.querySelector('.clock-face').getBoundingClientRect().width) === 196");
    await tap(await clockPoint(hour % 12, hour === 0 || hour > 12 ? 52 : 80));
    await until("document.querySelector('.clock-part[aria-pressed=true]').getAttribute('aria-label').startsWith('Minute')");
    await until("Math.round(document.querySelector('.clock-numbers').getBoundingClientRect().width) === 196");
    await tap(await clockPoint(minute / 5, 80));
    await until(`document.querySelector('.clock-face').getAttribute('aria-valuetext') === '${value}'`);
  };
  const tomorrow = await evaluate("(() => { const d=new Date(); d.setDate(d.getDate()+1); return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'); })()");
  const inTwoDays = await evaluate("(() => { const d=new Date(); d.setDate(d.getDate()+2); return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'); })()");
  const nextWeek = await evaluate("(() => { const d=new Date(); d.setDate(d.getDate()+7); return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'); })()");
  const shortDate = value => evaluate(`new Intl.DateTimeFormat('de-DE', { weekday:'short', day:'2-digit', month:'2-digit' }).format(new Date('${value}T12:00'))`);

  await evaluate(`${row(firstTask)}.querySelector('.entry-symbol').click()`);
  await until("Boolean(document.querySelector('.entry-dock-shell.is-open .dock-plan-tomorrow'))");
  await pause(400);
  await hover('.entry-dock-shell.is-open .dock-plan-tomorrow');
  await until(`${row(firstTask)}.dataset.preview === 'tomorrow' && ${row(firstTask)}.querySelector('.entry-symbol svg.icon-ghost')?.dataset.icon === 'migrated'`);
  assert.equal(await evaluate(`${row(firstTask)}.dataset.trace`), undefined, 'Previewing must not plan.');
  await evaluate("document.querySelector('.entry-dock-shell.is-open .dock-plan-date').click()");
  await until("Boolean(document.querySelector('.entry-dock-shell.is-open .planner')) && document.activeElement.getAttribute('aria-selected') === 'true'");
  assert.match(await evaluate("document.activeElement.getAttribute('aria-label')"), /aktueller Tag/, 'The calendar starts on the entry\'s own day.');
  assert.equal(await evaluate("document.querySelectorAll('.planner-day').length"), 42);
  for (const target of ['.planner-month', '.planner-weekdays', '.planner']) {
    await tap(await evaluate(`(() => { const r=document.querySelector('${target}').getBoundingClientRect(); return { x:r.left+6, y:r.top+4 }; })()`));
    await pause(80);
    assert.equal(await evaluate("Boolean(document.querySelector('.entry-dock-shell.is-open .planner'))"), true, `Clicking ${target} must keep the calendar open.`);
  }
  const monthBefore = await evaluate("document.querySelector('.planner-month').textContent");
  await tap(await evaluate("(() => { const r=Array.from(document.querySelectorAll('.planner-day.is-outside')).at(-1).getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; })()"));
  await until(`document.querySelector('.planner-month').textContent !== ${JSON.stringify(monthBefore)}`);
  assert.equal(await evaluate("Boolean(document.querySelector('.entry-dock-shell.is-open .planner'))"), true, 'Choosing a day of the next month must keep the calendar open.');
  await evaluate("document.querySelector('.planner-nav').click()");
  await until(`document.querySelector('.planner-month').textContent === ${JSON.stringify(monthBefore)}`);
  await evaluate("document.querySelector('.planner-day[aria-label*=\"aktueller Tag\"]').click()");
  await evaluate("document.querySelector('.planner-day[aria-selected=true]').focus()");
  await key('ArrowRight'); await key('ArrowRight');
  await until(`document.activeElement.getAttribute('aria-selected') === 'true' && ${row(firstTask)}.querySelector('.entry-symbol svg.icon-ghost')?.dataset.icon === 'scheduled'`);
  const calendarSize = await evaluate("(() => { const planner=document.querySelector('.planner'); return [planner.offsetWidth, planner.offsetHeight]; })()");
  await evaluate("document.querySelector('.planner-time-toggle').click()");
  await until("Boolean(document.querySelector('.clock-face')) && document.activeElement.classList.contains('clock-face')");
  assert.equal(await evaluate("document.querySelector('.clock-face').getAttribute('aria-valuetext')"), await evaluate("String((new Date().getHours()+1)%24).padStart(2,'0') + ':00'"), 'The clock starts at the next full hour.');
  await pause(400);
  assert.deepEqual(await evaluate("(() => { const planner=document.querySelector('.planner'); return [planner.offsetWidth, planner.offsetHeight]; })()"), calendarSize, 'The clock is exactly as large as the calendar.');
  assert(await evaluate("(() => { const body=document.querySelector('.planner-body'); const face=document.querySelector('.clock-face'), quick=document.querySelector('.clock-quick'); return face.offsetTop + face.offsetHeight <= body.offsetHeight + 1 && quick.getBoundingClientRect().right <= body.getBoundingClientRect().right + 1; })()"), 'The clock fits the calendar area.');
  assert(await evaluate("(() => { const back=document.querySelector('.clock-back').getBoundingClientRect(), body=document.querySelector('.planner-body').getBoundingClientRect(); return back.left - body.left < 4 && back.top - body.top < 6; })()"), 'The back button sits top left.');
  assert.equal(await evaluate("document.querySelector('.clock').textContent.includes('Tab')"), false, 'No Tab hint on the clock.');
  await key('Tab');
  assert.equal(await evaluate("document.querySelector('.clock-part[aria-pressed=true]').getAttribute('aria-label').startsWith('Minute') && document.activeElement.classList.contains('clock-face')"), true, 'Tab switches to minutes and keeps focus on the dial.');
  await key('Tab', 'Tab', 8);
  assert.equal(await evaluate("document.querySelector('.clock-part[aria-pressed=true]').getAttribute('aria-label').startsWith('Stunde')"), true, 'Shift+Tab switches back as well.');
  const typeTime = async digits => { for (const digit of digits) await key(digit, `Digit${digit}`); };
  for (const [digits, expected] of [['1530', '15:30'], ['930', '09:30'], ['250', '02:50']]) {
    await evaluate("document.querySelector('.clock-part').click()");
    await typeTime(digits);
    await until(`document.querySelector('.clock-face').getAttribute('aria-valuetext') === '${expected}'`);
  }
  await evaluate("document.querySelector('.clock-back').click()");
  await until("!document.querySelector('.clock') && document.activeElement.getAttribute('aria-selected') === 'true'");
  await evaluate("document.querySelector('.planner-time-toggle').click()");
  await until("Boolean(document.querySelector('.clock-face')) && document.activeElement.classList.contains('clock-face')");
  await tap(await evaluate("(() => { const r=document.querySelector('.clock-readout').getBoundingClientRect(); return { x:r.left+2, y:r.top+2 }; })()"));
  assert.equal(await evaluate("Boolean(document.querySelector('.entry-dock-shell.is-open .clock'))"), true, 'Clicking inside the clock must keep it open.');
  await setTime('15:30');
  const face = await evaluate("(() => { const r=document.querySelector('.clock-face').getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; })()");
  await command('Input.dispatchMouseEvent', { type:'mouseWheel', x:face.x, y:face.y, deltaX:0, deltaY:-100 });
  await until("document.querySelector('.clock-face').getAttribute('aria-valuetext') === '15:35'");
  await key('ArrowDown');
  await until("document.querySelector('.clock-face').getAttribute('aria-valuetext') === '15:34'");
  await evaluate("Array.from(document.querySelectorAll('.clock-quick button')).find(button => button.textContent === '20').click()");
  await until("document.querySelector('.clock-face').getAttribute('aria-valuetext') === '20:00'");
  await setTime('15:30');
  assert.equal(await evaluate("document.querySelector('.scroll').scrollTop >= 0"), true);
  await pause(450);
  await screenshot('clock.png');
  await evaluate("document.querySelector('.planner-time-toggle').click()");
  await until("Boolean(document.querySelector('.planner-grid')) && document.activeElement.getAttribute('aria-selected') === 'true'");
  await evaluate("document.querySelector('.planner-reminder').click()");
  await until("document.querySelector('.planner-reminder').getAttribute('aria-pressed') === 'true' && document.querySelector('.planner-confirm').getAttribute('aria-label').endsWith('15:30 Uhr')");
  assert.equal(await evaluate("document.querySelector('.planner-confirm').textContent"), await shortDate(inTwoDays));
  assert(await evaluate("(() => { const planner=document.querySelector('.planner'); return Array.from(document.querySelectorAll('.planner-foot > *')).every(item => item.offsetParent === planner && item.offsetLeft + item.offsetWidth <= planner.clientWidth - 10 && item.offsetWidth >= 28); })()"), 'Calendar controls must fit inside the panel.');
  await hover('h1');
  await pause(450);
  assert.equal(await evaluate("(() => { const scroll=document.querySelector('.scroll'); const before=scroll.scrollLeft; scroll.scrollLeft=200; const moved=scroll.scrollLeft !== before; scroll.scrollLeft=before; return !moved && scroll.offsetHeight === scroll.clientHeight; })()"), true, 'The calendar at the end of the row causes no horizontal scrolling.');
  await screenshot('planner.png');
  await key('Escape');
  await until(`!document.querySelector('.entry-dock-shell.is-open') && document.activeElement === ${row(firstTask)}.querySelector('.entry-symbol')`);
  assert.equal(await evaluate(`${row(firstTask)}.dataset.trace`), undefined, 'Escape leaves the calendar completely, without planning.');
  // A press outside closes the calendar as well, and so does Escape when focus is not inside it.
  await evaluate(`${row(firstTask)}.querySelector('.entry-symbol').click()`);
  await until("Boolean(document.querySelector('.entry-dock-shell.is-open .dock-plan-date'))");
  await evaluate("document.querySelector('.entry-dock-shell.is-open .dock-plan-date').click()");
  await until("Boolean(document.querySelector('.entry-dock-shell.is-open .planner'))");
  await tap(await evaluate("(() => { const r=document.querySelector('.document-header h1').getBoundingClientRect(); return { x:r.left+20, y:r.top+10 }; })()"));
  await until("!document.querySelector('.entry-dock-shell.is-open')");
  await evaluate(`${row(firstTask)}.querySelector('.entry-symbol').click()`);
  await until("Boolean(document.querySelector('.entry-dock-shell.is-open .dock-plan-date'))");
  await evaluate("document.querySelector('.entry-dock-shell.is-open .dock-plan-date').click()");
  await until("Boolean(document.querySelector('.entry-dock-shell.is-open .planner'))");
  await evaluate("document.activeElement.blur()");
  await key('Escape');
  await until("!document.querySelector('.entry-dock-shell.is-open')");
  await evaluate(`${row(firstTask)}.querySelector('.entry-symbol').click()`);
  await until("Boolean(document.querySelector('.entry-dock-shell.is-open .dock-plan-date'))");
  await evaluate("document.querySelector('.entry-dock-shell.is-open .dock-plan-date').click()");
  await until("document.activeElement.getAttribute('aria-selected') === 'true'");
  await key('ArrowRight'); await key('ArrowRight');
  await setTime('15:30');
  await evaluate("document.querySelector('.planner-reminder').click()");
  await evaluate("document.querySelector('.planner-confirm').click()");
  await until(`${row(firstTask)}.dataset.trace === 'date' && !document.querySelector('.entry-dock-shell.is-open')`);
  assert.equal(await symbolIcon(firstTask), 'scheduled', 'A task planned for a date shows <.');
  assert.equal(await evaluate(`${row(firstTask)}.querySelector('.entry-trace-target').textContent`), `${await shortDate(inTwoDays)}15:30`);
  assert.equal(await evaluate(`${row(firstTask)}.querySelector('.entry-trace-target .icon') !== null`), true, 'The reminder is shown as a bell.');
  assert.equal(await evaluate(`${row(firstTask)}.querySelector('.entry-text').readOnly`), false, 'A trace stays editable (its copies follow when saved).');
  await pause(400);
  await screenshot('planned.png');

  await evaluate(`${row(firstTask)}.querySelector('.entry-symbol').click()`);
  await until("Boolean(document.querySelector('.entry-dock-shell.is-open .dock-jump'))");
  assert.equal(await evaluate("Boolean(document.querySelector('.entry-dock-shell.is-open .status-track, .entry-dock-shell.is-open .dock-planning'))"), false, 'Traces offer neither status nor planning.');
  await evaluate("document.querySelector('.entry-dock-shell.is-open .dock-unplan').click()");
  await until(`!${row(firstTask)}.dataset.trace && ${row(firstTask)}.querySelector('.entry-text').readOnly === false`);
  await evaluate(`${row(firstTask)}.querySelector('.entry-symbol').click()`);
  await until("Boolean(document.querySelector('.entry-dock-shell.is-open .dock-plan-tomorrow'))");
  await evaluate("document.querySelector('.entry-dock-shell.is-open .dock-plan-tomorrow').click()");
  await until(`${row(firstTask)}.dataset.trace === 'tomorrow'`);
  assert.equal(await symbolIcon(firstTask), 'migrated', 'Moving to tomorrow shows >.');

  await evaluate(`${row(eventId)}.querySelector('.entry-symbol').click()`);
  await until("Boolean(document.querySelector('.entry-dock-shell.is-open .dock-plan-date'))");
  await evaluate("document.querySelector('.entry-dock-shell.is-open .dock-plan-date').click()");
  await until("document.activeElement.getAttribute('aria-selected') === 'true'");
  await key('ArrowDown');
  await key('Enter');
  await until(`${row(eventId)}.dataset.trace === 'date'`);
  assert.equal(await symbolIcon(eventId), 'scheduled-event', 'A planned event shows the outlined <.');
  assert.equal(await evaluate(`${row(eventId)}.querySelector('.entry-symbol svg').getAttribute('fill')`), 'none');

  await evaluate(`${newRow}.querySelector('.entry-symbol').click()`);
  await until("Boolean(document.querySelector('.entry-dock-shell.is-open .dock-plan-date'))");
  await evaluate("document.querySelector('.entry-dock-shell.is-open .dock-plan-date').click()");
  await until("Boolean(document.querySelector('.planner'))");
  await evaluate("document.querySelector('.planner-time-toggle').click()");
  await until("Boolean(document.querySelector('.clock-quick'))");
  await evaluate("Array.from(document.querySelectorAll('.clock-quick button')).find(button => button.textContent === '08').click()");
  await until("document.querySelector('.planner-confirm').textContent === 'Hier' && document.querySelector('.planner-confirm').getAttribute('aria-label') === 'Übernehmen, 08:00 Uhr'");
  await evaluate("document.querySelector('.planner-confirm').click()");
  await until(`${newRow}.querySelector('.entry-when')?.textContent === '08:00'`);
  assert.equal(await evaluate(`Boolean(${newRow}.querySelector('.entry-edit').compareDocumentPosition(${newRow}.querySelector('.entry-when')) & Node.DOCUMENT_POSITION_FOLLOWING)`), true, 'The time stands after the text.');
  assert.equal(await evaluate(`${newRow}.dataset.trace`), undefined, 'A time on the same day does not move the entry.');

  const savesBeforePlan = await evaluate('window.__uiTest.saves');
  await key('s', 'KeyS', 2);
  await until(`window.__uiTest.saves === ${savesBeforePlan + 1} && document.querySelector('.save-status').textContent === 'Gespeichert'`);
  const stored = await evaluate('window.__uiTest.day().entries');
  assert.equal(stored.find(entry => entry.id === firstTask).plan.targets[0].date, tomorrow);
  assert.equal(stored.find(entry => entry.id === eventId).plan.targets[0].date, nextWeek);
  assert.equal(stored.find(entry => entry.text === longText).time, '08:00');
  assert.equal(await evaluate(`window.__uiTest.day('${nextWeek}').entries[0].kind`), 'event');
  await evaluate(`${row(firstTask)}.querySelector('.entry-symbol').click()`);
  await until("Boolean(document.querySelector('.entry-dock-shell.is-open .dock-jump'))");
  assert.equal(await evaluate("Boolean(document.querySelector('.entry-dock-shell.is-open .dock-unplan'))"), false, 'Saved plans cannot be taken back.');
  await closeDock();
  await evaluate(`${row(firstTask)}.querySelector('.entry-trace-target').click()`);
  await until(`document.querySelector('.document-header h1').textContent.includes('${Number(tomorrow.slice(8))}.') && Boolean(${row(stored.find(entry => entry.id === firstTask).plan.targets[0].id)})`);
  const copyId = stored.find(entry => entry.id === firstTask).plan.targets[0].id;
  assert.equal(await evaluate(`${row(copyId)}.querySelector('.entry-text').value`), 'Eine Runde durch den Park gehen', 'The planned task appears on its new day.');
  assert.equal(await evaluate(`${row(copyId)}.dataset.trace`), undefined);
  assert.equal(await evaluate(`${row(copyId)}.dataset.priority`), 'high', 'Priority travels with the entry.');
  // Removing a moved entry asks whether its trace goes too; removing a trace whether the moved entry does.
  await evaluate(`${row(copyId)}.querySelector('.entry-symbol').click()`);
  await until("Boolean(document.querySelector('.entry-dock-shell.is-open .dock-remove'))");
  assert.match(await evaluate("document.querySelector('.entry-dock-shell.is-open .dock-remove').dataset.tip"), /Spur am/, 'The hint mentions the trace.');
  await evaluate("document.querySelector('.entry-dock-shell.is-open .dock-remove').click()");
  await until(`Boolean(${row(copyId)}.querySelector('.scope-choice'))`);
  assert.deepEqual(await evaluate(`[...${row(copyId)}.querySelectorAll('.scope-choice button')].map(button => button.textContent)`), ['Nur diesen', 'Alle 2'], 'Nothing follows the copy; all includes the trace before it.');
  assert.equal(await evaluate(`(() => { const choice=${row(copyId)}.querySelector('.dock-remove-choice .scope-choice.is-satellite'), cap=choice?.querySelector('.scope-choice-cap').getBoundingClientRect();
    return Boolean(choice) && !${row(copyId)}.querySelector('.dock-remove') && cap.width === 30 && choice.getBoundingClientRect().width > 150 && Boolean(document.querySelector('.entry-dock-shell.is-open')); })()`), true, 'In the orbit the question grows out of the trash satellite, which stays as its start.');
  assert.equal(await evaluate(`document.activeElement === ${row(copyId)}.querySelector('.scope-choice-this')`), true, 'Enter keeps to this entry.');
  await pause(400);
  await screenshot('scope-choice.png');
  await evaluate(`${row(copyId)}.querySelector('.scope-choice-all').click()`);
  await until(`!${row(copyId)}`);
  const savesBeforeRemove = await evaluate('window.__uiTest.saves');
  await key('s', 'KeyS', 2);
  await until(`window.__uiTest.saves === ${savesBeforeRemove + 1} && document.querySelector('.save-status').textContent === 'Gespeichert'`);
  await evaluate("document.querySelector('[aria-label=\"Vorheriger Tag\"]').click()");
  await until(`document.querySelectorAll('.entry').length > 0 && !${row(firstTask)} && Boolean(${row(eventId)})`);
  assert.equal(await evaluate(`window.__uiTest.day().entries.some(entry => entry.id === '${firstTask}')`), false, 'The trace is gone from its day.');
  await evaluate(`${row(eventId)}.querySelector('.entry-symbol').click()`);
  await until("Boolean(document.querySelector('.entry-dock-shell.is-open .dock-remove'))");
  assert.equal(await evaluate("document.querySelector('.entry-dock-shell.is-open .dock-remove').dataset.tip"), `Entfernen · auf Wunsch auch am ${await shortDate(nextWeek)}`);
  await evaluate("document.querySelector('.entry-dock-shell.is-open .dock-remove').click()");
  await until(`Boolean(${row(eventId)}.querySelector('.scope-choice'))`);
  assert.deepEqual(await evaluate(`[...${row(eventId)}.querySelectorAll('.scope-choice button')].map(button => button.textContent)`), ['Nur diesen', 'Auch den folgenden']);
  await key('ArrowRight', 'ArrowRight');
  await key('Enter', 'Enter');
  await until(`!${row(eventId)}`);
  await key('s', 'KeyS', 2);
  await until(`window.__uiTest.saves === ${savesBeforeRemove + 2} && document.querySelector('.save-status').textContent === 'Gespeichert'`);
  assert.equal(await evaluate(`window.__uiTest.day('${nextWeek}').entries.length`), 0, 'Removing a trace removes the planned event.');

  const focusedId = () => evaluate("document.activeElement.closest('.entry')?.dataset.entryId ?? document.activeElement.id");
  // Fonts, title and inline Markdown.
  assert.deepEqual(await evaluate("['body', 'h1', '.kind-picker button'].map(selector => getComputedStyle(document.querySelector(selector)).fontFamily.split(',')[0].replace(/[\"']/g, ''))"), ['IBM Plex Sans', 'IBM Plex Sans', 'IBM Plex Sans']);
  assert.equal(await evaluate("Array.from(document.fonts).some(font => font.family.replace(/[\"']/g, '') === 'IBM Plex Sans' && font.status === 'loaded')"), true, 'IBM Plex Sans is loaded from the bundle.');
  assert.deepEqual(await evaluate("(() => { const style=getComputedStyle(document.querySelector('#title')); return [style.fontWeight, style.fontSize]; })()"), ['700', '20px'], 'The title is larger and bold.');
  await evaluate("document.querySelector('#title').focus()");
  await key('n', 'KeyN', 1);
  await until("document.activeElement.classList.contains('entry-text') && document.activeElement.closest('.entry').dataset.entryKind === 'note'");
  const md = await focusedId();
  const mdText = () => evaluate(`${row(md)}.querySelector('.entry-text').value`);
  const select = (start, end) => evaluate(`(() => { const t=${row(md)}.querySelector('.entry-text'); t.focus(); t.setSelectionRange(${start}, ${end}); })()`);
  const source = 'Ein **fetter** und *kursiver* Tag mit ~~weg~~ und ==wichtig== sowie [Farbe]{rot}';
  await command('Input.insertText', { text:source });
  await until(`Boolean(${row(md)}.querySelector('.md-bold'))`);
  assert.deepEqual(await evaluate(`['.md-bold', '.md-italic', '.md-strike', '.md-highlight', '.md-color'].map(selector => ${row(md)}.querySelector(selector)?.textContent)`), ['fetter', 'kursiver', 'weg', 'wichtig', 'Farbe']);
  assert.equal(await evaluate(`getComputedStyle(${row(md)}.querySelector('.md-bold')).fontWeight`), '700');
  assert.equal(await evaluate(`getComputedStyle(${row(md)}.querySelector('.md-italic')).fontStyle`), 'italic');
  assert.equal(await evaluate(`getComputedStyle(${row(md)}.querySelector('.md-color')).color`), 'rgb(223, 98, 98)', 'Colours come from the Clean theme.');
  assert.equal(await evaluate(`getComputedStyle(${row(md)}.querySelector('.entry-text')).fontVariantLigatures`), 'none', 'Markers are not merged into ligatures.');
  await evaluate('document.fonts.ready.then(() => true)');
  assert.equal(await evaluate("['700 14px Lilex', 'italic 400 14px Lilex', 'italic 700 14px Lilex'].every(face => document.fonts.check(face))"), true, 'Bold and italic Lilex are preloaded.');
  // Live preview: markers only where the cursor is, none at all when the entry is not being edited.
  const shown = () => evaluate(`${row(md)}.querySelector('.entry-text').textContent`);
  assert.equal(await shown(), 'Ein fetter und kursiver Tag mit weg und wichtig sowie [Farbe]{rot}', 'With the cursor at the end only the colour markers there are shown.');
  assert.equal(await mdText(), source, 'The stored text keeps all markers.');
  await select(source.indexOf('fetter') + 2, source.indexOf('fetter') + 2);
  await until(`${row(md)}.querySelector('.entry-text').textContent === 'Ein **fetter** und kursiver Tag mit weg und wichtig sowie Farbe'`);
  assert.equal(await evaluate(`${row(md)}.querySelectorAll('.md-mark').length`), 2, 'Only the edited part shows its markers.');
  await select(source.indexOf('Tag') - 1, source.indexOf('Tag') - 1);
  await until(`${row(md)}.querySelector('.entry-text').textContent === 'Ein fetter und *kursiver* Tag mit weg und wichtig sowie Farbe'`, 'Directly after a part still counts as inside it.');
  await select(source.indexOf('wichtig') - 6, source.indexOf('Farbe') + 2);
  await until(`${row(md)}.querySelector('.entry-text').textContent === 'Ein fetter und kursiver Tag mit weg und ==wichtig== sowie [Farbe]{rot}'`);
  await evaluate("document.querySelector('#title').focus()");
  await until(`${row(md)}.querySelector('.entry-text').textContent === 'Ein fetter und kursiver Tag mit weg und wichtig sowie Farbe'`);
  assert.equal(await evaluate(`${row(md)}.querySelectorAll('.md-mark').length`), 0, 'No markers at all while not editing.');
  assert.equal(await evaluate(`${row(md)}.querySelector('.md-bold').textContent`), 'fetter', 'Formatting stays visible.');
  await pause(200);
  await screenshot('markdown-preview.png');
  assert(await evaluate(`(() => { const entry=document.querySelector('[data-entry-id="${cancelledTask}"]'); const line=entry.querySelector('.strike-overlay line'); const text=entry.querySelector('.cm-line'); const range=document.createRange(); range.selectNodeContents(text); return Math.abs(Number(line.getAttribute('x2')) - (range.getBoundingClientRect().right - entry.querySelector('.entry-edit').getBoundingClientRect().left)) < 2; })()`), 'The strike-through ends with the text, not the line box.');
  // Clicking into a hidden part reveals it and puts the caret where the click was.
  const clickAt = await evaluate(`(() => { const node=Array.from(${row(md)}.querySelectorAll('.md-italic')).at(-1); node.scrollIntoView({ block:'center' }); const r=node.getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; })()`);
  await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:clickAt.x, y:clickAt.y });
  await command('Input.dispatchMouseEvent', { type:'mousePressed', x:clickAt.x, y:clickAt.y, button:'left', buttons:1, clickCount:1 });
  await command('Input.dispatchMouseEvent', { type:'mouseReleased', x:clickAt.x, y:clickAt.y, button:'left', buttons:0, clickCount:1 });
  await until(`document.activeElement === ${row(md)}.querySelector('.entry-text') && document.activeElement.textContent.includes('*kursiver*')`);
  const caret = await evaluate('document.activeElement.selectionStart');
  assert(caret > source.indexOf('*kursiver*') && caret < source.indexOf('*kursiver*') + 10, `The caret lands inside the clicked word (${caret}).`);

  const word = source.indexOf('Tag');
  await select(word, word + 3);
  await key('b', 'KeyB', 2);
  await until(`${row(md)}.querySelector('.entry-text').value.includes('**Tag**')`);
  assert.deepEqual(await evaluate(`(() => { const t=${row(md)}.querySelector('.entry-text'); return [t.selectionStart, t.selectionEnd]; })()`), [word + 2, word + 5], 'The selection stays on the word.');
  await key('b', 'KeyB', 2);
  await until(`!${row(md)}.querySelector('.entry-text').value.includes('**Tag**')`);
  await key('i', 'KeyI', 2);
  await until(`${row(md)}.querySelector('.entry-text').value.includes('*Tag*')`);
  await command('Input.dispatchKeyEvent', { type:'rawKeyDown', key:'z', code:'KeyZ', modifiers:2, windowsVirtualKeyCode:90 });
  await command('Input.dispatchKeyEvent', { type:'keyUp', key:'z', code:'KeyZ', modifiers:2, windowsVirtualKeyCode:90 });
  await until(`!${row(md)}.querySelector('.entry-text').value.includes('*Tag*')`);
  assert.equal(await mdText(), source, 'Ctrl+Z undoes formatting.');
  await key('3', 'Digit3', 1);
  await until(`${row(md)}.querySelector('.entry-text').value.includes('[Tag]{gelb}')`);
  await key('0', 'Digit0', 1);
  await until(`!${row(md)}.querySelector('.entry-text').value.includes('{gelb}')`);
  assert.equal(await mdText(), source);
  await key('x', 'KeyX', 10);
  await key('h', 'KeyH', 10);
  await until(`${row(md)}.querySelector('.entry-text').value.includes('~~==Tag==~~')`);

  const contextAt = async () => {
    const point = await evaluate(`(() => { const r=${row(md)}.querySelector('.entry-text').getBoundingClientRect(); return { x:r.left+16, y:r.top+12 }; })()`);
    await command('Input.dispatchMouseEvent', { type:'mousePressed', x:point.x, y:point.y, button:'right', buttons:2, clickCount:1 });
    await command('Input.dispatchMouseEvent', { type:'mouseReleased', x:point.x, y:point.y, button:'right', buttons:0, clickCount:1 });
  };
  await select(0, 3);
  await contextAt();
  await until("Boolean(document.querySelector('.format-menu'))");
  assert.equal(await evaluate("document.querySelectorAll('.format-menu .format-color').length"), 9, 'Eight theme colours and “no colour”.');
  await pause(300);
  await screenshot('format-menu.png');
  await evaluate("document.querySelector('.format-menu [aria-label=\"Farbe grün\"]').dispatchEvent(new MouseEvent('click', { bubbles:true }))");
  await until(`${row(md)}.querySelector('.entry-text').value.startsWith('[Ein]{grün}')`);
  assert.equal(await evaluate("document.querySelector('.format-menu [aria-label=\"Farbe grün\"]').getAttribute('aria-pressed')"), 'true', 'The menu stays open and shows the current colour.');
  assert.equal(await evaluate(`document.activeElement === ${row(md)}.querySelector('.entry-text')`), true, 'The menu never takes focus from the text.');
  await evaluate("document.querySelector('.format-menu .format-bold').dispatchEvent(new MouseEvent('click', { bubbles:true }))");
  await until(`${row(md)}.querySelector('.entry-text').value.startsWith('[**Ein**]{grün}')`);
  await key('Escape');
  await until("!document.querySelector('.format-menu')");
  await select(5, 5);
  await contextAt();
  await pause(150);
  assert.equal(await evaluate("Boolean(document.querySelector('.format-menu'))"), false, 'Without a selection the system menu stays.');
  await key('Escape');
  await pause(300);
  await screenshot('markdown.png');
  await key('Delete', 'Delete', 1);
  await until(`!${row(md)}`);

  // Keyboard shortcuts, as in the F1 overview.
  const focusedEntry = focusedId;
  const active = () => evaluate("({ tag: document.activeElement.classList.contains('entry-text') ? 'EDITOR' : document.activeElement.tagName, id: document.activeElement.closest('.entry')?.dataset.entryId ?? null })");
  await key('F1', 'F1');
  await until("Boolean(document.querySelector('.shortcuts'))");
  assert(await evaluate("document.querySelectorAll('.shortcut').length") >= 28);
  await pause(400);
  await screenshot('shortcuts.png');
  await key('Escape');
  await until("!document.querySelector('.shortcuts')");

  await evaluate("document.querySelector('#title').focus()");
  await key('a', 'KeyA', 1);
  await until("document.activeElement.classList.contains('entry-text') && document.activeElement.closest('.entry').dataset.entryKind === 'task'");
  const first = await focusedEntry();
  await command('Input.insertText', { text:'Per Tastatur' });
  await key('Enter');
  await until(`document.activeElement.classList.contains('entry-text') && document.activeElement.closest('.entry').dataset.entryId !== '${first}'`);
  const second = await focusedEntry();
  assert.equal(await evaluate(`${row(first)}.nextElementSibling === ${row(second)} && ${row(second)}.dataset.entryKind === 'task'`), true, 'Enter adds an entry of the same kind directly below.');
  assert.equal(await evaluate(`${row(first)}.querySelector('.entry-text').value`), 'Per Tastatur', 'Enter does not insert a line break.');
  await command('Input.dispatchKeyEvent', { type:'rawKeyDown', key:'Backspace', code:'Backspace', windowsVirtualKeyCode:8 });
  await command('Input.dispatchKeyEvent', { type:'keyUp', key:'Backspace', code:'Backspace', windowsVirtualKeyCode:8 });
  await until(`!${row(second)} && document.activeElement === ${row(first)}.querySelector('.entry-text')`);
  assert.equal(await evaluate("document.activeElement.selectionStart"), 'Per Tastatur'.length, 'Backspace in an empty entry removes it and continues at the end of the one above.');

  await key('d', 'KeyD', 1);
  await until(`${row(first)}.dataset.status === 'done'`);
  assert.deepEqual(await active(), { tag:'EDITOR', id:first }, 'Alt+D keeps typing focus.');
  await key('x', 'KeyX', 1);
  await until(`${row(first)}.dataset.status === 'cancelled'`);
  await key('x', 'KeyX', 1);
  await until(`${row(first)}.dataset.status === 'open'`);
  await key('p', 'KeyP', 1);
  await until(`${row(first)}.dataset.priority === 'high'`);
  assert.deepEqual(await active(), { tag:'EDITOR', id:first }, 'Alt+P re-sorts but keeps the caret in the text.');
  await key('ArrowUp', 'ArrowUp', 2);
  const above = await active();
  assert.notEqual(above.id, first, 'Ctrl+Up moves to the entry above.');
  await key('ArrowDown', 'ArrowDown', 2);
  assert.deepEqual(await active(), { tag:'EDITOR', id:first }, 'Ctrl+Down comes back.');

  await key('u', 'KeyU', 1);
  await until(`Boolean(${row(first)}.querySelector('.clock-face')) && document.activeElement.classList.contains('clock-face')`);
  await typeTime('0930');
  await key('Enter');
  await until(`${row(first)}.querySelector('.entry-when')?.textContent === '09:30' && !document.querySelector('.entry-dock-shell.is-open')`);
  assert.deepEqual(await active(), { tag:'EDITOR', id:first }, 'Alt+U, typing and Enter return to the text.');
  await key('t', 'KeyT', 1);
  await until(`Boolean(${row(first)}.querySelector('.planner-grid')) && document.activeElement.getAttribute('aria-selected') === 'true'`);
  await key('ArrowRight');
  await key('Escape');
  await until("!document.querySelector('.entry-dock-shell.is-open')");
  assert.deepEqual(await active(), { tag:'EDITOR', id:first }, 'Escape from a planner opened by Alt+T returns to the text.');
  assert.equal(await evaluate(`${row(first)}.dataset.trace`), undefined);
  await key('Enter', 'Enter', 1);
  await until(`Boolean(${row(first)}.querySelector('.entry-dock-shell.is-open'))`);
  await key('Enter', 'Enter', 1);
  await until("!document.querySelector('.entry-dock-shell.is-open')");
  await key('m', 'KeyM', 1);
  await until(`${row(first)}.dataset.trace === 'tomorrow'`);
  await key('Delete', 'Delete', 1);
  await until(`!${row(first)}`);

  await key('s', 'KeyS', 2);
  await until("document.querySelector('.save-status').textContent === 'Gespeichert'");
  const heading = await evaluate("document.querySelector('.document-header h1').textContent");
  await key('ArrowRight', 'ArrowRight', 1);
  await until(`document.querySelector('.document-header h1').textContent !== ${JSON.stringify(heading)}`);
  await key('h', 'KeyH', 1);
  await until(`document.querySelector('.document-header h1').textContent === ${JSON.stringify(heading)} && document.querySelectorAll('.entry').length > 0`);
  await key('ArrowLeft', 'ArrowLeft', 1);
  await until(`document.querySelector('.document-header h1').textContent !== ${JSON.stringify(heading)}`);
  await key('ArrowRight', 'ArrowRight', 1);
  await until(`document.querySelector('.document-header h1').textContent === ${JSON.stringify(heading)} && document.querySelectorAll('.entry').length > 0`);

  // Setting: the entry actions as an orbit (default), as words in the text or as gestures; the choice is remembered.
  assert.equal(await evaluate("document.querySelector('.app').classList.contains('actions-orbit')"), true, 'The orbit is the default.');
  await key(',', 'Comma', 2);
  await until("Boolean(document.querySelector('.settings')) && document.activeElement.dataset.layout === 'orbit'");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.settings-option')].map(option => option.dataset.layout)"), ['orbit', 'inline', 'swipe'], 'The bar and the palette are gone.');
  await pause(350);
  await screenshot('settings.png');
  await evaluate("document.querySelector('.settings-option[data-layout=inline]').click()");
  await until("document.querySelector('.app').classList.contains('actions-inline')");
  await key('Escape');
  await until("!document.querySelector('.settings')");
  await key('s', 'KeyS', 2);
  await until("document.querySelector('.save-status').textContent === 'Gespeichert'");
  await command('Page.reload');
  await until("document.querySelectorAll('.entry').length > 0");
  assert.equal(await evaluate("document.querySelector('.app').classList.contains('actions-inline')"), true, 'The layout is remembered.');
  await evaluate("document.querySelector('.settings-button').click()");
  await until("document.activeElement?.dataset.layout === 'inline'");
  await key('ArrowLeft');
  await until("document.querySelector('.app').classList.contains('actions-orbit') && document.activeElement.dataset.layout === 'orbit'");
  await key('Escape');

  // Embedded in the text flow, no surface.
  await key(',', 'Comma', 2);
  await until("Boolean(document.querySelector('.settings'))");
  await evaluate("document.querySelector('.settings-option[data-layout=inline]').click()");
  await until("document.querySelector('.app').classList.contains('actions-inline')");
  await key('Escape');
  await evaluate("document.querySelector('#title').focus()");
  await key('a', 'KeyA', 1);
  await until("document.activeElement.classList.contains('entry-text')");
  const inlineTask = await focusedId();
  await command('Input.insertText', { text:'Eingebettet testen' });
  const inlineNextTop = () => evaluate(`${row(inlineTask)}.nextElementSibling?.getBoundingClientRect().top ?? ${row(inlineTask)}.getBoundingClientRect().bottom`);
  const before = await inlineNextTop();
  await key('Enter', 'Enter', 1);
  await until(`document.activeElement?.classList.contains('dock-done')`);
  await pause(450);
  assert(await inlineNextTop() > before + 15, 'The actions open in the flow and push the following rows down.');
  assert.deepEqual(await evaluate(`(() => { const dock=${row(inlineTask)}.querySelector('.entry-dock'); const style=getComputedStyle(dock), shell=getComputedStyle(dock.parentElement); return [style.backgroundColor, style.boxShadow, shell.position, shell.backgroundColor]; })()`), ['rgba(0, 0, 0, 0)', 'none', 'relative', 'rgba(0, 0, 0, 0)'], 'No surface and no shadow: it is part of the page.');
  assert.equal(await evaluate(`getComputedStyle(${row(inlineTask)}.querySelector('.dock-word')).fontFamily.split(',')[0].replace(/["']/g, '')`), 'Lilex', 'The actions are written in the writing font.');
  assert.match(await evaluate(`${row(inlineTask)}.querySelector('.entry-dock').textContent`), /offen.*erledigt.*abbrechen.*priorität.*morgen.*planen.*löschen/);
  await hover(`[data-entry-id="${inlineTask}"] .dock-cancelled`);
  await until(`${row(inlineTask)}.dataset.preview === 'cancelled'`);
  await pause(250);
  await screenshot('inline.png');
  await evaluate(`${row(inlineTask)}.querySelector('.dock-done').click()`);
  await until(`${row(inlineTask)}.dataset.status === 'done' && ${row(inlineTask)}.querySelector('.dock-done').getAttribute('aria-pressed') === 'true' && Boolean(document.querySelector('.entry-dock-shell.is-open'))`);
  await evaluate(`${row(inlineTask)}.querySelector('.dock-plan').click()`);
  await until(`Boolean(${row(inlineTask)}.querySelector('.planner-grid'))`);
  await pause(350);
  assert.deepEqual(await evaluate(`(() => { const style=getComputedStyle(${row(inlineTask)}.querySelector('.planner')); return [style.backgroundColor, style.boxShadow, style.position]; })()`), ['rgba(0, 0, 0, 0)', 'none', 'relative'], 'The calendar is embedded as well.');
  await screenshot('inline-planner.png');
  await key('Escape');
  await until("!document.querySelector('.entry-dock-shell.is-open')");
  await key('Delete', 'Delete', 1);
  await until(`!${row(inlineTask)}`);
  // Fifth layout: gestures instead of a menu.
  await key(',', 'Comma', 2);
  await until("Boolean(document.querySelector('.settings'))");
  await evaluate("document.querySelector('.settings-option[data-layout=swipe]').click()");
  await until("document.querySelector('.app').classList.contains('actions-swipe')");
  await key('Escape');
  const swipeTask = async text => {
    await evaluate("document.querySelector('#title').focus()");
    await key('a', 'KeyA', 1);
    await until("document.activeElement.classList.contains('entry-text')");
    const id = await focusedId();
    await command('Input.insertText', { text });
    return id;
  };
  const symbolPoint = id => evaluate(`(() => { const r=${row(id)}.querySelector('.entry-symbol').getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; })()`);
  const mouse = (type, point, buttons = 1) => command('Input.dispatchMouseEvent', { type, x:point.x, y:point.y, button:'left', buttons, clickCount:1 });
  const settled = async id => { await until(`(() => { const entry=${row(id)}, main=entry.querySelector('.entry-main').getBoundingClientRect(), box=entry.getBoundingClientRect(); return Math.abs(main.left - box.left) < 0.5 && Math.abs(main.top - box.top) < 0.5 && entry.getAnimations().length === 0 && !entry.querySelector('.swipe-lane'); })()`); };
  const swipeDrag = async (id, dx, inspect, dy = 0) => {
    await settled(id);
    const start = await symbolPoint(id);
    await mouse('mouseMoved', start, 0); await mouse('mousePressed', start);
    for (let step = 1; step <= 8; step++) await mouse('mouseMoved', { x:start.x + dx * step / 8, y:start.y + dy * step / 8 });
    await pause(60);
    const seen = inspect ? await inspect() : null;
    await mouse('mouseReleased', { x:start.x + dx, y:start.y + dy }, 0);
    return seen;
  };
  const swipeVertical = (id, dy, inspect) => swipeDrag(id, 0, inspect, dy);
  const tapSymbol = async id => { await settled(id); const point = await symbolPoint(id); await mouse('mouseMoved', point, 0); await mouse('mousePressed', point); await mouse('mouseReleased', point, 0); };
  const lane = id => evaluate(`(() => { const entry=${row(id)}, handle=entry.querySelector('.swipe-handle'), trail=entry.querySelector('.swipe-trail'); if (!handle) return null; const box=entry.getBoundingClientRect(), h=handle.getBoundingClientRect(), t=getComputedStyle(trail), label=handle.querySelector('.swipe-label'); return { text:label?.textContent ?? '', label:label ? Number(getComputedStyle(label).opacity) : 0, armed:handle.classList.contains('is-armed'), color:getComputedStyle(handle).getPropertyValue('--tone').trim(), preview:entry.dataset.preview ?? null, handleShift:Math.round(h.left - box.left), trailWidth:Math.round(trail.getBoundingClientRect().width), trailHeight:Math.round(trail.getBoundingClientRect().height), rowHeight:Math.round(box.height), handleDisk:getComputedStyle(handle).backgroundColor, rowShift:Math.round(entry.querySelector('.entry-main').getBoundingClientRect().left - box.left), trailRing:t.boxShadow, trailBorder:t.borderStyle }; })()`);

  const swiped = await swipeTask('Wischen testen');
  assert.equal(await evaluate("document.querySelectorAll('.entry-dock-shell.is-open').length"), 0);
  const weak = await swipeDrag(swiped, 30, () => lane(swiped));
  assert.equal(weak.armed, false, 'Below the first stage nothing is armed.');
  assert.equal(weak.label, 0, 'Without room the word is not shown yet.');
  await pause(450);
  assert.equal(await evaluate(`${row(swiped)}.dataset.trace ?? 'none'`), 'none', 'Releasing early does nothing.');
  // Down: done, further down cancelled; on a finished task the first stage reopens. Only an icon in a strip as wide as the symbol.
  const downShort = await swipeVertical(swiped, 42, async () => ({ ...await lane(swiped), shot:await pause(200).then(() => screenshot('swipe-down.png')), strip: await evaluate(`(() => { const trail=${row(swiped)}.querySelector('.swipe-trail'), symbol=${row(swiped)}.querySelector('.entry-symbol').getBoundingClientRect(), r=trail.getBoundingClientRect(); return { vertical:trail.classList.contains('is-vertical'), width:Math.round(r.width), symbolWidth:Math.round(symbol.width), words:${row(swiped)}.querySelectorAll('.swipe-handle .swipe-label').length, below:r.bottom > ${row(swiped)}.getBoundingClientRect().bottom, iconStays:Math.abs(${row(swiped)}.querySelector('.swipe-handle').getBoundingClientRect().top - symbol.top) < 1 }; })()`) }));
  await pause(300);
  assert.deepEqual(downShort.strip, { vertical:true, width:30, symbolWidth:30, words:0, below:true, iconStays:true }, 'Down: the icon stays at the symbol, a bar as wide as the symbol grows downwards.');
  assert.equal(downShort.color, '#76D982', 'Done has its own colour (green).');
  assert.deepEqual([downShort.trailRing, downShort.trailBorder], ['none', 'none'], 'Only colour, no ring.');
  assert.equal(downShort.rowShift, 0, 'The text does not move.');
  await until(`${row(swiped)}.dataset.status === 'done'`);
  await swipeVertical(swiped, 42);
  await until(`${row(swiped)}.dataset.status === 'open'`);
  const downLong = await swipeVertical(swiped, 90, () => lane(swiped));
  assert.equal(downLong.preview, 'cancelled', 'Further down cancels.');
  assert.equal(downLong.color, '#AD4075', 'Cancel has its own colour (pink).');
  await until(`${row(swiped)}.dataset.status === 'cancelled'`);
  await swipeVertical(swiped, 42);
  await until(`${row(swiped)}.dataset.status === 'open'`);
  // A long, wrapped entry: the strip still reaches past the row's end and lies on top of the following rows.
  const tall = await swipeTask('Ein langer Eintrag, der über mehrere Zeilen umbricht, damit der Streifen beim Wischen nach unten bis über das Ende der Zeile hinaus reicht und dort sichtbar bleibt.');
  await evaluate("document.activeElement.blur()");
  assert(await evaluate(`${row(tall)}.getBoundingClientRect().height`) > 60, 'The test entry wraps.');
  const covers = id => evaluate(`(() => { const entry=${row(id)}, trail=entry.querySelector('.swipe-trail'), handle=entry.querySelector('.swipe-handle'), icon=handle.querySelector('.swipe-icon').getBoundingClientRect(), r=trail.getBoundingClientRect(), box=entry.getBoundingClientRect(); handle.style.pointerEvents='auto'; trail.style.pointerEvents='auto'; const top=document.elementFromPoint(icon.left+icon.width/2, icon.top+icon.height/2); handle.style.pointerEvents=''; trail.style.pointerEvents=''; return { outside:r.bottom > box.bottom + 4 || r.top < box.top - 4, iconOnTop:handle.contains(top), trailZ:getComputedStyle(trail).zIndex }; })()`);
  const tallSide = await swipeDrag(tall, 140, async () => { await pause(250); await screenshot('swipe-tall-side.png'); return lane(tall); });
  assert.equal(tallSide.trailHeight, tallSide.rowHeight, 'Sideways the bar covers every line of a wrapped entry.');
  const tallDown = await swipeVertical(tall, 42, () => covers(tall));
  assert.deepEqual({ iconOnTop:tallDown.iconOnTop, trailZ:tallDown.trailZ }, { iconOnTop:true, trailZ:'4' }, 'Down on a wrapped entry: the moving symbol and its trail lie on top, visible all the way.');
  await until(`${row(tall)}.dataset.status === 'done'`);
  const tallUp = await swipeVertical(tall, -42, () => covers(tall));
  assert.deepEqual(tallUp, { outside:true, iconOnTop:true, trailZ:'4' }, 'Up: above the row and on top of the entry before it.');
  await until(`${row(tall)}.dataset.priority === 'high'`);
  await pause(300);
  await swipeVertical(tall, 42, async () => { await pause(200); await screenshot('swipe-tall.png'); });
  await until(`${row(tall)}.dataset.status === 'open'`);
  await swipeDrag(tall, -80);
  await until(`!${row(tall)}`);
  // Up: priority.
  const up = await swipeVertical(swiped, -42, async () => ({ ...await lane(swiped), above:await evaluate(`${row(swiped)}.querySelector('.swipe-trail').getBoundingClientRect().top < ${row(swiped)}.getBoundingClientRect().top`) }));
  assert.equal(up.color.toLowerCase(), '#e6a85c', 'Priority keeps its own orange.'); assert.equal(up.above, true, 'The bar grows upwards out of the row.');
  await until(`${row(swiped)}.dataset.priority === 'high'`);
  assert.equal(await evaluate(`${row(swiped)}.dataset.status`), 'open', 'Dragging is not a tap.');
  await evaluate(`${row(swiped)}.querySelector('.entry-symbol').focus()`);
  await key('ArrowUp');
  await until(`!${row(swiped)}.dataset.priority`);
  // Tap cycles; holding is just a tap.
  await tapSymbol(swiped); await until(`${row(swiped)}.dataset.status === 'done'`);
  await tapSymbol(swiped); await until(`${row(swiped)}.dataset.status === 'cancelled'`);
  await settled(swiped);
  const holdAt = await symbolPoint(swiped);
  await mouse('mouseMoved', holdAt, 0); await mouse('mousePressed', holdAt);
  await pause(700);
  await mouse('mouseReleased', holdAt, 0);
  await until(`${row(swiped)}.dataset.status === 'open'`);
  assert.equal(await evaluate(`${row(swiped)}.dataset.priority ?? 'none'`), 'none', 'Holding never sets priority.');
  assert.equal(await evaluate(`Boolean(${row(swiped)}.querySelector('.symbol-hold, .entry-dock-shell.is-open'))`), false);
  await evaluate(`${row(swiped)}.querySelector('.entry-symbol').focus()`);
  await key('ArrowDown');
  await until(`${row(swiped)}.dataset.status === 'done'`);
  await key('ArrowDown');
  await until(`${row(swiped)}.dataset.status === 'open'`);
  // Right, three stages: tomorrow, plan one day, plan several days.
  const rightPlan = await swipeDrag(swiped, 155, () => lane(swiped));
  assert.equal(rightPlan.text, 'planen');
  await until(`Boolean(${row(swiped)}.querySelector('.planner-grid')) && !${row(swiped)}.querySelector('.planner.is-multi')`);
  await key('Escape');
  await until("!document.querySelector('.entry-dock-shell.is-open')");
  const rightDays = await swipeDrag(swiped, 225, () => lane(swiped));
  assert.equal(rightDays.text, 'mehrere tage');
  await until(`Boolean(${row(swiped)}.querySelector('.planner.is-multi'))`);
  await key('Escape');
  await until("!document.querySelector('.entry-dock-shell.is-open')");
  const short = await swipeDrag(swiped, 112, async () => { await pause(260); const seen = await lane(swiped); seen.labelAbove = await evaluate(`${row(swiped)}.querySelector('.swipe-label').getBoundingClientRect().bottom <= ${row(swiped)}.querySelector('.cm-line').getBoundingClientRect().top + 2`); seen.scrollbar = await evaluate("document.querySelector('.scroll').offsetHeight !== document.querySelector('.scroll').clientHeight"); await screenshot('swipe.png'); return seen; });
  assert.equal(short.text, 'morgen'); assert.equal(short.armed, true); assert.equal(short.color, '#C2DCE9', 'Tomorrow is cyan, leading into blue and purple.'); assert.equal(short.preview, 'tomorrow');
  assert(short.label > 0.9, 'With room the word is faded in.');
  assert.equal(short.labelAbove, true, 'The word floats above the line instead of covering the text.');
  await until(`!${row(swiped)}.querySelector('.swipe-handle') && getComputedStyle(${row(swiped)}.querySelector('.entry-symbol')).opacity === '1'`);
  assert(Math.abs(short.handleShift) <= 1 && short.rowShift === 0 && short.trailWidth > 120, `The icon stays at the symbol, the text stays, the bar grows (${short.handleShift}, ${short.rowShift}, ${short.trailWidth}).`);
  assert.equal(short.handleDisk, 'rgba(0, 0, 0, 0)', 'No disk around the icon, only the bar behind it.');
  assert.equal(short.trailHeight, short.rowHeight, 'Sideways the bar spans the entry.');
  assert.equal(short.scrollbar, false, 'Swiping never shows a horizontal scrollbar.');
  assert.equal(new Set([rightPlan.color, rightDays.color, short.color, downShort.color, downLong.color, up.color]).size, 6, 'Every action has its own colour.');
  assert.equal(await evaluate(`(() => { const grip=${row(swiped)}.querySelector('.entry-grip').getBoundingClientRect(), content=document.querySelector('.content').getBoundingClientRect(); return grip.left >= content.left; })()`), true, 'The grip in the margin is not clipped.');
  await until(`${row(swiped)}.dataset.trace === 'tomorrow'`);
  // Left: remove.
  const remove = await swipeDrag(swiped, -80, () => lane(swiped));
  assert.equal(remove.text, 'löschen'); assert.equal(remove.color, '#DF6262');
  await until(`!${row(swiped)}`);
  const held = await swipeTask('Mehrere Tage planen');
  // Several days: two left clicks set a range, right clicks take days out of it or add days outside; then one trace with << and a copy per day.
  await evaluate(`${row(held)}.querySelector('.entry-text').focus()`);
  await key('T', 'KeyT', 9);
  await until(`Boolean(${row(held)}.querySelector('.planner.is-multi')) && ${row(held)}.querySelector('.planner-confirm').disabled`);
  const plusDays = n => evaluate(`(() => { const d=new Date(); d.setDate(d.getDate()+${n}); return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'); })()`);
  const days = [await plusDays(1), await plusDays(2), await plusDays(3), await plusDays(5)];
  const clickDay = async (date, right = false) => {
    const point = await evaluate(`(() => { const label=new Intl.DateTimeFormat('de-DE', { weekday:'long', day:'numeric', month:'long', year:'numeric' }).format(new Date('${date}T12:00')); const r=${row(held)}.querySelector('.planner-day[aria-label^="' + label + '"]').getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; })()`);
    await command('Input.dispatchMouseEvent', { type:'mousePressed', x:point.x, y:point.y, button:right ? 'right' : 'left', buttons:right ? 2 : 1, clickCount:1 });
    await command('Input.dispatchMouseEvent', { type:'mouseReleased', x:point.x, y:point.y, button:right ? 'right' : 'left', buttons:0, clickCount:1 });
  };
  const outside = await plusDays(7), excluded = await plusDays(4);
  await clickDay(days[0]);
  await until(`${row(held)}.querySelectorAll('.planner-day.is-pending').length === 1`);
  await clickDay(days[3]);
  await until(`${row(held)}.querySelectorAll('.planner-day.in-range').length === 5 && ${row(held)}.querySelector('.planner-confirm').textContent === '5 Tage'`);
  await clickDay(excluded, true);
  await until(`${row(held)}.querySelectorAll('.planner-day.is-excluded').length === 1`);
  await clickDay(outside, true);
  await until(`${row(held)}.querySelectorAll('.planner-day.is-added').length === 1 && ${row(held)}.querySelector('.planner-confirm').textContent === '5 Tage'`);
  await clickDay(outside, true);
  await until(`${row(held)}.querySelectorAll('.planner-day.is-picked').length === 4 && ${row(held)}.querySelector('.planner-confirm').textContent === '4 Tage'`);
  assert.equal(await evaluate(`${row(held)}.querySelector('.entry-symbol svg.icon-ghost')?.dataset.icon`), 'scheduled-multi', 'The symbol previews << while several days are picked.');
  await pause(350);
  await screenshot('multi-days.png');
  await key('Enter');
  await until(`${row(held)}.dataset.trace === 'days' && ${row(held)}.querySelector('.entry-trace-target').textContent.startsWith('4 Tage')`);
  assert.equal(await evaluate(`${row(held)}.querySelector('.entry-symbol svg').dataset.icon`), 'scheduled-multi');
  const savesBeforeDays = await evaluate('window.__uiTest.saves');
  await key('s', 'KeyS', 2);
  await until(`window.__uiTest.saves === ${savesBeforeDays + 1}`);
  for (const date of days) assert.equal(await evaluate(`window.__uiTest.day('${date}').entries.filter(entry => entry.text === 'Mehrere Tage planen').length`), 1, `A copy on ${date}.`);
  await evaluate(`${row(held)}.querySelector('.entry-text').focus()`);
  await key('Delete', 'Delete', 1);
  await until(`Boolean(${row(held)}.querySelector('.scope-choice'))`);
  assert.deepEqual(await evaluate(`[...${row(held)}.querySelectorAll('.scope-choice button')].map(button => button.textContent)`), ['Nur diesen', 'Auch die 4 folgenden']);
  await key('ArrowRight', 'ArrowRight');
  await key('Enter', 'Enter');
  await until(`!${row(held)}`);
  await key('s', 'KeyS', 2);
  await until(`window.__uiTest.saves === ${savesBeforeDays + 2}`);
  for (const date of days) assert.equal(await evaluate(`window.__uiTest.day('${date}').entries.length`), 0, 'Removing the trace removes every planned day.');
  assert.equal(await evaluate(`(window.__uiTest.day('${excluded}')?.entries ?? []).length`), 0, 'The day taken out of the range got nothing.');
  const wheeled = await swipeTask('Mit dem Trackpad');
  const wheelAt = await symbolPoint(wheeled);
  const dayBeforeWheel = await evaluate("document.querySelector('.document-header h1').textContent");
  for (let step = 0; step < 4; step++) await command('Input.dispatchMouseEvent', { type:'mouseWheel', x:wheelAt.x + 120, y:wheelAt.y, deltaX:-22, deltaY:0 });
  await until(`${row(wheeled)}.dataset.trace === 'tomorrow'`, 'Two-finger swipe right moves to tomorrow.');
  assert.equal(await evaluate("document.querySelector('.document-header h1').textContent"), dayBeforeWheel, 'Swiping an entry does not turn the day.');
  await evaluate(`${row(wheeled)}.querySelector('.entry-text').focus()`);
  await key('Enter', 'Enter', 1);
  await until("Boolean(document.querySelector('.entry-dock-shell.is-open .swipe-legend'))");
  assert.match(await evaluate("document.querySelector('.entry-dock-shell.is-open .swipe-legend').textContent"), /zum tag.*zurücknehmen.*löschen/);
  await evaluate("document.querySelector('.entry-dock-shell.is-open .swipe-legend [aria-label=\"löschen\"]').click()");
  await until(`!${row(wheeled)}`);

  await key(',', 'Comma', 2);
  await until("Boolean(document.querySelector('.settings'))");
  await evaluate("document.querySelector('.settings-option[data-layout=orbit]').click()");
  await until("document.querySelector('.app').classList.contains('actions-orbit')");
  await key('Escape');

  await command('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion',value:'reduce'}] });
  await evaluate("document.querySelector('.entry-symbol').click()");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.entry-dock-shell.is-open')).transitionDuration"), '0s');
  await checkCalendars();
  assert.deepEqual(errors, [], 'No browser runtime errors.');
  console.log('UI checks passed: calendar window (month, week, work week, year, day; keys, swiping, filters, remembered, live updates, open in journal), compact month window, calendar in the resizable sidebar (creating entries by marking quarter hours, composer, editing by right click), changing kinds (keys, orbit cluster, preview), saving by itself (after a pause, before leaving the day), actions reaching linked entries (following / all, Escape cancels), editable traces passing edits to their copies, swiping days, settings (orbit/inline/swipe layout, remembered), swipe gestures (the icon stays at the symbol, a bar in each action’s own colour grows, full height sideways; right: tomorrow/plan/several days, left: remove, down: done/cancel, up: priority, tap, hold is a tap, keys, trackpad), planning several days (range by two clicks, right-click flips, copies per day, linked removal), embedded inline actions (in the flow, no surface, preview, calendar), IBM Plex Sans UI and bold Lilex title, live-preview Markdown (markers only at the cursor, hidden when not editing, click into hidden parts), format shortcuts with undo, colours, right-click format menu; shortcuts (F1, Alt+A/Enter/Backspace outliner, Alt+D/X/P/U/T/M/Enter/Entf, Ctrl+arrows, Alt+arrows/H), clock as large as the calendar with back button, Tab and typed digits; clock dial (tap on both rings, wheel, keys, quick times), calendar stays open on inner clicks, time after text, linked removal both ways; planning (calendar keyboard, time, reminder, traces >/</outlined <, undo, tomorrow, same-day time, copies on target days), asterisk/outlined event/thick note priority symbols, automatic priority order, drag and keyboard boundaries, toolbar focus, saved priority; action pill, previews, removal, grouping, caret, saving, cached navigation, wrapping and reduced motion.');
  console.log(`Screenshots: ${join(artifacts, 'journal.png')} and menu.png`);
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await command('Browser.close'); } catch {}
    socket.close();
  }
  browser.kill();
  server.closeAllConnections();
  server.close();
}
