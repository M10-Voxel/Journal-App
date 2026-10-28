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
  mockWindows('main');
  const today = new Date();
  const date = [today.getFullYear(), String(today.getMonth()+1).padStart(2,'0'), String(today.getDate()).padStart(2,'0')].join('-');
  const fixture = { date, title: 'Zeit für die kleinen Dinge', body: 'Bestehender Freitext bleibt erhalten.', revision: 1, entries: [
    { id:'10000000-0000-4000-8000-000000000001', kind:'task', text:'Eine Runde durch den Park gehen', done:false, cancelled:false },
    { id:'10000000-0000-4000-8000-000000000002', kind:'note', text:'Heute etwas langsamer machen. Ein paar Gedanken sammeln und den Kopf frei bekommen.', done:false, cancelled:false },
    { id:'10000000-0000-4000-8000-000000000003', kind:'event', text:'Kaffee am Nachmittag', done:false, cancelled:false },
    { id:'10000000-0000-4000-8000-000000000004', kind:'task', text:'Das neue Buch weiterlesen', done:true, cancelled:false },
    { id:'10000000-0000-4000-8000-000000000005', kind:'task', text:'Den Schreibtisch umstellen', done:false, cancelled:true }
  ]};
  const days = new Map([[date, fixture]]);
  window.__uiTest = { date, saves: 0, day: () => structuredClone(days.get(date)) };
  window.confirm = () => true;
  mockIPC((command, payload) => {
    if (command === 'load_day') return structuredClone(days.get(payload.date) ?? { date:payload.date, title:'', body:'', revision:0, entries:[] });
    if (command === 'save_day') {
      const value = structuredClone(payload.day); value.revision += 1;
      days.set(value.date, value); window.__uiTest.saves += 1; return value;
    }
  }, { shouldMockEvents: true });
  await import(${JSON.stringify(entryScript)});
`;
const html = indexHtml.replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/, `<script type="module">${bootstrap}</script>`);
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(html); return; }
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
  await screenshot('journal.png');

  await evaluate("document.querySelector('[data-entry-kind=task] .entry-symbol').click()");
  await until("document.activeElement?.getAttribute('aria-label') === 'Als erledigt markieren'");
  await pause(180);
  await screenshot('menu.png');
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
  assert.deepEqual(await evaluate('({id:document.activeElement.closest(".entry").dataset.entryId, tag:document.activeElement.tagName, start:document.activeElement.selectionStart, end:document.activeElement.selectionEnd})'), { id:doneTask, tag:'TEXTAREA', start:4, end:8 });
  await command('Input.dispatchKeyEvent', { type:'keyDown', key:'ArrowDown', code:'ArrowDown', modifiers:1 });
  await command('Input.dispatchKeyEvent', { type:'keyUp', key:'ArrowDown', code:'ArrowDown', modifiers:1 });
  assert.deepEqual(await readOrder(), [eventId,firstTask,doneTask,cancelledTask,noteId]);

  await evaluate(`document.querySelector('[data-entry-id="${firstTask}"] .entry-symbol').click()`);
  await until("Boolean(document.querySelector('.entry-dock-shell.is-open'))");
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.entry-dock-shell.is-open .dock-planning button')).map(button => ({label:button.textContent, disabled:button.disabled}))"), [{label:'Morgen',disabled:true},{label:'Datum',disabled:true},{label:'Mehrere Tage',disabled:true}]);
  await evaluate("document.querySelector('.entry-dock-shell.is-open [aria-label=\"Als erledigt markieren\"]').click()");
  await until("document.querySelector('.entry-dock-shell.is-open .status-track').dataset.status === 'done'");
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-entry-id="${firstTask}"] .entry-symbol')).color`), expectedColor);
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-entry-id="${firstTask}"] .strike-overlay'))`), false);
  await evaluate("document.querySelector('.entry-dock-shell.is-open [aria-label=\"Aufgabe abbrechen\"]').click()");
  await until("document.querySelector('.entry-dock-shell.is-open .status-track').dataset.status === 'cancelled'");
  await evaluate("document.querySelector('.entry-dock-shell.is-open [aria-label=\"Wieder öffnen\"]').click()");
  await until("document.querySelector('.entry-dock-shell.is-open .status-track').dataset.status === 'open'");
  await evaluate("document.querySelector('.entry-dock-shell.is-open [aria-label=\"Aktionen schließen\"]').click()");
  await evaluate(`document.querySelector('[data-entry-id="${eventId}"] .entry-symbol').click()`);
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.entry-dock-shell.is-open .dock-planning button')).map(button => button.textContent)"), ['Datum','Mehrere Tage']);
  assert.equal(await evaluate("Boolean(document.querySelector('.entry-dock-shell.is-open .status-track'))"), false);
  assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"), 'Aktionen schließen');
  await pause(180);
  await screenshot('event-actions.png');
  await evaluate("document.querySelector('.entry-dock-shell.is-open [aria-label=\"Aktionen schließen\"]').click()");

  await evaluate("Array.from(document.querySelectorAll('.kind-picker button')).find(button => button.textContent === 'Aufgabe').click()");
  await until("document.querySelectorAll('.entry').length === 6 && document.activeElement.className === 'entry-text'");
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
  await evaluate("document.querySelector('.entry-dock-shell.is-open [aria-label=\"Aktionen schließen\"]').click()");
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

  await command('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion',value:'reduce'}] });
  await evaluate("document.querySelector('.entry-symbol').click()");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.entry-dock-shell.is-open')).transitionDuration"), '0s');
  assert.deepEqual(errors, [], 'No browser runtime errors.');
  console.log('UI checks passed: inline action dock, status switching, planning placeholders, grouping, pointer/menu/keyboard/text reordering, caret preservation, focus kept while saving, cached day switching, saved order, wrapping, continuous strike, save shortcut, day navigation, reduced motion.');
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
