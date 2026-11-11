// Actual Tauri/WebView2 + SQLite integration, in an explicitly marked disposable fixture.
// This does not select a vault, touch the user's settings, or change Windows autostart.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';

const artifacts = resolve('src-tauri/target/widget-native', `run-${Date.now()}`);
await mkdir(artifacts, { recursive: true });
await writeFile(join(artifacts, 'widget-smoke-fixture'), 'Isolated native test');
await writeFile(join(artifacts, 'journal.sqlite3'), '');
await writeFile(join(artifacts, 'desktop-widgets.json'), JSON.stringify({ enabled: true, locked: false, autostart: false }));
const portServer = createServer();
await new Promise(done => portServer.listen(0, '127.0.0.1', done));
const port = portServer.address().port;
await new Promise(done => portServer.close(done));
const app = spawn(resolve('src-tauri/target/debug/journal-app.exe'), ['--background'], {
  cwd: process.cwd(), windowsHide: true,
  env: { ...process.env, JOURNAL_WIDGET_SMOKE_ROOT: artifacts, JOURNAL_BROWSER_ARGS: `--remote-debugging-port=${port}` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
app.stdout.on('data', chunk => { output += chunk; }); app.stderr.on('data', chunk => { output += chunk; });
const pause = ms => new Promise(done => setTimeout(done, ms));
const errors = [];
class Page {
  constructor(socket) {
    this.socket = socket; this.next = 0; this.pending = new Map();
    socket.addEventListener('message', event => {
      const data = JSON.parse(event.data);
      if (data.id) { const request = this.pending.get(data.id); if (!request) return; this.pending.delete(data.id); clearTimeout(request.timeout); data.error ? request.reject(Error(data.error.message)) : request.resolve(data.result); }
      else if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.exception?.description ?? data.params.exceptionDetails.text);
    });
    socket.addEventListener('close', () => { for (const request of this.pending.values()) { clearTimeout(request.timeout); request.reject(Error('Native test connection closed')); } this.pending.clear(); });
  }
  static async connect(url) { const socket = new WebSocket(url); await new Promise((done, fail) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', fail, { once: true }); }); const page = new Page(socket); await page.send('Runtime.enable'); return page; }
  send(method, params = {}) {
    const id = ++this.next;
    return new Promise((resolve, reject) => { const timeout = setTimeout(() => { this.pending.delete(id); reject(Error(`Timeout: ${method}`)); }, 35000); this.pending.set(id, { resolve, reject, timeout }); this.socket.send(JSON.stringify({ id, method, params })); });
  }
  async eval(expression) { const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.exception?.value ?? result.exceptionDetails.text); return result.result.value; }
  async until(expression) { for (let n = 0; n < 160; n++) { try { if (await this.eval(expression)) return; } catch(error) { if (!String(error).includes('Test window is not ready')) throw error; } await pause(75); } throw Error(`Condition failed: ${expression}`); }
  async click(selector) { await this.until(`!!document.querySelector(${JSON.stringify(selector)})`); await this.eval(`document.querySelector(${JSON.stringify(selector)}).click()`); }
  async type(selector, text) { await this.until(`!!document.querySelector(${JSON.stringify(selector)})`); await this.eval(`document.querySelector(${JSON.stringify(selector)}).focus()`); await this.send('Input.insertText', { text }); }
  async input(selector, text) { await this.eval(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`); }
  async key(selector,key,code,options={}) { await this.eval(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},code:${JSON.stringify(code)},bubbles:true,cancelable:true,...${JSON.stringify(options)}}));})()`); }
  async invoke(command, args = {}) { const result=await this.eval(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(args)}).then(value=>({value}),reason=>({error:String(reason)}))`);if(result.error)throw Error(result.error);return result.value; }
  event(event, payload) { return this.invoke('plugin:event|emit', { event, payload }); }
  async screenshot(name) { const image = await this.send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(artifacts, name), Buffer.from(image.data, 'base64')); }
}
const pages = new Map(), connected = new Map();
class EmbeddedPage extends Page {
  constructor(main, label) { super({ addEventListener() {}, close() {} }); this.main=main; this.label=label; }
  send(method, params = {}) { return this.main.invoke('widget_smoke_cdp', { label:this.label, method, params:JSON.stringify(params) }); }
}
try {
  for (let n = 0; n < 240 && !(pages.has('main') && pages.has('widget-entries')); n++) {
    if (app.exitCode !== null) throw Error(`Test app exited (${app.exitCode}): ${output}`);
    let targets = [];
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch {}
    for (const target of targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl)) {
      if (connected.has(target.id)) continue;
      const page = await Page.connect(target.webSocketDebuggerUrl); connected.set(target.id, page);
      const label = await page.eval('window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label');
      if (label) pages.set(label, page); else { page.socket.close(); connected.delete(target.id); }
    }
    if(pages.has('main')&&!pages.has('widget-entries')){
      const windows=await pages.get('main').invoke('plugin:window|get_all_windows');
      if(windows.includes('widget-entries')){const widget=new EmbeddedPage(pages.get('main'),'widget-entries');await widget.send('Runtime.enable');pages.set('widget-entries',widget);}
    }
    await pause(100);
  }
  if (!pages.has('widget-entries') && pages.has('main')) {
    console.log('Native discovery:', JSON.stringify({ windows: await pages.get('main').invoke('plugin:window|get_all_windows'), state: await pages.get('main').invoke('desktop_widget_state'), targets: await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(), labels: [...pages.keys()] }));
  }
  assert(pages.has('main') && pages.has('widget-entries'), `Both native WebViews must exist. ${output}`);
  const main = pages.get('main'), widget = pages.get('widget-entries');
  await main.until("!!document.querySelector('.title-input')");
  await widget.until("!!document.querySelector('.title-input')");
  if (process.env.JOURNAL_WIDGET_SCOPE === 'calendar') {
    await main.invoke('widget_smoke_cdp',{label:'main',method:'Journal.disableInput',params:'{}'});
    await main.invoke('widget_smoke_cdp',{label:'widget-entries',method:'Journal.disableInput',params:'{}'});
    await widget.click('.kind-picker button:has([data-icon="task"])');await widget.type('.entry-text','Keep the daily widget draft');
    await main.until("document.querySelector('.entry-text').textContent==='Keep the daily widget draft'");
    await main.input('.title-input','Keep the main journal draft');
    const created=await main.invoke('desktop_widget_create',{kind:'calendar'}), id=created.widgets.find(item=>item.kind==='calendar').id;
    const label=`widget-${id}`, calendar=new EmbeddedPage(main,label);pages.set(label,calendar);
    await calendar.until("!!document.querySelector('.desktop-widget.is-calendar .cal')");
    await main.invoke('widget_smoke_cdp',{label,method:'Journal.disableInput',params:'{}'});
    await calendar.until(`window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible',{label:${JSON.stringify(label)}})`);
    const viewport=()=>calendar.eval('({active:false,viewport:{width:innerWidth,height:innerHeight,scale:devicePixelRatio},rects:[]})');
    const geometry=await calendar.invoke('desktop_widget_surface',await viewport());
    assert(geometry.minWidth>0&&geometry.widget.width>geometry.minWidth,'Calendar has its own initial and minimum size');
    await calendar.invoke('desktop_widget_surface',{...await viewport(),widget:{...geometry.widget,width:geometry.minWidth*1.25,height:geometry.minHeight*1.4},finish:true});
    await calendar.event('widget:surface-changed',null);await pause(150);
    const info=()=>main.invoke('widget_smoke_cdp',{label,method:'Journal.window',params:'{}'}), initialWindow=await info();
    for(const [index,view,count] of [[0,'year',12],[1,'month',42],[2,'week',7],[3,'workweek',5],[4,'day',1]]){
      await calendar.click(`.cal-views [role=tab]:nth-of-type(${index+1})`);
      const selector=view==='year'?'.cal-year-month':view==='month'?'.cal-month-day':'.cal-time-column';
      await calendar.until(`document.querySelector('.cal').dataset.view==='${view}' && document.querySelectorAll('${selector}').length===${count}`);
      assert(await calendar.eval("(()=>{const c=document.querySelector('.cal').getBoundingClientRect(),w=document.querySelector('.desktop-widget').getBoundingClientRect();return c.bottom<=w.bottom+1&&c.right<=w.right+1;})()"),'Calendar stays inside the visible widget');
      await calendar.screenshot(`calendar-widget-${view}.png`);
    }
    await calendar.click('.cal-views [role=tab]:nth-of-type(2)');
    let target=await calendar.eval("(()=>{const cell=[...document.querySelectorAll('.cal-month-day')].at(-1),r=cell.getBoundingClientRect();cell.dispatchEvent(new MouseEvent('contextmenu',{button:2,bubbles:true,cancelable:true,clientX:r.right-4,clientY:r.bottom-4}));return cell.dataset.date;})()");
    await calendar.until("!!document.querySelector('.cal-composer.is-placed') && document.documentElement.classList.contains('widget-popups-ready')");
    assert(await calendar.eval("(()=>{const p=document.querySelector('.cal-composer').getBoundingClientRect(),w=document.querySelector('.desktop-widget').getBoundingClientRect();return p.right>w.right||p.bottom>w.bottom||p.left<w.left||p.top<w.top;})()"),'The composer is visible beyond the widget boundary');
    const panelPoint=await calendar.eval("(()=>{const p=document.querySelector('.cal-composer').getBoundingClientRect();return [[Math.round((p.right-12)*devicePixelRatio),Math.round((p.bottom-12)*devicePixelRatio)]];})()");
    assert.deepEqual((await main.invoke('widget_smoke_cdp',{label,method:'Journal.region',params:JSON.stringify(panelPoint)})).inside,[true],'The popup outside the widget accepts native input');
    await calendar.screenshot('calendar-widget-outside-composer.png');
    await calendar.type('.cal-composer-text','Native calendar widget entry');await calendar.key('.cal-composer-text','Enter','Enter');
    await calendar.until("!document.querySelector('.cal-composer') && [...document.querySelectorAll('.cal-item')].some(item=>item.textContent.includes('Native calendar widget entry'))");
    const stored=await main.invoke('load_day',{date:target}), made=stored.entries.find(item=>item.text==='Native calendar widget entry');assert(made);
    const today=await main.eval("new Date().toLocaleDateString('sv-SE')"), kept=await main.invoke('load_day',{date:today});
    assert.equal(kept.title,'Keep the main journal draft');assert(kept.entries.some(entry=>entry.text==='Keep the daily widget draft'),'Calendar mutations preserve other pending editor drafts');
    await calendar.eval(`document.querySelector('[data-calendar-entry="${made.id}"]').dispatchEvent(new MouseEvent('contextmenu',{button:2,bubbles:true,cancelable:true}))`);
    await calendar.until("!!document.querySelector('.cal-composer.is-editing')");
    await calendar.eval("document.querySelector('.cal-composer-text').focus();document.querySelector('.cal-composer-text').select()");
    await calendar.send('Input.insertText',{text:'Edited in the native calendar widget'});await calendar.key('.cal-composer-text','Enter','Enter');
    await calendar.until("!document.querySelector('.cal-composer')");assert.equal((await main.invoke('load_day',{date:target})).entries.find(item=>item.id===made.id).text,'Edited in the native calendar widget');
    const drag=await calendar.eval(`(()=>{const a=document.querySelector('[data-calendar-entry="${made.id}"]').getBoundingClientRect(),cell=[...document.querySelectorAll('.cal-month-day')].at(-2),b=cell.getBoundingClientRect();return {from:{x:a.left+a.width/2,y:a.top+a.height/2},to:{x:b.left+b.width/2,y:b.top+b.height/2},date:cell.dataset.date};})()`);
    const mouse=(type,point,button='left',buttons=1)=>calendar.send('Input.dispatchMouseEvent',{type,...point,button,buttons,clickCount:1});
    await mouse('mouseMoved',drag.from,'none',0);await mouse('mousePressed',drag.from);await mouse('mouseMoved',drag.to);
    await calendar.until("!!document.querySelector('.cal-drag-preview') && !!document.querySelector('.cal-drop-outline')");await calendar.screenshot('calendar-widget-drag.png');
    await mouse('mouseReleased',drag.to,'left',0);await calendar.until("!document.querySelector('.cal-drag-preview,.cal-drop-outline')");
    await main.until(`window.__TAURI_INTERNALS__.invoke('load_day',{date:${JSON.stringify(drag.date)}}).then(day=>day.entries.some(entry=>entry.id===${JSON.stringify(made.id)}))`);
    assert(!(await main.invoke('load_day',{date:target})).entries.some(item=>item.id===made.id));target=drag.date;
    const props="(()=>{let f=document.querySelector('.cal')[Object.keys(document.querySelector('.cal')).find(key=>key.startsWith('__reactFiber'))];while(f){if(f.memoizedProps?.preferencesKey&&typeof f.memoizedProps.onExport==='function')return f.memoizedProps;f=f.return;}throw Error('Calendar callbacks not found');})()";
    const exported=await calendar.eval(`(${props}).onExport()`);assert(exported.some(day=>day.entries.some(entry=>entry.id===made.id)),'Export uses the resident writer and latest saved calendar data');
    await calendar.eval(`(${props}).onImport([{date:${JSON.stringify(today)},entry:{id:crypto.randomUUID(),calendarUid:'native-widget-import',kind:'event',text:'Imported through the calendar widget',description:'',done:false,cancelled:false,priority:false,time:'15:00',end:'16:00',reminder:false,showInJournal:false}}])`);
    const imported=await main.invoke('load_day',{date:today});assert(imported.entries.some(item=>item.text==='Imported through the calendar widget'));assert.equal(imported.title,kept.title);assert(imported.entries.some(item=>item.text==='Keep the daily widget draft'));
    await calendar.until(`!!document.querySelector('[data-calendar-entry="${made.id}"]')`);
    await calendar.eval(`document.querySelector('[data-calendar-entry="${made.id}"]').dispatchEvent(new MouseEvent('contextmenu',{button:2,bubbles:true,cancelable:true}))`);await calendar.until("!!document.querySelector('.cal-composer.is-editing')");
    await calendar.click('.cal-composer-remove');await calendar.until("!document.querySelector('.cal-composer')");assert(!(await main.invoke('load_day',{date:target})).entries.some(item=>item.id===made.id));
    assert.deepEqual(await info(),initialWindow,'Calendar popups never move or resize the native canvas');
    await calendar.click('.cal-views [role=tab]:nth-of-type(4)');await calendar.click('.cal-filter-note');await calendar.click('.cal-nav .nav-step:last-child');
    const key=`journal.calendar.widget-${id}`;await calendar.until(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))?.followToday===false`);
    const saved=await calendar.eval(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`);assert.equal(saved.view,'workweek');assert.equal(saved.kinds.note,true);
    await main.invoke('desktop_widget_update',{id,update:{enabled:false}});await main.until(`window.__TAURI_INTERNALS__.invoke('plugin:window|get_all_windows').then(labels=>!labels.includes(${JSON.stringify(label)}))`);await main.invoke('desktop_widget_update',{id,update:{enabled:true}});
    await calendar.until("document.querySelector('.cal')?.dataset.view==='workweek'");
    await main.invoke('widget_smoke_cdp',{label,method:'Journal.disableInput',params:'{}'});
    assert.equal(await calendar.eval(`JSON.parse(localStorage.getItem(${JSON.stringify(key)})).date`),saved.date);
    assert.equal(await calendar.eval("document.querySelector('.cal-filter-note').getAttribute('aria-pressed')"),'true');
    const secondState=await main.invoke('desktop_widget_create',{kind:'calendar'}),secondId=secondState.widgets.filter(item=>item.kind==='calendar').at(-1).id;
    const secondLabel=`widget-${secondId}`,second=new EmbeddedPage(main,secondLabel);pages.set(secondLabel,second);await second.until("!!document.querySelector('.cal')");
    await main.invoke('widget_smoke_cdp',{label:secondLabel,method:'Journal.disableInput',params:'{}'});
    assert.equal(await second.eval("document.querySelector('.cal').dataset.view"),'month');assert.equal(await second.eval("document.querySelector('.cal-filter-note').getAttribute('aria-pressed')"),'false');
    await main.event('journal:settings',{tab:'widgets',widget:id});await main.until(`!!document.querySelector('[data-widget-instance="${id}"] .widgets-details')`);
    await main.click(`[data-widget-instance="${id}"] .widgets-instance-actions button:has([data-icon="copy"])`);
    await main.until("window.__TAURI_INTERNALS__.invoke('desktop_widget_state').then(state=>state.widgets.filter(widget=>widget.kind==='calendar').length===3)");
    const copied=(await main.invoke('desktop_widget_state')).widgets.filter(item=>item.kind==='calendar').at(-1),copyLabel=`widget-${copied.id}`,copy=new EmbeddedPage(main,copyLabel);pages.set(copyLabel,copy);
    await copy.until("document.querySelector('.cal')?.dataset.view==='workweek'");await main.invoke('widget_smoke_cdp',{label:copyLabel,method:'Journal.disableInput',params:'{}'});
    assert.equal(await copy.eval("document.querySelector('.cal-filter-note').getAttribute('aria-pressed')"),'true','Duplication copies the calendar presentation');
    assert.deepEqual(errors,[]);
    await writeFile(join(artifacts,'result.json'),JSON.stringify({passed:true,cases:['calendar catalog creation','five views','responsive size','native popup outside widget','native popup input region','shared-writer create edit delete','other editor drafts preserved','export import callbacks','stable native canvas','restored view date filters','independent calendar instances','duplicate presentation'],id},null,2));
    console.log(`PASS: native calendar widget. Artifacts: ${artifacts}`);
  } else if (process.env.JOURNAL_WIDGET_SCOPE === 'manager') {
    await main.invoke('widget_smoke_cdp',{label:'main',method:'Journal.disableInput',params:'{}'});
    await main.invoke('widget_smoke_cdp',{label:'widget-entries',method:'Journal.disableInput',params:'{}'});
    const initial=await main.invoke('desktop_widget_state');
    assert.equal(initial.widgets.length,1);assert.equal(initial.widgets[0].id,'entries');assert.equal(initial.widgets[0].enabled,true);
    assert.equal(initial.types.find(type=>type.kind==='calendar').available,true);
    await assert.rejects(main.invoke('desktop_widget_create',{kind:'unknown-widget'}),/unknown variant|unknown-widget/);
    await assert.rejects(widget.invoke('desktop_widget_create',{kind:'daily-note'}),/eigen|Journal/);
    const created=await main.invoke('desktop_widget_create',{kind:'daily-note'}), secondId=created.widgets.find(item=>item.id!=='entries').id;
    const label=`widget-${secondId}`, second=new EmbeddedPage(main,label);pages.set(label,second);
    await second.until("!!document.querySelector('.desktop-widget .title-input')");
    await main.invoke('widget_smoke_cdp',{label,method:'Journal.disableInput',params:'{}'});
    assert.equal(await second.eval("document.documentElement.classList.contains('is-desktop-widget')"),true);
    await second.until(`window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible',{label:${JSON.stringify(label)}})`);
    const stack=await main.invoke('widget_smoke_cdp',{label:'main',method:'Journal.stack',params:'{}'});
    await pause(800);
    assert.deepEqual(await main.invoke('widget_smoke_cdp',{label:'main',method:'Journal.stack',params:'{}'}),stack,'Desktop maintenance preserves the order of overlapping widgets');
    await widget.click('.kind-picker button:has([data-icon="task"])');
    await widget.type('.entry-text','Shared entry from widget one');
    await second.until("document.querySelector('.entry-text')?.textContent==='Shared entry from widget one'");
    await second.input('.title-input','Shared title from widget two');
    await widget.until("document.querySelector('.title-input').value==='Shared title from widget two'");
    const today=await main.eval("new Date().toLocaleDateString('sv-SE')");
    await second.click('.desktop-widget-nav .nav-step:last-child');
    await second.until("document.querySelectorAll('.entry').length===0");
    await second.click('.kind-picker button:has([data-icon="note"])');
    await second.type('.entry-text','Independent second widget day');
    assert.equal(await widget.eval("document.querySelector('.entry-text').textContent"),'Shared entry from widget one');
    const renamed=await main.invoke('desktop_widget_update',{id:secondId,update:{name:'Arbeit',locked:true}});
    assert.equal(renamed.widgets.find(item=>item.id==='entries').locked,false);
    await second.until("document.querySelector('.desktop-widget').hasAttribute('data-locked') && document.querySelector('.desktop-widget-head').textContent.includes('Arbeit')");
    assert(!await widget.eval("document.querySelector('.desktop-widget-head').textContent.includes('Arbeit')"));
    await assert.rejects(second.invoke('desktop_widget_update',{id:'entries',update:{enabled:false}}),/eigen|Journal/);
    const surfaceArgs=await second.eval('({active:false,viewport:{width:innerWidth,height:innerHeight,scale:devicePixelRatio},rects:[]})');
    const firstBefore=await widget.invoke('desktop_widget_surface',await widget.eval('({active:false,viewport:{width:innerWidth,height:innerHeight,scale:devicePixelRatio},rects:[]})'));
    const secondBefore=await second.invoke('desktop_widget_surface',surfaceArgs);
    await assert.rejects(second.invoke('desktop_widget_surface',{...surfaceArgs,widget:{...secondBefore.widget,left:secondBefore.widget.left+20}}),/gesperrt/);
    await main.invoke('desktop_widget_update',{id:secondId,update:{locked:false}});
    await second.invoke('desktop_widget_surface',{...surfaceArgs,widget:{...secondBefore.widget,left:secondBefore.widget.left+20,width:secondBefore.widget.width+15},finish:true});
    await second.event('widget:surface-changed',null);
    const firstAfter=await widget.invoke('desktop_widget_surface',await widget.eval('({active:false,viewport:{width:innerWidth,height:innerHeight,scale:devicePixelRatio},rects:[]})'));
    assert.deepEqual(firstAfter.widget,firstBefore.widget,'One widget cannot move or resize another');
    await main.event('history:flush',{id:'multi-widget-save'});await pause(1400);
    const stored=await main.invoke('load_day',{date:today});assert.equal(stored.title,'Shared title from widget two');assert(stored.entries.some(entry=>entry.text==='Shared entry from widget one'));
    const saved=JSON.parse(await readFile(join(artifacts,'desktop-widgets.json'),'utf8'));
    assert.equal(saved.version,2);assert.equal(saved.widgets.length,2);
    assert.notDeepEqual(saved.widgets[0].placement,saved.widgets[1].placement);
    assert.equal(JSON.parse(await readFile(join(artifacts,'desktop-widgets.v1-backup.json'),'utf8')).enabled,true);
    const movedAgain=await second.invoke('desktop_widget_surface',surfaceArgs);
    await second.invoke('desktop_widget_surface',{...surfaceArgs,widget:{...movedAgain.widget,left:movedAgain.widget.left+5},finish:true});
    const expectedSourceX=saved.widgets.find(item=>item.id===secondId).placement.x+5*360/movedAgain.minWidth;
    const copied=await main.invoke('desktop_widget_create',{kind:'daily-note',source:secondId}), thirdId=copied.widgets.find(item=>!['entries',secondId].includes(item.id)).id;
    assert(Math.abs(copied.widgets.find(item=>item.id===secondId).placement.x-expectedSourceX)<1,'Duplicate captures a just-moved source without waiting for the position timer');
    const thirdLabel=`widget-${thirdId}`, third=new EmbeddedPage(main,thirdLabel);pages.set(thirdLabel,third);
    await third.until("!!document.querySelector('.title-input')");
    await main.invoke('widget_smoke_cdp',{label:thirdLabel,method:'Journal.disableInput',params:'{}'});
    assert.match(copied.widgets.find(item=>item.id===thirdId).name,/Arbeit.*Kopie/);
    await main.invoke('desktop_widget_remove',{id:thirdId});pages.delete(thirdLabel);
    await main.invoke('desktop_widget_update',{id:'entries',update:{enabled:false}});
    await main.until(`window.__TAURI_INTERNALS__.invoke('plugin:window|get_all_windows').then(labels=>!labels.includes('widget-entries')&&labels.includes(${JSON.stringify(label)}))`);
    assert.equal(await second.eval("document.querySelector('.entry-text').textContent"),'Independent second widget day');
    // An enabled widget recovers after a destroyed WebView; a deliberately hidden one stays hidden.
    await main.invoke('plugin:window|destroy',{label});
    await pause(2800);
    await main.until(`window.__TAURI_INTERNALS__.invoke('plugin:window|get_all_windows').then(labels=>labels.includes(${JSON.stringify(label)})&&!labels.includes('widget-entries'))`);
    await second.until("!!document.querySelector('.title-input')");
    await main.invoke('widget_smoke_cdp',{label,method:'Journal.disableInput',params:'{}'});
    await second.until("document.querySelector('.desktop-widget-head').textContent.includes('Arbeit')");
    await main.invoke('desktop_widget_update',{id:'entries',update:{enabled:true}});
    await widget.until("document.querySelector('.title-input')?.value==='Shared title from widget two'");
    await main.invoke('widget_smoke_cdp',{label:'widget-entries',method:'Journal.disableInput',params:'{}'});
    await main.invoke('desktop_widget_remove',{id:secondId});pages.delete(label);
    assert.equal((await main.invoke('desktop_widget_state')).widgets.length,1);
    assert((await main.invoke('load_day',{date:today})).entries.some(entry=>entry.text==='Shared entry from widget one'),'Removing a view preserves journal data');
    assert.equal((await main.invoke('desktop_widget_state')).autostart,false);
    assert.deepEqual(errors,[]);
    await writeFile(join(artifacts,'result.json'),JSON.stringify({passed:true,cases:['legacy migration and backup','calendar type available','multiple native widget windows','shared day edits','independent dates','independent names and locks','caller can only update its own widget','independent surfaces and saved positions','duplicate and remove','hidden widgets stay hidden','enabled widgets recover','removal preserves data','autostart unchanged'],secondId},null,2));
    console.log(`PASS: multiple native widgets. Artifacts: ${artifacts}`);
  } else if (process.env.JOURNAL_WIDGET_SCOPE === 'popups') {
    await main.invoke('widget_smoke_cdp', { label:'widget-entries', method:'Journal.disableInput', params:'{}' });
    await main.invoke('widget_smoke_cdp', { label:'main', method:'Journal.disableInput', params:'{}' });
    await widget.event('journal:appearance', { theme:'nebula', popupStyle:'b', pixel:false, language:'de', uiScale:'150', actionLayout:'orbit' });
    await widget.until("document.documentElement.dataset.theme==='nebula' && document.documentElement.dataset.popups==='b'");
    await widget.click('.kind-picker button:has([data-icon="task"])');
    await widget.until("document.querySelectorAll('.entry').length===1");
    await pause(600);
    const info = () => main.invoke('widget_smoke_cdp', { label:'widget-entries', method:'Journal.window', params:'{}' });
    const original = await info();
    const rects = "(()=>{const r=document.querySelector('.desktop-widget').getBoundingClientRect(),s=document.querySelector('.entry-symbol').getBoundingClientRect();return {widget:{left:r.left,top:r.top,width:r.width,height:r.height},symbol:{left:s.left,top:s.top},viewport:{width:innerWidth,height:innerHeight},scroll:document.querySelector('.desktop-widget-body').scrollLeft};})()";
    const before = await widget.eval(rects);
    await widget.eval(`(()=>{
      const samples=[],resizes=[],entry=document.querySelector('.entry'),widget=document.querySelector('.desktop-widget');
      window.__popupFrames={samples,resizes,entry,widget,running:true};
      window.addEventListener('resize',()=>resizes.push([innerWidth,innerHeight]));
      const sample=()=>{if(!window.__popupFrames.running)return;const r=widget.getBoundingClientRect(),s=entry.querySelector('.entry-symbol').getBoundingClientRect();samples.push([r.left,r.top,r.width,r.height,s.left,s.top,document.querySelector('.desktop-widget-body').scrollLeft]);requestAnimationFrame(sample);};sample();
    })()`);
    for(let cycle=0;cycle<12;cycle++){
      await widget.click('.entry-symbol');
      await widget.until("document.documentElement.classList.contains('widget-popups-ready')");
      await widget.click('.entry-symbol');
      await widget.until("!document.querySelector('.widget-floating-popup,.popover,.ctx-menu') && !document.documentElement.classList.contains('widget-popups-ready')");
    }
    // No settling delay: exercise replies arriving after the next popup toggle.
    for(let click=0;click<24;click++) await widget.click('.entry-symbol');
    await widget.until("!document.querySelector('.widget-floating-popup,.popover,.ctx-menu') && !document.documentElement.classList.contains('widget-popups-ready')");
    const motion = await widget.eval("(()=>{window.__popupFrames.running=false;const {samples,resizes,entry,widget}=window.__popupFrames;return {samples,resizes,sameNodes:entry===document.querySelector('.entry')&&widget===document.querySelector('.desktop-widget')};})()");
    assert(motion.samples.length>2,'Capture intermediate frames during repeated toggling');
    assert.deepEqual(motion.resizes,[],'No viewport resize events on popup toggles');
    assert(motion.sameNodes,'The editor stays mounted');
    for(const sample of motion.samples)sample.forEach((value,index)=>assert(Math.abs(value-motion.samples[0][index])<0.75,`No intermediate clipped or shifted widget frame: ${JSON.stringify(sample)}`));
    await writeFile(join(artifacts,'popup-frames.json'),JSON.stringify(motion,null,2));
    assert.deepEqual((await info()).size,original.size);assert.deepEqual((await info()).position,original.position);
    await widget.click('.entry-symbol');
    await widget.until("document.documentElement.classList.contains('widget-popup-canvas') && document.documentElement.classList.contains('widget-popups-ready')");
    await pause(400);
    const open = await info(), after = await widget.eval(rects), units = original.size.width / before.viewport.width;
    for (const axis of ['left','top']) {
      const nativeAxis = axis==='left'?'x':'y';
      assert(Math.abs(original.position[nativeAxis]+before.symbol[axis]*units-open.position[nativeAxis]-after.symbol[axis]*units)<3,'The entry keeps its screen position');
    }
    assert(Math.abs(after.widget.width-before.widget.width)<2 && Math.abs(after.widget.height-before.widget.height)<2,'The visible widget keeps its dimensions');
    assert.equal(after.scroll,0,'The widget does not scroll sideways');
    assert.deepEqual(open.size,original.size,'Opening a popup never resizes the native window');
    assert.deepEqual(open.position,original.position,'Opening a popup never moves the native window');
    assert(await widget.eval("(()=>{const p=document.querySelector('.widget-floating-popup').getBoundingClientRect(),w=document.querySelector('.desktop-widget').getBoundingClientRect();return p.right>w.right || p.left<w.left || p.bottom>w.bottom || p.top<w.top;})()"),'The popup is actually outside the widget');
    const points = await widget.eval(`(()=>{const p=document.querySelector('.widget-floating-popup').getBoundingClientRect(),w=document.querySelector('.desktop-widget').getBoundingClientRect();return [[w.left+20,w.top+20],[p.right-20,p.bottom-20],[innerWidth-2,innerHeight-2]].map(point=>point.map(value=>Math.round(value*${units})));})()`);
    const region = await main.invoke('widget_smoke_cdp', {label:'widget-entries',method:'Journal.region',params:JSON.stringify(points)});
    assert.deepEqual(region.inside,[true,true,false],'Widget and popup accept input while the unused desktop canvas is excluded from the native window');
    await widget.screenshot('popup-outside-widget.png');
    await widget.click('.sheet-action:has([data-icon="calendar"])');
    await widget.until("!!document.querySelector('.widget-floating-popup .planner') && document.documentElement.classList.contains('widget-popups-ready')");
    await widget.screenshot('planner-outside-widget.png');
    await widget.eval("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))");
    await widget.until("!document.querySelector('.widget-floating-popup,.popover,.ctx-menu') && !document.documentElement.classList.contains('widget-popups-ready')");
    const closed = await info();
    assert.deepEqual(closed.position,original.position); assert.deepEqual(closed.size,original.size);
    await widget.eval("(()=>{window.__gestureEvents=[];for(const type of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture'])window.addEventListener(type,event=>window.__gestureEvents.push({type,target:event.target.className,x:event.clientX,y:event.clientY,buttons:event.buttons,rect:document.querySelector('.desktop-widget').getBoundingClientRect().toJSON()}),true);})()");
    const gesture = async (selector,dx,dy) => {
      const point=await widget.eval(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+Math.min(20,r.width/2),y:r.top+r.height/2};})()`);
      const hit=await widget.eval(`(()=>{const target=document.elementFromPoint(${point.x},${point.y});return {matches:!!target?.closest(${JSON.stringify(selector)}),html:target?.outerHTML};})()`);
      assert(hit.matches,`Gesture target is available: ${hit.html}`);
      await widget.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
      await widget.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
      for(let step=1;step<=3;step++) await widget.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+dx*step/3,y:point.y+dy*step/3,buttons:1});
      await widget.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x+dx,y:point.y+dy,button:'left',buttons:0,clickCount:1});
      await pause(100);
    };
    await gesture('.desktop-widget-head',35,20);
    await widget.until(`Math.abs(document.querySelector('.desktop-widget').getBoundingClientRect().left-${before.widget.left+35})<1`);
    await gesture('.widget-grip.is-se',40,24);
    await widget.until(`Math.abs(document.querySelector('.desktop-widget').getBoundingClientRect().width-${before.widget.width+40})<1`);
    assert.deepEqual((await info()).size,original.size,'Move and resize also keep the native canvas stable');
    await pause(1000);
    const moved=JSON.parse(await readFile(join(artifacts,'desktop-widgets.json'),'utf8'));
    assert(moved.widgets.find(widget=>widget.id==='entries').placement.width>600,'Visible widget dimensions are persisted independently of the canvas');
    await widget.invoke('desktop_widget_update',{update:{reset:true}});
    await widget.until(`Math.abs(document.querySelector('.desktop-widget').getBoundingClientRect().width-${before.widget.width})<1 && Math.abs(document.querySelector('.desktop-widget').getBoundingClientRect().left-${before.widget.left})<1`);
    await widget.click('.widget-date');
    await widget.until("!!document.querySelector('body > .widget-floating-popup .mini-picker-panel') && document.documentElement.classList.contains('widget-popups-ready')");
    await widget.screenshot('calendar-outside-widget.png');
    await widget.event('widget:popups-dismiss', null);
    await widget.until("!document.querySelector('.mini-picker-panel') && !document.documentElement.classList.contains('widget-popups-ready')");
    await widget.click('.entry-symbol');
    await widget.until("document.documentElement.classList.contains('widget-popups-ready')");
    await widget.click('.sheet-close');
    await widget.until("!document.querySelector('.widget-floating-popup,.popover,.ctx-menu') && !document.documentElement.classList.contains('widget-popups-ready')");
    await widget.click('.entry-symbol');
    await widget.until("document.documentElement.classList.contains('widget-popups-ready')");
    await widget.click('.sheet-action:has([data-icon="tag"])');
    await widget.until("!!document.querySelector('.popover.tag-picker') && document.documentElement.classList.contains('widget-popups-ready')");
    await widget.screenshot('tag-picker-outside-widget.png');
    await widget.eval("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))");
    // TagPicker handles Escape at its input, as it does in the main editor.
    if(await widget.eval("!!document.querySelector('.popover.tag-picker')")) await widget.key('.popover.tag-picker input','Escape','Escape');
    await widget.until("!document.querySelector('.widget-floating-popup,.popover,.ctx-menu') && !document.documentElement.classList.contains('widget-popups-ready')");
    await pause(1000);
    const saved = JSON.parse(await readFile(join(artifacts,'desktop-widgets.json'),'utf8'));
    assert(saved.widgets.find(widget=>widget.id==='entries').placement.width<original.size.width+1,'The canvas size is not saved as widget size');
    assert.deepEqual(errors,[]);
    await writeFile(join(artifacts,'result.json'),JSON.stringify({passed:true,cases:['popup outside widget','48 popup toggle clicks','stable intermediate frames','no viewport resize','editor stays mounted','stable entry screen position','stable visible widget size','planner portal','mini calendar portal','tag picker portal','native input region','native outside dismissal','close button','move and resize','placement reset','persisted widget dimensions'],frames:motion.samples.length,original,open,closed},null,2));
    console.log(`PASS: native popup surface. Artifacts: ${artifacts}`);
  } else {
  assert.equal(await main.invoke('plugin:window|is_visible', { label: 'main' }), false, 'Background startup must not show main');
  assert.equal((await widget.invoke('desktop_widget_state')).autostart, false);

  await widget.click('.kind-picker button:has([data-icon="task"])');
  await widget.until("document.querySelectorAll('.entry').length===1");
  await widget.type('.entry-text', 'Written on the desktop');
  await widget.input('.title-input', 'Native widget day');
  await main.until("document.querySelector('.title-input').value==='Native widget day' && document.querySelector('.entry-text').textContent.includes('Written on the desktop')");
  await main.click('.kind-picker button:has([data-icon="note"])');
  await main.type('.entry:last-child .entry-text', 'Written in the main app');
  await widget.until("document.querySelectorAll('.entry').length===2 && document.querySelector('.entries').textContent.includes('Written in the main app')");
  await widget.event('history:request', { redo: false });
  await pause(350);
  assert.equal(await widget.eval("document.querySelectorAll('.error,.widget-message.is-error').length"), 0);
  // Redo and then force the save barrier without depending on idle timer throttling.
  await widget.event('history:request', { redo: true }); await pause(350);
  await main.event('history:flush', { id: 'native-barrier' }); await pause(300);
  const today = await main.eval("document.querySelector('.desktop-widget') ? '' : new Date().toLocaleDateString('sv-SE')");
  const stored = await main.invoke('load_day', { date: today });
  assert.equal(stored.title, 'Native widget day');
  assert.ok(stored.entries.some(e => e.text === 'Written on the desktop'));
  assert.ok(stored.entries.some(e => e.text === 'Written in the main app'));

  // Submit the delayed field operation after a real main-window edit, through the actual widget client.
  const originalText=await widget.eval("document.querySelector('.entry .entry-text').textContent");
  await main.type('.entry .entry-text', ' main draft');
  await widget.until("document.querySelector('.entry-text').textContent.includes('main draft')");
  await widget.eval(`(()=>{const el=document.querySelector('.desktop-widget');let fiber=el[Object.keys(el).find(key=>key.startsWith('__reactFiber'))];let client;
    while(fiber&&!client){for(let hook=fiber.memoizedState;hook&&typeof hook==='object';hook=hook.next){const value=hook.memoizedState;if(value&&typeof value.submit==='function'&&typeof value.flush==='function'){client=value;break;}}fiber=fiber.return;}
    if(!client)throw Error('Native widget client not found');
    client.submit({kind:'change',id:document.querySelector('.entry').dataset.entryId,before:{text:${JSON.stringify(originalText)}},patch:{text:'Retained local draft'}});
  })()`);
  await widget.until("!!document.querySelector('.widget-message.is-error')");
  await widget.click('.widget-recovery button:first-child');
  assert.match(await widget.eval("document.querySelector('.widget-draft').value"), /local draft/);
  assert.match(await main.eval("document.querySelector('.entry .entry-text').textContent"), /main draft/);
  assert.doesNotMatch(await main.eval("document.querySelector('.entry .entry-text').textContent"), /local draft/);
  await widget.screenshot('conflict-recovery.png');
  await widget.click('.widget-recovery button:last-child');
  await widget.until("!document.querySelector('.widget-message.is-error') && document.querySelector('.entry-text').textContent.includes('main draft')");

  await widget.click('.desktop-widget-nav .nav-step:last-child');
  await widget.until("document.querySelectorAll('.entry').length===0");
  await widget.input('.title-input', 'Independent next day');
  await widget.click('.kind-picker button:has([data-icon="task"])');
  await widget.type('.entry-text', 'Tomorrow from widget');
  const tomorrow = await widget.eval("document.querySelector('.desktop-widget-status > span').textContent.split('.').reverse().join('-')");
  await main.event('journal:navigate', { date: tomorrow, entry: null });
  await main.until("document.querySelector('.title-input').value==='Independent next day' && document.querySelector('.entries').textContent.includes('Tomorrow from widget')");
  await main.event('history:flush',{id:'before-main-reload'});await pause(200);
  await main.send('Page.reload');
  await main.until("document.querySelector('.title-input')?.value==='Native widget day'");
  await widget.until("!document.querySelector('.widget-message') && document.querySelector('.title-input').value==='Independent next day'");
  await widget.input('.title-input','After coordinator restart');
  await main.event('history:flush',{id:'after-main-reload'});await pause(200);
  assert.equal((await main.invoke('load_day',{date:tomorrow})).title,'After coordinator restart');
  await widget.input('.title-input','Independent next day');
  const originalEntry=await widget.eval("document.querySelector('.entry').dataset.entryId");
  const field=`[data-entry-id="${originalEntry}"] .entry-text`;
  const tag={id:crypto.randomUUID(),name:'Widget work',color:'#5ba6c9'};
  await main.invoke('save_tags',{tags:[tag]});
  await widget.key(field,'g','KeyG',{altKey:true});await widget.until("!!document.querySelector('.tag-picker')");
  await widget.click('.tag-option.is-tag');await widget.until("document.querySelector('.entry-tag')?.textContent.includes('Widget work')");
  await main.invoke('save_tags',{tags:[{...tag,name:'Renamed work',color:'#b97bbb'}]});
  await widget.until("document.querySelector('.entry-tag')?.textContent.includes('Renamed work')");
  await widget.key(field,'Enter','Enter',{ctrlKey:true});await widget.until("document.querySelectorAll('.entry').length===2");
  await widget.key(field,'Enter','Enter');await widget.until("document.querySelectorAll('.entry').length===3");
  await main.event('history:flush',{id:'entry-keys'});await pause(200);
  const keyed=await main.invoke('load_day',{date:tomorrow});
  assert.equal(keyed.entries.find(e=>e.id===originalEntry).tag,tag.id);
  assert.equal(keyed.entries.filter(e=>e.tag===tag.id).length,2,'Enter inherits the tag');
  assert.equal(keyed.entries.filter(e=>!e.tag).length,1,'Ctrl+Enter creates an untagged entry');
  const secondEntry=keyed.entries.find(e=>e.tag===tag.id&&e.id!==originalEntry).id;
  await widget.type(`[data-entry-id="${secondEntry}"] .entry-text`,'Second work task');
  await widget.key(`[data-entry-id="${secondEntry}"] .entry-text`,'ArrowUp','ArrowUp',{altKey:true});
  await widget.until(`document.querySelector('.entry.has-tag').dataset.entryId===${JSON.stringify(secondEntry)}`);
  await widget.key(field,'b','KeyB',{altKey:true});await widget.until("!!document.querySelector('.entry-description-field .markdown-text')");
  await widget.type('.entry-description-field .markdown-text','Details written in the widget');
  await widget.key('.entry-description-field .markdown-text','Escape','Escape');
  await widget.key(field,'m','KeyM',{altKey:true});
  await main.event('history:flush',{id:'widget-plan'});await pause(250);
  const planned=await main.invoke('load_day',{date:tomorrow}), trace=planned.entries.find(e=>e.id===originalEntry);
  assert.equal(trace.description,'Details written in the widget');assert.ok(trace.plan?.targets.length);
  const target=await main.invoke('load_day',{date:trace.plan.targets[0].date});
  assert.ok(target.entries.some(e=>e.id===trace.plan.targets[0].id&&e.tag===tag.id&&e.description===trace.description));
  const blank=keyed.entries.find(e=>!e.tag).id;
  await widget.key(`[data-entry-id="${blank}"] .entry-text`,'Backspace','Backspace');await widget.until("document.querySelectorAll('.entry').length===2");

  // All theme changes use the real settings UI, including live propagation to the other WebView.
  await main.event('journal:settings', { tab: 'appearance' });
  for (const theme of ['nebula', 'journal', 'classic']) {
    await main.click(`[data-theme-choice="${theme}"]`);
    await widget.until(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`);
    await widget.eval("document.querySelector('.entry-symbol[aria-expanded=true]')?.click()");
    if(theme==='nebula')await widget.until("document.querySelector('.desktop-widget').classList.contains('nebula-terminal')");
    await widget.screenshot(`widget-${theme}.png`);
    assert.equal(await widget.eval("document.documentElement.scrollWidth>innerWidth || document.documentElement.scrollHeight>innerHeight"), false, `${theme} viewport overflow`);
  }
  await main.click('.settings-close');
  if(process.env.JOURNAL_WIDGET_SHELL_CHECK==='1'){
    const widgetWindow=await main.invoke('widget_smoke_cdp',{label:'widget-entries',method:'Journal.window',params:'{}'}), mainWindow=await main.invoke('widget_smoke_cdp',{label:'main',method:'Journal.window',params:'{}'});
    const point=await widget.eval("(()=>{const r=document.querySelector('.title-input').getBoundingClientRect();return {x:(r.left+r.width*.8)/innerWidth,y:(r.top+r.height*.5)/innerHeight};})()");
    const shell=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('scripts/widget-shell-smoke.ps1'),'-Widget',String(widgetWindow.hwnd),'-Application',String(mainWindow.hwnd),'-EditorX',String(point.x),'-EditorY',String(point.y)],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let shellOutput='';shell.stdout.on('data',chunk=>{shellOutput+=chunk;});shell.stderr.on('data',chunk=>{shellOutput+=chunk;});
    const code=await new Promise(done=>shell.once('exit',done));assert.equal(code,0,shellOutput);console.log(shellOutput.trim());
    await widget.until("document.querySelector('.title-input').value.endsWith('x')");
  }
  await main.event('journal:settings',{tab:'appearance'});
  await main.click('[data-pixel-toggle]');
  await widget.until("document.documentElement.hasAttribute('data-pixel')");
  const minimum=await widget.invoke('desktop_widget_surface',{active:false,viewport:await widget.eval('({width:innerWidth,height:innerHeight,scale:devicePixelRatio})'),rects:[]});
  await widget.invoke('desktop_widget_surface',{active:false,viewport:await widget.eval('({width:innerWidth,height:innerHeight,scale:devicePixelRatio})'),rects:[],widget:{...minimum.widget,width:minimum.minWidth,height:minimum.minHeight},finish:true});
  await widget.event('widget:surface-changed',null);
  await widget.until(`Math.abs(document.querySelector('.desktop-widget').getBoundingClientRect().width-${minimum.minWidth})<1`);
  await widget.screenshot('widget-pixel-minimum.png');
  assert.equal(await widget.eval("document.documentElement.scrollWidth>innerWidth"), false);
  assert.equal(await widget.eval("getComputedStyle(document.querySelector('.desktop-widget')).borderTopLeftRadius"), '0px');
  await widget.invoke('desktop_widget_update', { update: { locked: true } });
  await widget.until("document.querySelectorAll('.widget-grip').length===0");
  await widget.invoke('desktop_widget_update', { update: { locked: false } });
  await widget.until("document.querySelectorAll('.widget-grip').length===8");
  assert.equal((await widget.invoke('desktop_widget_state')).autostart, false);
  await main.event('history:flush', { id: 'native-final' }); await pause(250);
  const saved = await main.invoke('load_day', { date: tomorrow });
  assert.equal(saved.title, process.env.JOURNAL_WIDGET_SHELL_CHECK==='1'?'Independent next dayx':'Independent next day'); assert.ok(saved.entries.some(e=>e.text==='Tomorrow from widget'));
  await main.eval("localStorage.setItem('journal.backgroundHint','1')");
  await main.invoke('plugin:window|close',{label:'main'});
  await main.until("window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible',{label:'main'}).then(value=>!value)");
  assert.equal((await main.invoke('desktop_widget_state')).widgets.find(widget=>widget.id==='entries').enabled,true);
  await widget.click('.widget-close');
  await main.until("window.__TAURI_INTERNALS__.invoke('plugin:window|get_all_windows').then(windows=>!windows.includes('widget-entries'))");
  assert.equal((await main.invoke('desktop_widget_state')).widgets.find(widget=>widget.id==='entries').enabled,false);
  await main.invoke('desktop_widget_update',{id:'entries',update:{enabled:true}});
  await widget.until("document.querySelector('.title-input')?.value==='Native widget day'");
  assert.deepEqual(errors, []);
  await writeFile(join(artifacts, 'result.json'), JSON.stringify({ passed: true, nativeShell:process.env.JOURNAL_WIDGET_SHELL_CHECK==='1', date: today, tomorrow, cases: ['native WebView2 and SQLite', 'hidden main', 'live two-way edits', 'undo/redo barrier', 'conflict draft recovery', 'independent dates', 'main navigation into a widget draft', 'writer reconnect after main reload', 'tags and rename', 'Enter / Ctrl+Enter', 'reorder', 'description and planning', 'all themes', 'pixel minimum size', 'position lock', 'main close', 'widget close and restore'], errors }, null, 2));
  console.log(`PASS: native widget integration. Artifacts: ${artifacts}`);
  }
} catch (error) {
  if(pages.has('widget-entries')){try{console.log('Gesture diagnostics:',JSON.stringify(await pages.get('widget-entries').eval('window.__gestureEvents')));}catch{}}
  for (const [label, page] of pages) { try { await page.screenshot(`failure-${label}.png`); await writeFile(join(artifacts, `${label}.txt`), await page.eval('document.body.innerText')); await writeFile(join(artifacts, `${label}.state.json`),JSON.stringify(await page.eval('({origin:location.origin,storage:{...localStorage}})'),null,2)); } catch {} }
  await writeFile(join(artifacts, 'process.log'), output);
  console.error(`Native widget artifacts: ${artifacts}`, error); throw error;
} finally {
  const main = pages.get('main');
  if (main && app.exitCode === null) { try { await Promise.race([main.invoke('quit_app'),pause(750)]); } catch {} }
  for (const page of connected.values()) page.socket.close();
  if (app.exitCode === null) { await Promise.race([new Promise(done => app.once('exit', done)), pause(2000)]); if (app.exitCode === null) app.kill(); }
}
