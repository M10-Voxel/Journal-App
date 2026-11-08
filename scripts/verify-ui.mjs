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
    days.set(shift(1), { date:shift(1), title:'', body:'', revision:1, entries:[item(1, 'event', 'Zahnarzt', { time:'09:00' }), item(2, 'event', 'Telefonat mit **Anna**', { time:'09:30', end:'10:30' }), item(3, 'task', 'Bericht abgeben', { priority:true }), item(4, 'note', 'Gute Laune'),
      item(5, 'task', 'Schon verschoben', { plan:{ via:'date', targets:[{ date:shift(9), id:item(6, 'task', '').id }], time:null, reminder:false } })] });
    days.set(shift(-2), { date:shift(-2), title:'', body:'', revision:1, entries:[item(7, 'task', 'Einkaufen', { done:true }), item(8, 'event', 'Kino', { time:'18:30' })] });
    days.set(shift(3), { date:shift(3), title:'Großer Tag', body:'', revision:1, entries:Array.from({ length:7 }, (_, index) => item(10 + index, 'task', \`Aufgabe \${index + 1}\`)) });
    days.set(shift(5), { date:shift(5), title:'Urlaub', body:'', revision:1, entries:[item(20, 'event', 'Flug nach Lissabon')] });
  }
  const invoked = [];
  window.__uiTest = { date, saves: 0, invoked, shift, updateAvailable:sessionStorage.getItem('test.updateAvailable')==='1', updateCheckError:sessionStorage.getItem('test.updateCheckError')==='1', day: (value = date) => structuredClone(days.get(value)),
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
  // Repeating series (Repeat in storage.rs): entries keep their series as seriesId; loading shows it as repeat.
  const series = new Map();
  window.__uiTest.series = series;
  const withRepeat = entry => { const { seriesId, ...rest } = entry; const known = seriesId && series.get(seriesId); return known ? { ...rest, repeat:{ series:seriesId, rule:structuredClone(known.rule), horizon:known.horizon } } : rest; };
  const loadDay = date => {
    const value = structuredClone(days.get(date) ?? { date, title:'', body:'', revision:0, entries:[] });
    value.entries = value.entries.map(withRepeat);
    for (const entry of value.entries) { const from = origin(entry.id); if (from) entry.origin = from; }
    return value;
  };
  const dayBefore = date => { const [y, m, d] = date.split('-').map(Number); const value = new Date(y, m - 1, d - 1, 12); return [value.getFullYear(), String(value.getMonth()+1).padStart(2,'0'), String(value.getDate()).padStart(2,'0')].join('-'); };
  const addCopy = (date, id, entry, schedule, seriesId) => {
    const other = days.get(date) ?? { date, title:'', body:'', revision:0, entries:[] };
    other.revision += 1;
    other.entries.push({ id, kind:entry.kind, text:entry.text, done:false, cancelled:false, priority:entry.priority, time:schedule.time ?? null, end:schedule.end ?? null, reminder:Boolean(schedule.reminder), showInJournal:entry.showInJournal !== false, plan:null, seriesId });
    days.set(date, other);
  };
  // An entry leaving its series on \`date\` ends it the day before; open later occurrences go, finished ones may join the successor.
  const endSeries = (id, date, successor, touched) => {
    for (const [day, value] of days) {
      if (day <= date) continue;
      const before = value.entries.length;
      value.entries = value.entries.filter(entry => !(entry.seriesId === id && !entry.plan && !entry.done && !entry.cancelled));
      for (const entry of value.entries) if (entry.seriesId === id && successor?.dates.includes(day)) { entry.seriesId = successor.id; successor.dates.splice(successor.dates.indexOf(day), 1); touched.add(day); }
      if (value.entries.length !== before) { value.revision += 1; touched.add(day); }
    }
    const known = series.get(id);
    if (known) known.rule = { ...known.rule, end:{ until:dayBefore(date) } };
  };
  const dropEmptySeries = () => { for (const id of series.keys()) if (![...days.values()].some(day => day.entries.some(entry => entry.seriesId === id))) series.delete(id); };
  const linkedNext = id => {
    const current = [...days.values()].flatMap(day => day.entries).find(entry => entry.id === id);
    return [...(current?.plan?.targets ?? []).map(target => target.id), ...[...days.values()].flatMap(day => day.entries.filter(entry => entry.plan?.targets.some(target => target.id === id) || (current?.seriesId && entry.seriesId === current.seriesId)).map(entry => entry.id))];
  };
  const take = id => { for (const [day, value] of days) { const index = value.entries.findIndex(entry => entry.id === id); if (index >= 0) return [day, value.entries.splice(index, 1)[0]]; } };
  const tagList = [];
  window.__uiTest.tags = () => structuredClone(tagList);
  const mail = { accounts:[], pending:[], candidates:[], notices:[], delivered:new Set(), analyzed:[], model:{installed:false,enabled:false,installing:false,downloaded:0,total:0,error:''} };
  window.__uiTest.mail = mail;
  const mailChanged = () => { void window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event:'mail:changed', payload:null }); };
  mockIPC((command, payload) => {
    if (command === 'vault_status') return {path:'C:/Test/Journal-A',legacy:true,preferences:null,error:null};
    if (command === 'vault_choose') { invoked.push([command,payload]);return window.__uiTest.vaultChoice ?? null; }
    if (command === 'vault_save_preferences' || command === 'vault_activate') { invoked.push([command,payload]);return null; }
    if (command === 'plugin:app|version') return '0.1.0';
    if (command === 'startup_update_check') {
      if(label!=='main')return false;
      if(sessionStorage.getItem('test.persistUpdateClaim')!=='1')return true;
      const claimed=sessionStorage.getItem('test.updateClaimed')==='1';sessionStorage.setItem('test.updateClaimed','1');return !claimed;
    }
    if (command === 'plugin:updater|check') {
      invoked.push([command,payload]);if(window.__uiTest.updateCheckError)throw new Error('Offline test');
      const number=invoked.filter(([c])=>c==='plugin:updater|check').length;
      const update=window.__uiTest.updateAvailable ? {rid:100+number,currentVersion:'0.1.0',version:'0.1.1',body:'Release notes',rawJson:{}} : null;
      if(number===1&&sessionStorage.getItem('test.delayStartupCheck')==='1')return new Promise(resolve=>{window.__uiTest.finishStartupCheck=()=>resolve(update)});
      return update;
    }
    if (command === 'plugin:updater|download') { invoked.push([command,payload]);if(window.__uiTest.updateError)throw new Error(window.__uiTest.updateError);return 101; }
    if (command === 'plugin:updater|install' || command === 'plugin:resources|close') { invoked.push([command,payload]);return null; }
    if (command === 'plugin:window|get_all_windows') return [label];
    if (command === 'history_step') {
      invoked.push([command,payload]);
      if (payload.emptyEntry) {
        for (const value of days.values()) {
          const entry=value.entries.find(e=>e.id===payload.emptyEntry && e.text==='');
          if (entry) { window.__uiTest.undone={date:value.date,entry:structuredClone(entry)};value.entries=value.entries.filter(e=>e.id!==entry.id); }
        }
      } else if (payload.redo && window.__uiTest.undone) {
        const {date,entry}=window.__uiTest.undone;days.get(date).entries.push(entry);window.__uiTest.undone=null;
      }
      void window.__uiTest.emit('history:restored',null);return true;
    }
    if (command === 'drive_validate') return null;
    if (command === 'board_list') return JSON.parse(sessionStorage.getItem('boardCards')||'[]');
    if (command === 'board_folders') return JSON.parse(sessionStorage.getItem('boardFolders')||'[]');
    if (command === 'board_folder_save') {
      const folders=JSON.parse(sessionStorage.getItem('boardFolders')||'[]');
      sessionStorage.setItem('boardFolders',JSON.stringify([...folders.filter(f=>f.id!==payload.folder.id),payload.folder]));
      return payload.folder;
    }
    if (command === 'board_folder_remove') {
      const folders=JSON.parse(sessionStorage.getItem('boardFolders')||'[]'), parent=folders.find(f=>f.id===payload.id)?.parent??null;
      sessionStorage.setItem('boardFolders',JSON.stringify(folders.filter(f=>f.id!==payload.id).map(f=>f.parent===payload.id?{...f,parent}:f)));
      const cards=JSON.parse(sessionStorage.getItem('boardCards')||'[]');
      sessionStorage.setItem('boardCards',JSON.stringify(cards.map(c=>c.folder===payload.id?{...c,folder:parent}:c)));return null;
    }
    if (command === 'board_patch_many') {
      const cards=JSON.parse(sessionStorage.getItem('boardCards')||'[]');
      sessionStorage.setItem('boardCards',JSON.stringify(cards.map(c=>({...c,...payload.patches[c.id]}))));return null;
    }
    if (command === 'board_remove') {
      const cards=JSON.parse(sessionStorage.getItem('boardCards')||'[]'), note=cards.find(c=>c.id===payload.id), removed=new Set(payload.ids??[payload.id]);
      for(const note of cards.filter(c=>removed.has(c.id)&&c.kind==='note'))for(const card of cards)if(card.kind!=='note'&&card.notebook&&!card.dates.length&&note.links?.includes(card.id)&&(card.links??[]).every(id=>(payload.ids??[payload.id]).includes(id)))removed.add(card.id);
      sessionStorage.setItem('boardCards',JSON.stringify(cards.filter(c=>!removed.has(c.id)).map(c=>({...c,links:(c.links??[]).filter(id=>!removed.has(id))}))));
      return null;
    }
    if (command === 'board_patch') {const cards=JSON.parse(sessionStorage.getItem('boardCards')||'[]');const old=cards.find(c=>c.id===payload.id);const card={...old,...payload.patch,id:payload.id};sessionStorage.setItem('boardCards',JSON.stringify([...cards.filter(c=>c.id!==card.id),card]));return card;}
    if (command === 'board_image_save') {sessionStorage.setItem('boardImage:'+payload.id,payload.data);return null;}
    if (command === 'board_image_load') return 'data:image/avif;base64,'+sessionStorage.getItem('boardImage:'+payload.id);
    if (command === 'board_link_preview') return '<html><head><title>Board test page</title><meta property="og:description" content="Preview description"></head></html>';
    if (command === 'board_detach' || command === 'board_open_link') {invoked.push([command,payload]);return null;}
    if (command === 'drive_status') return {connected:sessionStorage.getItem('driveConnected')==='yes',clientId:'test.apps.googleusercontent.com'};
    if (command === 'drive_connect') {sessionStorage.setItem('driveConnected','yes');return null;}
    if (command === 'drive_snapshot') return {schema:11,tables:{days:{'2026-11-02':{date:'2026-11-02',title:'Private Sync Test',body:'Geheim',revision:1}},entries:{},tags:{},series:{}}};
    if (command === 'drive_read') return sessionStorage.getItem('driveRemote') ? {id:'test-file',etag:'test-version',data:sessionStorage.getItem('driveRemote')} : {id:null,etag:null,data:null};
    if (command === 'drive_write') {sessionStorage.setItem('driveEncrypted',payload.data);return null;}
    if (command === 'drive_apply') {sessionStorage.setItem('driveApplied',JSON.stringify(payload.snapshot));return null;}

    // Activities bring their own tags; the tag checks start without any (localStorage 'test.noActivities').
    if (command === 'load_period_data') return JSON.stringify({ definitions:localStorage.getItem('test.noActivities') ? [] : [{id:'reading',name:'Lesen',trackTime:!localStorage.getItem('test.activitySizes')},{id:'sport',name:'Sport'},...(localStorage.getItem('test.activitySizes')?[{id:'binary-extra',name:'Magnesium',trackTime:false}]:[])], notes:{}, days:Object.fromEntries(Array.from({length:28},(_,i)=>[shift(-i),{rating:i%4===0?undefined:4+i%7,items:{reading:{done:i%2===0,minutes:30},sport:{done:i%3===0,minutes:45}}}])) });
    if (command === 'save_period_data') { if (window.__uiTest.failPeriodSave) { window.__uiTest.failPeriodSave=false; throw new Error('Timer save test failure'); } window.__uiTest.periodData=JSON.parse(payload.data); return; }
    if (command === 'mail_ml_status') return structuredClone(mail.model);
    if (command === 'mail_ml_install') { mail.model.installed=true; mail.model.enabled=true; void window.__uiTest.emit('mail:ml',null); mailChanged(); return; }
    if (command === 'mail_ml_enabled') { mail.model.enabled=payload.value; void window.__uiTest.emit('mail:ml',null); mailChanged(); return; }
    if (command === 'mail_ml_analyze') {
      if (!mail.model.enabled) throw new Error('Lokales Modell ist nicht aktiv');
      mail.analyzed.push(payload.text);
      const date=window.__uiTest.shift(1).split('-').reverse().join('.');
      const spans=payload.text.includes('Treffen morgen 20 bis 21:20') ? [['date','morgen'],['event','Treffen']] : payload.text.includes('Treffen morgen 17 Uhr') ? [['date','morgen'],['time','17 Uhr'],['event','Treffen']] : [['date',date],['time','zwischen 10 und 12 Uhr'],['event','Lieferung']];
      return {text:payload.text,milliseconds:100,classifications:[{label:'a future appointment, invitation or announced delivery',score:.8}],mentions:spans.filter(([,text])=>payload.text.includes(text)).map(([field,text])=>({field,text,score:.95,start:payload.text.indexOf(text),end:payload.text.indexOf(text)+text.length}))};
    }
    if (command === 'mail_accounts') return structuredClone(mail.accounts);
    if (command === 'mail_pending') return structuredClone(mail.pending);
    if (command === 'mail_candidates') return structuredClone(mail.candidates);
    if (command === 'mail_notices') return [...mail.notices];
    if (command === 'mail_save') {
      if (payload.account.host === 'bad.example') throw new Error('Testverbindung fehlgeschlagen');
      const account = structuredClone(payload.account);
      mail.accounts = [...mail.accounts.filter(a => a.id !== account.id), account]; mailChanged(); return account;
    }
    if (command === 'mail_enabled') { mail.accounts.find(a => a.id === payload.id).enabled = payload.enabled; mailChanged(); return; }
    if (command === 'mail_auto_import') { mail.accounts.find(a => a.id === payload.id).autoImport = payload.enabled; mailChanged(); return; }
    if (command === 'mail_cancel' || command === 'mail_help') return;
    if (command === 'mail_remove') {
      mail.accounts = mail.accounts.filter(a => a.id !== payload.id); mail.pending = mail.pending.filter(p => p.account.id !== payload.id); mail.candidates = mail.candidates.filter(p => p.accountId !== payload.id); mailChanged(); return;
    }
    if (command === 'mail_stage') {
      if (mail.pending.some(p => p.account.id === payload.accountId && p.message.key === payload.messageKey)) {
        mail.candidates.push(...payload.candidates); if (payload.notice) mail.notices.push(payload.notice);
        mail.pending = mail.pending.filter(p => p.account.id !== payload.accountId || p.message.key !== payload.messageKey); mailChanged();
      }
      return;
    }
    if (command === 'mail_resolve') { mail.candidates = mail.candidates.filter(c => !payload.ids.includes(c.id)); mailChanged(); return; }
    if (command === 'mail_sync') {
      const account = mail.accounts.find(a => a.id === payload.id); account.lastSync = Date.now()/1000;
      if (!mail.delivered.has(account.id)) {
        mail.delivered.add(account.id); const target = shift(1).split('-').reverse().join('.');
        mail.pending.push({ account:structuredClone(account), message:{ key:'mail-test-1', subject:'Lieferung UI-Test',sender:'Carrier <notify@carrier.example>',sentAt:Date.now()/1000,text:'Ihre Lieferung kommt am ' + target + ' zwischen 10 und 12 Uhr.',html:'',calendars:[] } });
      }
      mailChanged(); return;
    }
    if (command === 'read_calendar_file') return window.__uiTest.icsInput ?? null;
    if (command === 'write_calendar_file') { window.__uiTest.icsOutput = payload.content; return true; }
    if (command === 'export_calendar') return [...days.values()].map(day => ({ date:day.date, title:day.title, entries:structuredClone(day.entries.filter(entry => !entry.plan && entry.kind !== 'note')) }));
    if (command === 'move_calendar_entry') { invoked.push([command,payload]);
      const old = days.get(payload.from), index = old?.entries.findIndex(entry => entry.id === payload.id) ?? -1;
      if (index < 0) throw new Error('Missing calendar entry');
      const [entry] = old.entries.splice(index,1);
      const target = days.get(payload.to) ?? { date:payload.to,title:'',body:'',revision:0,entries:[] };
      target.entries.push({...entry,time:payload.time,end:payload.end}); days.set(payload.to,target);
      old.revision++;if(target!==old)target.revision++;
      const touched=[...new Set([payload.from,payload.to])];
      void window.__TAURI_INTERNALS__.invoke('plugin:event|emit',{event:'journal:changed',payload:touched});
      return touched;
    }
    if (command === 'import_calendar') {
      const touched = new Set();
      for (const { date, entry } of payload.entries) {
        let id = entry.id;
        for (const [oldDate, oldDay] of days) {
          const index = oldDay.entries.findIndex(item => item.calendarUid === entry.calendarUid || item.id === entry.id);
          if (index >= 0) { id = oldDay.entries[index].id; oldDay.entries.splice(index, 1); touched.add(oldDate); }
        }
        const day = days.get(date) ?? { date, title:'', body:'', revision:0, entries:[] };
        day.entries.push({ ...entry, id }); days.set(date, day); touched.add(date);
      }
      for (const date of touched) days.get(date).revision++;
      void window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event:'journal:changed', payload:[...touched] });
      return [...touched];
    }
    if (command === 'load_tags') return structuredClone(tagList);
    if (command === 'save_tags') {
      const save = () => {
      const names = payload.tags.map(tag => tag.name.trim().toLowerCase());
      if (names.some((name, index) => !name || names.indexOf(name) !== index || payload.tags[index].name !== payload.tags[index].name.trim())) throw new Error('Ungültiger Tag');
      const kept = new Set(payload.tags.map(tag => tag.id)), touched = [];
      for (const day of days.values()) for (const entry of day.entries) if (entry.tag && !kept.has(entry.tag)) { entry.tag = null; touched.push(day.date); }
      tagList.splice(0, tagList.length, ...payload.tags.map(tag => ({ ...tag, color:tag.color.toLowerCase() })));
      void window.__uiTest.emit('journal:tags', structuredClone(tagList));
      if (touched.length) void window.__uiTest.emit('journal:changed', touched);
      return structuredClone(tagList);
      };
      if (!window.__uiTest.tagSaveDelay) return save();
      window.__uiTest.tagSaveActive = true;
      return new Promise((resolve, reject) => setTimeout(() => {
        try { resolve(save()); } catch (error) { reject(error); }
        finally { window.__uiTest.tagSaveActive = false; }
      }, window.__uiTest.tagSaveDelay));
    }
    if (command === 'load_day') return loadDay(payload.date);
    if (command === 'load_range') return [...days.values()].filter(day => day.date >= payload.from && day.date <= payload.to)
      .map(day => ({ date:day.date, title:day.title, entries:structuredClone(day.entries.filter(entry => !entry.plan).map(withRepeat)) })).filter(day => day.title || day.entries.length).sort((a, b) => a.date.localeCompare(b.date));
    if (command === 'snooze_reminder' || command === 'fit_popup' || command === 'reminder_action' || command === 'background_hint' || command === 'quit_app') { invoked.push([command, payload]); return null; }
    if (command === 'popup_reminders') return label !== 'reminder' ? [] : [
      { id:'10000000-0000-4000-8000-000000000001', date, kind:'task', text:'Eine Runde durch den **Park** gehen', time:'14:15', end:null, due:date + 'T14:15', late:false, snoozed:false },
      { id:'10000000-0000-4000-8000-000000000003', date, kind:'event', text:'Kaffee am Nachmittag', time:'15:00', end:'15:30', due:date + 'T15:00', late:true, snoozed:false },
      { id:'background', date:'', kind:'info', text:'Journal läuft im Hintergrund weiter und erinnert dich. Öffnen und Beenden über das Symbol im Infobereich.', time:null, end:null, due:'', late:false, snoozed:false }];
    if (command === 'load_series') return [...series].map(([id, known]) => ({ series:id, rule:structuredClone(known.rule), horizon:known.horizon }));
    if (command === 'extend_series') {
      const touched = new Set();
      for (const extension of payload.extensions) {
        const known = series.get(extension.series);
        if (!known || known.horizon !== extension.from) continue;
        const latest = [...days.values()].flatMap(day => day.entries.filter(entry => entry.seriesId === extension.series).map(entry => [day.date, entry])).sort((a, b) => b[0].localeCompare(a[0]))[0]?.[1];
        if (!latest) continue;
        for (const date of extension.dates) { addCopy(date, crypto.randomUUID(), latest, latest, extension.series); touched.add(date); }
        known.horizon = extension.to;
      }
      window.__uiTest.extended = (window.__uiTest.extended ?? 0) + payload.extensions.length;
      return [...touched].sort();
    }
    if (command === 'plugin:window|is_maximized') return Boolean(window.__uiTest.maximized);
    if (command === 'plugin:window|toggle_maximize') { window.__uiTest.maximized = !window.__uiTest.maximized; invoked.push([command, payload]); return null; }
    if (command === 'open_window' || command === 'show_day' || command === 'panel_detach' || command.startsWith('plugin:window|')) { invoked.push([command, payload]); return null; }
    if (command === 'load_linked') {
      const where = id => { for (const [day, value] of days) { const found = value.entries.find(entry => entry.id === id); if (found) return [day, found]; } };
      const group = [payload.id], queue = [payload.id];
      while (queue.length) for (const other of linkedNext(queue.shift())) if (!group.includes(other)) { group.push(other); queue.push(other); }
      return group.map(id => where(id)).filter(Boolean).map(([date, entry]) => ({ id:entry.id, date, kind:entry.kind, done:entry.done, cancelled:entry.cancelled, trace:Boolean(entry.plan), series:entry.seriesId ?? null })).sort((a, b) => a.date.localeCompare(b.date));
    }
    if (command === 'edit_linked') {
      const { edit } = payload, changed = new Set();
      for (const id of payload.ids) for (const [day, value] of days) {
        const entry = value.entries.find(item => item.id === id && !item.plan);
        if (!entry) continue;
        Object.assign(entry, { kind:edit.kind, text:edit.text, description:edit.description, priority:edit.priority, reminder:edit.reminder && edit.kind !== 'note', showInJournal:edit.showInJournal },
          edit.times ? { time:edit.times.time, end:edit.times.end } : {}, edit.kind === 'task' ? {} : { done:false, cancelled:false });
        changed.add(day);
      }
      for (const day of changed) days.get(day).revision += 1;
      void window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event:'journal:changed', payload:[...changed] });
      return [...changed].sort();
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
      dropEmptySeries();
      window.__uiTest.linkedChanges = (window.__uiTest.linkedChanges ?? 0) + 1;
      void window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event:'journal:changed', payload:[...changed] });
      return [...changed].sort();
    }
    if (command === 'save_day') {
      const value = structuredClone(payload.day); value.revision += 1;
      // Edits kept with their entry ("only this one") are not passed on (keepAlone in storage.rs).
      const alone = new Set(value.keepAlone ?? []); delete value.keepAlone;
      for (const entry of value.entries) delete entry.origin;
      const previous = days.get(value.date)?.entries ?? [];
      const created = new Set(previous.flatMap(entry => entry.plan?.targets ?? []).map(target => target.id));
      const touched = new Set(), linked = new Set();
      // Without repeat an entry keeps its series; an unknown series starts here; leaving a series ends it on this day.
      const started = [];
      for (const entry of value.entries) {
        const old = previous.find(item => item.id === entry.id)?.seriesId ?? null, repeat = entry.repeat;
        let next = old;
        if (repeat && series.has(repeat.series)) next = repeat.series;
        else if (repeat && !repeat.rule) next = null;
        else if (repeat) { series.set(repeat.series, { rule:structuredClone(repeat.rule), horizon:repeat.horizon }); next = repeat.series; started.push({ entry, dates:[...repeat.dates ?? []] }); }
        if (old && old !== next) endSeries(old, value.date, started.at(-1)?.entry === entry ? { id:next, dates:started.at(-1).dates } : null, touched);
        delete entry.repeat; entry.seriesId = next ?? undefined;
      }
      days.set(value.date, value);
      for (const { entry, dates } of started) for (const date of dates) { addCopy(date, crypto.randomUUID(), entry, entry, entry.seriesId); touched.add(date); }
      for (const entry of value.entries) for (const target of entry.plan?.targets ?? []) {
        if (created.has(target.id)) continue;
        const repeat = entry.plan.repeat, dates = [...repeat?.dates ?? []];
        if (repeat && !series.has(repeat.series)) {
          series.set(repeat.series, { rule:structuredClone(repeat.rule), horizon:repeat.horizon });
          if (entry.seriesId) endSeries(entry.seriesId, value.date, { id:repeat.series, dates }, touched);
        }
        addCopy(target.date, target.id, entry, entry.plan, repeat?.series); touched.add(target.date);
        for (const date of dates) { addCopy(date, crypto.randomUUID(), entry, entry.plan, repeat.series); touched.add(date); }
      }
      // Edited text, kind or priority reach the linked entries in both directions (sync_linked).
      const find = id => { for (const [day, other] of days) { const found = other.entries.find(entry => entry.id === id); if (found) return [day, found]; } };
      for (const entry of value.entries) {
        const before = previous.find(item => item.id === entry.id);
        if (alone.has(entry.id) || !before || (before.kind === entry.kind && before.text === entry.text && before.priority === entry.priority)) continue;
        const seenLinks = new Set([entry.id]), links = [entry.id];
        while (links.length) {
          for (const other of linkedNext(links.shift())) {
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
      touched.delete(value.date);
      dropEmptySeries();
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
const csp = `default-src 'self'; style-src 'self' 'unsafe-inline' https: 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; font-src 'self' data: https:; script-src 'self' 'wasm-unsafe-eval' 'nonce-${nonce}'; img-src 'self' data: blob: https:; worker-src 'self' blob:; connect-src 'self' ipc: http://ipc.localhost`;
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
function command(method, params = {}, sessionId) {
  const id = ++sequence;
  return new Promise((resolveCommand, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timeout); resolveCommand(value); }, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? {sessionId} : {}) }));
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
// The last command the page sent, leaving out the windows' monitor queries (they come whenever a window measures itself).
const lastCall = "window.__uiTest.invoked.filter(call => call[0] !== 'plugin:window|current_monitor').at(-1)";
async function screenshot(name) {
  const result = await command('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(artifacts, name), Buffer.from(result.data, 'base64'));
}
async function pointAt(selector) {
  return evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
}
async function pointerClick(point) {
  await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
  await command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
  await command('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1});
}
async function checkMailSettings() {
  await command('Emulation.setFocusEmulationEnabled',{enabled:true});
  const click = text => evaluate(`Array.from(document.querySelectorAll('.mail-settings button')).find(button => button.textContent.trim() === ${JSON.stringify(text)}).click()`);
  const fill = (label, value) => evaluate(`(() => { const input=Array.from(document.querySelectorAll('.mail-settings label')).find(label => label.textContent.startsWith(${JSON.stringify(label)})).querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await key(',', 'Comma', 2);
  await until("Boolean(document.querySelector('.settings'))");
  await evaluate("document.querySelector('#settings-mail-tab').click()");
  await until("Boolean(document.querySelector('.mail-empty'))");
  await click('Modell herunterladen und aktivieren');
  await until('window.__uiTest.mail.model.enabled === true && Boolean(document.querySelector(".mail-model .mail-check"))');
  await click('Konto hinzufügen');
  await until("document.querySelectorAll('.mail-provider').length === 7");
  await pause(350); await screenshot('mail-providers.png');
  await evaluate("document.querySelector('.mail-provider-gmail').click()");
  await until("Boolean(document.querySelector('.mail-oauth'))");
  assert.match(await evaluate("document.querySelector('.mail-form').textContent"), /Desktop-App.*gmail.readonly/s);
  assert.equal(await evaluate("document.querySelector('.mail-oauth input').required"), true, 'OAuth cannot silently pretend that an app registration exists.');
  await click('Zurück');
  await evaluate("document.querySelector('.mail-provider-microsoft').click()");
  assert.match(await evaluate("document.querySelector('.mail-form').textContent"), /http:\/\/localhost:42813\//);
  assert.equal(await evaluate("document.querySelector('.mail-form input[type=password]')"), null, 'Microsoft uses a public PKCE client without a client secret.');
  await click('Zurück');
  await evaluate("document.querySelector('.mail-provider-proton').click()");
  assert.equal(await evaluate("document.querySelector('.mail-server input').value"), '127.0.0.1');
  assert.match(await evaluate("document.querySelector('.mail-provider-help').textContent"), /bezahlten Proton-Tarif/);
  await click('Zurück');
  await evaluate("document.querySelector('.mail-provider-custom').click()");
  await fill('E-Mail-Adresse','test@example.org'); await fill('Kontoname','Mein Testpostfach');
  await fill('Posteingangsserver','bad.example'); await fill('Passwort / App-Passwort','synthetic-only-not-a-real-password');
  await evaluate("document.querySelector('.mail-form').requestSubmit()");
  await until("document.querySelector('.mail-error')?.textContent.includes('Testverbindung fehlgeschlagen')");
  assert.equal(await evaluate('window.__uiTest.mail.accounts.length'), 0, 'Failed connections do not create an account.');
  await fill('Posteingangsserver','imap.example.org');
  await evaluate("document.querySelector('.mail-form button[type=submit]').focus()");
  await evaluate("document.querySelector('.mail-form').requestSubmit()");
  // A subject-only neural event name now falls back to the full subject instead of crossing into another sentence.
  await until("document.querySelectorAll('.mail-account').length === 1 && document.querySelectorAll('.mail-suggestion').length===1");
  assert.equal(await evaluate("document.querySelector('[data-mail-auto-import]').getAttribute('aria-checked')"),'false','Adding appointments defaults to off.');
  assert(!await evaluate("window.__uiTest.day(window.__uiTest.shift(1))?.entries.some(entry=>entry.text.includes('Lieferung')) ?? false"),'Suggestions do not write calendar entries before approval.');
  await until("Boolean(document.activeElement.closest('.settings'))");
  assert.equal(await evaluate("document.querySelector('.mail-settings input[type=password]')"), null, 'Credentials leave the form after saving.');
  assert.equal(await evaluate('window.__uiTest.mail.accounts[0].password'), undefined, 'Account metadata never exposes the password.');
  assert(await evaluate('window.__uiTest.mail.analyzed.some(text=>text.includes("Lieferung UI-Test"))'), 'Free-text mail proposals use the isolated ML analysis API.');
  await until("Boolean(document.querySelector('.mail-suggestions-notice'))");
  await key('Escape');await until("!document.querySelector('.settings')");
  await pointerClick(await pointAt('.mail-suggestions-notice .notice-action'));
  await until("Boolean(document.querySelector('.mail-suggestion')) && !document.querySelector('.mail-suggestions-notice')");
  await evaluate("document.querySelector('.mail-suggestion .mail-actions button:nth-child(2)').click()");
  await until("Boolean(document.querySelector('.mail-proposal-edit'))");
  await screenshot('mail-review-suggestion.png');
  await evaluate("document.querySelector('.mail-suggestion .is-primary').click()");
  await until("Boolean(document.querySelector('.mail-import-toast')) === false && !document.querySelector('.mail-suggestion')");
  assert(await evaluate("window.__uiTest.day(window.__uiTest.shift(1))?.entries.some(entry=>entry.text.includes('Lieferung') && entry.time==='10:00' && entry.end==='12:00' && entry.showInJournal===false)"),'A reviewed suggestion is imported only on acceptance.');
  // Turning on the account switch enables the same pipeline for subsequent ML and ICS suggestions.
  await evaluate("document.querySelector('[data-mail-auto-import]').click()");
  await until("window.__uiTest.mail.accounts[0].autoImport===true");
  await evaluate(`window.__uiTest.mail.candidates.push({id:'reject-only',accountId:window.__uiTest.mail.accounts[0].id,messageKey:'reject-only',subject:'Review',sender:'person@example.org',sentAt:Date.now()/1000,date:window.__uiTest.shift(2),evidence:'Review',entry:{id:crypto.randomUUID(),kind:'event',text:'Rejected appointment',calendarUid:'reject-only',time:'12:00'}});window.__uiTest.mail.accounts[0].autoImport=false;window.__uiTest.emit('mail:changed',null)`);
  await until("document.querySelectorAll('.mail-suggestion').length===1");
  await evaluate("document.querySelector('.mail-suggestion .mail-actions button:last-child').click()");
  await until("!document.querySelector('.mail-suggestion') && !document.querySelector('.mail-suggestions-notice')");
  assert(!await evaluate("window.__uiTest.day(window.__uiTest.shift(2))?.entries.some(e=>e.text==='Rejected appointment') ?? false"),'Rejecting a suggestion never creates a calendar entry.');
  await evaluate("document.querySelector('[data-mail-auto-import]').click()");await until("window.__uiTest.mail.accounts[0].autoImport===true");
  await click('Bearbeiten');
  await until("Boolean(document.querySelector('.mail-form'))");
  assert.equal(await evaluate("document.querySelectorAll('.mail-form .mail-check input').length"),2, 'Fetching and automatic adding are separate account preferences.');
  await evaluate("document.querySelector('.mail-form').requestSubmit()");
  await until("!document.querySelector('.mail-form')");
  await click('Pausieren'); await until('window.__uiTest.mail.accounts[0].enabled === false');
  await click('Aktivieren'); await until('window.__uiTest.mail.accounts[0].enabled === true');
  await until("Boolean(document.activeElement?.closest('.settings'))");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  // Mail events also process while Settings is closed, including updates to an existing UID.
  await key('Escape');
  await until("!document.querySelector('.settings')");
  const enqueueCalendar = async (key, ahead) => evaluate(`(() => { const account=window.__uiTest.mail.accounts[0], date=window.__uiTest.shift(${ahead}).replaceAll('-','');
    window.__uiTest.mail.pending.push({account:structuredClone(account),message:{key:${JSON.stringify(key)},subject:'Automatischer Termin',sender:'calendar@example.org',sentAt:Date.now()/1000,text:'',html:'',calendars:['BEGIN:VCALENDAR\\r\\nVERSION:2.0\\r\\nBEGIN:VEVENT\\r\\nUID:mail-auto-test@example.org\\r\\nDTSTART:'+date+'T130000\\r\\nSUMMARY:Mail-Auto-Test\\r\\nEND:VEVENT\\r\\nEND:VCALENDAR']}});
    return window.__uiTest.emit('mail:changed',null); })()`);
  await enqueueCalendar('auto-1',1);
  await until("window.__uiTest.day(window.__uiTest.shift(1))?.entries.some(entry => entry.text === 'Mail-Auto-Test') && window.__uiTest.mail.candidates.length === 0");
  await until("document.querySelector('.mail-import-toast')?.textContent.includes('Mail-Auto-Test')");
  await screenshot('mail-auto-import.png');
  await enqueueCalendar('auto-2',3);
  await until("window.__uiTest.day(window.__uiTest.shift(3))?.entries.some(entry => entry.text === 'Mail-Auto-Test') && window.__uiTest.mail.candidates.length === 0");
  assert.equal(await evaluate("window.__uiTest.day(window.__uiTest.shift(1))?.entries.some(entry=>entry.text==='Mail-Auto-Test') ?? false"),false, 'The update moves the existing UID without leaving a duplicate.');
  await key(',', 'Comma', 2); await until("Boolean(document.querySelector('.settings'))");
  await evaluate("document.querySelector('#settings-mail-tab').click()");
  await until("Boolean(document.querySelector('.mail-model .mail-check input'))");
  // Pausing the optional model retains plain text and still allows structured invitations through.
  await evaluate("document.querySelector('.mail-model .mail-check input').click()");
  await until('window.__uiTest.mail.model.enabled === false');
  await evaluate(`(() => { const account=structuredClone(window.__uiTest.mail.accounts[0]);
    window.__uiTest.mail.pending.push({account,message:{key:'deferred-text',subject:'',sender:'person@example.org',sentAt:Date.now()/1000,text:'Treffen morgen 17 Uhr',html:'',calendars:[]}});
    return window.__uiTest.emit('mail:changed',null); })()`);
  await enqueueCalendar('paused-model-ics',4);
  await until("window.__uiTest.day(window.__uiTest.shift(4))?.entries.some(entry=>entry.text==='Mail-Auto-Test') && window.__uiTest.mail.candidates.length === 0 && window.__uiTest.mail.pending.length === 1");
  assert.equal(await evaluate('window.__uiTest.mail.pending[0].message.key'),'deferred-text');
  await evaluate("document.querySelector('.mail-model .mail-check input').click()");
  await until("window.__uiTest.mail.pending.length === 0 && window.__uiTest.day(window.__uiTest.shift(1))?.entries.some(entry=>entry.text==='Treffen' && entry.time==='17:00')");
  await evaluate(`(() => { const account=structuredClone(window.__uiTest.mail.accounts[0]);
    window.__uiTest.mail.pending.push({account,message:{key:'range-ui',subject:'',sender:'person@example.org',sentAt:Date.now()/1000,text:'Treffen morgen 20 bis 21:20',html:'',calendars:[]}});
    return window.__uiTest.emit('mail:changed',null); })()`);
  await until("!document.querySelector('.mail-suggestion') && window.__uiTest.day(window.__uiTest.shift(1))?.entries.some(entry=>entry.text==='Treffen' && entry.time==='20:00' && entry.end==='21:20')");
  await until("document.querySelector('.mail-import-toast')?.textContent.includes('21:20')");
  await evaluate("document.querySelector('.mail-account .is-danger').click()");
  await until('window.__uiTest.mail.accounts.length === 0');
  assert(await evaluate("window.__uiTest.day(window.__uiTest.shift(4))?.entries.some(entry => entry.text === 'Mail-Auto-Test')"), 'Removing a mail connection retains calendar entries.');
  await key('Escape');
  // The confirmation intentionally overlays the lower calendar; dismiss it before grid pointer tests.
  await evaluate("document.querySelector('.mail-import-toast button')?.click()");
  await until("!document.querySelector('.mail-import-toast')");
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
// Saving is automatic; checks that count saves ask for one at once.
const saveNow = () => evaluate("window.dispatchEvent(new Event('journal:save-now'))");
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
async function checkLanguage() {
  const origin=`http://127.0.0.1:${server.address().port}`;
  await command('Page.navigate',{url:origin});
  await until("document.querySelectorAll('.entry').length===5");
  await evaluate('window.__journalAutosaveDelay=3600000');
  await evaluate("document.querySelector('.entry-text').focus()");
  await command('Input.insertText',{text:'Aufgabe bleibt Deutsch – '});
  const draft=await evaluate("document.querySelector('.entry-text').value");
  await key(',', 'Comma', 2);
  await until("Boolean(document.querySelector('[data-language=en]'))");
  await evaluate("document.querySelector('[data-language=en]').click()");
  await until("document.documentElement.lang==='en' && document.querySelector('#settings-appearance-tab').textContent==='Appearance'");
  assert.equal(await evaluate("document.querySelector('.entry-text').value"),draft,'Switching languages preserves unsaved user content.');
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('journal.settings')).language"),'en');
  assert.equal(await evaluate("document.querySelector('#settings-language').textContent"),'Language');
  await pause(300); await screenshot('language-english-settings.png');
  await key('Escape');
  assert.match(await evaluate("document.querySelector('.document-header h1').textContent"),/Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday/);
  assert.equal(await evaluate("document.querySelector('.cal-views button[aria-label=Week]')?.textContent.includes('Week')"),true);
  // Open the existing entry's planner and repeat field without changing its text.
  await evaluate("document.querySelector('.entry-text').focus()");
  await key('w','KeyW',1);
  await until("Boolean(document.querySelector('.repeat-write'))");
  assert.match(await evaluate("document.querySelector('.repeat-write').value"),/Weekly|Daily/);
  assert.equal(await evaluate("document.querySelector('.repeat-units button').textContent"),'day');
  const typeWord=async text=>{
    await evaluate("document.querySelector('.repeat-write').focus()");
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    await evaluate("document.querySelector('.repeat-write').select()");
    await command('Input.insertText',{text});
    await until("document.querySelectorAll('.repeat-suggest-item').length>0");
    return evaluate("[...document.querySelectorAll('.repeat-suggest-word')].map(node=>node.textContent)");
  };
  const en=await typeWord('Mon'); assert(en.includes('Monday')); assert(!en.includes('Montag')); assert(!en.includes('Monat'));
  await pause(300); await screenshot('language-english-suggestions.png');
  const fallback=await typeWord('Mit'); assert(fallback.includes('Mittwoch'),'German suggestions remain available when English has no matching word.');
  // A switch from another window changes labels without replacing the text being typed.
  await evaluate("window.__uiTest.emit('journal:language','de')");
  await until("document.documentElement.lang==='de'");
  assert.equal(await evaluate("document.querySelector('.repeat-write').value"),'Mit');
  const de=await typeWord('Mon'); assert(de.includes('Montag')); assert(!de.includes('Monday'));
  await key('Escape'); await key('Escape'); await key('Escape');
  await key(',', 'Comma', 2); await until("Boolean(document.querySelector('[data-language=de]'))");
  await evaluate("document.querySelector('[data-language=en]').click()");
  await until("document.documentElement.lang==='en'");
  await key('Escape'); await command('Page.reload');
  await until("document.documentElement.lang==='en' && document.querySelectorAll('.entry').length===5");
  await key('F1'); await until("Boolean(document.querySelector('.shortcut-pages'))");
  assert.equal(await evaluate("document.querySelector('.shortcuts').getAttribute('aria-label')"),'Keyboard shortcuts');
  await pause(300); await screenshot('language-english-shortcuts.png');
  await key('Escape');
  await command('Page.navigate',{url:`${origin}/?window=calendar`});
  await until("document.documentElement.lang==='en' && Boolean(document.querySelector('.cal'))");
  assert.equal(await evaluate("document.querySelector('.cal-viewbar [aria-label=Month]')!==null"),true);
  await command('Page.navigate',{url:origin}); await until("Boolean(document.querySelector('.settings-button'))");
  await key(',', 'Comma', 2); await until("Boolean(document.querySelector('[data-language=de]'))");
  await evaluate("document.querySelector('[data-language=de]').click()");
  await until("document.documentElement.lang==='de'"); await key('Escape');
  console.log('Language checks passed: DE/EN labels/dates, unsaved content, planning suggestions with strict preferred-language fallback, persistence and cross-window updates.');
}
async function checkColors() {
  const origin = `http://127.0.0.1:${server.address().port}`;
  await command('Page.navigate', {url:origin});
  await until("document.querySelectorAll('.entry').length===5");
  const draft = '**Klar** [Rot]{rot} [Grün]{grün} ==Markiert==';
  await evaluate("document.querySelector('.entry-text').focus(); document.querySelector('.entry-text').setSelectionRange(0,document.querySelector('.entry-text').value.length)");
  await command('Input.insertText',{text:draft});
  const token = name => evaluate(`getComputedStyle(document.documentElement).getPropertyValue(${JSON.stringify('--'+name)}).trim()`);
  const fill = (name, value, type='text') => evaluate(`(() => {const input=document.querySelector('[data-color-field="${name}"] input[type="${type}"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const openSettings = async () => {await evaluate("document.querySelector('.settings-button').click()"); await until("Boolean(document.querySelector('#settings-colors-tab'))"); await evaluate("document.querySelector('#settings-colors-tab').click()");};
  await openSettings();
  await until("Boolean(document.querySelector('[data-color-theme-choice=green]'))");
  await pause(350); await screenshot('colors-original-settings.png');
  await evaluate("document.querySelector('[data-color-theme-choice=original]').focus()");
  await key('ArrowRight');
  await until("document.documentElement.dataset.colorTheme==='green'");
  assert.equal(await token('accent'),'#aeff00');
  assert(await evaluate("(() => {const symbols=[...document.querySelectorAll('.entry[data-status=open] .entry-symbol')];return symbols.length>0 && symbols.every(symbol=>getComputedStyle(symbol).color==='rgb(174, 255, 0)');})()"),'Open task symbols use the main lime colour.');
  assert.equal(await evaluate("document.querySelector('.entry-text').value"),draft,'A palette change preserves unsaved Markdown.');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.md-color')).color"),'rgb(236, 163, 144)','Existing Markdown inherits the selected theme.');
  await pause(250); await screenshot('colors-green-settings.png');
  assert.equal(await evaluate("document.querySelectorAll('[data-color-theme-choice]').length"),5);
  // The last palettes are the journal style's: candlelight, and paper (light, so its form controls are light too).
  await key('End');
  await until("document.documentElement.dataset.colorTheme==='candle'");
  await key('ArrowLeft');
  await until("document.documentElement.dataset.colorTheme==='paper' && getComputedStyle(document.documentElement).colorScheme==='light'");
  assert.equal(await token('accent'),'#2f5d9e');
  await key('ArrowLeft');
  await until("document.documentElement.dataset.colorTheme==='summer'");
  assert.equal(await token('accent'),'#50d5ff');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.md-color')).color"),'rgb(255, 159, 147)','The summer theme recolours existing Markdown without editing it.');
  assert.equal(await token('md-blue'),'#78cfff');
  assert.equal(await token('md-highlight-background'),'#f1ce8533');
  assert.equal(await evaluate("document.querySelector('.entry-text').value"),draft);
  await pause(200); await screenshot('colors-summer-settings.png');
  await evaluate("document.querySelector('.settings-close').click()");
  await until("!document.querySelector('.settings')");
  await pause(200); await screenshot('colors-summer-journal.png');
  await openSettings();
  await evaluate("document.querySelector('[data-color-theme-choice=summer]').focus()");
  await key('ArrowRight');
  await until("document.documentElement.dataset.colorTheme==='paper'");
  await key('ArrowRight');
  await until("document.documentElement.dataset.colorTheme==='candle'");
  await key('ArrowRight');
  await until("document.documentElement.dataset.colorTheme==='original'");
  await key('ArrowLeft');
  await until("document.documentElement.dataset.colorTheme==='candle'");
  await key('Home');
  await until("document.documentElement.dataset.colorTheme==='original'");
  await evaluate("document.querySelector('[data-color-theme-choice=summer]').click()");
  await until("document.documentElement.dataset.colorTheme==='summer'");
  await evaluate("document.querySelector('[data-color-theme-choice=summer]').focus()");
  await key('ArrowLeft');
  await until("document.documentElement.dataset.colorTheme==='green'");
  await fill('md-red','#ffbbaa');
  await until("getComputedStyle(document.querySelector('.md-color')).color==='rgb(255, 187, 170)'");
  await fill('md-red','#oops');
  assert.equal(await token('md-red'),'#ffbbaa','Invalid hex never reaches CSS or persisted preferences.');
  assert.equal(await evaluate("document.querySelector('[data-color-field=md-red] .color-hex').getAttribute('aria-invalid')"),'true');
  await evaluate("document.querySelector('[data-color-field=md-red] .color-hex').focus();document.querySelector('[data-color-field=md-red] .color-hex').blur()");
  assert.equal(await evaluate("document.querySelector('[data-color-field=md-red] .color-hex').value"),'#ffbbaa');
  await evaluate("document.querySelector('[data-color-group=accents]').open=true");
  await fill('accent','#151515');
  assert.equal(await token('on-accent'),'#ffffff','Dark accent colours receive light button text.');
  await evaluate("document.querySelector('[data-color-field=accent] .color-reset').click()");
  assert.equal(await token('accent'),'#aeff00');
  await evaluate("document.querySelector('[data-color-field=accent] .color-well').click()");
  await until("Boolean(document.querySelector('.color-picker-popover .color-picker-hex'))");
  await evaluate("(() => {const input=document.querySelector('.color-picker-popover .color-picker-hex'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'#cde857'); input.dispatchEvent(new Event('input',{bubbles:true}));})()");
  assert.equal(await token('accent'),'#cde857','The colour picker and hex input edit the same token.');
  assert.equal(await evaluate("document.querySelector('[data-color-field=accent] .color-hex').value"),'#cde857');
  await key('Escape');
  await until("!document.querySelector('.color-picker-popover') && Boolean(document.querySelector('.settings'))");
  await fill('edge','128','range');
  assert.equal(await token('edge'),'#aeff0080');
  await evaluate("document.querySelector('[data-color-theme-choice=original]').click()");
  await until("document.documentElement.dataset.colorTheme==='original'");
  assert.equal(await token('md-red'),'#df6262');
  await evaluate("document.querySelector('[data-color-group=accents]').open=true");
  await fill('accent','#8db4ff');
  await evaluate("document.querySelector('[data-color-theme-choice=green]').click()");
  assert.equal(await token('accent'),'#cde857','Switching bases restores that base’s overrides.');
  assert.equal(await token('md-red'),'#ffbbaa');
  await evaluate("document.querySelector('.color-reset-all').click()");
  assert.equal(await token('accent'),'#aeff00');
  assert.equal(await token('md-red'),'#eca390');
  await fill('md-red','#ffbbaa');
  await command('Emulation.setDeviceMetricsOverride',{width:760,height:520,deviceScaleFactor:1,mobile:false});
  await pause(150);
  assert(await evaluate("(() => {const p=document.querySelector('.settings'),r=p.getBoundingClientRect(); return r.left>=0 && r.top>=0 && r.right<=innerWidth && r.bottom<=innerHeight && p.scrollWidth<=p.clientWidth+1 && [...p.querySelectorAll('.color-hex')].every(e=>e.getBoundingClientRect().width>=65);})()"),'Colour controls fit compact windows, including the header and close button.');
  assert(await evaluate("(() => {const head=document.querySelector('.settings-head'),r=head.getBoundingClientRect(); return head.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})()"),'App toolbars cannot cover the modal header in small windows.');
  await screenshot('colors-settings-compact.png');
  await command('Emulation.setDeviceMetricsOverride',{width:1180,height:780,deviceScaleFactor:1,mobile:false});
  await evaluate("document.querySelector('.settings-close').focus()");
  await key('Escape');
  await until("!document.querySelector('.settings')");
  assert.equal(await evaluate("document.querySelector('.entry-text').value"),draft);
  await pause(200); await screenshot('colors-green-journal.png');
  await evaluate("(() => {const input=document.querySelector('.entry-text'); input.focus(); const start=input.value.indexOf('Rot');input.setSelectionRange(start,start+3); input.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:800,clientY:300}));})()");
  await until("Boolean(document.querySelector('.format-menu'))");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.format-color')).backgroundColor"),'rgb(255, 187, 170)','The format menu uses exactly the same overridden Markdown colour.');
  await key('Escape');
  await saveNow();
  const saved=await evaluate("JSON.parse(localStorage.getItem('journal.settings'))");
  assert.equal(saved.customColors.green['md-red'],'#ffbbaa');
  await openSettings();
  await evaluate("document.querySelector('#settings-appearance-tab').click()");
  await until("Boolean(document.querySelector('[data-pixel-toggle]'))");
  await evaluate("(() => { const s=document.querySelector('[data-pixel-toggle]'); if (s.getAttribute('aria-checked')!=='true') s.click(); })()");
  assert.equal(await token('accent'),'#aeff00','Pixel and Classic share the chosen palette.');
  await evaluate("document.querySelector('[data-language=en]').click()");
  await evaluate("document.querySelector('#settings-colors-tab').click()");
  await until("document.querySelector('#settings-colors-tab').textContent==='Colours'");
  assert.equal(await evaluate("document.querySelector('#settings-colors-title').textContent"),'Base colour theme');
  await pause(200); await screenshot('colors-green-pixel-settings.png');
  await key('Escape');
  await pause(150); await screenshot('colors-green-pixel-journal.png');
  for (const window of ['calendar','mini','reminder']) {
    await command('Page.navigate',{url:`${origin}/?window=${window}`});
    await until("document.documentElement.dataset.colorTheme==='green' && document.documentElement.dataset.pixel!==undefined");
    assert.equal(await token('md-red'),'#ffbbaa');
    // A window already open must also update from the device event without losing its content.
    await evaluate("window.__uiTest.emit('journal:colors',{colorTheme:'original',customColors:{}})");
    await until("document.documentElement.dataset.colorTheme==='original'");
    assert.equal(await token('md-red'),'#df6262');
    if (window === 'calendar') {
      await until("Boolean(document.querySelector('.cal'))");
      await evaluate("window.__uiTest.emit('journal:colors',JSON.parse(localStorage.getItem('journal.settings')))");
      await pause(250); await screenshot('colors-green-calendar.png');
    }
  }
  await command('Page.navigate',{url:origin});
  await until("document.documentElement.dataset.colorTheme==='green' && Boolean(document.querySelector('.settings-button'))");
  assert.equal(await token('md-red'),'#ffbbaa','Custom colours survive a reload.');
  await openSettings();
  await evaluate("document.querySelector('[data-color-theme-choice=summer]').click()");
  await fill('md-blue','#82ddff');
  await command('Page.reload');
  await until("document.documentElement.dataset.colorTheme==='summer' && Boolean(document.querySelector('.settings-button'))");
  assert.equal(await token('md-blue'),'#82ddff','The third theme and its own overrides survive a reload.');
  assert.equal(await token('md-red'),'#ff9f93','Green overrides do not leak into the summer palette.');
  await pause(200); await screenshot('colors-summer-pixel-journal.png');
  for (const window of ['calendar','mini','reminder']) {
    await command('Page.navigate',{url:`${origin}/?window=${window}`});
    await until("document.documentElement.dataset.colorTheme==='summer' && document.documentElement.dataset.pixel!==undefined");
    assert.equal(await token('md-blue'),'#82ddff');
  }
  await command('Page.navigate',{url:origin});
  await until("Boolean(document.querySelector('.settings-button'))");
  await openSettings();
  assert.equal(await evaluate("document.querySelector('[data-color-theme-choice=summer] strong').textContent"),'Sky & Sunshine');
  await pause(250); await screenshot('colors-summer-pixel-settings.png');
  await evaluate("document.querySelector('.color-reset-all').click()");
  assert.equal(await token('md-blue'),'#78cfff');
  await evaluate("document.querySelector('[data-color-theme-choice=green]').click()");
  await evaluate("document.querySelector('.color-reset-all').click()");
  await evaluate("document.querySelector('[data-color-theme-choice=original]').click()");
  await evaluate("document.querySelector('.color-reset-all').click()");
  await evaluate("document.querySelector('#settings-appearance-tab').click()");
  await until("Boolean(document.querySelector('[data-theme-choice=classic]'))");
  await evaluate("document.querySelector('[data-theme-choice=classic]').click()");
  await evaluate("(() => { const s=document.querySelector('[data-pixel-toggle]'); if (s.getAttribute('aria-checked')==='true') s.click(); })()");
  await evaluate("document.querySelector('[data-language=de]').click()");
  await until("document.documentElement.dataset.colorTheme==='original' && document.documentElement.dataset.theme==='classic' && document.documentElement.lang==='de'");
  await key('Escape');
  console.log('Colour checks passed: base palettes, live Markdown/editor/menu colours, picker/hex/opacity, validation, independent overrides, resets, unsaved content, persistence, compact layout, both UI styles, English labels and all window types.');
}

async function checkDrive() {
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const theme of ['classic','pixel']) {
    await evaluate(`localStorage.setItem('journal.settings',JSON.stringify({...JSON.parse(localStorage.getItem('journal.settings')||'{}'),theme:${JSON.stringify(theme)}}));sessionStorage.removeItem('driveConnected');sessionStorage.removeItem('driveApplied');sessionStorage.removeItem('driveEncrypted');sessionStorage.removeItem('driveRemote')`);
    await command('Page.navigate',{url:origin});await until("document.querySelectorAll('.entry').length===5");
    await evaluate("document.querySelector('.settings-button').click()");await until("Boolean(document.querySelector('#settings-drive-tab'))");
    await evaluate("document.querySelector('#settings-drive-tab').click()");await until("Boolean(document.querySelector('[data-drive=connect]'))");
    await evaluate("document.querySelector('[data-drive=connect]').click()");await until("!document.querySelector('[data-drive=connect]')");
    await evaluate("(()=>{const f=document.querySelector('.drive-key');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(f,'a password, not a device key');f.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await evaluate("document.querySelector('[data-drive=sync]').click()");
    await until("document.querySelector('.mail-error')?.textContent.includes('Ungültiger Geräteschlüssel')");
    assert.equal(await evaluate("sessionStorage.getItem('driveEncrypted')"),null,'An invalid key never uploads or applies data.');
    await evaluate("(()=>{const f=document.querySelector('.drive-key');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(f,'');f.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await evaluate("document.querySelector('[data-drive=generate]').click()");
    const keyText=await evaluate("document.querySelector('.drive-key').value");assert.equal(keyText.length,44);
    await pause(200);await screenshot(`drive-${theme}.png`);
    await evaluate("document.querySelector('[data-drive=sync]').click()");await until("sessionStorage.getItem('driveApplied')!==null && !document.querySelector('.settings')");
    const encoded=await evaluate("sessionStorage.getItem('driveEncrypted')");assert(!encoded.includes('Private Sync Test'));assert(!encoded.includes('Geheim'));
    const plain=await evaluate(`(async()=>{const e=JSON.parse(sessionStorage.getItem('driveEncrypted'));const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));const key=await crypto.subtle.importKey('raw',bytes(${JSON.stringify(keyText)}),'AES-GCM',false,['decrypt']);return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(e.iv)},key,bytes(e.cipher)));})()`);
    assert.equal(JSON.parse(plain).tables.days['2026-11-02'].body,'Geheim');
    await until("document.querySelectorAll('.entry').length===5");
    await evaluate(`(async()=>{const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));const key=await crypto.subtle.importKey('raw',bytes(${JSON.stringify(keyText)}),'AES-GCM',false,['encrypt']);const snapshot=JSON.parse(sessionStorage.getItem('driveApplied'));snapshot.tables.days['2026-11-02'].body='Cloud edit';const iv=crypto.getRandomValues(new Uint8Array(12));const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(snapshot))));sessionStorage.setItem('driveRemote',JSON.stringify({version:1,iv:btoa(String.fromCharCode(...iv)),cipher:btoa(String.fromCharCode(...cipher))}));sessionStorage.removeItem('driveApplied');})()`);
    await evaluate("document.querySelector('.settings-button').click()");await until("Boolean(document.querySelector('#settings-drive-tab'))");await evaluate("document.querySelector('#settings-drive-tab').click()");await until("Boolean(document.querySelector('.drive-key'))");
    await evaluate(`(()=>{const field=document.querySelector('.drive-key');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,${JSON.stringify(' '+keyText.slice(0,20)+' '+keyText.slice(20)+' ')});field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await until("document.querySelector('[data-drive=sync]')?.disabled===false");await evaluate("document.querySelector('[data-drive=sync]').click()");await until("sessionStorage.getItem('driveApplied')!==null && !document.querySelector('.settings')");
    assert.equal(await evaluate("JSON.parse(sessionStorage.getItem('driveApplied')).tables.days['2026-11-02'].body"),'Cloud edit','Remote offline edits are downloaded, decrypted and merged against the previous sync.');

    const reopenDrive = async () => {
      await until("document.querySelectorAll('.entry').length===5");
      await evaluate("document.querySelector('.settings-button').click()");await until("Boolean(document.querySelector('#settings-drive-tab'))");
      await evaluate("document.querySelector('#settings-drive-tab').click()");await until("Boolean(document.querySelector('.drive-key'))");
      await evaluate(`(()=>{const f=document.querySelector('.drive-key');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(f,${JSON.stringify(keyText)});f.dispatchEvent(new Event('input',{bubbles:true}));sessionStorage.removeItem('driveApplied');})()`);
    };
    // Download replaces the local state without uploading anything to Drive.
    const encryptedBefore=await evaluate("sessionStorage.driveEncrypted");
    await reopenDrive();await evaluate("document.querySelector('[data-drive=download-cloud]').click()");
    await until("sessionStorage.getItem('driveApplied')!==null && !document.querySelector('.settings')");
    assert.equal(await evaluate("sessionStorage.driveEncrypted"),encryptedBefore);
    assert.equal(await evaluate("JSON.parse(sessionStorage.driveApplied).tables.days['2026-11-02'].body"),'Cloud edit');
    // Exact upload uses this device's current snapshot, with no local import or merge.
    await reopenDrive();await evaluate("document.querySelector('[data-drive=upload-local]').click()");
    await until("!document.querySelector('.settings')");
    assert.equal(await evaluate("sessionStorage.getItem('driveApplied')"),null,'Upload does not replace the local database.');
    const uploaded=await evaluate(`(async()=>{const e=JSON.parse(sessionStorage.driveEncrypted),bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));const key=await crypto.subtle.importKey('raw',bytes(${JSON.stringify(keyText)}),'AES-GCM',false,['decrypt']);return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(e.iv)},key,bytes(e.cipher))));})()`);
    assert.equal(uploaded.tables.days['2026-11-02'].body,'Geheim','Exact upload keeps local content instead of the remote edit.');
    assert.equal(await evaluate(`Object.values(localStorage).some(v=>v.includes(${JSON.stringify(keyText)}))`),false);
  }
  console.log('Drive UI passed: connection setup, key generation, encrypted exchange and application in Classic/Pixel (mock transport).');
}

async function checkTags() {
  const origin = `http://127.0.0.1:${server.address().port}`;
  await evaluate("localStorage.setItem('journal.settings', JSON.stringify({...JSON.parse(localStorage.getItem('journal.settings')||'{}'), theme:'classic', language:'de'})); localStorage.removeItem('journal.hiddenTags')");
  await command('Emulation.setDeviceMetricsOverride', { width:1180, height:780, deviceScaleFactor:1, mobile:false });
  await evaluate("localStorage.setItem('test.noActivities', '1')");
  await command('Page.navigate', { url:origin });
  await until("document.querySelectorAll('.entry').length===5");
  assert(!await evaluate("Boolean(document.querySelector('.tag-filter-button'))"), 'Without tags there is nothing to filter.');
  const row = id => `document.querySelector('[data-entry-id="10000000-0000-4000-8000-00000000000${id}"]')`;
  const setValue = (selector, value) => evaluate(`(() => {const input=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true}));})()`);

  // Settings → Tags: two tags, each with its own colour; names are unique.
  await key(',', 'Comma', 2);
  await until("Boolean(document.querySelector('#settings-tags-tab'))");
  await evaluate("document.querySelector('#settings-tags-tab').click()");
  await until("Boolean(document.querySelector('.tag-row.is-new .tag-name'))");
  const addTag = async name => {
    await evaluate("document.querySelector('.tag-row.is-new .tag-name').focus()");
    await command('Input.insertText', { text:name });
    await key('Enter', 'Enter');
  };
  await addTag('Arbeit');
  await until("document.querySelectorAll('.tag-list .tag-row').length===1");
  await addTag('Uni');
  await until("document.querySelectorAll('.tag-list .tag-row').length===2");
  assert.deepEqual(await evaluate("window.__uiTest.tags().map(tag=>tag.name)"), ['Arbeit','Uni']);
  const [work, uni] = await evaluate("window.__uiTest.tags()");
  assert.notEqual(work.color, uni.color, 'New tags get different colours.');
  await addTag('arbeit');
  await until("Boolean(document.querySelector('.tag-error'))");
  assert.equal(await evaluate("document.querySelectorAll('.tag-list .tag-row').length"), 2, 'A name in use is refused.');
  await setValue('.tag-row.is-new .tag-name', '');

  // The own colour picker: a field, a hue bar, hex, suggestions; Escape closes only the picker.
  await evaluate("document.querySelector('[data-tag-row=Uni] .color-well').click()");
  await until("Boolean(document.querySelector('.color-picker-popover .color-picker-field canvas'))");
  assert.deepEqual(await evaluate("(() => {const c=document.querySelector('.color-picker-field canvas'); return [c.width, c.height, getComputedStyle(c).imageRendering];})()"), [96, 64, 'auto']);
  await until("document.activeElement?.classList.contains('color-picker-field')");
  const before = await evaluate("document.querySelector('.color-picker-hex').value");
  await key('ArrowLeft', 'ArrowLeft', 8);
  await until(`document.querySelector('.color-picker-hex').value!==${JSON.stringify(before)}`);
  await setValue('.color-picker-hex', '#ff7a90');
  await until("document.querySelector('[data-tag-row=Uni]').style.getPropertyValue('--tag')==='#ff7a90'");
  await until("window.__uiTest.tags()[1].color==='#ff7a90'");
  assert.equal(await evaluate("document.querySelector('.color-picker-swatches button[aria-pressed=true]')?.getAttribute('aria-label') ?? null"), '#ff7a90');
  await evaluate("document.querySelector('.color-picker-swatches button').click()");
  await until("window.__uiTest.tags()[1].color==='#569eff'");
  await setValue('.color-picker-hex', '#ff7a90');
  await until("window.__uiTest.tags()[1].color==='#ff7a90'");
  await pause(200); await screenshot('tags-settings.png');
  await key('Escape');
  await until("!document.querySelector('.color-picker-popover') && Boolean(document.querySelector('.settings'))");
  await key('Escape');
  await until("!document.querySelector('.settings')");

  // Alt G: the tag picker at the entry. A number picks at once, typing finds, Enter on a new name creates it.
  // Leaving the pane commits a colour before the debounce expires.
  const openTags = async () => {
    await evaluate("document.querySelector('.settings-button').click()");
    await until("Boolean(document.querySelector('#settings-tags-tab'))");
    await evaluate("document.querySelector('#settings-tags-tab').click()");
    await until("Boolean(document.querySelector('[data-tag-row=Uni]'))");
  };
  await openTags();
  await evaluate("document.querySelector('[data-tag-row=Uni] .color-well').click()");
  await until("Boolean(document.querySelector('.color-picker-hex'))");
  await setValue('.color-picker-hex', '#a1b2c3');
  await evaluate("document.querySelector('.settings-close').click()");
  await until("!document.querySelector('.settings') && window.__uiTest.tags()[1].color==='#a1b2c3'");
  // A slow earlier write cannot clear a later colour or overwrite a rename.
  await openTags();
  await evaluate("window.__uiTest.tagSaveDelay=250;document.querySelector('[data-tag-row=Uni] .color-well').click()");
  await until("Boolean(document.querySelector('.color-picker-hex'))");
  await setValue('.color-picker-hex', '#8fb9ef');
  await until("window.__uiTest.tagSaveActive===true");
  await setValue('.color-picker-hex', '#ff7a90');
  await key('Escape');
  await until("!document.querySelector('.color-picker-popover')");
  await setValue('[data-tag-row=Uni] .tag-name', 'Studium');
  await evaluate("document.querySelector('[data-tag-row=Uni] .tag-name').focus();document.querySelector('[data-tag-row=Uni] .tag-name').blur()");
  await until("window.__uiTest.tags()[1].name==='Studium' && window.__uiTest.tags()[1].color==='#ff7a90'");
  await evaluate("window.__uiTest.tagSaveDelay=0");
  await setValue('[data-tag-row=Studium] .tag-name', 'Uni');
  await evaluate("document.querySelector('[data-tag-row=Studium] .tag-name').focus();document.querySelector('[data-tag-row=Studium] .tag-name').blur()");
  await until("window.__uiTest.tags()[1].name==='Uni'");
  await evaluate("document.querySelector('.settings-close').click()");
  await until("!document.querySelector('.settings')");
  const pickTag = async (id, keys) => {
    await evaluate(`${row(id)}.querySelector('.entry-text').focus()`);
    await key('g', 'KeyG', 1);
    await until("Boolean(document.querySelector('.tag-picker input'))");
    await until("document.activeElement===document.querySelector('.tag-picker input')");
    await keys();
  };
  await pickTag(1, () => key('1', 'Digit1'));
  await until(`${row(1)}.dataset.tag==='Arbeit'`);
  await until(`document.activeElement?.closest('[data-entry-id]')===${row(1)} && document.activeElement.classList.contains('entry-text')`);
  await pickTag(5, async () => { await command('Input.insertText', { text:'un' }); await until("document.querySelector('.tag-option[aria-selected=true]')?.textContent.includes('Uni')"); await key('Enter', 'Enter'); });
  await until(`${row(5)}.dataset.tag==='Uni'`);
  await pickTag(4, async () => { await command('Input.insertText', { text:'Sport' }); await until("Boolean(document.querySelector('.tag-option.is-create[aria-selected=true]'))"); await key('Enter', 'Enter'); });
  await until(`${row(4)}.dataset.tag==='Sport' && window.__uiTest.tags().length===3`);
  // Grouped: within the tasks Arbeit, Uni, Sport follow the tags' order; each group's first entry names its tag.
  const knownTags = await evaluate("window.__uiTest.tags()");
  await evaluate(`window.__TAURI_INTERNALS__.invoke('save_tags',{tags:[...window.__uiTest.tags(),...Array.from({length:24},(_,i)=>({id:crypto.randomUUID(),name:'Auswahl '+String(i+1).padStart(2,'0'),color:'#569eff'}))]})`);
  await pickTag(1, async () => { await key('ArrowUp'); await key('ArrowUp'); });
  await until("document.querySelector('.tag-option[aria-selected=true]')?.textContent.includes('Auswahl 24')");
  assert(await evaluate("(() => {const list=document.querySelector('.tag-picker-list'),item=list.querySelector('[aria-selected=true]'),a=list.getBoundingClientRect(),b=item.getBoundingClientRect();return list.scrollTop>0 && b.top>=a.top-1 && b.bottom<=a.bottom+1;})()"),'Keyboard navigation scrolls long tag lists into view.');
  await key('Escape');
  await evaluate(`window.__TAURI_INTERNALS__.invoke('save_tags',{tags:${JSON.stringify(knownTags)}})`);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.entry[data-entry-kind=task]')].map(entry=>entry.dataset.tag)"), ['Arbeit','Uni','Sport']);
  assert.equal(await evaluate(`${row(1)}.querySelector('.entry-tag').textContent`), 'Arbeit');
  assert(await evaluate(`${row(1)}.classList.contains('has-tag') && getComputedStyle(${row(1)}, '::after').backgroundColor==='rgb(86, 158, 255)'`), 'The tag line takes its colour.');
  // Enter below a tagged entry: the new one takes the tag and stays in the group.
  await evaluate(`(() => {const text=${row(1)}.querySelector('.entry-text'); text.focus(); text.setSelectionRange(text.value.length,text.value.length);})()`);
  await key('Enter', 'Enter');
  await until("document.activeElement?.closest('.entry')?.dataset.tag==='Arbeit' && document.activeElement.value===''");
  await command('Input.insertText', { text:'Bericht schreiben' });
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.entry[data-entry-kind=task]')].map(entry=>entry.dataset.tag)"), ['Arbeit','Arbeit','Uni','Sport']);
  assert.equal(await evaluate("document.querySelectorAll('.entry[data-tag=Arbeit] .entry-tag').length"), 1, 'Only the first of a group names the tag.');
  // In the orbit the tag is one more cluster at the row's end; it opens the same picker.
  await evaluate(`${row(3)}.querySelector('.entry-symbol').click()`);
  await until(`Boolean(${row(3)}.querySelector('.entry-dock-shell.is-open .dock-tag-button'))`);
  await evaluate(`${row(3)}.querySelector('.dock-tag-button').click()`);
  await until("Boolean(document.querySelector('.tag-picker'))");
  await key('2', 'Digit2');
  await until(`${row(3)}.dataset.tag==='Uni'`);
  await saveNow();
  await until("!document.querySelector('.save-status.is-dirty')");
  await pause(250); await screenshot('tags-journal.png');

  // The journal's filter: 1 hides Arbeit, A shows all, Alt+click keeps one. The choice stays.
  await until("Boolean(document.querySelector('.main > .toolbar .tag-filter-button'))");
  await evaluate("document.querySelector('.main > .toolbar .tag-filter-button').click()");
  await until("document.activeElement?.classList.contains('tag-filter-row')");
  await key('1', 'Digit1');
  await until("!document.querySelector('.entry[data-tag=Arbeit]') && document.querySelector('.entry-hidden-count')?.textContent==='2 ausgeblendet'");
  assert(await evaluate("document.querySelector('.main > .toolbar .tag-filter-button').classList.contains('is-filtering')"));
  await pause(150); await screenshot('tags-filter.png');
  await key('a', 'KeyA');
  await until("document.querySelectorAll('.entry[data-tag=Arbeit]').length===2 && !document.querySelector('.entry-hidden-count')");
  await evaluate("[...document.querySelectorAll('.tag-filter-row')].find(row=>row.textContent.includes('Uni')).dispatchEvent(new MouseEvent('click',{bubbles:true,altKey:true}))");
  await until("[...document.querySelectorAll('.entry')].every(entry=>entry.dataset.tag==='Uni')");
  assert.deepEqual(await evaluate("JSON.parse(localStorage.getItem('journal.hiddenTags')).journal.length"), 3, 'Arbeit, Sport and the untagged are hidden, and remembered.');
  await key('a', 'KeyA');
  await key('Escape');
  await until("!document.querySelector('.tag-filter') && document.querySelectorAll('.entry').length===6");

  // The calendar: tagged entries in their colour, its own filter, the tag in the card (Alt G).
  await evaluate("window.__uiTest.store({...window.__uiTest.day(),entries:window.__uiTest.day().entries.map(entry=>entry.done ? {...entry,time:'09:00',end:'10:00'} : entry)})");
  await evaluate("document.querySelector('.sidebar .cal').focus()");
  await key('t','KeyT');
  await until("Boolean(document.querySelector('.cal-item.is-block.is-task.has-tag.is-done'))");
  assert(await evaluate("(() => {const item=document.querySelector('.cal-item.is-block.is-task.has-tag.is-done');return getComputedStyle(item).color===getComputedStyle(item.querySelector('.icon')).color;})()"),'Completed tagged blocks keep their grey status colour.');
  await until("Boolean(document.querySelector('.cal-item[data-tag=Arbeit]'))");
  assert(await evaluate("(() => { const item=document.querySelector('.cal-item[data-tag=Arbeit]'), style=getComputedStyle(item); return item.style.getPropertyValue('--tag')==='#569eff' && style.boxShadow.includes('inset') && style.backgroundColor!=='rgba(0, 0, 0, 0)'; })()"), 'Calendar entries are tinted and outlined in their tag colour.');
  await evaluate("document.querySelector('.cal-actions .tag-filter-button').click()");
  await until("document.activeElement?.classList.contains('tag-filter-row')");
  await key('1', 'Digit1');
  await until("!document.querySelector('.cal-item[data-tag=Arbeit]') && document.querySelectorAll('.entry[data-tag=Arbeit]').length===2");
  assert.match(await evaluate("document.querySelector('.cal-day-stats').textContent"),/1\/2/, 'The day summary also excludes hidden tags.');
  await key('a', 'KeyA');
  await key('Escape');
  await until("Boolean(document.querySelector('.cal-item[data-tag=Arbeit]'))");
  await evaluate("document.querySelector('.cal-item[data-tag=Uni]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");
  await until("document.querySelector('.cal-composer')?.classList.contains('has-tag')");
  await until("document.activeElement?.classList.contains('cal-composer-text')");
  await key('g', 'KeyG', 1);
  await until("Boolean(document.querySelector('.tag-picker'))");
  await key('3', 'Digit3');
  await until("document.querySelector('.cal-composer-tag')?.getAttribute('aria-label')==='Tag: Sport' && document.activeElement?.classList.contains('cal-composer-text')");
  await pause(150); await screenshot('tags-composer.png');
  await key('Enter', 'Enter');
  await until("!document.querySelector('.cal-composer') && document.querySelectorAll('.entry[data-tag=Sport]').length===2");

  // A click on an entry opens its description in its own card, not the journal.
  await key('s', 'KeyS', 2);
  await until("!document.querySelector('.save-status.is-dirty')");
  await evaluate("(() => { const day = window.__uiTest.day(); day.entries.find(entry => entry.text === 'Kaffee am Nachmittag').description = 'Mit Anna im Café am Markt, Kuchen mitbringen.'; return window.__uiTest.store(day); })()");
  const coffee = "[...document.querySelectorAll('.sidebar .cal-item')].find(item => item.textContent.includes('Kaffee am Nachmittag'))";
  await until(`Boolean(${coffee})`);
  await evaluate(`${coffee}.click()`);
  await until("document.querySelector('.cal-details-text')?.textContent.startsWith('Mit Anna')");
  await pause(150); await screenshot('calendar-description.png');
  await key('Escape');
  await until("!document.querySelector('.cal-details')");
  // Removing a tag keeps its entries, without a tag.
  await key(',', 'Comma', 2);
  await until("Boolean(document.querySelector('#settings-tags-tab'))");
  await evaluate("document.querySelector('#settings-tags-tab').click()");
  await until("Boolean(document.querySelector('[data-tag-row=Sport] .tag-remove'))");
  await evaluate("document.querySelector('[data-tag-row=Sport] .tag-remove').click()");
  await until("document.querySelector('[data-tag-row=Sport] .tag-remove')?.textContent==='Löschen?'");
  await evaluate("document.querySelector('[data-tag-row=Sport] .tag-remove').click()");
  await until("!document.querySelector('[data-tag-row=Sport]') && !document.querySelector('.entry[data-tag=Sport]') && document.querySelectorAll('.entry').length===6");

  // Pixel: the same, drawn in coarse pixels.
  await evaluate("document.querySelector('#settings-appearance-tab').click()");
  await until("Boolean(document.querySelector('[data-pixel-toggle]'))");
  await evaluate("(() => { const s=document.querySelector('[data-pixel-toggle]'); if (s.getAttribute('aria-checked')!=='true') s.click(); })()");
  await until("document.documentElement.dataset.pixel!==undefined");
  await evaluate("document.querySelector('#settings-tags-tab').click()");
  await until("Boolean(document.querySelector('[data-tag-row=Arbeit] .color-well'))");
  await evaluate("document.querySelector('[data-tag-row=Arbeit] .color-well').click()");
  await until("Boolean(document.querySelector('.color-picker.is-pixel'))");
  assert.deepEqual(await evaluate("(() => {const c=document.querySelector('.color-picker-field canvas'); return [c.width, c.height, getComputedStyle(c).imageRendering, getComputedStyle(document.querySelector('.color-picker-thumb')).borderRadius];})()"), [18, 12, 'pixelated', '0px']);
  await pause(200); await screenshot('tags-pixel-settings.png');
  await key('Escape');
  await key('Escape');
  await until("!document.querySelector('.settings')");
  await evaluate("document.querySelector('.main > .toolbar .tag-filter-button').click()");
  await until("Boolean(document.querySelector('.tag-filter'))");
  await pause(200); await screenshot('tags-pixel-journal.png');
  await key('Escape');
  await evaluate("localStorage.setItem('journal.settings', JSON.stringify({...JSON.parse(localStorage.getItem('journal.settings')||'{}'), theme:'classic'})); localStorage.removeItem('journal.hiddenTags')");
  await evaluate("localStorage.removeItem('test.noActivities')");
  console.log('Tag checks passed: settings (create, unique names, colours, order), own colour picker (field, keys, hex, suggestions, pixel cells), Alt G picker (number, search, create), grouping, Enter keeps the tag, orbit cluster, journal and calendar filters (toggle, all, only one, remembered), calendar colours, tag in the card, removing a tag, pixel theme.');
}
async function checkPixelTheme() {
  const origin = `http://127.0.0.1:${server.address().port}`;
  await command('Page.navigate', { url:origin });
  await until("document.querySelectorAll('.entry').length===5");
  const palette = () => evaluate("['--background','--surface','--text','--muted','--accent','--priority','--success','--error'].map(name=>getComputedStyle(document.documentElement).getPropertyValue(name).trim())");
  const colors = await palette();
  const layout = await evaluate("[document.querySelector('.sidebar').getBoundingClientRect().width,document.querySelector('.topbar').getBoundingClientRect().height]");
  await key(',', 'Comma', 2);
  await until("Boolean(document.querySelector('[data-pixel-toggle]'))");
  await evaluate("(() => { const s=document.querySelector('[data-pixel-toggle]'); if (s.getAttribute('aria-checked')!=='true') s.click(); })()");
  await until("document.documentElement.dataset.pixel!==undefined");
  await evaluate("Promise.all([document.fonts.load('400 16px VT323'),document.fonts.load('400 13px \"Pixelify Sans\"')])");
  assert.deepEqual(await palette(),colors, 'The pixel theme preserves every palette token.');
  assert.equal(await evaluate("document.querySelector('[data-pixel-toggle]').getAttribute('aria-checked')"),'true');
  assert(await evaluate("[...document.querySelectorAll('.theme-options button')].every(button=>button.scrollWidth<=button.clientWidth+1)"));
  await pause(250); await screenshot('pixel-settings.png');
  await command('Emulation.setDeviceMetricsOverride',{width:760,height:520,deviceScaleFactor:1,mobile:false});
  await pause(250);
  assert(await evaluate("(() => {const panel=document.querySelector('.settings'),r=panel.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.bottom<=innerHeight && panel.scrollWidth<=panel.clientWidth+1;})()"),'Pixel settings remain usable in a small window.');
  await screenshot('pixel-settings-compact.png');
  await command('Emulation.setDeviceMetricsOverride',{width:1180,height:780,deviceScaleFactor:1,mobile:false});
  await pause(100);
  await key('Escape');
  assert.deepEqual(await evaluate("[document.querySelector('.sidebar').getBoundingClientRect().width,document.querySelector('.topbar').getBoundingClientRect().height]"),layout,'Theme selection preserves panel dimensions.');
  assert.match(await evaluate("getComputedStyle(document.querySelector('.cm-editor')).fontFamily"),/VT323/);
  assert(await evaluate("(() => { const c=document.createElement('canvas').getContext('2d'); c.font='16px VT323'; return Math.abs(c.measureText('iiii').width-c.measureText('WWWW').width)<.01; })()"),'The writing font is genuinely monospaced.');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.icon-pixel')).display"),'inline');
  await pause(250); await screenshot('pixel-journal.png');
  // The orbit opens quickly in square steps: its ring is made of pixels and everything stands within 250 ms.
  await evaluate("document.querySelector('[data-entry-kind=task] .entry-symbol, .entry .entry-symbol').click()");
  await pause(250);
  assert.deepEqual(await evaluate(`(() => { const dock=document.querySelector('.entry-dock-shell.is-open'); const sat=[...dock.querySelectorAll('.dock-satellite:not(:disabled)')];
    return [getComputedStyle(dock.querySelector('.dock-orbit circle')).display, [...dock.querySelectorAll('.dock-orbit-pixel path')].every(p => getComputedStyle(p).opacity==='1'),
      sat.every(b => getComputedStyle(b).opacity==='1' && getComputedStyle(b).transform!=='none' && !getComputedStyle(b).transform.includes('0.3'))]; })()`), ['none', true, true]);
  await screenshot('pixel-orbit.png');
  await key('Escape');
  await command('Page.reload');
  await until("document.documentElement.dataset.pixel!==undefined && document.querySelectorAll('.entry').length===5");
  await evaluate("document.querySelector('.entry-text').focus()");
  await command('Input.insertText', { text:'Pixel ÄÖÜ äöü ß – lesbar' });
  await saveNow();
  await until("window.__uiTest.saves>0");
  await key('F1');
  await until("Boolean(document.querySelector('.shortcuts'))");
  await pause(400);
  await screenshot('pixel-shortcuts.png');
  await key('Escape');
  await evaluate("document.querySelector('.sidebar .cal').focus()");
  await key('t','KeyT');
  await until("Boolean(document.querySelector('.cal-time-column'))");
  await pause(250);
  const point=await evaluate("(() => { const g=document.querySelector('.cal-time'), c=g.querySelector('.cal-time-column').getBoundingClientRect(), h=parseFloat(getComputedStyle(g).getPropertyValue('--hour')); return {x:c.left+c.width/2,y:c.top+9.25*h}; })()");
  // The right mouse button draws new entries; left clicks leave the empty grid alone.
  const dragTo={x:point.x,y:point.y+40};
  await command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'right',buttons:2,clickCount:1});
  await command('Input.dispatchMouseEvent',{type:'mouseMoved',...dragTo,button:'right',buttons:2});
  await command('Input.dispatchMouseEvent',{type:'mouseReleased',...dragTo,button:'right',buttons:0,clickCount:1});
  await until("Boolean(document.querySelector('.cal-composer.is-placed'))");
  await pause(400);
  assert(await evaluate("(() => {const r=document.querySelector('.cal-composer').getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.bottom<=innerHeight;})()"));
  await command('Input.insertText',{text:'Pixel-Termin'});
  await screenshot('pixel-calendar.png');
  await key('Enter');
  await until("!document.querySelector('.cal-composer') && window.__uiTest.day().entries.some(entry=>entry.text==='Pixel-Termin')");
  await command('Page.navigate',{url:`${origin}/?window=calendar`});
  await until("document.documentElement.dataset.pixel!==undefined && Boolean(document.querySelector('.cal'))");
  // Cross-window events also update windows already open, without reloading their content.
  await evaluate("window.__uiTest.emit('journal:theme','classic')");
  await until("document.documentElement.dataset.theme==='classic'");
  await command('Page.navigate',{url:origin});
  await until("Boolean(document.querySelector('.settings-button'))");
  await key(',', 'Comma', 2);
  await until("Boolean(document.querySelector('[data-theme-choice=classic]'))");
  await evaluate("document.querySelector('[data-theme-choice=classic]').click()");
  await evaluate("(() => { const s=document.querySelector('[data-pixel-toggle]'); if (s.getAttribute('aria-checked')==='true') s.click(); })()");
  await until("document.documentElement.dataset.theme==='classic'");
  await key('Escape');
  console.log('Pixel theme checks passed: unchanged palette/layout, bundled mono font, saved preference, editing/saving, shortcuts, calendar drawing and cross-window synchronization.');
}
async function checkJournalTheme() {
  const origin = `http://127.0.0.1:${server.address().port}`;
  await command('Page.navigate', { url:origin });
  await until("document.querySelectorAll('.entry').length===5");
  const pagesNow = "[...document.querySelectorAll('.book-page:not(.is-outgoing)')].map(p=>p.dataset.page+':'+p.dataset.date).join()";
  const kindsNow = "[...document.querySelectorAll('.book-page:not(.is-outgoing)')].map(p=>p.dataset.page).join()";
  // The app's day is the one whose page carries the head with the navigation (the date picker).
  const pickerDate = value => `document.querySelector('.book-page:not(.is-outgoing):has(.book-nav)')?.dataset.date === ${JSON.stringify(value)}`;
  const today = await evaluate('window.__uiTest.date'), tomorrow = await evaluate('window.__uiTest.shift(1)');
  // Choosing the style brings the paper palette and the book (a spread: entries | data).
  await key(',', 'Comma', 2);
  await until("Boolean(document.querySelector('[data-theme-choice=journal]'))");
  // Three designs (normal, journal, Nebula); the pixel look is a switch over the first two.
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.theme-options button')].map(b => b.dataset.themeChoice)"), ['classic', 'journal', 'nebula']);
  assert.equal(await evaluate("document.querySelector('[data-pixel-toggle]').getAttribute('role')"), 'switch');
  await evaluate("document.querySelector('[data-theme-choice=journal]').click()");
  await until("document.documentElement.dataset.theme==='journal' && document.documentElement.dataset.colorTheme==='paper'");
  assert.equal(await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--background').trim()"), '#f3ecdc');
  assert.equal(await evaluate("getComputedStyle(document.documentElement).colorScheme"), 'light');
  await evaluate("Promise.all([document.fonts.load('400 15px \"Source Serif 4\"'),document.fonts.load('600 30px Fraunces')])");
  await pause(250); await screenshot('journal-settings.png');
  await key('Escape');
  await until("!document.querySelector('.settings') && document.querySelectorAll('.book-page').length===2");
  assert.equal(await evaluate("document.querySelector('.sidebar')"), null, 'The book has no sidebar; the calendar comes down from its ribbon.');
  assert.equal(await evaluate(pagesNow), `entries:${today},data:${today}`);
  assert.match(await evaluate("getComputedStyle(document.querySelector('.book-page .entry-edit')).fontFamily"), /Source Serif 4/);
  assert.match(await evaluate("getComputedStyle(document.querySelector('.book-page h1')).fontFamily"), /Fraunces/);
  // The register on the outer page: all kinds of page at fixed heights, the right page's own tab is current.
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.book-cut-tab')].map(b => b.dataset.page)"), ['entries', 'data', 'board']);
  assert.equal(await evaluate("document.querySelector('.book-cut-tab[aria-current=page]').dataset.page"), 'data');
  await pause(300); await screenshot('journal-spread.png');
  // Turning moves the right page to the left: data | board, then board | the next day's entries (the app's day follows).
  await key('PageDown', 'PageDown', 2);
  await pause(170); await screenshot('journal-turning.png');
  await until(`${pagesNow}===${JSON.stringify(`data:${today},board:${today}`)} && document.querySelectorAll('.book-page').length===2`);
  assert(await evaluate(pickerDate(today)));
  await pause(300);
  await key('PageDown', 'PageDown', 2);
  await until(`${pagesNow}===${JSON.stringify(`board:${today},entries:${tomorrow}`)}`);
  await until(pickerDate(tomorrow));
  await until("Boolean(document.querySelector('.book-page.is-entries .title-input'))");
  await pause(500); await screenshot('journal-next-day.png');
  // The dog-ear turns back; the day returns with the page.
  await evaluate("document.querySelector('.book-page.is-left .book-corner.is-prev').click()");
  await until(`${pagesNow}===${JSON.stringify(`data:${today},board:${today}`)}`);
  await until(pickerDate(today));
  await pause(500);
  // Turning back once more shows the day from its entries page.
  await evaluate("document.querySelector('.book-page.is-left .book-corner.is-prev').click()");
  await until(`${kindsNow}==='entries,data'`);
  await until("document.querySelectorAll('.entry').length===5");
  // Spread or single page is chosen in the settings (Darstellung → Buchansicht).
  const bookViewTo = async view => {
    await key(',', 'Comma', 2);
    await until(`Boolean(document.querySelector('[data-book-view=${view}]'))`);
    await evaluate(`document.querySelector('[data-book-view=${view}]').click()`);
    await key('Escape');
    await until("!document.querySelector('.settings')");
  };
  // One page at a time: the register steps and Alt+→ (a whole day, to its entries page).
  await bookViewTo('single');
  await until("document.querySelectorAll('.book-page').length===1 && Boolean(document.querySelector('.book-stage.is-single'))");
  assert.equal(await evaluate("localStorage.getItem('journal.bookView')"), 'single');
  await pause(300); await screenshot('journal-single.png');
  await key('PageDown', 'PageDown', 2);
  await pause(190); await screenshot('journal-single-turning.png');
  await until(`${kindsNow}==='data' && document.querySelectorAll('.book-page').length===1`);
  await evaluate("document.querySelector('.book-cut-tab[data-page=board]').click()");
  await until(`${kindsNow}==='board'`);
  await until("Boolean(document.querySelector('.book-page .bulletin-board'))");
  await evaluate("document.querySelector('.board-actions button').click()");
  await until("document.querySelectorAll('.board-card').length===1");
  await evaluate("document.activeElement?.blur()");
  await pause(400); await screenshot('journal-board.png');
  await key('ArrowRight', 'ArrowRight', 1);
  await until(`${kindsNow}==='entries' && ${pickerDate(tomorrow)}`);
  await key('ArrowLeft', 'ArrowLeft', 1);
  await until(`${kindsNow}==='entries' && ${pickerDate(today)} && document.querySelectorAll('.entry').length===5`);
  await bookViewTo('double');
  await until("document.querySelectorAll('.book-page').length===2");
  // The calendar comes down (Ctrl+K) as a sheet over the left page; the book stays where it is. Esc takes it back up.
  const spread = await evaluate("document.querySelector('.book-spread').getBoundingClientRect().toJSON()");
  assert(spread.width >= 1180 - 60, 'The book fills the app.');
  await key('k', 'KeyK', 2);
  await until("document.querySelector('.calendar-drawer.is-overlay').classList.contains('is-open')");
  await pause(250); await screenshot('journal-calendar-dropping.png');
  await pause(800);
  assert(await evaluate(`(() => { const sheet=document.querySelector('.calendar-drawer-sheet').getBoundingClientRect(), now=document.querySelector('.book-spread').getBoundingClientRect();
    return now.left===${spread.left} && now.width===${spread.width} && sheet.left>=now.left+20 && sheet.left<now.left+50 && Math.abs(sheet.width-now.width/2)<60 && sheet.top>=now.top-24; })()`), 'The calendar lies over the left page (a little above its edge, see journal-layout).');
  assert.equal(await evaluate("localStorage.getItem('journal.calendarDrawer')"), '1');
  // The calendar's views are tabs on the right edge of its sheet.
  assert(await evaluate("(() => { const bar=document.querySelector('.calendar-drawer .cal-viewbar').getBoundingClientRect(), sheet=document.querySelector('.calendar-drawer-sheet').getBoundingClientRect(); const tools=document.querySelector('.calendar-drawer .cal-toolbar').getBoundingClientRect(); return bar.right<=sheet.left+8 && bar.height>200 && bar.width<40 && tools.right<=sheet.left+8 && tools.width<40 && getComputedStyle(document.querySelector('.calendar-drawer .cal-title')).display==='none'; })()"), 'Calendar views and filters are tabs on the left of the sheet.');
  await screenshot('journal-calendar.png');
  await evaluate("[...document.querySelectorAll('.calendar-drawer .cal-views button')].find(button => button.getAttribute('aria-label')==='Woche').click()");
  await until("document.querySelector('.calendar-drawer .cal').dataset.view==='week'");
  await pause(300); await screenshot('journal-calendar-week.png');
  await evaluate("[...document.querySelectorAll('.calendar-drawer .cal-views button')].find(button => button.getAttribute('aria-label')==='Monat').click()");
  await until("document.querySelector('.calendar-drawer .cal').dataset.view==='month'");
  // Clicking a day opens it in the book (its entries page) and folds the sheet away, so the day can be seen.
  await evaluate(`document.querySelector('.calendar-drawer [data-date="${tomorrow}"]').click()`);
  await until(`${pickerDate(tomorrow)} && ${pagesNow}.includes(${JSON.stringify(`entries:${tomorrow}`)}) && !document.querySelector('.calendar-drawer').classList.contains('is-open')`);
  await key('h', 'KeyH', 1);
  await until(`${pickerDate(today)} && document.querySelectorAll('.entry').length===5`);
  await pause(500);
  await evaluate("document.querySelector('.calendar-tab').click()");
  await until("document.querySelector('.calendar-drawer').classList.contains('is-open')");
  await evaluate("document.querySelector('.calendar-drawer .cal').focus()");
  await key('Escape');
  await until("!document.querySelector('.calendar-drawer').classList.contains('is-open')");
  // Putting it back slides it away (an animation: a transition would not start and the sheet would vanish at once).
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.calendar-drawer-sheet')).animationName"), 'sheet-slide-out');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.calendar-drawer-sheet')).visibility"), 'visible', 'The sheet is still seen while it slides away.');
  await pause(700);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.calendar-drawer-sheet')).visibility"), 'hidden');
  assert.equal(await evaluate("localStorage.getItem('journal.calendarDrawer')"), '0');
  // One page: the sheet has the dragged width over the page.
  await bookViewTo('single');
  await until("document.querySelectorAll('.book-page').length===1");
  await key('k', 'KeyK', 2);
  await until("document.querySelector('.calendar-drawer').classList.contains('is-open')");
  await pause(900); await screenshot('journal-calendar-single.png');
  assert(await evaluate("Boolean(document.querySelector('.calendar-drawer .sidebar-resizer'))"));
  await key('k', 'KeyK', 2);
  await until("!document.querySelector('.calendar-drawer').classList.contains('is-open')");
  await bookViewTo('double');
  await until("document.querySelectorAll('.book-page').length===2");
  // There is no title bar: settings and the window's controls sit on the cover; the calendar is always a sheet.
  assert(await evaluate("!document.querySelector('.topbar') && !document.querySelector('.titlebar-help') && Boolean(document.querySelector('.book-window-bar .settings-button')) && document.querySelectorAll('.book-window-bar .window-controls button').length===3"));
  assert(await evaluate("(() => { const bar=document.querySelector('.book-window-bar').getBoundingClientRect(), tabs=document.querySelector('.book-register').getBoundingClientRect(), book=document.querySelector('.book-spread').getBoundingClientRect(); return bar.top===0 && bar.bottom<=book.top && tabs.right<=bar.left; })()"), 'The window bar sits on the cover beside the register tabs.');
  await key(',', 'Comma', 2);
  await until("Boolean(document.querySelector('[data-book-view=double]'))");
  assert.equal(await evaluate("document.querySelector('[data-calendar-dock]')"), null, 'No choice where the calendar lies.');
  // The journal's own evening palette, on the same book.
  await evaluate("document.querySelector('#settings-colors-tab').click()");
  await until("Boolean(document.querySelector('[data-color-theme-choice=candle]'))");
  await evaluate("document.querySelector('[data-color-theme-choice=candle]').click()");
  await until("document.documentElement.dataset.colorTheme==='candle' && getComputedStyle(document.documentElement).colorScheme==='dark'");
  // The cover around the book follows the palette and can be adjusted (Farben → Buch).
  assert.equal(await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--cover').trim()"), '#5a3020');
  assert(await evaluate("Boolean(document.querySelector('[data-color-group=book]'))"));
  await key('Escape');
  await until("!document.querySelector('.settings') && Boolean(document.querySelector('.calendar-drawer.is-overlay'))");
  await pause(300); await screenshot('journal-candle.png');
  await key(',', 'Comma', 2);
  await evaluate("document.querySelector('#settings-colors-tab').click()");
  await until("Boolean(document.querySelector('[data-color-theme-choice=paper]'))");
  await evaluate("document.querySelector('[data-color-theme-choice=paper]').click()");
  await until("document.documentElement.dataset.colorTheme==='paper'");
  await key('Escape');
  await until("!document.querySelector('.settings')");
  // Settings and shortcuts are plain cards (no ruled background); the entries page is ruled only where it is written on,
  // one line per line of text (wrapped lines too).
  await key(',', 'Comma', 2);
  await until("Boolean(document.querySelector('.settings'))");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.settings')).backgroundImage"), 'none');
  await key('Escape');
  await until("!document.querySelector('.settings') && document.querySelectorAll('.entry').length===5");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.book-page.is-entries .book-page-scroll')).backgroundImage"), 'none');
  assert(await evaluate(`[...document.querySelectorAll('.book-page.is-entries .entry .entry-text')].every(text => { const style=getComputedStyle(text), height=text.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom);
    return style.backgroundImage.includes('linear-gradient') && style.backgroundClip==='content-box' && height>0 && height%24===0; })`), 'Every line of text has its rule.');
  assert(await evaluate("[...document.querySelectorAll('.book-page.is-entries .entry .entry-text')].some(text => text.clientHeight>=60)"), 'A wrapped entry has a rule per line.');
  // Both pages at once (Settings → Blättern): entries | data, then the board over both pages, then the next day.
  await key(',', 'Comma', 2);
  await until("Boolean(document.querySelector('[data-book-paging=spread]'))");
  await evaluate("document.querySelector('[data-book-paging=spread]').click()");
  await key('Escape');
  await until(`!document.querySelector('.settings') && ${pagesNow}===${JSON.stringify(`entries:${today},data:${today}`)}`);
  await key('PageDown', 'PageDown', 2);
  await pause(150); await screenshot('journal-spreads-turning.png');
  await until(`${pagesNow}===${JSON.stringify(`board:${today}`)} && document.querySelectorAll('.book-page').length===1 && !document.querySelector('.book-ghost')`);
  assert(await evaluate("(() => { const page=document.querySelector('.book-page.is-wide').getBoundingClientRect(), spread=document.querySelector('.book-spread').getBoundingClientRect(); return Math.abs(page.width-spread.width)<2; })()"), 'The board lies over both pages.');
  assert(await evaluate(pickerDate(today)));
  // Over both pages the spine's shadow and the ribbon fade out below the top edge; the board shows whole.
  assert(await evaluate("(() => { const stage=document.querySelector('.book-stage.is-wide-page'); const mask=e=>getComputedStyle(e).maskImage || getComputedStyle(e).webkitMaskImage; return Boolean(stage) && mask(document.querySelector('.book-ribbon > span')).includes('gradient') && getComputedStyle(document.querySelector('.book-spread'),'::after').maskImage.includes('gradient'); })()"), 'Ribbon and spine fade out over the board.');
  await pause(200); await screenshot('journal-spreads-board.png');
  await key('PageDown', 'PageDown', 2);
  await pause(330); await screenshot('journal-spreads-turning-out.png');
  await until(`${pagesNow}===${JSON.stringify(`entries:${tomorrow},data:${tomorrow}`)} && ${pickerDate(tomorrow)} && document.querySelectorAll('.book-page').length===2`);
  await key('PageUp', 'PageUp', 2);
  await until(`${pagesNow}===${JSON.stringify(`board:${today}`)} && ${pickerDate(today)}`);
  await pause(500);
  await key('PageUp', 'PageUp', 2);
  await until(`${pagesNow}===${JSON.stringify(`entries:${today},data:${today}`)} && document.querySelectorAll('.book-page').length===2`);
  await pause(500);
  // The calendar sheet on the book: one page beside it, up to its edge; picking a day keeps the sheet.
  await key('k', 'KeyK', 2);
  await until("document.querySelector('.calendar-drawer.is-overlay').classList.contains('is-open') && document.querySelector('.book-stage.is-beside') && document.querySelectorAll('.book-page').length===1");
  await pause(1100);
  assert(await evaluate("(() => { const sheet=document.querySelector('.calendar-drawer-sheet').getBoundingClientRect(), page=document.querySelector('.book-page').getBoundingClientRect(), spread=document.querySelector('.book-spread').getBoundingClientRect(); return page.left>=sheet.right-4 && Math.abs(page.right-spread.right)<2; })()"), 'The page lies beside the calendar.');
  await screenshot('journal-spreads-calendar.png');
  await evaluate(`document.querySelector('.calendar-drawer [data-date="${tomorrow}"]').click()`);
  await until(`${pickerDate(tomorrow)} && ${pagesNow}===${JSON.stringify(`entries:${tomorrow}`)} && document.querySelector('.calendar-drawer').classList.contains('is-open')`);
  await key('h', 'KeyH', 1);
  await until(`${pickerDate(today)} && document.querySelectorAll('.entry').length===5`);
  await key('k', 'KeyK', 2);
  await until("!document.querySelector('.calendar-drawer').classList.contains('is-open') && document.querySelectorAll('.book-page').length===2");
  await key(',', 'Comma', 2);
  await until("Boolean(document.querySelector('[data-book-paging=page]'))");
  await evaluate("document.querySelector('[data-book-paging=page]').click()");
  await key('Escape');
  await until("!document.querySelector('.settings')");
  // Writing works as everywhere: the entry is typed and saved.
  await evaluate("document.querySelector('.book-page.is-entries .entry-text').focus()");
  await command('Input.insertText', { text:'Tinte auf Papier – ÄÖÜ ß ' });
  await saveNow();
  await until("window.__uiTest.saves>0 && window.__uiTest.day().entries.some(entry=>entry.text.includes('Tinte auf Papier'))");
  await evaluate("document.activeElement?.blur()");
  await evaluate("document.querySelector('.book-page.is-entries .entry-symbol').click()");
  await pause(400); await screenshot('journal-orbit.png');
  await key('Escape');
  await key('F1');
  await until("Boolean(document.querySelector('.shortcuts'))");
  await evaluate("[...document.querySelectorAll('.shortcuts [role=tab]')].find(tab=>tab.textContent.includes('Buch')).click()");
  await pause(300); await screenshot('journal-shortcuts.png');
  await key('Escape');
  // The views are register tabs on the book's top edge (no bar of their own; turning and the date sit in the title bar).
  assert.equal(await evaluate("document.querySelector('.journal-tabs, .main > .toolbar')"), null);
  assert(await evaluate("(() => { const tabs=document.querySelector('.book-register').getBoundingClientRect(), book=document.querySelector('.book-spread').getBoundingClientRect(); return document.querySelectorAll('.book-register-tab').length===5 && tabs.bottom<=book.top+1 && tabs.top>=0; })()"), 'The register tabs sit on the top edge of the book.');
  // Turning days and the date are on the page; the title bar keeps the view switch.
  assert(await evaluate("!document.querySelector('.topbar') && Boolean(document.querySelector('.book-page .book-nav .book-nav-date'))"));
  // Overviews have pages of their own: note with ratings, then activities.
  await evaluate("document.querySelector('[data-period-mode=month]').click()");
  await until(`${kindsNow}==='notes,activities' && document.querySelector('[data-period-mode=month]').getAttribute('aria-current')==='page'`);
  await pause(400); await screenshot('journal-month.png');
  await key('PageDown', 'PageDown', 2);
  await until(`${kindsNow}==='activities,notes'`);
  await key('2', 'Digit2', 2);
  await until(`${kindsNow}==='notes,activities' && document.querySelector('[data-period-mode=week]').getAttribute('aria-current')==='page'`);
  await key('1', 'Digit1', 2);
  await until(`${kindsNow}==='entries,data'`);
  // A narrow window shows one page by itself.
  await command('Emulation.setDeviceMetricsOverride',{width:820,height:640,deviceScaleFactor:1,mobile:false});
  await until("document.querySelectorAll('.book-page').length===1");
  assert(await evaluate("document.querySelector('.main').scrollWidth<=document.querySelector('.main').clientWidth+1"));
  await pause(300); await screenshot('journal-narrow.png');
  await command('Emulation.setDeviceMetricsOverride',{width:1180,height:780,deviceScaleFactor:1,mobile:false});
  await until("document.querySelectorAll('.book-page').length===2");
  // Other windows take the style too.
  await command('Page.navigate',{url:`${origin}/?window=calendar`});
  await until("document.documentElement.dataset.theme==='journal' && Boolean(document.querySelector('.cal'))");
  await pause(300); await screenshot('journal-calendar-window.png');
  await command('Page.navigate',{url:origin});
  await until("document.documentElement.dataset.theme==='journal' && document.querySelectorAll('.book-page').length===2");
  // Back to the classic style: the dark palette chosen before returns, with the sidebar.
  await key(',', 'Comma', 2);
  await until("Boolean(document.querySelector('[data-theme-choice=classic]'))");
  await evaluate("document.querySelector('[data-theme-choice=classic]').click()");
  await evaluate("(() => { const s=document.querySelector('[data-pixel-toggle]'); if (s.getAttribute('aria-checked')==='true') s.click(); })()");
  await until("document.documentElement.dataset.theme==='classic' && document.documentElement.dataset.colorTheme==='original'");
  await key('Escape');
  await until("Boolean(document.querySelector('.sidebar')) && !document.querySelector('.book-stage')");
  assert.equal(await evaluate("getComputedStyle(document.documentElement).colorScheme"), 'dark');
  assert.deepEqual(errors, []);
  console.log('Journal style checks passed: paper palette and fonts, spreads and single pages, turning across days, bookmarks, the calendar drawer, writing and saving, overviews, narrow windows and switching back.');
}
async function checkNebulaTheme() {
  const origin = `http://127.0.0.1:${server.address().port}`;
  await command('Emulation.setDeviceMetricsOverride',{width:1380,height:860,deviceScaleFactor:1,mobile:false});
  await command('Page.navigate', { url:origin });
  await until("document.querySelectorAll('.entry').length===5");
  const today = await evaluate('window.__uiTest.date'), tomorrow = await evaluate('window.__uiTest.shift(1)');
  const prompt = "document.querySelector('.nebula-terminal.is-entries .nebula-prompt')?.textContent";
  // Three designs; with the pixel look switched on, Nebula still shows none of it (and keeps the switch for the others).
  await key(',', 'Comma', 2);
  await until("Boolean(document.querySelector('[data-theme-choice=nebula]'))");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.theme-options button')].map(b => b.dataset.themeChoice)"), ['classic', 'journal', 'nebula']);
  await evaluate("(() => { const s=document.querySelector('[data-pixel-toggle]'); if (s.getAttribute('aria-checked')!=='true') s.click(); })()");
  await until("document.documentElement.dataset.pixel!==undefined");
  await evaluate("document.querySelector('[data-theme-choice=nebula]').click()");
  await until("document.documentElement.dataset.theme==='nebula'");
  assert.equal(await evaluate("document.documentElement.dataset.pixel"), undefined, 'Nebula has no pixel look.');
  assert.equal(await evaluate("document.querySelector('[data-pixel-toggle]').disabled"), true, 'The pixel switch is disabled in Nebula.');
  assert.equal(await evaluate("document.querySelector('[data-pixel-toggle]').getAttribute('aria-checked')"), 'true', 'The stored pixel choice stays.');
  // The fixed palette wins over the chosen one (original: #000000 background), which stays stored.
  assert.equal(await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--background').trim()"), '#050505');
  assert.equal(await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()"), '#a66cf0');
  assert.equal(await evaluate("getComputedStyle(document.documentElement).colorScheme"), 'dark');
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('journal.settings')).colorTheme"), 'original');
  await evaluate("Promise.all([document.fonts.load('400 15px \"Space Mono\"'),document.fonts.load('400 40px \"Instrument Serif\"'),document.fonts.load('700 12px \"Space Grotesk\"')])");
  await pause(300); await screenshot('nebula-settings.png');
  await evaluate("document.querySelector('#settings-colors-tab').click()");
  await until("Boolean(document.querySelector('.color-settings.is-fixed .color-fixed-hint')) && !document.querySelector('[data-color-theme-choice]')");
  await key('Escape');
  await until("!document.querySelector('.settings') && Boolean(document.querySelector('.nebula-desk'))");
  // Its own layout: no sidebar, toolbar or title bar; rail, terminals, poster; the window's controls in its own bar.
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.app > .sidebar, .main > .toolbar, .main > .topbar, .book-stage')].map(e => e.className)"), []);
  assert(await evaluate("['.nebula-window-bar .nebula-tabs','.nebula-cal-panel .nebula-calendar-toggle','.nebula-terminal.is-entries','.nebula-terminal.is-data','.nebula-terminal.is-board','.nebula-poster','.nebula-backdrop'].every(s => document.querySelector(s))"));
  assert.equal(await evaluate("document.querySelectorAll('.nebula-window-bar .window-controls button').length"), 3);
  assert.equal(await evaluate("document.querySelector('.nebula-backdrop').getAttribute('aria-hidden')"), 'true');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.nebula-backdrop')).pointerEvents"), 'none');
  assert.equal(await evaluate("document.querySelector('.nebula-poster-figure').textContent"), today.slice(8));
  assert.match(await evaluate(prompt), new RegExp(`--day ${today}`));
  assert.match(await evaluate("getComputedStyle(document.querySelector('.nebula-terminal .entry-text')).fontFamily"), /Space Mono/);
  assert.match(await evaluate("getComputedStyle(document.querySelector('.nebula-poster-figure')).fontFamily"), /Instrument Serif/);
  assert.match(await evaluate("getComputedStyle(document.querySelector('.nebula-tab')).fontFamily"), /Space Mono/);
  // No rail any more: the overview (poster and calendar) on the left, the counts in the poster's prose.
  assert(!(await evaluate("Boolean(document.querySelector('.nebula-rail'))")), 'No rail.');
  assert(await evaluate("document.querySelector('.nebula-side').getBoundingClientRect().right <= document.querySelector('.nebula-terminals').getBoundingClientRect().left"), 'The overview lies left of the windows.');
  assert.match(await evaluate("document.querySelector('.nebula-poster-prose').textContent"), /^5 Einträge · 1 offen/);
  assert.equal(await evaluate("document.querySelector('.nebula-today').disabled"), true);
  // Animated decoration (it stands still with reduced motion, below).
  assert(await evaluate("document.getAnimations().some(a => a.playState==='running' && a.effect?.getTiming().iterations===Infinity)"));
  // The glitch boxes stand still (no blinking); the running line is off for now (NebulaDesk: showMarquee).
  assert.equal(await evaluate("document.getAnimations().filter(a => a.effect?.target?.classList?.contains('nebula-glitch')).length"), 0);
  assert.equal(await evaluate("document.querySelector('.nebula-marquee')"), null);
  // The small calendar beside the poster: a month to pick days in.
  assert.equal(await evaluate("document.querySelectorAll('.nebula-side .nebula-cal-panel .cal-compact-day').length"), 42);
  assert.equal(await evaluate("document.querySelector('.nebula-side .cal-compact-day[aria-selected=true]')?.textContent"), String(Number(today.slice(8))));
  await pause(400); await screenshot('nebula-day.png');
  // Writing in the terminal: a new task, then done with Alt+D.
  await evaluate("[...document.querySelectorAll('.nebula-terminal .kind-picker button')].find(b => b.title.includes('Alt A')).click()");
  await until("document.querySelectorAll('.entry').length===6 && document.activeElement?.classList.contains('entry-text')");
  await command('Input.insertText', { text:'Nebula schreibt mit' });
  await key('d', 'KeyD', 1);
  await until("document.activeElement.closest('.entry')?.dataset.status==='done'");
  await saveNow();
  await until("window.__uiTest.saves>0 && window.__uiTest.day().entries.some(e => e.text==='Nebula schreibt mit' && e.done)");
  assert.match(await evaluate("document.querySelector('.nebula-poster-prose').textContent"), /^6 Einträge/);
  // Turning days in the rail, and back with [ HEUTE ].
  await evaluate("document.querySelectorAll('.nebula-step')[1].click()");
  await until(`${prompt}?.includes(${JSON.stringify(tomorrow)})`);
  assert.equal(await evaluate("document.querySelector('.nebula-today').disabled"), false);
  await evaluate("document.querySelector('.nebula-today').click()");
  await until(`${prompt}?.includes(${JSON.stringify(today)}) && document.querySelector('.nebula-today').disabled`);
  await evaluate("document.activeElement?.blur()");
  await key('ArrowRight', 'ArrowRight', 1);
  await until(`${prompt}?.includes(${JSON.stringify(tomorrow)})`);
  await key('h', 'KeyH', 1);
  await until(`${prompt}?.includes(${JSON.stringify(today)})`);
  // The views as hooked tabs (and Ctrl+1–5): an overview has a note and an activities terminal.
  await evaluate("document.querySelector('.nebula-tab[data-period-mode=week]').click()");
  await until("Boolean(document.querySelector('.nebula-terminal.is-notes')) && Boolean(document.querySelector('.nebula-terminal.is-activities')) && !document.querySelector('.nebula-terminal.is-entries')");
  assert.equal(await evaluate("document.querySelector('.nebula-tab[aria-current=page]').dataset.periodMode"), 'week');
  // The calendar's day view: in the week, a strip of its days changes the day shown without leaving the overview.
  await evaluate("document.querySelector('.nebula-cal-views [data-cal-view=day]').click()");
  // It is the calendar's own day view: 24 hours in one column, no view tabs, and the main calendar keeps its view.
  const panelCal = ".nebula-cal-panel .cal.is-fixed[data-view=day]";
  await until(`document.querySelectorAll('.nebula-cal-strip button').length===7 && document.querySelectorAll('${panelCal} .cal-time-column').length===1`);
  assert.equal(await evaluate(`document.querySelectorAll('${panelCal} .cal-time-hours span').length`), 24);
  assert.equal(await evaluate(`document.querySelectorAll('${panelCal} .cal-viewbar').length`), 0);
  assert.equal(await evaluate("document.querySelector('.nebula-calendar .cal').dataset.view"), 'month');
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('journal.calendar') ?? '{}').view ?? 'month'"), 'month');
  // In the week, the strip moves the calendar to another of its days; the overview stays.
  const otherDay = await evaluate("[...document.querySelectorAll('.nebula-cal-strip button')].find(b => b.getAttribute('aria-pressed')!=='true').dataset.stripDate");
  await evaluate(`document.querySelector('.nebula-cal-strip [data-strip-date="${otherDay}"]').click()`);
  await until(`document.querySelector('.nebula-cal-strip [data-strip-date="${otherDay}"]').getAttribute('aria-pressed')==='true'`);
  assert.equal(await evaluate("document.querySelector('.nebula-tab[aria-current=page]').dataset.periodMode"), 'week');
  // Entries are made in it like in the calendar: dragging over the hours with the right button opens the composer.
  const column = await evaluate(`(() => { const r=document.querySelector('${panelCal} .cal-time-column').getBoundingClientRect(), b=document.querySelector('${panelCal} .cal-body').getBoundingClientRect(); const allday=document.querySelector('${panelCal} .cal-time-allday').getBoundingClientRect(); const top=Math.max(r.top,b.top,allday.bottom)+30; return {x:r.left+r.width/2, y:top}; })()`);
  await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:column.x, y:column.y });
  await command('Input.dispatchMouseEvent', { type:'mousePressed', x:column.x, y:column.y, button:'right', buttons:2, clickCount:1 });
  for (let step = 1; step <= 6; step++) await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:column.x, y:column.y + step * 12, button:'right', buttons:2 });
  await command('Input.dispatchMouseEvent', { type:'mouseReleased', x:column.x, y:column.y + 72, button:'right', buttons:0, clickCount:1 });
  await until("Boolean(document.querySelector('.cal-composer'))");
  assert(await evaluate(`Boolean(document.querySelector('${panelCal} .cal-selection'))`), 'The dragged hours are marked in the day view (not the whole day).');
  assert(await evaluate(`[...document.querySelectorAll('${panelCal} .cal-toolbar :is(.cal-nav, .cal-actions)')].every(e => { const r=e.getBoundingClientRect(), p=document.querySelector('.nebula-cal-panel').getBoundingClientRect(); return r.width>0 && r.left>=p.left-1 && r.right<=p.right+1; })`), 'Turning and filters fit the panel.');
  await pause(300); await screenshot('nebula-day-composer.png');
  await key('Escape');
  await until("!document.querySelector('.cal-composer')");
  // The poster scrolls away; the calendar sticks to the top and grows into its room, down to the window's edge.
  const panelBox = "(() => { const p=document.querySelector('.nebula-cal-panel').getBoundingClientRect(), d=document.querySelector('.nebula-desk').getBoundingClientRect(), q=document.querySelector('.nebula-poster').getBoundingClientRect(); return { top:p.top-d.top, bottom:innerHeight-p.bottom, height:p.height, poster:q.bottom-d.top }; })()";
  const before = await evaluate(panelBox);
  assert(before.top > before.poster && Math.abs(before.bottom - 18) <= 2, `The calendar fills the column below the poster: ${JSON.stringify(before)}`);
  await evaluate("document.querySelector('.nebula-desk').scrollTop=420");
  await pause(200);
  const after = await evaluate(panelBox);
  assert(after.poster < 0 && Math.abs(after.top - 18) <= 2 && Math.abs(after.bottom - 18) <= 2 && after.height > before.height + 100, `The poster is gone, the calendar takes its room: ${JSON.stringify(after)}`);
  await pause(300); await screenshot('nebula-week.png');
  await evaluate("document.querySelector('.nebula-desk').scrollTop=0");
  await evaluate("document.querySelector('.nebula-cal-views [data-cal-view=month]').click()");
  await until("Boolean(document.querySelector('.nebula-side .cal-compact-grid'))");
  await key('3', 'Digit3', 2);
  await until("document.querySelector('.nebula-tab[aria-current=page]').dataset.periodMode==='month'");
  await key('1', 'Digit1', 2);
  await until("Boolean(document.querySelector('.nebula-terminal.is-entries .entry'))");
  // Ctrl+K brings the calendar window over the terminals, Esc in it takes it away again.
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.nebula-calendar')).visibility"), 'hidden');
  await evaluate("document.activeElement?.blur()");
  await key('k', 'KeyK', 2);
  await until("document.querySelector('.nebula-calendar').classList.contains('is-open') && Boolean(document.activeElement?.closest('.nebula-calendar'))");
  await pause(400);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.nebula-calendar')).visibility"), 'visible');
  await screenshot('nebula-calendar.png');
  await key('Escape');
  await until("!document.querySelector('.nebula-calendar').classList.contains('is-open') && document.activeElement?.classList.contains('nebula-calendar-toggle')");
  await evaluate("document.querySelector('.nebula-calendar-toggle').click()");
  await until("document.querySelector('.nebula-calendar').classList.contains('is-open')");
  await evaluate("document.querySelector('.nebula-calendar-close').click()");
  await until("!document.querySelector('.nebula-calendar').classList.contains('is-open')");
  const ticketEntry = (id, text, extra) => `{id:'30000000-0000-4000-8000-00000000000${id}',kind:'event',text:'${text}',done:false,cancelled:false,priority:false,time:null,reminder:false,plan:null,...${JSON.stringify(extra)}}`;
  // Tickets: entries tagged delivery, payment or appointments (the fixed mail tags) and events (Ereignisse); the foil
  // tells which. An untagged task gets none; a click opens the day.
  await evaluate(`window.__uiTest.store({date:${JSON.stringify(tomorrow)},title:'',body:'',revision:1,entries:[${ticketEntry(1, 'Aufgabe ohne Tag', { kind:'task', time:'18:00' })},${ticketEntry(5, 'Nur im Kalender', {showInJournal:false,time:'16:00'})},${ticketEntry(6, 'Aktivitätszeit', {showInJournal:false,time:'17:00',end:'17:30'})}]})`);
  await pause(600);
  assert.equal(await evaluate(`document.querySelectorAll('.nebula-ticket[data-ticket-date="${tomorrow}"]').length`), 0, 'Tasks, calendar-only entries and activity time get no ticket.');
  await evaluate(`window.__uiTest.store({date:${JSON.stringify(tomorrow)},title:'',body:'',revision:2,entries:[${ticketEntry(1, 'Kino ohne Tag', { time:'18:00',showInJournal:true })},${ticketEntry(2, 'Konzert im Park', { time:'19:30', end:'22:00', showInJournal:false,tag:'f4c8191a-2d70-4b01-9d00-000000000003' })},${ticketEntry(3, 'Paket kommt', { kind:'task', showInJournal:false,tag:'f4c8191a-2d70-4b01-9d00-000000000001' })},${ticketEntry(4, 'Miete überweisen', { kind:'task', showInJournal:false,tag:'f4c8191a-2d70-4b01-9d00-000000000002' })}]})`);
  await until(`document.querySelectorAll('.nebula-ticket[data-ticket-date="${tomorrow}"]').length>=2`);
  const ticketKinds = ['delivery', 'payment', 'event', 'appointment'];
  const shownKinds = await evaluate(`[...document.querySelectorAll('.nebula-ticket[data-ticket-date="${tomorrow}"]')].map(t => t.dataset.ticketKind)`);
  assert.deepEqual(shownKinds, ticketKinds.slice(0, shownKinds.length), 'Tickets in time order, each kind with its foil.');
  assert(await evaluate("[...document.querySelectorAll('.nebula-ticket')].every(t => { const r=t.getBoundingClientRect(); return r.width / r.height > 2; })"), 'Tickets are flat.');
  assert(await evaluate("[...document.querySelectorAll('.nebula-ticket')].some(t => t.dataset.ticketKind==='event')"), 'Events get tickets.');
  await evaluate("document.querySelector('.nebula-tickets').scrollIntoView({block:'end'})");
  await pause(300); await screenshot('nebula-tickets.png');
  await evaluate(`document.querySelector('.nebula-ticket[data-ticket-date="${tomorrow}"]').click()`);
  await until(`${prompt}?.includes(${JSON.stringify(tomorrow)})`);
  await evaluate("document.activeElement?.blur()");
  await key('h', 'KeyH', 1);
  await until(`${prompt}?.includes(${JSON.stringify(today)})`);
  // The pinboard in the style: square cards without tilt, on Nebula paper.
  await evaluate("document.querySelector('.nebula-terminal.is-board .board-actions button').click()");
  await until("Boolean(document.querySelector('.nebula-terminal.is-board .board-card'))");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.board-card')).getPropertyValue('--tilt').trim()"), '0deg');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.board-card')).borderTopLeftRadius"), '0px');
  await evaluate("document.querySelector('.nebula-terminal.is-board').scrollIntoView({block:'center'})");
  await pause(400); await screenshot('nebula-board.png');
  // The wheel over the board scrolls the desk on; only Ctrl+wheel zooms the board.
  const deskTop = await evaluate("document.querySelector('.nebula-desk').scrollTop");
  const overBoard = await evaluate("(() => { const r=document.querySelector('.nebula-terminal.is-board .board-viewport').getBoundingClientRect(); return { x:r.left+r.width-30, y:r.top+r.height/2 }; })()");
  const boardZoom = await evaluate("document.querySelector('.board-viewport').style.getPropertyValue('--board-scale')");
  await command('Input.dispatchMouseEvent', { type:'mouseWheel', x:overBoard.x, y:overBoard.y, deltaX:0, deltaY:-200 });
  await until(`document.querySelector('.nebula-desk').scrollTop < ${deskTop}`);
  assert.equal(await evaluate("document.querySelector('.board-viewport').style.getPropertyValue('--board-scale')"), boardZoom, 'Plain wheel leaves the zoom.');
  // Widths: nothing runs out of the window; the overview lies left of the windows, narrow above them.
  for (const width of [1380, 1180, 820, 560]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:820,deviceScaleFactor:1,mobile:false}); await evaluate("document.querySelector('.nebula-desk').scrollTop=0"); await pause(350);
    assert(await evaluate("(() => { const d=document.querySelector('.nebula-desk'); return d.scrollWidth<=d.clientWidth+1; })()"), `No horizontal overflow at ${width}`);
    assert(await evaluate("[...document.querySelectorAll('.nebula-tab, .nebula-window-bar button, .nebula-step, .nebula-today, .nebula-calendar-toggle')].every(e => { const r=e.getBoundingClientRect(); return r.width>0 && r.left>=-1 && r.right<=innerWidth+1; })"), `Controls fit at ${width}`);
    assert(await evaluate("(() => { const r=s=>document.querySelector(s).getBoundingClientRect(), tabs=[...document.querySelectorAll('.nebula-tab')].map(e=>e.getBoundingClientRect()); const bar=r('.nebula-window-bar'), search=r('.nebula-window-bar .search'), note=r('.nebula-notebook-toggle'), free=(tabs[0].left-search.right)+(note.left-tabs.at(-1).right); return search.right<=tabs[0].left+1 && tabs.at(-1).right<=note.left && note.right<=r('.nebula-window-bar .settings-button').left+1 && Math.abs((tabs[0].left+tabs.at(-1).right)/2-(bar.left+bar.width/2))<2 && free>=80; })()"), `The views sit in the middle, nothing overlaps, and the bar keeps room to move the window at ${width}`);
    // The free bar moves the window.
    const freeBar = await evaluate("(() => { const n=document.querySelector('.nebula-notebook-toggle').getBoundingClientRect(), t=[...document.querySelectorAll('.nebula-tab')].at(-1).getBoundingClientRect(); return { x:(t.right+n.left)/2, y:n.top+n.height/2 }; })()");
    assert(await evaluate(`document.elementFromPoint(${freeBar.x}, ${freeBar.y})?.classList.contains('nebula-window-space')`), `Free bar at ${width}`);
    await command('Input.dispatchMouseEvent', { type:'mousePressed', x:freeBar.x, y:freeBar.y, button:'left', buttons:1, clickCount:1 });
    await command('Input.dispatchMouseEvent', { type:'mouseReleased', x:freeBar.x, y:freeBar.y, button:'left', buttons:0, clickCount:1 });
    await until("window.__uiTest.invoked.at(-1)?.[0] === 'plugin:window|start_dragging'");
    const order = await evaluate("(() => { const c=document.querySelector('.nebula-terminals').getBoundingClientRect(), p=document.querySelector('.nebula-side').getBoundingClientRect(); return { above: p.bottom<=c.top+1, left: p.right<=c.left+1 }; })()");
    if (width >= 1180) assert(order.left, `Overview left of the windows at ${width}`);
    else assert(order.above, `Overview above the windows at ${width}`);
    if (width === 1180) await screenshot('nebula-1180.png');
    if (width === 820) await screenshot('nebula-narrow.png');
    if (width === 560) await screenshot('nebula-small.png');
  }
  await command('Emulation.setDeviceMetricsOverride',{width:1180,height:780,deviceScaleFactor:1,mobile:false});
  // Reduced motion: the desk stands still.
  await command('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion',value:'reduce'}] });
  await pause(100);
  assert.deepEqual(await evaluate("document.getAnimations().filter(a => a.playState==='running' && a.effect?.getTiming().iterations===Infinity).map(a => String(a.effect.target?.className?.baseVal ?? a.effect.target?.className))"), []);
  await command('Emulation.setEmulatedMedia', { features:[] });
  // Other windows take the design (and no pixel look) too.
  await command('Page.navigate',{url:`${origin}/?window=calendar`});
  await until("document.documentElement.dataset.theme==='nebula' && document.documentElement.dataset.pixel===undefined && Boolean(document.querySelector('.cal'))");
  assert.equal(await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--background').trim()"), '#050505');
  await pause(300); await screenshot('nebula-calendar-window.png');
  await command('Page.navigate',{url:origin});
  await until("document.documentElement.dataset.theme==='nebula' && Boolean(document.querySelector('.nebula-desk .entry'))");
  // Floating windows: the calendar moves by its bar, resizes at its corner, lies over the desk (the day's note stays usable
  // beside it), keeps its place after a reload; focus darkens the rest; a double click on the bar docks it again.
  await command('Emulation.setDeviceMetricsOverride',{width:1380,height:860,deviceScaleFactor:1,mobile:false});
  await evaluate("localStorage.removeItem('journal.nebulaWindow.calendar')");
  await evaluate("document.activeElement?.blur()");
  await key('k', 'KeyK', 2);
  await until("Boolean(document.querySelector('.nebula-calendar.is-open'))"); await pause(400);
  const drag = async (from, to) => {
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:from.x,y:from.y});
    await command('Input.dispatchMouseEvent',{type:'mousePressed',x:from.x,y:from.y,button:'left',buttons:1,clickCount:1});
    for (let step = 1; step <= 6; step++) await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:from.x+(to.x-from.x)*step/6,y:from.y+(to.y-from.y)*step/6,button:'left',buttons:1});
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:to.x,y:to.y,button:'left',buttons:0,clickCount:1});
  };
  const box = () => evaluate("document.querySelector('.nebula-calendar').getBoundingClientRect().toJSON()");
  const docked = await box();
  // Smaller at its corner first (docked it fills the desk), then moved by its bar.
  const corner = await evaluate("(() => { const r=document.querySelector('.nebula-calendar .nebula-grip.is-se').getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; })()");
  await drag(corner, { x:corner.x-(docked.width-520), y:corner.y-(docked.height-420) });
  await until("document.querySelector('.nebula-calendar').classList.contains('is-floating') && Math.abs(document.querySelector('.nebula-calendar').getBoundingClientRect().width-520)<4");
  const resized = await box();
  assert(Math.abs(resized.height-420)<4 && Math.abs(resized.left-docked.left)<2 && Math.abs(resized.top-docked.top)<2, 'The corner resizes, the opposite corner stays: '+JSON.stringify(resized));
  const head = await evaluate("(() => { const r=document.querySelector('.nebula-calendar .nebula-prompt').getBoundingClientRect(); return { x:r.left+20, y:r.top+r.height/2 }; })()");
  await drag(head, { x:head.x+300, y:head.y+140 });
  await until(`Math.abs(document.querySelector('.nebula-calendar').getBoundingClientRect().left-${resized.left + 300})<3`);
  const small = await box();
  assert(Math.abs(small.top-resized.top-140)<3 && Math.abs(small.width-520)<2, 'The bar moves the window: '+JSON.stringify(small));
  // Beside it the desk is still there: the day's note can be clicked where the window is not.
  assert(await evaluate("(() => { const w=document.querySelector('.nebula-calendar').getBoundingClientRect(); const e=document.querySelector('.nebula-desk .entry .entry-text'); const r=e.getBoundingClientRect(); const x=r.left+10, y=r.top+r.height/2; return (x<w.left||x>w.right||y<w.top||y>w.bottom) && e.contains(document.elementFromPoint(x,y)); })()"), 'The day note stays usable beside the window.');
  await pause(300); await screenshot('nebula-window-floating.png');
  assert.deepEqual(JSON.parse(await evaluate("localStorage.getItem('journal.nebulaWindow.calendar')")), { x:Math.round(small.left-(await evaluate("document.querySelector('.nebula-stage').getBoundingClientRect().left"))), y:Math.round(small.top-(await evaluate("document.querySelector('.nebula-stage').getBoundingClientRect().top"))), w:Math.round(small.width), h:Math.round(small.height) }, 'The place is remembered.');
  // Focus: the rest under a dark veil; a click on it ends the focus.
  await evaluate("document.querySelector('.nebula-calendar .nebula-window-focus').click()");
  await until("Boolean(document.querySelector('.nebula-dim')) && document.querySelector('.nebula-calendar').classList.contains('is-focused')");
  assert.equal(await evaluate("Number(getComputedStyle(document.querySelector('.nebula-calendar')).zIndex) > Number(getComputedStyle(document.querySelector('.nebula-dim')).zIndex)"), true);
  await pause(300); await screenshot('nebula-window-focus.png');
  await evaluate("document.querySelector('.nebula-dim').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))");
  await until("!document.querySelector('.nebula-dim')");
  // Double click on the bar: back in its docked place.
  await command('Input.dispatchMouseEvent',{type:'mousePressed',x:small.left+40,y:small.top+12,button:'left',buttons:1,clickCount:1});
  await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:small.left+40,y:small.top+12,button:'left',buttons:0,clickCount:1});
  await command('Input.dispatchMouseEvent',{type:'mousePressed',x:small.left+40,y:small.top+12,button:'left',buttons:1,clickCount:2});
  await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:small.left+40,y:small.top+12,button:'left',buttons:0,clickCount:2});
  await until("!document.querySelector('.nebula-calendar').classList.contains('is-floating') && localStorage.getItem('journal.nebulaWindow.calendar')===null");
  await key('Escape'); await until("!document.querySelector('.nebula-calendar.is-open')");
  // Several windows focused at once – a grid window and the overview's calendar – both over the veil.
  await evaluate("document.querySelector('.nebula-desk').scrollTop=0"); await pause(150);
  await evaluate("document.querySelector('.nebula-panel.is-entries .nebula-window-focus').click()");
  await evaluate("document.querySelector('.nebula-cal-panel .nebula-window-focus').click()");
  await until("document.querySelector('.nebula-panel.is-entries').classList.contains('is-focused') && document.querySelector('.nebula-cal-panel').classList.contains('is-focused') && Boolean(document.querySelector('.nebula-dim'))");
  assert(await evaluate("['.nebula-panel.is-entries .entry-text', '.nebula-cal-panel .nebula-cal-views button'].every(s => { const e=document.querySelector(s), r=e.getBoundingClientRect(), hit=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2); return e===hit || e.contains(hit); })"), 'Focused windows lie above the veil.');
  assert(await evaluate("(() => { const r=document.querySelector('.nebula-panel.is-data').getBoundingClientRect(); return document.elementFromPoint(r.left+r.width/2, r.top+r.height/2)?.matches('.nebula-panel.is-data.is-dimmed'); })()"), 'The others lie under a veil of their own.');
  // The ◐ of a window under its veil shows through and lights up when pointed at; a click focuses it as well.
  const dataFocus = await evaluate("(() => { const r=document.querySelector('.nebula-panel.is-data .nebula-window-focus').getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; })()");
  assert(await evaluate(`document.elementFromPoint(${dataFocus.x}, ${dataFocus.y})?.matches('.nebula-panel.is-data .nebula-window-focus')`), 'The ◐ shows through the veil.');
  await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:dataFocus.x, y:dataFocus.y }); await pause(150);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.nebula-panel.is-data .nebula-window-focus')).backgroundColor"), await evaluate("getComputedStyle(document.querySelector('.nebula-panel.is-entries .nebula-window-focus')).backgroundColor"), 'Pointed at, it is lit like a focused one.');
  await pause(200); await screenshot('nebula-focus-hover.png');
  await command('Input.dispatchMouseEvent', { type:'mousePressed', x:dataFocus.x, y:dataFocus.y, button:'left', buttons:1, clickCount:1 });
  await command('Input.dispatchMouseEvent', { type:'mouseReleased', x:dataFocus.x, y:dataFocus.y, button:'left', buttons:0, clickCount:1 });
  await until("document.querySelector('.nebula-panel.is-data').classList.contains('is-focused') && document.querySelector('.nebula-panel.is-entries').classList.contains('is-focused')");
  await pause(300); await screenshot('nebula-focus-several.png');
  await evaluate("document.querySelector('.nebula-panel.is-data .nebula-window-focus').click()");
  await until("!document.querySelector('.nebula-panel.is-data').classList.contains('is-focused')");
  await evaluate("document.querySelector('.nebula-cal-panel .nebula-window-focus').click()");
  await until("!document.querySelector('.nebula-cal-panel').classList.contains('is-focused') && Boolean(document.querySelector('.nebula-dim'))");
  // A click on a window under its veil ends every focus.
  const veiled = await evaluate("(() => { const r=document.querySelector('.nebula-panel.is-data').getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; })()");
  await command('Input.dispatchMouseEvent', { type:'mousePressed', x:veiled.x, y:veiled.y, button:'left', buttons:1, clickCount:1 });
  await command('Input.dispatchMouseEvent', { type:'mouseReleased', x:veiled.x, y:veiled.y, button:'left', buttons:0, clickCount:1 });
  await until("!document.querySelector('.nebula-dim') && !document.querySelector('.is-focused') && !document.querySelector('.is-dimmed')");
  // The big calendar opens from the overview's calendar bar (the window bar keeps only the notebook's switch).
  assert.equal(await evaluate("Boolean(document.querySelector('.nebula-window-bar .nebula-calendar-toggle'))"), false);
  await evaluate("document.querySelector('.nebula-cal-panel .nebula-calendar-toggle').click()");
  await until("Boolean(document.querySelector('.nebula-calendar.is-open')) && document.querySelector('.nebula-cal-panel .nebula-calendar-toggle').classList.contains('is-open')"); await pause(300);
  // Shift+wheel over the calendar turns the calendar, not the journal's day.
  const shownDay = await evaluate("document.querySelector('.nebula-poster-figure').textContent");
  const calTitle = await evaluate("document.querySelector('.nebula-calendar .cal-title').textContent");
  const overCal = await evaluate("(() => { const r=document.querySelector('.nebula-calendar .cal-body, .nebula-calendar .cal-month, .nebula-calendar .cal').getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; })()");
  await command('Input.dispatchMouseEvent', { type:'mouseWheel', x:overCal.x, y:overCal.y, deltaX:0, deltaY:120, modifiers:8 });
  await until(`document.querySelector('.nebula-calendar .cal-title').textContent !== ${JSON.stringify(calTitle)}`);
  await pause(300);
  assert.equal(await evaluate("document.querySelector('.nebula-poster-figure').textContent"), shownDay, 'The journal keeps its day.');
  await evaluate("document.querySelector('.nebula-cal-panel .nebula-calendar-toggle').click()");
  await until("!document.querySelector('.nebula-calendar.is-open')");
  // The grid: windows can be minimized to their bar, set to half or whole rows, moved by their bar, and the calendar and
  // notebook can join it (button, or Shift while dragging) and leave it again.
  await evaluate("localStorage.removeItem('journal.nebulaLayout.v1')");
  await command('Page.reload');
  await until("Boolean(document.querySelector('.nebula-grid .nebula-panel.is-entries .entry'))"); await pause(400);
  // By default: entries and data side by side (7 + 5 columns, as tall as each other), the board below over the whole row.
  assert(await evaluate("(() => { const r=id=>document.querySelector('.nebula-panel.is-'+id).getBoundingClientRect(), e=r('entries'), d=r('data'), b=r('board'); return document.querySelector('.nebula-panel.is-entries').dataset.span==='7' && document.querySelector('.nebula-panel.is-data').dataset.span==='5' && document.querySelector('.nebula-panel.is-board').dataset.span==='12' && Math.abs(e.top-d.top)<2 && Math.abs(e.height-d.height)<2 && b.top>e.bottom && b.height>e.height; })()"), 'The default layout: entries and data in a row, the board below.');
  await pause(200); await screenshot('nebula-default.png');
  // The checks below start from the earlier layout: data and board sharing a row, no heights.
  await evaluate("localStorage.setItem('journal.nebulaLayout.v1', JSON.stringify({ order:{ day:['entries','data','board'], period:['notes','activities'] }, minimized:[], spans:{ data:6, board:6 }, docked:[], floating:[], heights:{} }))");
  await command('Page.reload');
  await until("Boolean(document.querySelector('.nebula-grid .nebula-panel.is-entries .entry'))"); await pause(400);
  const order = () => evaluate("[...document.querySelectorAll('.nebula-grid > .nebula-panel')].map(p => p.dataset.panel).join()");
  assert.equal(await order(), 'entries,data,board');
  await evaluate("document.querySelector('.nebula-panel.is-entries .nebula-panel-minimize').click()");
  await until("document.querySelector('.nebula-panel.is-entries').classList.contains('is-minimized') && document.querySelector('.nebula-panel.is-entries .nebula-panel-body').hidden");
  assert(await evaluate("document.querySelector('.nebula-panel.is-entries').getBoundingClientRect().height < 40"), 'Minimized: only the bar.');
  await pause(200); await screenshot('nebula-grid-minimized.png');
  await evaluate("document.querySelector('.nebula-panel.is-entries .nebula-panel-minimize').click()");
  await until("!document.querySelector('.nebula-panel.is-entries').classList.contains('is-minimized')");
  // The calendar into the grid by its button: it leaves the desk's air and sits after the board.
  await evaluate("document.activeElement?.blur()"); await key('k', 'KeyK', 2);
  await until("Boolean(document.querySelector('.nebula-calendar.is-open'))"); await pause(300);
  await evaluate("document.querySelector('.nebula-calendar .nebula-window-grid').click()");
  await until("Boolean(document.querySelector('.nebula-grid > .nebula-panel.is-calendar .cal')) && !document.querySelector('section.nebula-calendar')");
  assert.equal(await order(), 'entries,data,board,calendar');
  // Moving by the bar: the calendar dragged to the top lands before the entries.
  const barOf = id => evaluate(`(() => { const r=document.querySelector('.nebula-panel.is-${id} .nebula-prompt').getBoundingClientRect(); return { x:r.left+30, y:r.top+r.height/2 }; })()`);
  const pull = async (from, to, shift = false) => {
    const modifiers = shift ? 8 : 0;
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:from.x,y:from.y,modifiers});
    await command('Input.dispatchMouseEvent',{type:'mousePressed',x:from.x,y:from.y,button:'left',buttons:1,clickCount:1,modifiers});
    for (let step = 1; step <= 8; step++) await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:from.x+(to.x-from.x)*step/8,y:from.y+(to.y-from.y)*step/8,button:'left',buttons:1,modifiers});
    await pause(120);
  };
  const release = (at, shift = false) => command('Input.dispatchMouseEvent',{type:'mouseReleased',x:at.x,y:at.y,button:'left',buttons:0,clickCount:1,modifiers:shift ? 8 : 0});
  await evaluate("document.querySelector('.nebula-desk').scrollTop=0");
  const top = await evaluate("(() => { const r=document.querySelector('.nebula-panel.is-entries').getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+20 }; })()");
  // The data window dropped over the middle of the entries lands in a row of its own above them; the board fills the
  // row the data window left.
  const dataBar = await barOf('data');
  await pull(dataBar, top);
  assert(await evaluate("document.querySelector('.nebula-panel.is-entries').classList.contains('is-drop-top') && document.querySelector('.nebula-panel.is-data').classList.contains('is-held')"), 'A violet bar marks the landing place.');
  assert(await evaluate(`(() => { const r=document.querySelector('.nebula-panel.is-data').getBoundingClientRect(); return Math.abs(r.top-(${top.y}-20)) < 60; })()`), 'The carried window follows the pointer.');
  await screenshot('nebula-grid-moving.png');
  await release(top);
  await until("[...document.querySelectorAll('.nebula-grid > .nebula-panel')].map(p => p.dataset.panel).join()==='data,entries,board,calendar'");
  assert.deepEqual(await evaluate("['data','board'].map(id => document.querySelector(`.nebula-panel.is-${id}`).dataset.span)"), ['12', '12'], 'A row of its own; the board takes the whole row it is left alone in.');
  // The board dropped on the right edge of the entries: the two share that row (scrolled so both bars are in view).
  await evaluate("(() => { const d=document.querySelector('.nebula-desk'); d.scrollTop += document.querySelector('.nebula-panel.is-entries').getBoundingClientRect().top - 80; })()"); await pause(250);
  const boardFrom = await barOf('board');
  const besideEntries = await evaluate("(() => { const r=document.querySelector('.nebula-panel.is-entries').getBoundingClientRect(); return { x:r.right-30, y:r.top+Math.min(120, r.height/2) }; })()");
  await pull(boardFrom, besideEntries);
  assert(await evaluate("document.querySelector('.nebula-panel.is-entries').classList.contains('is-drop-split-right')"), 'Beside a window: its right half is marked.');
  await screenshot('nebula-grid-beside.png');
  await release(besideEntries);
  await until("[...document.querySelectorAll('.nebula-grid > .nebula-panel')].map(p => p.dataset.panel).join()==='data,entries,board,calendar' && document.querySelector('.nebula-panel.is-board').dataset.span==='6'");
  assert(await evaluate("(() => { const a=document.querySelector('.nebula-panel.is-entries').getBoundingClientRect(), b=document.querySelector('.nebula-panel.is-board').getBoundingClientRect(); return document.querySelector('.nebula-panel.is-entries').dataset.span==='6' && Math.abs(a.top-b.top)<2 && a.right<b.left; })()"), 'Two windows share a row.');
  // Half and whole rows by button: back to the whole row, the board moves to the next row.
  await evaluate("document.querySelector('.nebula-panel.is-entries .nebula-panel-half').click()");
  await until("document.querySelector('.nebula-panel.is-entries').dataset.span==='12'");
  await evaluate("document.querySelector('.nebula-panel.is-entries .nebula-panel-half').click()");
  await until("document.querySelector('.nebula-panel.is-entries').dataset.span==='6'");
  await evaluate("document.querySelector('.nebula-panel.is-calendar').scrollIntoView({block:'end'})"); await pause(300);
  await screenshot('nebula-grid-docked.png');
  // Out of the grid: the calendar dragged out floats again where it was let go.
  const calendarBar = await barOf('calendar');
  // Beside the grid, inside the window (over the poster's column).
  const outside = await evaluate(`(() => { const r=document.querySelector('.nebula-poster').getBoundingClientRect(); return { x:r.left+40, y:Math.min(innerHeight-40, Math.max(60, ${calendarBar.y})) }; })()`);
  await pull(calendarBar, outside); await release(outside);
  await until("Boolean(document.querySelector('section.nebula-calendar.is-open.is-floating')) && !document.querySelector('.nebula-grid > .nebula-panel.is-calendar')");
  // Back in with Shift, before the board: the hint without Shift, the bar with it.
  await evaluate("document.querySelector('.nebula-desk').scrollTop=0"); await pause(200);
  const floatBar = await evaluate("(() => { const r=document.querySelector('section.nebula-calendar .nebula-prompt').getBoundingClientRect(); return { x:r.left+30, y:r.top+r.height/2 }; })()");
  const board = await evaluate("(() => { const r=document.querySelector('.nebula-panel.is-board').getBoundingClientRect(); return { x:r.left+20, y:r.top+r.height/2 }; })()");
  await pull(floatBar, board);
  await until("Boolean(document.querySelector('.nebula-dock-hint'))");
  await release(board);
  await until("Boolean(document.querySelector('section.nebula-calendar.is-floating')) && !document.querySelector('.nebula-grid > .nebula-panel.is-calendar')");
  const floatBar2 = await evaluate("(() => { const r=document.querySelector('section.nebula-calendar .nebula-prompt').getBoundingClientRect(); return { x:r.left+30, y:r.top+r.height/2 }; })()");
  const board2 = await evaluate("(() => { const r=document.querySelector('.nebula-panel.is-board').getBoundingClientRect(); return { x:r.left+20, y:r.top+r.height/2 }; })()");
  await pull(floatBar2, board2, true);
  await until("Boolean(document.querySelector('.nebula-panel.is-board.is-drop-split-left, .nebula-panel.is-board.is-drop-top'))");
  await release(board2, true);
  await until("[...document.querySelectorAll('.nebula-grid > .nebula-panel')].map(p => p.dataset.panel).join()==='data,entries,calendar,board'");
  // Remembered after a reload; then back to the first layout.
  await command('Page.reload');
  await until("[...document.querySelectorAll('.nebula-grid > .nebula-panel')].map(p => p.dataset.panel).join()==='data,entries,calendar,board'");
  await evaluate("document.querySelector('.nebula-layout-reset').click()");
  await until("[...document.querySelectorAll('.nebula-grid > .nebula-panel')].map(p => p.dataset.panel).join()==='entries,data,board' && Boolean(document.querySelector('section.nebula-calendar.is-open'))");
  assert.equal(await evaluate("Boolean(document.querySelector('.nebula-layout-reset'))"), false);
  // The running line is off (its code stays).
  assert.equal(await evaluate("document.querySelector('.nebula-marquee')"), null);
  // Reset gives the default layout; the width checks below start from data and board sharing a row again.
  assert.equal(await evaluate("document.querySelector('.nebula-panel.is-data').dataset.span"), '5');
  await evaluate("localStorage.setItem('journal.nebulaLayout.v1', JSON.stringify({ order:{ day:['entries','data','board'], period:['notes','activities'] }, minimized:[], spans:{ data:6, board:6 }, docked:[], floating:[], heights:{} }))");
  await command('Page.reload');
  await until("Boolean(document.querySelector('.nebula-grid .nebula-panel.is-entries .entry'))"); await pause(400);
  // Width: the right edge sets the columns (it snaps); a double click there gives the whole row again. (A floating
  // calendar would lie over the grid: closed first.)
  await evaluate("document.querySelector('section.nebula-calendar.is-open .nebula-calendar-close')?.click()");
  await until("!document.querySelector('section.nebula-calendar.is-open')");
  await evaluate("document.querySelector('.nebula-desk').scrollTop=0"); await pause(200);
  const edge = await evaluate("(() => { const r=document.querySelector('.nebula-panel.is-entries .nebula-panel-width').getBoundingClientRect(), g=document.querySelector('.nebula-grid').getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+20, column:(g.width-18*11)/12+18 }; })()");
  await pull(edge, { x:edge.x - edge.column * 4, y:edge.y }); await release({ x:edge.x - edge.column * 4, y:edge.y });
  await until("document.querySelector('.nebula-panel.is-entries').dataset.span==='8'");
  await pause(200); await screenshot('nebula-grid-width.png');
  // In a row of two the neighbour follows at once: the data window two columns wider, the board two narrower.
  const dataEdge = await evaluate("(() => { const r=document.querySelector('.nebula-panel.is-data .nebula-panel-width').getBoundingClientRect(), g=document.querySelector('.nebula-grid').getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+20, column:(g.width-18*11)/12+18 }; })()");
  await pull(dataEdge, { x:dataEdge.x + dataEdge.column * 2, y:dataEdge.y });
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.nebula-panel.is-board')).getPropertyValue('--span').trim()"), '4', 'The neighbour narrows while the edge is dragged.');
  await release({ x:dataEdge.x + dataEdge.column * 2, y:dataEdge.y });
  await until("document.querySelector('.nebula-panel.is-data').dataset.span==='8' && document.querySelector('.nebula-panel.is-board').dataset.span==='4'");
  assert(await evaluate("(() => { const a=document.querySelector('.nebula-panel.is-data').getBoundingClientRect(), b=document.querySelector('.nebula-panel.is-board').getBoundingClientRect(); return Math.abs(a.top-b.top)<2; })()"), 'Still one row.');
  // The column on the right: with the month open the poster stays while the desk scrolls (the month right below it);
  // with the day open the poster scrolls away and the day grows into its room.
  const posterTop = () => evaluate("document.querySelector('.nebula-poster').getBoundingClientRect().top");
  await evaluate("document.querySelector('.nebula-cal-panel [data-cal-view=month]').click()");
  await until("Boolean(document.querySelector('.nebula-cal-panel.is-month'))");
  await evaluate("document.querySelector('.nebula-desk').scrollTop=0"); await pause(200);
  const restingTop = await posterTop();
  await evaluate("document.querySelector('.nebula-desk').scrollTop=600"); await pause(300);
  assert(Math.abs(await posterTop() - restingTop) < 2, 'Month: the poster stays.');
  assert(await evaluate("(() => { const p=document.querySelector('.nebula-poster').getBoundingClientRect(), c=document.querySelector('.nebula-cal-panel').getBoundingClientRect(); return c.top >= p.bottom && c.top - p.bottom < 30; })()"), 'Month: right below the poster.');
  await screenshot('nebula-side-month.png');
  await evaluate("document.querySelector('.nebula-cal-panel [data-cal-view=day]').click()");
  await until("Boolean(document.querySelector('.nebula-cal-panel.is-day'))"); await pause(300);
  assert(await posterTop() < restingTop - 100, 'Day: the poster scrolls away.');
  await evaluate("document.querySelector('.nebula-cal-panel [data-cal-view=month]').click()");
  await evaluate("document.querySelector('.nebula-desk').scrollTop=0");
  // Minimized beside an open window: the data window stands upright as a narrow bar, the board takes its columns; restored,
  // both have their widths again.
  await pause(200);
  await evaluate("document.querySelector('.nebula-panel.is-data .nebula-panel-minimize').click()");
  await until("document.querySelector('.nebula-panel.is-data').classList.contains('is-upright') && Boolean(document.querySelector('.nebula-panel.is-data .nebula-panel-state')) && document.querySelector('.nebula-panel.is-board').dataset.span==='11'");
  assert(await evaluate("(() => { const d=document.querySelector('.nebula-panel.is-data').getBoundingClientRect(), b=document.querySelector('.nebula-panel.is-board').getBoundingClientRect(); return d.width < 40 && b.left - d.right < 26 && Math.abs(d.top-b.top) < 2 && Math.abs(d.height-b.height) < 2 && b.left > d.right; })()"), 'An upright bar, as thick as a flat one, as tall as its neighbour and close beside it.');
  await evaluate("document.querySelector('.nebula-panel.is-data').scrollIntoView({block:'start'})"); await pause(250);
  await screenshot('nebula-grid-upright.png');
  await evaluate("document.querySelector('.nebula-panel.is-data .nebula-panel-minimize').click()");
  await until("!document.querySelector('.nebula-panel.is-data').classList.contains('is-upright') && document.querySelector('.nebula-panel.is-data').dataset.span==='8' && document.querySelector('.nebula-panel.is-board').dataset.span==='4'");
  // The board window's lower edge: the board inside grows with it while dragging and after.
  await evaluate("document.querySelector('.nebula-panel.is-board .nebula-panel-resize').scrollIntoView({block:'center'})"); await pause(200);
  const boardGrip = await evaluate("(() => { const r=document.querySelector('.nebula-panel.is-board .nebula-panel-resize').getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2, board:document.querySelector('.nebula-panel.is-board .board-viewport').clientHeight }; })()");
  await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:boardGrip.x, y:boardGrip.y });
  await command('Input.dispatchMouseEvent', { type:'mousePressed', x:boardGrip.x, y:boardGrip.y, button:'left', buttons:1, clickCount:1 });
  await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:boardGrip.x, y:boardGrip.y + 160, button:'left', buttons:1 }); await pause(150);
  const pulled = await evaluate("(() => { const b=document.querySelector('.nebula-panel.is-board .nebula-panel-body'), v=b.querySelector('.board-viewport'); return { body:b.className+' '+b.style.height+' '+b.clientHeight, board:v.clientHeight, at:document.elementFromPoint(" + boardGrip.x + "," + boardGrip.y + ")?.className }; })()");
  assert(pulled.board > boardGrip.board + 100, 'The board grows while its window is pulled taller: ' + JSON.stringify({ before: boardGrip, pulled }));
  await command('Input.dispatchMouseEvent', { type:'mouseReleased', x:boardGrip.x, y:boardGrip.y + 160, button:'left', buttons:0, clickCount:1 }); await pause(250);
  assert(await evaluate(`document.querySelector('.nebula-panel.is-board .board-viewport').clientHeight > ${boardGrip.board + 100}`), 'The board keeps the taller window.');
  await evaluate("document.querySelector('.nebula-panel.is-board .nebula-panel-resize').dispatchEvent(new MouseEvent('dblclick', { bubbles:true }))");
  await until("!document.querySelector('.nebula-panel.is-board .nebula-panel-body').classList.contains('has-height')");
  await evaluate("document.querySelector('.nebula-desk').scrollTop=0");
  // The day's own windows float too: the data window carried beside the grid floats there, ⊞ docks it again.
  const dataHead = await barOf('data');
  const beside = await evaluate("(() => { const r=document.querySelector('.nebula-poster').getBoundingClientRect(); return { x:r.left+30, y:r.top+40 }; })()");
  await pull(dataHead, beside); await release(beside);
  await until("Boolean(document.querySelector('section.nebula-floating.is-data .period-section')) && !document.querySelector('.nebula-grid > .nebula-panel.is-data')");
  await pause(300); await screenshot('nebula-floating-data.png');
  await evaluate("document.querySelector('section.nebula-floating.is-data .nebula-window-grid').click()");
  await until("Boolean(document.querySelector('.nebula-grid > .nebula-panel.is-data')) && !document.querySelector('section.nebula-floating')");
  // Out of the journal: the board carried past the window's edge becomes a window of its own (here: the command), and
  // comes back into the grid when that window closes.
  const boardHead = await barOf('board');
  const away = { x:(await evaluate('innerWidth')) + 40, y:boardHead.y };
  await pull(boardHead, { x:(await evaluate('innerWidth')) - 4, y:boardHead.y });
  await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:away.x,y:away.y,button:'left',buttons:1}); await pause(120);
  assert(await evaluate("Boolean(document.querySelector('.nebula-detach-hint'))"), 'A hint while the pointer is outside.');
  await release(away);
  await until("window.__uiTest.invoked.some(call => call[0]==='panel_detach' && call[1].kind==='board') && !document.querySelector('.nebula-grid > .nebula-panel.is-board')");
  await evaluate("window.__uiTest.emit('nebula:panel-closed','board')");
  await until("Boolean(document.querySelector('.nebula-grid > .nebula-panel.is-board'))");
  await evaluate("document.querySelector('.nebula-layout-reset')?.click()");
  await key('Escape'); await until("!document.querySelector('.nebula-calendar.is-open')");
  await command('Emulation.setDeviceMetricsOverride',{width:1180,height:780,deviceScaleFactor:1,mobile:false});
  // Back to the normal design: the pixel look chosen before returns with it; then off again.
  await key(',', 'Comma', 2);
  await until("Boolean(document.querySelector('[data-theme-choice=classic]'))");
  await evaluate("document.querySelector('[data-theme-choice=classic]').click()");
  await until("document.documentElement.dataset.theme==='classic' && document.documentElement.dataset.pixel!==undefined && !document.querySelector('[data-pixel-toggle]').disabled");
  await evaluate("document.querySelector('[data-pixel-toggle]').click()");
  await until("document.documentElement.dataset.pixel===undefined");
  assert.equal(await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--background').trim()"), '#000000');
  await key('Escape');
  await until("Boolean(document.querySelector('.sidebar')) && !document.querySelector('.nebula-desk')");
  assert.deepEqual(errors, []);
  console.log('Nebula checks passed: third design card, no pixel look (switch disabled, choice kept), fixed palette over the stored one, fonts, rail/terminals/poster layout, writing and Alt+D in the terminal, day turning and [ HEUTE ], view tabs and Ctrl+1–5, the calendar window (Ctrl+K, Esc, ×), tickets opening their day, widths 1380–560, reduced motion, the calendar window and switching back.');
}

async function checkCalendarStart() {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const atHour = hour => `(() => { const grid=document.querySelector('.cal-time'); return grid && Math.abs(grid.scrollTop/parseFloat(getComputedStyle(grid).getPropertyValue('--hour'))-${hour}) < .05; })()`;
  for (const [index, view] of ['workweek', 'week', 'day'].entries()) {
    await command('Emulation.setDeviceMetricsOverride', { width:1560, height:2160, deviceScaleFactor:1, mobile:false });
    const script = await command('Page.addScriptToEvaluateOnNewDocument', { source:`localStorage.setItem('journal.calendar', JSON.stringify({view:${JSON.stringify(view)},kinds:{event:true,task:true,note:false}}))` });
    try { await command('Page.navigate', { url:`${origin}/?window=calendar&start-test=${index}` }); }
    finally { await command('Page.removeScriptToEvaluateOnNewDocument', { identifier:script.identifier }); }
    await until(`document.readyState==='complete' && document.querySelector('.cal')?.dataset.view===${JSON.stringify(view)} && parseFloat(getComputedStyle(document.querySelector('.cal-time')).getPropertyValue('--hour'))>70`);
    await until(atHour(4));
    await screenshot(`calendar-start-${view}-tall.png`);
    // Resizing after a deliberate scroll must preserve the user's chosen hour.
    await evaluate("(() => { const grid=document.querySelector('.cal-time'); grid.scrollTop=2*parseFloat(getComputedStyle(grid).getPropertyValue('--hour')); })()");
    await command('Emulation.setDeviceMetricsOverride', { width:1560, height:900, deviceScaleFactor:1, mobile:false });
    await until(atHour(2));
    await evaluate("document.querySelector('.cal').focus()");
    await key('ArrowRight', 'ArrowRight');
    await until(atHour(4));
  }
  console.log('Calendar start checks passed: fresh tall day/week/workweek opens at 04:00, manual scrolling survives resizing, changing dates resets to 04:00.');
}
async function checkCalendars() {
  const origin = `http://127.0.0.1:${server.address().port}`;
  await command('Emulation.setDeviceMetricsOverride', { width:1180, height:780, deviceScaleFactor:1, mobile:false });
  // The journal saves by itself shortly after a change, and at once before showing another day.
  const headingNow = "document.querySelector('.document-header h1').textContent";
  await key('h', 'KeyH', 1);
  await until(`${headingNow} === ${longDate(await evaluate('window.__uiTest.date'))}`);
  await saveNow();
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
  await saveNow();
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
  await saveNow();
  await key('h', 'KeyH', 1);
  await until(`${headingNow} === ${longDate(await evaluate('window.__uiTest.date'))}`);
  // Editing one of them in the calendar asks before applying: only this one, or all (here no other on the same weekday).
  const seriesText = n => evaluate(`window.__uiTest.day(window.__uiTest.shift(${n})).entries.find(entry => entry.text.startsWith('Serie'))?.text`);
  const seriesItem = async n => `[...document.querySelectorAll('.sidebar .cal-month-day')].find(cell => cell.querySelector('.cal-month-number').getAttribute('aria-label').startsWith(${longDate(await evaluate(`window.__uiTest.shift(${n})`))}))?.querySelector('.cal-item')`;
  const editSeries = async (n, text) => {
    const item = await seriesItem(n);
    await until(`Boolean(${item})`);
    const at = await evaluate(`(() => { const r=(${item}).getBoundingClientRect(); return { x:r.left+Math.min(r.width/2, 20), y:r.top+r.height/2 }; })()`);
    await command('Input.dispatchMouseEvent', { type:'mousePressed', x:at.x, y:at.y, button:'right', buttons:2, clickCount:1 });
    await command('Input.dispatchMouseEvent', { type:'mouseReleased', x:at.x, y:at.y, button:'right', buttons:0, clickCount:1 });
    await until("document.querySelector('.cal-composer.is-editing.is-placed') && document.activeElement === document.querySelector('.cal-composer-text')");
    await command('Input.insertText', { text });
    await key('Enter', 'Enter');
    await until("Boolean(document.querySelector('.cal-composer .scope-choice.is-edit'))");
  };
  await evaluate("document.querySelector('.sidebar .cal').focus()");
  await key('m', 'KeyM');
  await editSeries(2, 'Serie hier');
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.cal-composer .scope-choice button')].map(button => button.textContent)"), ['Nur diesen', 'Alle 3'], 'The trace is left out.');
  assert.equal(await evaluate("document.activeElement === document.querySelector('.cal-composer .scope-choice-this')"), true, 'Enter keeps to this entry.');
  await pause(300);
  await screenshot('calendar-edit-scope.png');
  await key('Enter', 'Enter');
  await until(`!document.querySelector('.cal-composer') && window.__uiTest.day(window.__uiTest.shift(2)).entries.some(entry => entry.text === 'Serie hier')`);
  assert.deepEqual([await seriesText(1), await seriesText(3)], ['Serie', 'Serie'], 'Only this one changed.');
  await editSeries(3, 'Serie alle');
  await key('ArrowRight', 'ArrowRight');
  await key('Enter', 'Enter');
  await until(`[1, 3].every(n => window.__uiTest.day(window.__uiTest.shift(n)).entries.some(entry => entry.text === 'Serie alle')) && window.__uiTest.day(window.__uiTest.shift(2)).entries.some(entry => entry.text === 'Serie alle')`);

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
  await saveNow();
  await until(`[...document.querySelectorAll('.sidebar .cal-item-text')].some(item => item.textContent === 'Aus dem Kalender')`);
  await key('h', 'KeyH', 1);
  await until(`${heading} === ${longDate(sideToday)}`);
  // A click shows the details; from there the entry opens in the journal.
  await evaluate("[...document.querySelectorAll('.sidebar .cal-item')].find(item => item.textContent.includes('Aus dem Kalender')).click()");
  await until("Boolean(document.querySelector('.cal-details'))");
  await evaluate("[...document.querySelectorAll('.cal-details .tag-picker-foot button')].at(-1).click()");
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
  const gridHour = () => evaluate("parseFloat(getComputedStyle(document.querySelector('.sidebar .cal-time')).getPropertyValue('--hour'))");
  assert(Math.abs(await evaluate("document.querySelector('.sidebar .cal-time').scrollTop / parseFloat(getComputedStyle(document.querySelector('.sidebar .cal-time')).getPropertyValue('--hour'))") - 4) < .05, 'The time grid always opens at 04:00.');
  const at = minutes => evaluate(`(() => { const grid=document.querySelector('.sidebar .cal-time'), r=grid.querySelector('.cal-time-column').getBoundingClientRect(), hour=parseFloat(getComputedStyle(grid).getPropertyValue('--hour')); return { x:r.left+r.width/2, y:r.top+${minutes}/60*hour }; })()`);
  const markRange = async (from, ...through) => {
    const start = await at(from);
    await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:start.x, y:start.y });
    await command('Input.dispatchMouseEvent', { type:'mousePressed', x:start.x, y:start.y, button:'right', buttons:2, clickCount:1 });
    let point = start;
    for (const minutes of through) { point = await at(minutes); await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:point.x, y:point.y, button:'right', buttons:2 }); }
    return point;
  };
  const release = point => command('Input.dispatchMouseEvent', { type:'mouseReleased', x:point.x, y:point.y, button:'right', buttons:0, clickCount:1 });
  const selection = "document.querySelector('.sidebar .cal-selection-time')?.textContent";
  let point = await markRange(9 * 60 + 5, 9 * 60 + 40, 10 * 60 + 20);
  assert.equal(await evaluate(selection), '09:00 – 10:30', 'The range snaps to quarter hours while dragging.');
  assert.equal(await evaluate("document.querySelector('.cal-composer')"), null, 'The composer waits for the release.');
  await release(point);
  await until("document.querySelector('.cal-composer.is-placed') && document.activeElement === document.querySelector('.cal-composer-text')");
  assert.equal(await evaluate("(() => { const c=document.querySelector('.cal-composer').getBoundingClientRect(), s=document.querySelector('.sidebar .cal-selection').getBoundingClientRect(); return c.left >= 0 && c.right <= innerWidth && c.bottom <= innerHeight && (c.left >= s.right || c.right <= s.left || c.top >= s.bottom); })()"), true, 'Next to the range, inside the window.');
  assert.equal(await evaluate("document.querySelector('.cal-composer-length').textContent"), '1 h 30');
  assert.equal(await evaluate("(() => { const pill=document.querySelector('.cal-composer-when'), length=pill.querySelector('.cal-composer-length'); return pill.scrollWidth <= pill.clientWidth && pill.getBoundingClientRect().right - length.getBoundingClientRect().right >= 10; })()"), true, 'The time pill leaves breathing room after the duration.');
  // A marked range becomes a calendar entry unless chosen otherwise; that choice comes first.
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.cal-composer-kinds [role=radio]')].map(kind => [kind.getAttribute('aria-label'), kind.getAttribute('aria-checked')])").then(kinds => kinds[0]), ['Nur im Kalender', 'true']);
  await key('e', 'KeyE', 1);
  await until("document.querySelector('.cal-composer-kinds [role=radio][aria-checked=true]').getAttribute('aria-label') === 'Ereignis'");
  await command('Input.insertText', { text:'Zahnarzt-Test' });
  await evaluate("document.querySelector('.cal-composer-description').focus()");
  await command('Input.insertText', { text:'Raum 2' });
  await key('Enter', 'Enter');
  assert(await evaluate("Boolean(document.querySelector('.cal-composer'))"), 'Enter adds a line in the description without submitting.');
  await command('Input.insertText', { text:'Unterlagen mitbringen' });
  await evaluate("document.querySelector('.cal-composer-text').focus()");
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
  assert(await evaluate("window.__uiTest.day(window.__uiTest.date).entries.some(entry=>entry.text==='Zahnarzt-Test' && entry.description==='Raum 2\\nUnterlagen mitbringen')"), 'The description is saved separately from the title.');
  await until("[...document.querySelectorAll('.sidebar .cal-item.is-block')].some(block => block.textContent.includes('Zahnarzt-Test'))");
  assert.equal(await evaluate("Math.round([...document.querySelectorAll('.sidebar .cal-item.is-block')].find(block => block.textContent.includes('Zahnarzt-Test')).getBoundingClientRect().height)"), Math.round(75 / 60 * await gridHour() - 3), 'The block lasts as long as the range (75 min), using the current hour scale.');
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  // A mere click marks nothing, only dragging does; the edges resize a range; Escape discards.
  point = await markRange(14 * 60 + 10);
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  assert(await evaluate("!document.querySelector('.sidebar .cal-selection') && !document.querySelector('.cal-composer')"), 'Pressing without dragging shows no temporary selection.');
  await release(point);
  await pause(150);
  assert(await evaluate("!document.querySelector('.sidebar .cal-selection') && !document.querySelector('.cal-composer')"), 'A click into the hours creates nothing.');
  point = await markRange(14 * 60 + 5, 14 * 60 + 30, 14 * 60 + 55);
  await release(point);
  await until(`${selection} === '14:00 – 15:00' && Boolean(document.querySelector('.cal-composer.is-placed'))`);
  const edge = await evaluate("(() => { const r=document.querySelector('.sidebar .cal-selection-edge.is-end').getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; })()");
  await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:edge.x, y:edge.y });
  await command('Input.dispatchMouseEvent', { type:'mousePressed', x:edge.x, y:edge.y, button:'left', buttons:1, clickCount:1 });
  const resizeDistance = await gridHour() * .75;
  await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:edge.x, y:edge.y + resizeDistance, button:'left', buttons:1 });
  await command('Input.dispatchMouseEvent', { type:'mouseReleased', x:edge.x, y:edge.y + resizeDistance, button:'left', buttons:0, clickCount:1 });
  await until(`${selection} === '14:00 – 15:45'`);
  await until("Boolean(document.querySelector('.cal-composer.is-placed'))");
  await evaluate("document.querySelector('.cal-composer-text').focus()");
  await key('Enter', 'Enter');
  await until("document.querySelector('.cal-composer-text').classList.contains('is-shaking')");
  assert.equal(await evaluate('window.__uiTest.saves'), savesBeforeCreate + 1, 'Nothing is created without text.');
  await key('Escape');
  await until(`!document.querySelector('.cal-composer') && !document.querySelector('.sidebar .cal-selection')`);
  // A click into the band on top makes an entry for the whole day, without a time.
  const allDay = await evaluate("(() => { const r=document.querySelector('.sidebar .cal-time-allday-cell').getBoundingClientRect(); return { x:r.right-8, y:r.top+r.height/2 }; })()");
  await command('Input.dispatchMouseEvent', { type:'mouseMoved', ...allDay });
  await command('Input.dispatchMouseEvent', { type:'mousePressed', ...allDay, button:'right', buttons:2, clickCount:1 });
  await command('Input.dispatchMouseEvent', { type:'mouseReleased', ...allDay, button:'right', buttons:0, clickCount:1 });
  await until("document.querySelector('.cal-composer.is-placed') && document.querySelector('.cal-composer-untimed')?.textContent==='ohne Uhrzeit' && document.activeElement === document.querySelector('.cal-composer-text')");
  assert(await evaluate("document.querySelector('.sidebar .cal-time-allday-cell').classList.contains('is-composing') && !document.querySelector('.sidebar .cal-selection')"));
  await command('Input.insertText', { text:'Ganzer Tag' });
  await pause(100); await screenshot('calendar-allday.png');
  await key('Enter', 'Enter');
  await until("!document.querySelector('.cal-composer') && window.__uiTest.day(window.__uiTest.date).entries.some(entry => entry.text === 'Ganzer Tag' && !entry.time && !entry.end)");
  await until("[...document.querySelectorAll('.sidebar .cal-time-allday-cell .cal-item')].some(item => item.textContent.includes('Ganzer Tag'))");
  // Dragging into the bottom edge scrolls the hours along.
  const scrolled = await evaluate("document.querySelector('.sidebar .cal-time').scrollTop");
  const scrollRoom = await evaluate("(() => { const grid=document.querySelector('.sidebar .cal-time'); return grid.scrollHeight-grid.clientHeight-grid.scrollTop; })()");
  const bottom = await evaluate("(() => { const r=document.querySelector('.sidebar .cal-time').getBoundingClientRect(); return r.bottom - 6; })()");
  const startDrag = await markRange(16 * 60);
  await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:startDrag.x, y:bottom, button:'right', buttons:2 });
  if (scrollRoom > 1) await until(`document.querySelector('.sidebar .cal-time').scrollTop > ${scrolled + Math.min(40, scrollRoom / 2)}`);
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
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  point = await markRange(60 + 5, 60 + 35);
  await release(point);
  await until("document.activeElement === document.querySelector('.cal-composer-text')");
  await evaluate("document.querySelector('.cal-composer [aria-label^=\"Aufgabe\"]').click()");
  await evaluate("document.querySelector('.cal-composer-text').focus()");
  await command('Input.insertText', { text:'Früh los' });
  // The card repeats too (↻ or Alt W): the planner's repeat view opens under it; "Jahr" makes it yearly.
  await key('w', 'KeyW', 1);
  await until("document.activeElement === document.querySelector('.cal-composer .repeat')");
  // Written in the card, another weekday stays (the card's day is the first occurrence, the rule keeps Wednesday).
  const otherDay = await evaluate("['Montag', 'Mittwoch'][new Date(window.__uiTest.shift(1) + 'T12:00').getDay() === 3 ? 0 : 1]");
  await evaluate("document.querySelector('.cal-composer .repeat-write').focus()");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await evaluate("document.querySelector('.cal-composer .repeat-write').select()");
  await command('Input.insertText', { text:`Wöchentlich am ${otherDay}` });
  await key('Enter', 'Enter');
  await until(`document.querySelector('.cal-composer .repeat-write').value === 'Wöchentlich am ${otherDay.slice(0, 2)}'`);
  await evaluate("[...document.querySelectorAll('.cal-composer .repeat-units button')].find(button => button.textContent === 'Jahr').click()");
  await until("/^Jährlich am /.test(document.querySelector('.cal-composer .repeat-write').value) && document.querySelector('.cal-composer-repeat').getAttribute('aria-pressed') === 'true'");
  assert(await evaluate("(() => { const card=document.querySelector('.cal-composer').getBoundingClientRect(); return [...document.querySelectorAll('.cal-composer .repeat *')].every(item => { const r=item.getBoundingClientRect(); return r.width === 0 || (r.right <= card.right && r.bottom <= card.bottom); }); })()"), 'The repeat view fits the card.');
  // The end date is picked in a small month that fits the card as well.
  await pause(350);
  const composerBack = await evaluate("(() => { const r=document.querySelector('.cal-composer .clock-back').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; })()");
  await evaluate("[...document.querySelectorAll('.cal-composer .repeat-segments button')].find(button => button.textContent === 'Datum').click()");
  await until("Boolean(document.querySelector('.cal-composer-end .cal-compact-day'))");
  assert(await evaluate("(() => { const card=document.querySelector('.cal-composer').getBoundingClientRect(); return [...document.querySelectorAll('.cal-composer-end *')].every(item => { const r=item.getBoundingClientRect(); return r.width === 0 || (r.right <= card.right && r.bottom <= card.bottom); }); })()"), 'The end month fits the card.');
  await pause(300);
  assert.deepEqual(await evaluate("(() => { const r=document.querySelector('.cal-composer-end .clock-back').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; })()"), composerBack, 'The end picker keeps the back button exactly where it was in the repeat menu.');
  await screenshot('composer-end.png');
  await evaluate("[...document.querySelectorAll('.cal-composer-end .cal-compact-day:not(.is-outside)')].at(-1).click()");
  await until("document.querySelector('.cal-composer .repeat-segments .is-date')?.textContent.startsWith('bis ')");
  await evaluate("[...document.querySelectorAll('.cal-composer .repeat-segments button')].find(button => button.textContent === 'Nie').click()");
  await pause(350);
  await screenshot('composer-repeat.png');
  await key('Enter', 'Enter');
  await until(`(window.__uiTest.day('${nextDay}')?.entries ?? []).some(entry => entry.text === 'Früh los')`);
  const nextYear = `${Number(nextDay.slice(0, 4)) + 1}${nextDay.slice(4)}`;
  assert.equal(await evaluate(`Boolean(window.__uiTest.day('${nextDay}').entries.find(entry => entry.text === 'Früh los').seriesId) && (window.__uiTest.day('${nextYear}')?.entries ?? []).some(entry => entry.text === 'Früh los')`), true, 'A yearly series made in the calendar recurs a year later.');
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
  // Past midnight: the end goes on into the next day (Shift+↓ in the card, or dragging on at the bottom), saved as one
  // entry ending at 26:00 (02:00 the next morning), drawn on both days.
  {
    await evaluate(`${side()}.focus()`); await key('t', 'KeyT');
    await until(`${side()}.dataset.view === 'day'`);
    await evaluate("document.querySelector('.sidebar .cal-time').scrollTop = 1e6");
    await pause(150);
    // Marked a little above the bottom edge (dragging into it would run on into the next day), then moved by keys.
    const late = await at(22 * 60 + 5);
    await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:late.x, y:late.y });
    await command('Input.dispatchMouseEvent', { type:'mousePressed', x:late.x, y:late.y, button:'right', buttons:2, clickCount:1 });
    await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:late.x + 8, y:late.y, button:'right', buttons:2 });
    await release({ x:late.x + 8, y:late.y });
    await until("document.querySelector('.cal-composer.is-placed') && document.activeElement === document.querySelector('.cal-composer-text')");
    await command('Input.insertText', { text:'Nachtschicht' });
    for (let step = 0; step < 4; step++) await key('ArrowDown', 'ArrowDown');
    for (let step = 0; step < 11; step++) await key('ArrowDown', 'ArrowDown', 8);
    await until("document.querySelector('.sidebar .cal-selection.is-night-start') && /02:00⁺¹/.test(document.querySelector('.cal-composer-when').textContent)");
    await key('Enter', 'Enter');
    await until(`!document.querySelector('.cal-composer') && window.__uiTest.day(window.__uiTest.date).entries.some(entry => entry.text === 'Nachtschicht' && entry.time === '23:00' && entry.end === '26:00')`);
    await evaluate(`${side()}.focus()`); await key('w', 'KeyW');
    await until(`${side()}.dataset.view === 'week' && Boolean(document.querySelector('.sidebar .cal-item.is-night-start')) && (window.__uiTest.date.slice(0, 10) === window.__uiTest.shift(0) && new Date(window.__uiTest.date + 'T12:00').getDay() === 0 || Boolean(document.querySelector('.sidebar .cal-item.is-night-rest')))`);
    assert.match(await evaluate("document.querySelector('.sidebar .cal-item.is-night-start').title"), /23:00 bis 26:00|23:00/, 'The block names its time.');
    await pause(300);
    await screenshot('calendar-overnight.png');
    await evaluate(`${side()}.focus()`); await key('h', 'KeyH'); await key('t', 'KeyT');
    await until(`${side()}.dataset.view === 'day' && ${side('.cal-time-day')}?.title.startsWith(${longDate(sideToday)})`);
  }
  await rightClick(sideBlock('Zahnarzt-Test'));
  await until("document.querySelector('.cal-composer.is-editing.is-placed') && document.activeElement === document.querySelector('.cal-composer-text')");
  assert.equal(await evaluate("document.querySelector('.cal-composer-text').value"), 'Zahnarzt-Test');
  assert.equal(await evaluate("document.querySelector('.cal-composer-description').value"), 'Raum 2\nUnterlagen mitbringen');
  await evaluate("(() => { const input=document.querySelector('.cal-composer-description'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Raum 3\\nGeänderte Details'); input.dispatchEvent(new Event('input',{bubbles:true})); })()");
  assert.equal(await evaluate(selection), '09:15 – 10:30', 'The entry shows as its range.');
  assert.equal(await evaluate(`${sideBlock('Zahnarzt-Test')}.classList.contains('is-editing')`), true);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.cal-composer-kinds [role=radio]')].map(kind => kind.getAttribute('aria-label') + ':' + kind.getAttribute('aria-checked'))"), ['Nur im Kalender:false', 'Ereignis:true', 'Aufgabe:false'], 'A timed entry cannot become a note.');
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
  assert(await evaluate("window.__uiTest.day().entries.some(entry=>entry.text==='Zahnarzt verschoben' && entry.description==='Raum 3\\nGeänderte Details')"), 'Edited descriptions survive saving.');
  // In the month (another day), the card edits in place and can remove the entry.
  await key('m', 'KeyM');
  await until(`${side()}.dataset.view === 'month' && Boolean(${sideBlock('Früh los')})`);
  await rightClick(sideBlock('Früh los'));
  await until("document.querySelector('.cal-composer.is-editing.is-placed') && !document.querySelector('.cal-composer-time')");
  // The card selects its text once it settled; typing then goes to the end on purpose.
  await until("(() => { const t=document.querySelector('.cal-composer-text'); return document.activeElement === t && t.selectionStart === 0 && t.selectionEnd === t.value.length; })()");
  await evaluate("(() => { const t=document.querySelector('.cal-composer-text'); t.setSelectionRange(t.value.length, t.value.length); })()");
  await command('Input.insertText', { text:'!' });
  await key('Enter', 'Enter');
  // "Früh los" repeats, so the card asks how far the edit reaches; Enter keeps it to this one.
  await until("Boolean(document.querySelector('.cal-composer .scope-choice.is-edit')) && document.activeElement === document.querySelector('.cal-composer .scope-choice-this')");
  await key('Enter', 'Enter');
  await until(`window.__uiTest.day('${nextDay}').entries.some(entry => entry.text === 'Früh los!')`);
  assert.equal(await evaluate(heading), journalDay, 'Editing another day leaves the journal where it was.');
  await until(`Boolean(${sideBlock('Früh los!')})`);
  await rightClick(sideBlock('Früh los!'));
  await until("Boolean(document.querySelector('.cal-composer.is-editing .cal-composer-remove'))");
  await evaluate("document.querySelector('.cal-composer-remove').click()");
  // It repeats yearly, so removing asks how far: the first occurrence takes the following ones along.
  await until("Boolean(document.querySelector('.cal-composer .scope-choice'))");
  await evaluate("[...document.querySelectorAll('.cal-composer .scope-choice button')].find(button => button.textContent.includes('folgenden')).click()");
  await until(`!window.__uiTest.day('${nextDay}').entries.some(entry => entry.text.startsWith('Früh los')) && !(window.__uiTest.day('${nextYear}')?.entries ?? []).some(entry => entry.text.startsWith('Früh los'))`);

  // Calendar-only is an exclusive third kind choice, and choosing a task restores its daily-note entry.
  await evaluate(`${side()}.focus()`);
  await key('h', 'KeyH'); await key('t', 'KeyT');
  await until(`${side()}.dataset.view === 'day' && Boolean(${sideBlock('Zahnarzt verschoben')} )`);
  await rightClick(sideBlock('Zahnarzt verschoben'));
  await until("Boolean(document.querySelector('.cal-composer.is-editing.is-placed'))");
  assert.equal(await evaluate("document.querySelector('.cal-composer-kinds [aria-label=\"Aufgabe\"]').getAttribute('aria-checked')"), 'true');
  await evaluate("document.querySelector('.cal-composer-kinds [aria-label=\"Nur im Kalender\"]').click()");
  await screenshot('calendar-daily-toggle.png');
  await evaluate("document.querySelector('.cal-composer-create').click()");
  await until("!document.querySelector('.cal-composer') && ![...document.querySelectorAll('.entry')].some(row => row.textContent.includes('Zahnarzt verschoben'))");
  assert.equal(await evaluate("window.__uiTest.day().entries.find(entry => entry.text === 'Zahnarzt verschoben').showInJournal"), false);
  await until(`Boolean(${sideBlock('Zahnarzt verschoben')})`);
  await rightClick(sideBlock('Zahnarzt verschoben'));
  await until("Boolean(document.querySelector('.cal-composer-kinds [aria-label=\"Nur im Kalender\"][aria-checked=true]'))");
  await evaluate("document.querySelector('.cal-composer-kinds [aria-label=\"Aufgabe\"]').click()");
  await until("document.querySelector('.cal-composer-kinds [aria-label=\"Aufgabe\"]').getAttribute('aria-checked') === 'true'");
  await evaluate("document.querySelector('.cal-composer-create').click()");
  await until("!document.querySelector('.cal-composer') && [...document.querySelectorAll('.entry')].some(row => row.textContent.includes('Zahnarzt verschoben'))");

  // ICS uses native file dialogs in production; IPC mocks exercise file contents, preview and repeated import here.
  const transfer = "document.querySelector('.sidebar [aria-label=\"Kalender importieren oder exportieren\"]')";
  const transferButton = label => `[...document.querySelectorAll('.cal-transfer-panel button')].find(button => button.textContent.includes(${JSON.stringify(label)}))`;
  await evaluate(`${transfer}.click()`);
  await until("Boolean(document.querySelector('.cal-transfer-panel'))");
  await screenshot('calendar-transfer.png');
  await evaluate(`${transferButton('exportieren')}.click()`);
  await until("Boolean(window.__uiTest.icsOutput)");
  assert.equal(await evaluate("window.__uiTest.icsOutput.includes('BEGIN:VCALENDAR') && window.__uiTest.icsOutput.includes('Zahnarzt verschoben')"), true);
  await evaluate(`window.__uiTest.icsInput = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Test//EN','BEGIN:VEVENT','UID:ui-import','DTSTAMP:20261030T120000Z','DTSTART;VALUE=DATE:' + window.__uiTest.date.replaceAll('-', ''),'SUMMARY:ICS Import-Test','X-JOURNAL-SHOW-IN-JOURNAL:FALSE','END:VEVENT','END:VCALENDAR'].join(String.fromCharCode(13, 10))`);
  await evaluate(`${transferButton('Datei importieren')}.click()`);
  await until("Boolean(document.querySelector('.cal-transfer-confirm'))");
  await screenshot('calendar-import-preview.png');
  await evaluate("document.querySelector('.cal-transfer-confirm').click()");
  await until("window.__uiTest.day().entries.some(entry => entry.text === 'ICS Import-Test')");
  assert.equal(await evaluate("[...document.querySelectorAll('.entry')].some(row => row.textContent.includes('ICS Import-Test'))"), false);
  await until(`Boolean(${sideBlock('ICS Import-Test')})`);
  await evaluate(`${transferButton('Datei importieren')}.click()`);
  await until("Boolean(document.querySelector('.cal-transfer-confirm'))");
  await evaluate("document.querySelector('.cal-transfer-confirm').click()");
  await until("document.querySelector('.cal-transfer-panel [role=status]')?.textContent.includes('importiert')");
  assert.equal(await evaluate("window.__uiTest.day().entries.filter(entry => entry.calendarUid === 'ui-import').length"), 1);
  await key('Escape');
  await until("!document.querySelector('.cal-transfer-panel')");

  await evaluate(`${side()}.focus()`); await key('m', 'KeyM');
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
  await saveNow();
  const copyOf = `window.__uiTest.day(window.__uiTest.date).entries.find(entry => entry.text === 'Typwechsel')?.plan?.targets[0].id`;
  await until(`Boolean(${copyOf})`);
  const copyId = await evaluate(copyOf);
  await evaluate(`(() => { const text=${kindRow}.querySelector('.entry-text'); text.focus(); text.setSelectionRange(text.value.length, text.value.length); })()`);
  await command('Input.insertText', { text:' (neu)' });
  await key('E', 'KeyE', 9);
  await saveNow();
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
  // A click shows the entry's details in a card (the journal opens from the day number).
  await evaluate(`[...${cell(tomorrow)}.querySelectorAll('.cal-item')][1].click()`);
  await until("Boolean(document.querySelector('.popover.cal-details'))");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.popover.cal-details')).borderRadius"), await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--popup-radius').trim()"), 'The card is a popup like the others.');
  await key('Escape');
  await until("!document.querySelector('.popover.cal-details')");

  // The journal saving a day shows up at once.
  await evaluate(`window.__uiTest.store({ ...window.__uiTest.day('${today}'), entries:[...window.__uiTest.day('${today}').entries, { id:'30000000-0000-4000-8000-000000000001', kind:'event', text:'Spontan dazu', done:false, cancelled:false, priority:false, time:'20:00', reminder:false, plan:null }] })`);
  await until(`[...${cell(today)}.querySelectorAll('.cal-item-text')].some(item => item.textContent === 'Spontan dazu') || ${cell(today)}.querySelector('.cal-more')?.textContent !== undefined`);

  // Views by key: J M W A T and 1–5; the choice is remembered.
  await key('w', 'KeyW');
  await until("document.querySelector('.cal').dataset.view === 'week' && document.querySelectorAll('.cal-time-column').length === 7");
  assert.equal(await evaluate("document.querySelector('.cal-views [aria-selected=true]').getAttribute('aria-label')"), 'Woche');
  assert.equal(await evaluate("document.querySelectorAll('.cal-time-column.is-today .cal-now').length"), 1, 'Today shows the current time.');
  assert(await evaluate("document.querySelector('.cal-time').scrollTop") > 0, 'The hours start scrolled towards the morning at the current scale.');
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
  if (!await evaluate("[...document.querySelectorAll('.cal-item.is-block.is-event')].some(item=>item.textContent.includes('Telefonat'))")) await key('ArrowRight', 'ArrowRight');
  await until("[...document.querySelectorAll('.cal-item.is-block.is-event')].some(item=>item.textContent.includes('Telefonat'))");
  await evaluate("[...document.querySelectorAll('.cal-item.is-block.is-event')].find(item => item.textContent.includes('Telefonat')).scrollIntoView({ block:'center' })");
  await pause(350);
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
  assert.deepEqual(await evaluate(lastCall), ['show_day', { date:tomorrow, entry:null }]);
  assert.equal(await evaluate("document.querySelector('.cal').dataset.view"), 'year');
  await key('t', 'KeyT');
  await until("document.querySelector('.cal').dataset.view === 'day' && document.querySelectorAll('.cal-time-column').length === 1");
  const blocks = await evaluate("[...document.querySelectorAll('.cal-item.is-block')].map(block => { const r=block.getBoundingClientRect(); return { left:Math.round(r.left), width:Math.round(r.width) }; })");
  assert.equal(blocks.length, 2); assert(blocks[0].left < blocks[1].left && blocks[0].left + blocks[0].width > blocks[1].left && Math.abs(blocks[0].width - blocks[1].width) < 2, 'Overlapping cards are wide and staggered, not squeezed into equal slices.');
  assert.deepEqual(await texts('.cal-time-allday .cal-item'), ['Bericht abgeben']);
  await evaluate("document.querySelector('.cal-filter-note').click()");
  await until("[...document.querySelectorAll('.cal-time-allday .cal-item-text')].some(item => item.textContent === 'Gute Laune')");
  assert.equal(await evaluate("document.querySelector('.cal-day-notes').textContent.includes('Gute Laune')"), true);
  await pause(350);
  await screenshot('calendar-day.png');
  await evaluate(`(() => { const day=window.__uiTest.day('${tomorrow}'); day.entries.push({ id:'30000000-0000-4000-8000-000000000001', kind:'task', text:'Code review', done:false, cancelled:false, priority:true, time:'09:45', end:'11:00' }); return window.__uiTest.store(day); })()`);
  await until("document.querySelectorAll('.cal-item.is-block').length === 3");
  assert.equal(await evaluate("(() => { const column=document.querySelector('.cal-time-column').getBoundingClientRect(), cards=[...document.querySelectorAll('.cal-item.is-block')].map(card => card.getBoundingClientRect()); return cards.every(card => card.width >= column.width * .5 - 5 && card.left >= column.left && card.right <= column.right) && cards[0].right > cards[1].left && cards[1].right > cards[2].left; })()"), true, 'Three cards overlap by half while remaining inside their day.');
  await screenshot('calendar-overlapping.png');
  // Actual viewport resizing must resize the timeline, keep the date row compact and avoid dead space below it.
  for (const height of [460, 780, 1500, 2160]) {
    await command('Emulation.setDeviceMetricsOverride', { width:1120, height, deviceScaleFactor:1, mobile:false });
    await until("(() => { const grid=document.querySelector('.cal-time'), head=grid.querySelector('.cal-time-top'), hour=parseFloat(getComputedStyle(grid).getPropertyValue('--hour')); return Math.abs(hour - Math.max(36, Math.round((grid.clientHeight-head.offsetHeight)/20*4)/4)) < .3; })()");
    assert.equal(await evaluate("(() => { const grid=document.querySelector('.cal-time'), body=grid.querySelector('.cal-time-body'); grid.scrollTop=grid.scrollHeight; return body.getBoundingClientRect().bottom >= grid.getBoundingClientRect().bottom - 1 && grid.scrollHeight/grid.clientHeight < 2.8 && grid.querySelector('.cal-time-day').getBoundingClientRect().height <= 36; })()"), true, 'The grid fills the height with bounded scrolling and a compact date row.');
    if (height === 1500) await screenshot('calendar-tall.png');
  }
  await command('Emulation.setDeviceMetricsOverride', { width:1120, height:760, deviceScaleFactor:1, mobile:false });
  await evaluate("document.querySelector('.cal-open').click()");
  assert.deepEqual(await evaluate(lastCall), ['show_day', { date:tomorrow, entry:null }]);
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
  assert.deepEqual(await evaluate(lastCall), ['show_day', { date:today, entry:null }]);
  await evaluate("document.querySelector('.mini-pin').click()");
  await until("document.querySelector('.mini-pin').getAttribute('aria-pressed') === 'true'");
  assert.equal(await evaluate(`${lastCall}[0]`), 'plugin:window|set_always_on_top');
  const month = await evaluate("document.querySelector('.mini .cal-title').textContent");
  await key('PageDown', 'PageDown');
  await until(`document.querySelector('.mini .cal-title').textContent !== ${JSON.stringify(month)}`);

  // The popup outside the app: the same cards on a transparent page, the window sized to them; buttons answer the store.
  await command('Emulation.setDeviceMetricsOverride', { width:360, height:520, deviceScaleFactor:1, mobile:false });
  await command('Page.navigate', { url:`${origin}/?window=reminder` });
  await until("document.querySelectorAll('.reminder-popup .reminder').length === 3");
  assert.deepEqual(await evaluate("['html', 'body', '#root', '.reminder-popup'].map(selector => getComputedStyle(document.querySelector(selector)).backgroundColor)"), Array(4).fill('rgba(0, 0, 0, 0)'), 'The popup page is transparent around the cards.');
  assert.equal(await evaluate("document.querySelector('.reminder-popup .reminder-text').textContent"), 'Eine Runde durch den Park gehen');
  await until("window.__uiTest.invoked.some(([command, payload]) => command === 'fit_popup' && Math.abs(payload.height - document.querySelector('.reminder-popup').offsetHeight) < 1)");
  assert(await evaluate("document.querySelector('.reminder-popup').offsetWidth <= 360"), 'The cards fit the popup window.');
  await command('Emulation.setDefaultBackgroundColorOverride', { color:{ r:40, g:60, b:90, a:1 } });
  await pause(700);
  await screenshot('reminder-popup.png');
  await command('Emulation.setDefaultBackgroundColorOverride', {});
  await evaluate("document.querySelector('.reminder-popup .reminder-done').click()");
  await until("window.__uiTest.invoked.some(([command, payload]) => command === 'reminder_action' && payload.action === 'done' && payload.id.endsWith('0001'))");
  await evaluate("document.querySelector('.reminder-popup .reminder.is-info .reminder-quit').click()");
  await until("window.__uiTest.invoked.some(([command, payload]) => command === 'reminder_action' && payload.action === 'quit' && payload.id === 'background')");
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
  await evaluate('document.fonts.ready.then(() => true)');
  if (process.env.JOURNAL_UI_SCOPE === 'nebula-tickets') {
    await command('Emulation.setFocusEmulationEnabled',{enabled:true});
    await command('Emulation.setDeviceMetricsOverride',{width:1800,height:1000,deviceScaleFactor:1,mobile:false});
    await evaluate("localStorage.setItem('journal.settings',JSON.stringify({...JSON.parse(localStorage.getItem('journal.settings')||'{}'),theme:'nebula'}))");
    await command('Page.reload');await until("Boolean(document.querySelector('.nebula-desk')) && window.__uiTest.periodData?.definitions.every(d=>d.calendarTagId)");
    await evaluate(`(()=>{
      const day=window.__uiTest.shift(1), activity=window.__uiTest.periodData.definitions[0].calendarTagId;
      const item=(text,extra={})=>({id:crypto.randomUUID(),kind:'event',text,done:false,cancelled:false,priority:false,time:'15:00',end:'16:00',...extra});
      window.__uiTest.ticketDay=day;
      return window.__uiTest.store({date:day,title:'',body:'',revision:1,entries:[
        item('Calendar only',{showInJournal:false}),item('Activity time',{showInJournal:false,tag:activity}),
        item('Activity in journal',{showInJournal:true,tag:activity}),item('Task',{kind:'task'}),item('Note',{kind:'note'})
      ]});
    })()`);
    await pause(200);
    assert.equal(await evaluate("document.querySelectorAll('.nebula-ticket[data-ticket-date=\"'+window.__uiTest.ticketDay+'\"]').length"),0,'Ordinary calendar entries, activities, tasks and notes have no tickets.');
    await evaluate(`(()=>{const day=window.__uiTest.ticketDay, current=window.__uiTest.day(day);const item=(text,extra)=>({id:crypto.randomUUID(),kind:'event',text,done:false,cancelled:false,priority:false,time:null,showInJournal:false,...extra});current.entries.push(
      item('Event',{showInJournal:true,time:'18:00'}),item('Delivery',{tag:'f4c8191a-2d70-4b01-9d00-000000000001'}),
      item('Payment',{tag:'f4c8191a-2d70-4b01-9d00-000000000002'}),item('Mail appointment',{tag:'f4c8191a-2d70-4b01-9d00-000000000003'})
    );current.revision++;return window.__uiTest.store(current)})()`);
    await until("document.querySelectorAll('.nebula-ticket[data-ticket-date=\"'+window.__uiTest.ticketDay+'\"]').length===4");
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.nebula-ticket[data-ticket-date=\"'+window.__uiTest.ticketDay+'\"]')].map(e=>e.dataset.ticketKind).sort()"),['appointment','delivery','event','payment']);
    await screenshot('nebula-ticket-filter.png');assert.deepEqual(errors,[]);
    console.log('Nebula ticket filter passed: only visible events and all three mail categories; no ordinary calendar entries or activity time.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'startup-notices') {
    await command('Emulation.setFocusEmulationEnabled',{enabled:true});
    for (const [theme,pixel] of [['classic',false],['classic',true],['journal',false],['journal',true],['nebula',false]]) {
      await evaluate(`sessionStorage.setItem('test.updateAvailable','1');localStorage.setItem('journal.settings',JSON.stringify({...JSON.parse(localStorage.getItem('journal.settings')||'{}'),theme:${JSON.stringify(theme)},pixel:${pixel}}))`);
      await command('Page.reload');await until("Boolean(document.querySelector('[data-update-notice]'))");
      assert.equal(await evaluate("window.__uiTest.invoked.filter(([c])=>c==='plugin:updater|check').length"),1,'Exactly one background check runs on startup.');
      assert(!await evaluate("window.__uiTest.invoked.some(([c])=>c==='plugin:updater|download'||c==='plugin:updater|install')"),'Availability does not download or install anything.');
      await evaluate("window.__uiTest.emit('journal:mail-suggestions',{count:3,fresh:3})");await until("Boolean(document.querySelector('.mail-suggestions-notice'))");
      assert(await evaluate("(()=>{const a=document.querySelector('[data-update-notice]').getBoundingClientRect(),b=document.querySelector('.mail-suggestions-notice').getBoundingClientRect();return a.bottom<=b.top && a.left>=0 && b.bottom<=innerHeight && [...document.querySelectorAll('.app-notices button')].every(b=>b.scrollWidth<=b.clientWidth+1)})()"),'Both notices fit and do not overlap.');
      await screenshot(`startup-notices-${theme}${pixel?'-pixel':''}.png`);
      await pointerClick(await pointAt('[data-update-notice] > button'));
      await until("!document.querySelector('[data-update-notice]')");
      await evaluate("window.__uiTest.emit('journal:theme',{theme:'classic',pixel:false,popupStyle:'a'})");await pause(100);
      assert.equal(await evaluate("window.__uiTest.invoked.filter(([c])=>c==='plugin:updater|check').length"),1,'Appearance changes never restart the background check.');
      await pointerClick(await pointAt('.mail-suggestions-notice .notice-action'));
      await until("Boolean(document.querySelector('.mail-settings')) && !document.querySelector('.mail-suggestions-notice')");
      await key('Escape');await until("!document.querySelector('.settings')");
    }
    // The notice opens update settings, where a user can explicitly start the download.
    await command('Page.reload');await until("Boolean(document.querySelector('[data-update-notice]'))");
    await pointerClick(await pointAt('[data-update-notice] .notice-action'));
    await until("Boolean(document.querySelector('[data-update-download]'))");
    assert(!await evaluate("window.__uiTest.invoked.some(([c])=>c==='plugin:updater|download')"));
    await pointerClick(await pointAt('[data-update-download]'));await until("Boolean(document.querySelector('[data-update-install]'))");
    await key('Escape');await until("!document.querySelector('.settings')");
    await evaluate("sessionStorage.setItem('test.persistUpdateClaim','1');sessionStorage.removeItem('test.updateClaimed')");
    await command('Page.reload');await until("Boolean(document.querySelector('[data-update-notice]'))");
    await command('Page.reload');await until("document.querySelectorAll('.entry').length===5");
    assert.equal(await evaluate("window.__uiTest.invoked.filter(([c])=>c==='plugin:updater|check').length"),0,'A frontend reload keeps the native once-per-process check.');
    await evaluate("sessionStorage.removeItem('test.persistUpdateClaim');sessionStorage.removeItem('test.updateClaimed')");
    // A delayed startup reply must not replace a manually checked and downloaded update.
    await evaluate("sessionStorage.setItem('test.delayStartupCheck','1')");
    await command('Page.reload');await until("typeof window.__uiTest.finishStartupCheck==='function' && document.querySelectorAll('.entry').length===5");
    await evaluate("document.querySelector('.settings-button').click()");await until("Boolean(document.querySelector('#settings-updates-tab'))");
    await evaluate("document.querySelector('#settings-updates-tab').click()");await until("Boolean(document.querySelector('[data-update-check]'))");
    await pointerClick(await pointAt('[data-update-check]'));await until("Boolean(document.querySelector('[data-update-download]'))");
    await pointerClick(await pointAt('[data-update-download]'));await until("Boolean(document.querySelector('[data-update-install]'))");
    await evaluate("window.__uiTest.finishStartupCheck()");await until("Boolean(document.querySelector('[data-update-notice]'))");
    assert.equal(await evaluate("window.__uiTest.invoked.filter(([c])=>c==='plugin:updater|check').length"),2);
    assert(await evaluate("Boolean(document.querySelector('[data-update-install]'))"),'A late startup response preserves the downloaded installer.');
    await evaluate("sessionStorage.removeItem('test.delayStartupCheck')");
    await key('Escape');await until("!document.querySelector('.settings')");
    await evaluate("sessionStorage.removeItem('test.updateAvailable');sessionStorage.setItem('test.updateCheckError','1')");
    await command('Page.reload');await until("document.querySelectorAll('.entry').length===5 && window.__uiTest.invoked.some(([c])=>c==='plugin:updater|check')");
    assert(!await evaluate("Boolean(document.querySelector('[data-update-notice]'))"),'An offline startup remains silent and usable.');
    await evaluate("sessionStorage.removeItem('test.updateCheckError');sessionStorage.setItem('test.updateAvailable','1')");
    await command('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?window=calendar`});await until("Boolean(document.querySelector('.cal'))");
    assert.equal(await evaluate("window.__uiTest.invoked.filter(([c])=>c==='plugin:updater|check').length"),0,'Secondary windows never check for app updates.');
    assert.deepEqual(errors,[]);console.log('Startup notices passed: once per startup, themed notices, explicit download, offline startup and secondary-window isolation.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'mail-header-themes') {
    await command('Emulation.setFocusEmulationEnabled',{enabled:true});
    const sampleTitle='Bald ist Ihr DPD Paket da';
    const originalSubject='Ihre Sendung ist angekündigt – weitere Informationen zur Zustellung';
    const sender='DPD <noreply@service.dpd.example>';
    for(const [theme,pixel,style] of [['classic',false,'a'],['classic',false,'b'],['journal',false,'a'],['journal',false,'b'],['nebula',false,'a'],['nebula',false,'b'],['classic',true,'a'],['journal',true,'b']]){
      await command('Emulation.setDeviceMetricsOverride',{width:1180,height:780,deviceScaleFactor:1,mobile:false});
      await evaluate(`localStorage.setItem('journal.settings',JSON.stringify({...JSON.parse(localStorage.getItem('journal.settings')||'{}'),theme:${JSON.stringify(theme)},pixel:${pixel},popupStyle:${JSON.stringify(style)}}));localStorage.setItem('journal.calendarDrawer','1');localStorage.setItem('journal.notebookDrawer','0');localStorage.removeItem('journal.calendar')`);
      await command('Page.reload');await until("document.querySelectorAll('.entry').length===5 && Boolean(document.querySelector('.cal-item'))");
      await evaluate(`window.__TAURI_INTERNALS__.invoke('save_tags',{tags:[{id:'50000000-0000-4000-8000-000000000001',name:'Lieferung',color:'#209657'}]})`);
      const setMail=async subject=>evaluate(`(()=>{const d=window.__uiTest.day();Object.assign(d.entries[2],{text:${JSON.stringify(sampleTitle)},tag:'50000000-0000-4000-8000-000000000001',time:'00:00',end:'47:59',description:'journal-mail:v1\\n'+JSON.stringify({subject:${JSON.stringify(subject)},sender:${JSON.stringify(sender)},text:'Ihre Sendung stellen wir in 1–2 Werktagen zu.',html:'<h1 style="color:red">Guten Tag</h1><p>Ihre Sendung stellen wir in 1–2 Werktagen zu.</p>',notes:'Sendungsdetails aus dem Anhang.'})});window.__uiTest.store(d);})()`);
      const openMail=async()=>{await evaluate("document.querySelector('.cal-item[data-calendar-entry=\"10000000-0000-4000-8000-000000000003\"]').click()");await until("Boolean(document.querySelector('.cal-details .mail-content-head')) && Number(getComputedStyle(document.querySelector('.cal-details')).opacity)>.95");};
      await setMail(sampleTitle);await pause(100);await openMail();
      assert.equal(await evaluate("document.querySelector('.cal-details-head strong').textContent"),sampleTitle);
      assert.equal(await evaluate("Boolean(document.querySelector('.mail-content-subject-row'))"),false,'An identical mail subject is shown once in the entry heading.');
      assert.equal(await evaluate("document.querySelector('.mail-content-sender-value').textContent"),sender);
      assert.equal(await evaluate("document.querySelector('.cal-details-tag').textContent"),'Lieferung');
      assert(await evaluate("document.querySelector('.cal-details-time').textContent.includes('00:00') && document.querySelector('.cal-details-time').textContent.includes('23:59')"));
      const geometry=()=>evaluate(`(()=>{const head=document.querySelector('.mail-content-head'),b=head.getBoundingClientRect(),sender=head.querySelector('.mail-content-sender').getBoundingClientRect(),button=head.querySelector('.mail-content-remote').getBoundingClientRect(),p=document.querySelector('.cal-details').getBoundingClientRect(),actions=document.querySelector('.cal-details-actions').getBoundingClientRect();return {overflow:head.scrollWidth>head.clientWidth+1,overlap:sender.left<button.right&&sender.right>button.left&&sender.top<button.bottom&&sender.bottom>button.top,inside:button.left>=b.left&&button.right<=b.right&&button.top>=b.top&&button.bottom<=b.bottom,popup:p.bottom<=innerHeight&&p.left>=0&&p.right<=innerWidth,footer:actions.bottom<=innerHeight};})()`);
      for(const width of [1180,420]){
        await command('Emulation.setDeviceMetricsOverride',{width,height:780,deviceScaleFactor:1,mobile:false});await pause(130);
        const g=await geometry();assert(!g.overflow&&!g.overlap&&g.inside&&g.popup&&g.footer,`${theme}/${style}/pixel=${pixel}/${width}: ${JSON.stringify(g)}`);
      }
      await command('Emulation.setDeviceMetricsOverride',{width:1180,height:780,deviceScaleFactor:1,mobile:false});await pause(100);
      await evaluate("document.querySelector('.mail-content-remote').click()");
      await until("document.querySelector('.mail-content-remote').getAttribute('aria-pressed')==='true'");
      assert(await evaluate("document.querySelector('.mail-content iframe').srcdoc.includes('color:red')"),'Original inline mail styles remain present.');
      await pause(350);
      await screenshot(`mail-head-${theme}-${style}${pixel?'-pixel':''}.png`);
      await key('Escape');await until("!document.querySelector('.cal-details')");
      await setMail(originalSubject);await pause(100);await openMail();
      assert.equal(await evaluate("document.querySelector('.mail-content-subject').textContent"),originalSubject,'A different original subject remains visible.');
      assert.equal(await evaluate("document.querySelector('.mail-content-notes pre').textContent"),'Sendungsdetails aus dem Anhang.');
      const g=await geometry();assert(!g.overflow&&!g.overlap&&g.footer,`Separate subject: ${theme}/${style}: ${JSON.stringify(g)}`);
      await key('Escape');await until("!document.querySelector('.cal-details')");
      if(theme==='classic' && style==='a'){
        await setMail('');await pause(100);await openMail();
        assert.equal(await evaluate("Boolean(document.querySelector('.mail-content-subject-row'))"),false,'An absent original subject leaves no empty labelled row.');
        await key('Escape');await until("!document.querySelector('.cal-details')");
      }
      console.log(`Mail header passed: ${theme}/${style}, pixel=${pixel}`);
    }
    assert.deepEqual(errors,[]);
  } else if (process.env.JOURNAL_UI_SCOPE === 'activity-sizes') {
    for(const [theme,pixel] of [['classic',false],['classic',true],['journal',false],['nebula',false]]){
      await evaluate(`localStorage.setItem('test.activitySizes','1');localStorage.setItem('journal.settings',JSON.stringify({...JSON.parse(localStorage.getItem('journal.settings')||'{}'),theme:${JSON.stringify(theme)},pixel:${pixel}}));localStorage.setItem('journal.calendarDrawer','0');localStorage.setItem('journal.notebookDrawer','0')`);
      await command('Page.reload');await until("document.querySelectorAll('.entry').length===5");
      for(const [mode,number] of [['week',2],['month',3],['quarter',4],['year',5]]){
        await key(String(number),'Digit'+number,2);await until("document.querySelectorAll('.activity-summary-card').length===3");await pause(100);
        const sizes=await evaluate(`(()=>{
          const cards=[...document.querySelectorAll('.activity-summary-card')];
          return cards.map(card=>{
            const r=card.getBoundingClientRect(),chart=card.querySelector('.heatmap-grid,.activity-timeline').getBoundingClientRect(),count=card.querySelector('.activity-metrics > span').getBoundingClientRect();
            return {height:r.height,width:r.width,chartTop:chart.top-r.top,countTop:count.top-r.top};
          });
        })()`);
        for(const size of sizes){assert(Math.abs(size.height-sizes[1].height)<1,`${theme}/${mode}: timed and untimed card heights: ${JSON.stringify(sizes)}`);assert(Math.abs(size.chartTop-sizes[1].chartTop)<1,`${theme}/${mode}: charts align`);assert(Math.abs(size.countTop-sizes[1].countTop)<1,`${theme}/${mode}: day counts align`);}
      }
      console.log(`Activity card sizes passed: ${theme}, pixel=${pixel}`);
    }
    assert.deepEqual(errors,[]);
  } else if (process.env.JOURNAL_UI_SCOPE === 'popup-dismissal') {
    await command('Emulation.setDeviceMetricsOverride',{width:1540,height:1000,deviceScaleFactor:1,mobile:false});
    const pointerClick=async(point,button='left')=>{
      await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
      await command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button,buttons:button==='right'?2:1,clickCount:1});
      await command('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button,buttons:0,clickCount:1});
      await pause(80);
    };
    const pointAt=async(selector)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    const outsideDay=async()=>evaluate(`(()=>{
      const boxes=[...document.querySelectorAll('.popover,.cal-composer,.mini-picker-panel,.cal-transfer-panel,.ctx-menu,.format-menu,.entry-dock-shell.is-open .entry-dock')].map(e=>e.getBoundingClientRect());
      for(const e of document.querySelectorAll('.cal-month-day')){
        if(e.dataset.date===window.__uiTest.date)continue;
        const r=e.getBoundingClientRect();
        for(const [dx,dy] of [[.5,.7],[.2,.5],[.8,.2]]){
          const x=r.left+r.width*dx,y=r.top+r.height*dy;
          if(x<2||y<2||x>=innerWidth-2||y>=innerHeight-2||boxes.some(p=>x>=p.left&&x<=p.right&&y>=p.top&&y<=p.bottom))continue;
          if(document.elementFromPoint(x,y)?.closest('.cal-month-day')===e)return {x,y};
        }
      }
      throw new Error('No visible month day outside popup');
    })()`);
    for(const [theme,pixel,popupStyle] of [['classic',false,'a'],['classic',true,'b'],['journal',false,'a'],['journal',true,'b'],['nebula',false,'a'],['nebula',false,'b']]){
      await evaluate(`localStorage.setItem('journal.settings',JSON.stringify({...JSON.parse(localStorage.getItem('journal.settings')||'{}'),theme:${JSON.stringify(theme)},pixel:${pixel},popupStyle:${JSON.stringify(popupStyle)}}));localStorage.setItem('journal.calendarDrawer','1');localStorage.setItem('journal.notebookDrawer','0');localStorage.removeItem('journal.calendar')`);
      await command('Page.reload');await until("document.querySelectorAll('.entry').length===5 && Boolean(document.querySelector('.cal-month-day'))");
      if(theme==='classic'){
        await pointerClick(await pointAt('.entry .entry-symbol'));await until("Boolean(document.querySelector('.entry-dock-shell.is-open'))");
        await pointerClick(await outsideDay());await until("!document.querySelector('.entry-dock-shell.is-open')");
        assert(await evaluate("document.querySelectorAll('.entry').length===5 && Boolean(document.querySelector('.cal-month-day'))"),'Floating entry actions also consume their dismissing click.');
      }
      await evaluate(`(()=>{const d=window.__uiTest.day();d.entries[2].description='journal-mail:v1\\n'+JSON.stringify({subject:'Lieferung',sender:'demo@example.org',text:'Heute zwischen 10 und 12 Uhr',html:'<h1>Lieferung</h1><p>Heute zwischen 10 und 12 Uhr</p>'});window.__uiTest.store(d);})()`);
      const mailSelector='.cal-item[data-calendar-entry="10000000-0000-4000-8000-000000000003"]';
      await until(`Boolean(document.querySelector(${JSON.stringify(mailSelector)}))`);
      const originalEntries=await evaluate("[...document.querySelectorAll('.entry')].map(e=>e.dataset.entryId)");
      await pointerClick(await pointAt(mailSelector));await until("Boolean(document.querySelector('.cal-details .mail-content'))");
      if(theme==='nebula'){
        await pointerClick(await pointAt('.cal-details .chrome-close'));
        await until("!document.querySelector('.cal-details')");await pause(150);
        assert(!await evaluate("Boolean(document.querySelector('.cal-details'))"),'Header X stays closed and does not reopen its owning entry.');
        await pointerClick(await pointAt(mailSelector));await until("Boolean(document.querySelector('.cal-details .mail-content'))");
      }
      const dayPoint=await outsideDay();
      await pointerClick(dayPoint);await until("!document.querySelector('.cal-details')");
      assert.deepEqual(await evaluate("[...document.querySelectorAll('.entry')].map(e=>e.dataset.entryId)"),originalEntries,'Dismiss click does not navigate to the day behind the mail.');
      assert(await evaluate("Boolean(document.querySelector('.cal-month-day')) && !document.querySelector('.cal-composer')"),'Only the popup closes; calendar stays open.');
      await pointerClick(dayPoint);
      await until("!document.querySelector('.entry[data-entry-id=\"10000000-0000-4000-8000-000000000001\"]')");
      console.log(`Popup dismissal passed: ${theme}, pixel=${pixel}, style=${popupStyle}`);
    }
    await evaluate("localStorage.setItem('journal.calendarDrawer','1')");
    await command('Page.reload');await until("document.querySelectorAll('.entry').length===5 && Boolean(document.querySelector('.cal-month-day'))");
    const entrySelector='.cal-item[data-calendar-entry="10000000-0000-4000-8000-000000000003"]';
    await pointerClick(await pointAt(entrySelector),'right');await until("Boolean(document.querySelector('.cal-composer.is-placed'))");
    await pointerClick(await pointAt('.cal-composer-tag'));await until("Boolean(document.querySelector('.popover.tag-picker'))");
    const target=await outsideDay();
    await pointerClick(target);await until("!document.querySelector('.popover.tag-picker')");
    assert(await evaluate("Boolean(document.querySelector('.cal-composer')) && document.querySelectorAll('.entry').length===5"),'Outside press closes the nested tag popup only.');
    await pointerClick(target);await until("!document.querySelector('.cal-composer')");
    assert(await evaluate("Boolean(document.querySelector('.cal-month-day')) && document.querySelectorAll('.entry').length===5"),'Second press dismisses the editor without calendar navigation.');
    await pointerClick(await pointAt('.mini-calendar-picker > button'));await until("Boolean(document.querySelector('.mini-picker-panel'))");
    await pointerClick(await outsideDay());await until("!document.querySelector('.mini-picker-panel')");
    assert(await evaluate("Boolean(document.querySelector('.cal-month-day')) && document.querySelectorAll('.entry').length===5"),'Mini calendar dismiss does not activate the month day underneath.');
    console.log('Nested popup, calendar editor and mini calendar dismissal passed.');
    assert.deepEqual(errors,[]);
  } else if (process.env.JOURNAL_UI_SCOPE === 'vault-updates') {
    for (const [theme,pixel] of [['classic',false],['classic',true],['nebula',false]]) {
      await evaluate(`localStorage.setItem('journal.settings',JSON.stringify({...JSON.parse(localStorage.getItem('journal.settings')||'{}'),theme:${JSON.stringify(theme)},pixel:${pixel}}))`);
      await command('Page.reload');await until("document.querySelectorAll('.entry').length===5");
      await evaluate("document.querySelector('.settings-button').click()");await until("Boolean(document.querySelector('#settings-storage-tab'))");
      await evaluate("document.querySelector('#settings-storage-tab').click()");await until("document.querySelector('[data-vault-path]')?.textContent.includes('Journal-A')");
      assert(await evaluate("[...document.querySelectorAll('.system-actions button')].every(b=>b.scrollWidth<=b.clientWidth+2)"),'Vault buttons fit their labels.');
      await evaluate("window.__uiTest.vaultChoice={path:'C:/Test/Journal-B'};document.querySelector('[data-vault-copy]').click()");
      await until("Boolean(document.querySelector('[data-vault-confirm]'))");
      assert(!await evaluate("window.__uiTest.invoked.some(([c])=>c==='vault_activate')"),'Folder choice alone does not switch vaults.');
      await evaluate("document.querySelector('.system-confirm .system-actions button:last-child').click();document.querySelector('#settings-updates-tab').click()");
      await until("Boolean(document.querySelector('[data-update-check]'))");
      await evaluate("document.querySelector('[data-update-check]').click()");
      await until("document.querySelector('#settings-updates [role=status]')?.textContent.includes('aktuelle Version')");
      await evaluate("window.__uiTest.updateAvailable=true;document.querySelector('[data-update-check]').click()");
      await until("document.querySelector('[data-update-version]')?.textContent.includes('0.1.1')");
      await evaluate("document.querySelector('[data-update-download]').click()");await until("Boolean(document.querySelector('[data-update-install]'))");
      await evaluate("document.querySelector('[data-update-install]').click()");
      await until("window.__uiTest.invoked.some(([c])=>c==='plugin:updater|install')");
      assert(await evaluate("(()=>{const c=window.__uiTest.invoked.map(([c])=>c);return c.lastIndexOf('vault_save_preferences')<c.lastIndexOf('plugin:updater|install')&&c.includes('vault_save_preferences')})()"),'Vault browser state is saved before installation.');
      await until("document.querySelector('#settings-storage-tab').closest('[role=tablist]').inert===false");
      await evaluate("document.querySelector('#settings-storage-tab').click()");await until("Boolean(document.querySelector('[data-vault-copy]'))");
      await evaluate("document.querySelector('[data-vault-copy]').click()");await until("Boolean(document.querySelector('[data-vault-confirm]'))");
      await evaluate("document.querySelector('[data-vault-confirm]').click()");
      await until("window.__uiTest.invoked.some(([c])=>c==='vault_activate')");
      assert.deepEqual(await evaluate("window.__uiTest.invoked.find(([c])=>c==='vault_activate')[1]"),{path:'C:/Test/Journal-B',mode:'copy'});
    }
    assert.deepEqual(errors,[]);console.log('Vault selection/confirmation and update check/download/install passed in Classic, Pixel and Nebula.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'performance') {
    await evaluate("localStorage.setItem('journal.settings',JSON.stringify({...JSON.parse(localStorage.getItem('journal.settings')||'{}'),theme:'nebula'}));localStorage.setItem('journal.calendarDrawer','0');localStorage.setItem('journal.notebookDrawer','0')");
    await command('Page.reload');await until("Boolean(document.querySelector('.nebula-stage'))");
    assert.equal(await evaluate("document.querySelector('.nebula-calendar .cal')"),null,'Closed calendar holds no calendar DOM.');
    assert.equal(await evaluate("document.querySelector('.nebula-notebook .cm-editor')"),null,'Closed notebook holds no editors.');
    await evaluate("document.querySelector('.nebula-notebook-toggle').click()");
    await until("Boolean(document.querySelector('.nebula-notebook .notebook'))");
    await evaluate("document.querySelector('.nebula-notebook-toggle').click()");
    await until("!document.querySelector('.nebula-notebook .notebook')");
    await evaluate("document.querySelector('.nebula-calendar-toggle').click()");
    await until("Boolean(document.querySelector('.nebula-calendar .cal'))");
    await evaluate("document.querySelector('.nebula-calendar-toggle').click()");
    await until("!document.querySelector('.nebula-calendar .cal')");
    await evaluate("window.dispatchEvent(new Event('blur'))");
    // A blur event with actual browser focus may report focused; emulate a hidden document explicitly.
    await evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))");
    assert(await evaluate("document.documentElement.hasAttribute('data-window-idle')"));
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.nebula-orbit-a')).animationPlayState"),'paused');
    await evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:false});Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});window.dispatchEvent(new Event('focus'))");
    assert.equal(await evaluate("document.documentElement.hasAttribute('data-window-idle')"),false);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.nebula-orbit-a')).animationPlayState"),'running');
    assert.deepEqual(errors,[]);console.log('Performance UI passed: closed views release their DOM, hidden windows pause animations, focus resumes them.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'notebook') {
    const fill = (label, value) => evaluate(`(() => {const input=[...document.querySelectorAll('.notebook input')].find(input=>input.getAttribute('aria-label')===${JSON.stringify(label)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await evaluate(`(() => {
      const card=(id,title,extra={})=>({id,kind:'note',title,text:'Notiz mit **Markdown**',dates:[],order:1,created:window.__uiTest.date,notebook:true,...extra});
      sessionStorage.setItem('boardFolders',JSON.stringify([{id:'work',name:'Arbeit',parent:null,order:1},{id:'home',name:'Privat',parent:null,order:2}]));
      sessionStorage.setItem('boardCards',JSON.stringify([card('work-note','Projektplan',{folder:'work',links:['page','image']}),card('home-note','Urlaubsplan',{folder:'home'}),card('page','Zweite Seite',{folder:'work',links:['work-note']}),card('image','Bild',{kind:'image',notebook:true,links:['work-note'],image:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>'})]));
      localStorage.setItem('journal.notebookCollapsed','invalid JSON');
      localStorage.setItem('journal.notebookNote','work-note');localStorage.setItem('journal.notebookDrawer','1');
    })()`);
    await command('Page.reload');
    await until("document.querySelector('.notebook-title')?.value==='Projektplan'");
    assert.equal(await evaluate("document.querySelectorAll('.notebook-attachment').length"),1);
    await evaluate("window.__notebookBeforeMove=sessionStorage.boardCards;document.querySelectorAll('.notebook-note')[0].click()");
    await evaluate("document.querySelectorAll('.notebook-note')[1].dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}))");
    await until("document.querySelectorAll('.notebook-note.is-chosen').length===2");
    await evaluate("document.querySelectorAll('.notebook-note')[0].click()");
    await evaluate("document.querySelectorAll('.notebook-note')[2].dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))");
    await until("document.querySelectorAll('.notebook-note.is-chosen').length===3");
    assert(await evaluate("Boolean(document.querySelector('.notebook-chosen-delete .icon'))"));
    await evaluate("document.querySelector('.notebook-note.is-chosen').click()");
    await until("document.querySelectorAll('.notebook-note.is-chosen').length===3");
    await evaluate("document.querySelector('.notebook-chosen .notebook-folder-pick').click()");
    await until("Boolean(document.querySelector('.folder-pick-option'))");
    await evaluate("[...document.querySelectorAll('.folder-pick-option')].find(b=>b.textContent.includes('Privat')).click()");
    await until("JSON.parse(sessionStorage.boardCards).filter(c=>c.kind==='note').every(c=>c.folder==='home')");
    await evaluate("sessionStorage.boardCards=window.__notebookBeforeMove;window.__uiTest.emit('board:reset',null)");
    await until("!document.querySelector('.notebook-chosen')");

    await evaluate("document.querySelectorAll('.notebook-note')[0].click()");
    await evaluate("document.querySelectorAll('.notebook-note')[1].dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}));document.querySelectorAll('.notebook-note')[0].focus()");
    await evaluate("document.querySelector('.notebook-note.is-chosen').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:450,clientY:200}))");
    await until("Boolean(document.querySelector('.ctx-menu [data-item=delete-all]'))");
    await key('Escape');
    await key('Delete');
    await until("JSON.parse(sessionStorage.boardCards).filter(c=>c.kind==='note').length===1");
    await evaluate("sessionStorage.boardCards=window.__notebookBeforeMove;window.__uiTest.emit('board:reset',null)");
    await until("document.querySelectorAll('.notebook-note').length===3");
    await evaluate("(() => {const cards=JSON.parse(sessionStorage.boardCards),id=document.querySelector('.notebook-page').dataset.pageId;cards.find(c=>c.id===id).dates=[window.__uiTest.date];sessionStorage.boardCards=JSON.stringify(cards);window.__uiTest.emit('board:reset',null);})()");
    await until("Boolean(document.querySelector('.notebook-day-link'))");
    await evaluate("document.querySelector('.notebook-day-link').click()");
    await until("!document.querySelector('.notebook-view')");
    await evaluate("document.querySelector('.journal-tab.is-notebook').click()");
    await until("Boolean(document.querySelector('.notebook-title'))");
    await evaluate("document.querySelector('.notebook-page').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:600,clientY:240}))");
    await until("Boolean(document.querySelector('.ctx-menu [data-item=open-day]:not(:disabled)'))");
    await evaluate("document.querySelector('.ctx-menu [data-item=open-day]').click()");
    await until("!document.querySelector('.notebook-view')");
    await evaluate("document.querySelector('.journal-tab.is-notebook').click()");
    await until("Boolean(document.querySelector('.notebook-title'))");

    await evaluate("document.querySelector('[data-folder=home] .notebook-folder-name').click()");
    await until("document.querySelector('.notebook-title')?.value==='Urlaubsplan'");
    await fill('Zettel suchen','Projektplan');
    await until("document.querySelector('.notebook-title')?.value==='Projektplan'");
    await fill('Zettel suchen','Nothing matches this');
    await until("!document.querySelector('.notebook-title')");
    await fill('Zettel suchen','');
    await until("document.querySelector('.notebook-title')?.value==='Urlaubsplan'");
    await evaluate("document.querySelector('[data-folder=work] .notebook-folder-name').click()");
    await until("Boolean(document.querySelector('[data-note-id=work-note]'))");
    await evaluate("document.querySelector('[data-note-id=work-note]').click()");
    await evaluate("document.querySelector('.notebook-turn.is-next').click()");
    await until("document.querySelector('.notebook-page').dataset.pageId==='page'");
    await evaluate("document.querySelector('[data-folder=home] .notebook-folder-name').click()");
    await until("document.querySelector('.notebook-page').dataset.pageId==='home-note'");
    await evaluate("document.querySelector('.notebook-add-folder').click()");
    await fill('Ordnername','Forschung');await key('Enter');
    await until("JSON.parse(sessionStorage.boardFolders).some(f=>f.name==='Forschung')");
    await evaluate("[...document.querySelectorAll('.notebook-folder-name')].find(b=>b.textContent.includes('Forschung')).click()");
    await until("!document.querySelector('.notebook-title')");
    await evaluate("document.querySelector('.notebook-head .notebook-new').click()");
    await until("document.activeElement===document.querySelector('.notebook-title')");
    await fill('Titel','Neue Forschung');
    await evaluate("document.querySelector('.notebook-text .cm-content').focus()");
    await command('Input.insertText',{text:'## Ergebnis\nEin bearbeitbarer Zettel.'});
    await until("JSON.parse(sessionStorage.boardCards).some(c=>c.title==='Neue Forschung'&&c.text.includes('Ein bearbeitbarer Zettel.'))");
    await evaluate("document.querySelector('.notebook-day [role=switch]').click()");
    await until("JSON.parse(sessionStorage.boardCards).some(c=>c.title==='Neue Forschung'&&c.dates.length===1)");
    await evaluate("document.querySelector('.notebook-attach-actions [aria-expanded]').click()");
    await fill('URL','https://example.org/notebook');
    await evaluate("document.querySelector('.notebook-link-form').requestSubmit()");
    await until("document.querySelector('.notebook-attachment strong')?.textContent==='Board test page'");
    await evaluate("document.querySelector('.notebook-attachment-foot button').click()");
    await until("!document.querySelector('.notebook-attachment')");
    const made=await evaluate("document.querySelector('.notebook-page').dataset.pageId");
    await command('Page.reload');
    await until("document.querySelector('.notebook-title')?.value==='Neue Forschung'");
    await evaluate("document.querySelector('.notebook-delete').click()");
    await until(`!JSON.parse(sessionStorage.boardCards).some(c=>c.id===${JSON.stringify(made)})`);
    await evaluate("document.querySelector('[data-folder=work] .notebook-folder-name').click()");
    await until("Boolean(document.querySelector('[data-note-id=work-note]'))");
    await evaluate("document.querySelector('[data-note-id=work-note]').click()");
    await until("document.querySelector('.notebook-page').dataset.pageId==='work-note'");
    await evaluate("document.querySelector('.notebook-delete').click()");
    await until("!JSON.parse(sessionStorage.boardCards).some(c=>c.id==='work-note'||c.id==='image')");
    assert(await evaluate("JSON.parse(sessionStorage.boardCards).find(c=>c.id==='page').links.length===0"));
    // Synthetic merged changes arrive without restarting the window.
    await evaluate("(() => {const cards=JSON.parse(sessionStorage.boardCards);cards.find(c=>c.id==='page').title='Synchronisierte Seite';sessionStorage.boardCards=JSON.stringify(cards);window.__uiTest.emit('board:reset',null);})()");
    await until("document.querySelector('.notebook-title')?.value==='Synchronisierte Seite'");
    // Sorting: by title (A–Z), by when a note was made or last edited (newest first), remembered on the device.
    await evaluate("[...document.querySelectorAll('.notebook-folder-name')].find(b=>b.closest('[data-folder=all]')).click()");
    const order = () => evaluate("[...document.querySelectorAll('.notebook-note')].map(n=>n.querySelector('strong').textContent)");
    await evaluate("document.querySelector('.notebook-sort [data-sort=title]').click()");
    await until("document.querySelector('.notebook-sort [data-sort=title]').getAttribute('aria-checked')==='true'");
    const byTitle = await order();
    assert.deepEqual(byTitle, [...byTitle].sort((a, b) => a.localeCompare(b, undefined, { numeric:true, sensitivity:'base' })), 'Titles A–Z: '+byTitle);
    await evaluate("document.querySelector('[data-note-id=home-note]').click()");
    await until("document.querySelector('.notebook-title')?.value==='Urlaubsplan'");
    await fill('Titel','Urlaubsplan 2027');
    await evaluate("document.querySelector('.notebook-sort [data-sort=updated]').click()");
    await until("document.querySelector('.notebook-note strong')?.textContent==='Urlaubsplan 2027'");
    assert(await evaluate("JSON.parse(sessionStorage.boardCards).find(c=>c.id==='home-note').updatedAt>0"), 'Editing a title stamps the note.');
    assert.equal(await evaluate("localStorage.getItem('journal.notebookSort')"), 'updated');
    // Dragging a note onto a folder files it there.
    await evaluate(`(() => { const dt=new DataTransfer(); const note=document.querySelector('[data-note-id=home-note]'), folder=document.querySelector('[data-folder=work]');
      note.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));
      folder.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));
      folder.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt})); })()`);
    await until("JSON.parse(sessionStorage.boardCards).find(c=>c.id==='home-note').folder==='work'");
    // Several notes at once: Ctrl+click and Shift+click choose, the bar moves them all into a folder.
    await evaluate("(() => {const cards=JSON.parse(sessionStorage.boardCards);cards.push({...cards.find(c=>c.kind==='note'),id:'range-test-note',title:'Dritter Testzettel',links:[]});sessionStorage.boardCards=JSON.stringify(cards);window.__uiTest.emit('board:reset',null);})()");
    await evaluate("[...document.querySelectorAll('.notebook-folder-name')].find(b=>b.closest('[data-folder=all]')).click()");
    await until("document.querySelectorAll('.notebook-note').length>=3");
    const ids = await evaluate("[...document.querySelectorAll('.notebook-note')].slice(0,3).map(n=>n.dataset.noteId)");
    await evaluate(`document.querySelector('[data-note-id="${ids[0]}"]').click()`);
    await evaluate(`document.querySelector('[data-note-id="${ids[2]}"]').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))`);
    await until("document.querySelectorAll('.notebook-note.is-chosen').length===3 && Boolean(document.querySelector('.notebook-chosen'))");
    await evaluate(`document.querySelector('[data-note-id="${ids[1]}"]').dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}))`);
    await until("document.querySelectorAll('.notebook-note.is-chosen').length===2");
    await pause(150); await screenshot('notebook-multi.png');
    await evaluate("document.querySelector('.notebook-chosen .notebook-folder-pick').click()");
    await until("Boolean(document.querySelector('.folder-pick'))");
    await evaluate("[...document.querySelectorAll('.folder-pick-option')].find(o=>!o.classList.contains('is-none')).click()");
    await until(`(() => { const cards=JSON.parse(sessionStorage.boardCards); const a=cards.find(c=>c.id===${JSON.stringify(ids[0])}), b=cards.find(c=>c.id===${JSON.stringify(ids[2])}); return a.folder && a.folder===b.folder && !document.querySelector('.notebook-chosen'); })()`);
    // In the journal the notebook is a sheet on the left like the calendar's; only one of them is out at a time.
    await evaluate(`localStorage.setItem('journal.settings',JSON.stringify({...JSON.parse(localStorage.getItem('journal.settings')||'{}'),theme:'journal',pixel:false,colorTheme:'paper',bookPaging:'page'}));localStorage.setItem('journal.bookView','double');localStorage.setItem('journal.calendarDrawer','0');localStorage.setItem('journal.notebookDrawer','1')`);
    await command('Page.reload');
    await until("Boolean(document.querySelector('.calendar-drawer.is-notebook.is-open .notebook-title'))"); await pause(800);
    const sheet = await evaluate("(() => { const s=document.querySelector('.calendar-drawer.is-notebook .calendar-drawer-sheet').getBoundingClientRect(), b=document.querySelector('.book-spread').getBoundingClientRect(); return { left:s.left-b.left, right:b.right-s.right, half:b.width/2, width:s.width }; })()");
    assert(sheet.left < 60 && sheet.right > sheet.half - 40, 'The notebook lies on the left page: '+JSON.stringify(sheet));
    await screenshot('notebook-journal-left.png');
    // Both out on a spread: the calendar on the left page, the notebook moves to the right one.
    await evaluate("document.querySelector('.calendar-tab').click()");
    await until("Boolean(document.querySelector('.calendar-drawer.is-calendar.is-open') && document.querySelector('.calendar-drawer.is-notebook.is-open.is-right'))"); await pause(800);
    assert(await evaluate("(() => { const c=document.querySelector('.calendar-drawer.is-calendar .calendar-drawer-sheet').getBoundingClientRect(), n=document.querySelector('.calendar-drawer.is-notebook .calendar-drawer-sheet').getBoundingClientRect(), b=document.querySelector('.book-spread').getBoundingClientRect(); return c.right <= n.left + 4 && n.left >= b.left + b.width/2 - 20; })()"), 'Calendar left, notebook right.');
    await screenshot('notebook-journal-both.png');
    // On one page there is room for one sheet: the one taken out last stays.
    await evaluate("void localStorage.setItem('journal.bookView','single')");
    await command('Emulation.setDeviceMetricsOverride',{width:800,height:780,deviceScaleFactor:1,mobile:false});
    await until("document.querySelectorAll('.calendar-drawer.is-open').length===1 && Boolean(document.querySelector('.calendar-drawer.is-calendar.is-open'))");
    await command('Emulation.setDeviceMetricsOverride',{width:1180,height:780,deviceScaleFactor:1,mobile:false});
    await evaluate("document.querySelector('.calendar-tab').click()");
    await until("!document.querySelector('.calendar-drawer.is-open')");
    await evaluate("document.querySelector('.notebook-tab').click()");
    await until("Boolean(document.querySelector('.calendar-drawer.is-notebook.is-open:not(.is-right)'))");
    // Turning both pages at once, the book shows one page beside the notebook, as beside the calendar.
    await evaluate(`localStorage.setItem('journal.settings',JSON.stringify({...JSON.parse(localStorage.getItem('journal.settings')||'{}'),bookPaging:'spread'}))`);
    await command('Page.reload');
    await until("Boolean(document.querySelector('.calendar-drawer.is-notebook.is-open .notebook-title')) && Boolean(document.querySelector('.book-stage.is-beside'))"); await pause(800);
    assert(await evaluate("(() => { const s=document.querySelector('.calendar-drawer.is-notebook .calendar-drawer-sheet').getBoundingClientRect(), p=document.querySelector('.book-page:not(.is-outgoing)').getBoundingClientRect(); return document.querySelectorAll('.book-page:not(.is-outgoing)').length===1 && p.left>=s.right-4; })()"), 'One page beside the notebook.');
    await screenshot('notebook-journal-beside.png');
    await evaluate(`localStorage.setItem('journal.settings',JSON.stringify({...JSON.parse(localStorage.getItem('journal.settings')||'{}'),bookPaging:'page'}))`);
    for (const theme of ['classic','journal','nebula']) for (const pixel of [false,true]) {
      await evaluate(`localStorage.setItem('journal.settings',JSON.stringify({...JSON.parse(localStorage.getItem('journal.settings')||'{}'),theme:'${theme}',pixel:${pixel},colorTheme:'${theme==='journal'?'paper':'original'}'}));localStorage.setItem('journal.calendarDrawer','0');localStorage.setItem('journal.notebookDrawer','1');localStorage.setItem('journal.notebookFolder','all');`);
      await command('Emulation.setDeviceMetricsOverride',{width:1180,height:780,deviceScaleFactor:1,mobile:false});
      await command('Page.reload');
      await until("Boolean(document.querySelector('.notebook-title'))");await pause(600);
      assert(await evaluate("(() => {const n=document.querySelector('.notebook').getBoundingClientRect();return n.width>200&&n.height>150&&n.left>=-2&&n.right<=innerWidth+5;})()"),'Notebook fits '+theme+' pixel='+pixel);
      await screenshot(`notebook-${theme}-${pixel?'pixel':'normal'}.png`);
      await command('Emulation.setDeviceMetricsOverride',{width:540,height:780,deviceScaleFactor:1,mobile:false});await pause(400);
      assert(await evaluate("(() => {const p=document.querySelector('.notebook-page');return p.scrollWidth<=p.clientWidth+2;})()"),'Note has no horizontal overflow at 540: '+theme+' pixel='+pixel);
    }
    assert.deepEqual(errors,[]);console.log('Notebook UI passed: folders, filtering/search, pages, editing, day switch, attachments, deletion, reload, sync refresh and all three designs with pixel variants.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'tag-popup-persistence') {
    const tagId='dddddddd-dddd-4ddd-addd-dddddddddddd';
    await evaluate(`window.__TAURI_INTERNALS__.invoke('save_tags',{tags:[...window.__uiTest.tags(),{id:'${tagId}',name:'PopupTag',color:'#569eff'}]})`);
    const entryId=await evaluate(`(() => {const day=window.__uiTest.day();day.entries[0].tag='${tagId}';window.__uiTest.store(day);return day.entries[0].id;})()`);
    await until("Boolean(document.querySelector('.sidebar .cal-item[data-tag=PopupTag]'))");
    await evaluate("document.querySelector('.sidebar .cal-item[data-tag=PopupTag]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");
    await until("Boolean(document.querySelector('.cal-composer-tag'))");
    await evaluate("document.querySelector('.cal-composer-tag').click()");await until("Boolean(document.querySelector('.tag-picker-foot button'))");
    await evaluate("document.querySelector('.tag-picker-foot button').click()");
    await until("Boolean(document.querySelector('#settings-tags')) && Boolean(document.querySelector('.tag-picker')) && Boolean(document.querySelector('.cal-composer'))");
    await evaluate("document.querySelector('[data-tag-row=PopupTag] .tag-name').focus();document.querySelector('[data-tag-row=PopupTag] .tag-name').select()");
    await command('Input.insertText',{text:'PopupRenamed'});
    await evaluate("document.querySelector('[data-tag-row=PopupTag] .tag-name').blur()");
    await until("window.__uiTest.tags().some(t=>t.name==='PopupRenamed')");
    await evaluate("document.querySelector('[data-tag-row=PopupRenamed] .color-well').click()");
    await until("Boolean(document.querySelector('.color-picker-swatches'))");
    await evaluate("document.querySelector('.color-picker-swatches button[aria-label=\"#e6a85c\"]').click()");
    await until(`window.__uiTest.tags().some(t=>t.id==='${tagId}' && t.color==='#e6a85c')`);
    assert(await evaluate("Boolean(document.querySelector('.tag-picker')) && Boolean(document.querySelector('.cal-composer'))"));
    await key('Escape');await until("!document.querySelector('.color-picker-popover')");
    await evaluate("document.querySelector('.settings-close').click()");await until("!document.querySelector('.settings') && Boolean(document.querySelector('.tag-picker')) && Boolean(document.querySelector('.cal-composer'))");
    await evaluate("[...document.querySelectorAll('.tag-option')].find(e=>e.textContent.includes('PopupRenamed')).click()");
    await until("!document.querySelector('.tag-picker') && Boolean(document.querySelector('.cal-composer'))");
    await key('Enter','Enter');await until("!document.querySelector('.cal-composer')");
    await evaluate("window.dispatchEvent(new Event('journal:save-now'))");
    await until(`window.__uiTest.day().entries.some(e=>e.id==='${entryId}' && e.tag==='${tagId}')`);
    assert.deepEqual(errors,[]);console.log('Tag editor, settings and stable identity checks passed.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'board-free-drag') {
    await evaluate("localStorage.setItem('journal.settings',JSON.stringify({...JSON.parse(localStorage.getItem('journal.settings')||'{}'),theme:'nebula'}));sessionStorage.setItem('boardCards',JSON.stringify([{id:'free-card',kind:'note',title:'Free card',text:'',dates:[window.__uiTest.date],order:1,boardX:8,y:18,w:180,h:120}]));location.reload()");
    const reset=async()=>{
      await evaluate("const cards=JSON.parse(sessionStorage.boardCards);cards[0].boardX=8;cards[0].y=18;sessionStorage.boardCards=JSON.stringify(cards);location.reload()");
      await until("Boolean(document.querySelector('.board-card'))");
      await evaluate("document.querySelector('.board-viewport').scrollIntoView({block:'center'})");await pause(200);
    };
    const mouse=(type,p,buttons=1)=>command('Input.dispatchMouseEvent',{type,...p,button:'left',buttons,clickCount:1});
    const drag=async direction=>{
      const p=await evaluate("(() => {const c=document.querySelector('.board-card').getBoundingClientRect(),v=document.querySelector('.board-viewport').getBoundingClientRect();return {start:{x:c.left+12,y:c.top+8},left:v.left,right:v.right,bottom:v.bottom,top:v.top};})()");
      const end=direction==='left'?{x:p.left-65,y:p.start.y}:direction==='right'?{x:p.right+65,y:p.start.y}:direction==='top'?{x:p.start.x,y:p.top-65}:{x:p.start.x,y:p.bottom+75};
      await mouse('mouseMoved',p.start,0);await mouse('mousePressed',p.start);await mouse('mouseMoved',end);await pause(150);await mouse('mouseReleased',end,0);await pause(200);
    };
    await reset();
    assert(await evaluate("getComputedStyle(document.querySelector('.board-viewport')).boxShadow==='none' && getComputedStyle(document.querySelector('.board-viewport')).borderTopWidth==='0px'"));
    await drag('right');
    assert(await evaluate("JSON.parse(sessionStorage.boardCards)[0].boardX>document.querySelector('.board-world').clientWidth-180"),'Cards can move past the former right boundary.');
    const right=await evaluate("JSON.parse(sessionStorage.boardCards)[0].boardX");await evaluate('location.reload()');await until("Boolean(document.querySelector('.board-card'))");
    assert.equal(await evaluate("document.querySelector('.board-card').offsetLeft"),right,'Absolute position survives reload.');
    await reset();await drag('left');
    assert(await evaluate("JSON.parse(sessionStorage.boardCards)[0].boardX<0"),'Cards can move past the former left boundary.');
    await reset();await drag('top');
    assert(await evaluate("JSON.parse(sessionStorage.boardCards)[0].y<0"),'Cards can move above the former top boundary.');
    const above=await evaluate("JSON.parse(sessionStorage.boardCards)[0].y");await evaluate('location.reload()');await until("Boolean(document.querySelector('.board-card'))");
    assert.equal(await evaluate("document.querySelector('.board-card').offsetTop"),above,'Negative vertical positions survive reload.');
    await reset();
    const readCamera=()=>evaluate("(() => {const v=document.querySelector('.board-viewport'),m=new DOMMatrix(getComputedStyle(document.querySelector('.board-world')).transform);return {width:v.clientWidth,height:v.clientHeight,scale:m.a,x:m.e,y:m.f,cx:(v.clientWidth/2-m.e)/m.a,cy:(v.clientHeight/2-m.f)/m.a};})()");
    const original=await readCamera();
    await evaluate(`(() => {const v=document.querySelector('.board-viewport');v.style.width='${original.width*.6}px';v.style.height='${original.height*.7}px';})()`);await pause(200);
    const small=await readCamera();assert(small.scale<original.scale,'Resizing the complete board adjusts zoom.');
    assert(Math.abs(small.cx-original.cx)<.01 && Math.abs(small.cy-original.cy)<.01,'Resizing preserves the centre of the content.');
    await evaluate(`(() => {const v=document.querySelector('.board-viewport');v.style.width='${original.width}px';v.style.height='${original.height}px';})()`);await pause(200);
    const restored=await readCamera();assert(Math.abs(restored.scale-original.scale)<.0001,'Growing back restores the previous zoom without drift.');
    await reset();const height=await evaluate("document.querySelector('.board-viewport').clientHeight");await drag('bottom');
    assert(await evaluate("document.querySelector('.board-viewport').clientHeight")>height,'Dragging below the board expands its visible area.');
    assert(await evaluate("JSON.parse(sessionStorage.boardCards)[0].y>100"));
    assert.deepEqual(errors,[]);console.log('Free board dragging passed: no frame, unbounded horizontal movement, persistence and downward expansion.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'interaction-fixes') {
    await evaluate("localStorage.setItem('journal.settings',JSON.stringify({...JSON.parse(localStorage.getItem('journal.settings')||'{}'),theme:'nebula'}));location.reload()");
    await until("Boolean(document.querySelector('input.nebula-poster-title'))");
    await evaluate("document.querySelector('input.nebula-poster-title').focus();document.querySelector('input.nebula-poster-title').select()");await key('a','KeyA',2);await command('Input.insertText',{text:'Direct poster title'});
    assert.equal(await evaluate("document.querySelector('.title-input').value"),'Direct poster title');
    await evaluate("window.__TAURI_INTERNALS__.invoke('save_tags',{tags:[{id:'test-tag',name:'Test',color:'#569eff'}]})");
    await saveNow();
    await evaluate("(() => {const d=window.__uiTest.day();d.entries[0].tag='test-tag';return window.__uiTest.store(d);})()");
    await evaluate("window.__uiTest.emit('history:restored',null)");await pause(150);
    await evaluate("document.querySelector('.entry[data-entry-id=\"10000000-0000-4000-8000-000000000001\"] .entry-text').focus()");
    await key('Enter','Enter',2);
    await until("document.querySelectorAll('.entry').length===6 && document.activeElement?.classList.contains('entry-text')");
    await command('Input.insertText',{text:'Without tag via shortcut'});await pause(150);await saveNow();
    await until("window.__uiTest.day().entries.some(e=>e.text==='Without tag via shortcut')");
    assert.equal(await evaluate("window.__uiTest.day().entries.find(e=>e.text==='Without tag via shortcut').tag"),null);
    await evaluate("document.querySelector('.board-actions button').click()");
    await until("Boolean(document.querySelector('.board-card'))");
    await evaluate("document.querySelector('.board-surface').scrollIntoView({block:'center'})");
    const before=await evaluate("({width:document.querySelector('.board-world').clientWidth,left:document.querySelector('.board-card').offsetLeft,top:document.querySelector('.board-card').offsetTop,zoom:parseFloat(document.querySelector('.board-viewport').style.getPropertyValue('--board-scale')),height:document.querySelector('.board-viewport').clientHeight,grid:getComputedStyle(document.querySelector('.board-viewport')).backgroundSize})");
    const pt=await evaluate("(() => {const r=document.querySelector('.board-surface').getBoundingClientRect();return {x:r.left+30,y:r.top+30};})()");
    await command('Input.dispatchMouseEvent',{type:'mouseWheel',...pt,deltaY:120,deltaX:0,modifiers:2});
    await until(`parseFloat(document.querySelector('.board-viewport').style.getPropertyValue('--board-scale'))<${before.zoom}`);
    assert.equal(await evaluate("document.querySelector('.board-viewport').clientHeight"),before.height,'Zoom keeps the board frame the same height.');
    assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.board-viewport')).backgroundSize"),before.grid,'The background scales with the cards.');
    const blank=await evaluate("(() => {const r=document.querySelector('.board-viewport').getBoundingClientRect();return {x:r.right-35,y:r.bottom-35};})()");
    const panBefore=await evaluate("getComputedStyle(document.querySelector('.board-viewport')).backgroundPosition");
    await command('Input.dispatchMouseEvent',{type:'mousePressed',...blank,button:'left',buttons:1,clickCount:1});
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:blank.x-60,y:blank.y-40,button:'left',buttons:1});
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:blank.x-60,y:blank.y-40,button:'left',buttons:0,clickCount:1});
    assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.board-viewport')).backgroundPosition"),panBefore,'Dragging free space moves the background.');
    await evaluate("document.querySelector('.board-viewport').style.width='220px'");await pause(150);
    assert.equal(await evaluate("document.querySelector('.board-world').clientWidth"),before.width);
    assert.equal(await evaluate("document.querySelector('.board-card').offsetLeft"),before.left);
    assert.equal(await evaluate("document.querySelector('.board-card').offsetTop"),before.top);
    await evaluate("document.querySelector('.nebula-tab[data-period-mode=week]').click()");await pause(400);
    const side=async (button,point={x:20,y:80})=>{
      const name=button===3?'back':'forward';
      await command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:name,buttons:button===3?8:16,clickCount:1});
      await command('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:name,buttons:0,clickCount:1});
    };
    await side(3);await until("document.querySelector('.nebula-tab[data-period-mode=day]').hasAttribute('aria-current')");
    await pause(100);await side(4);await until("document.querySelector('.nebula-tab[data-period-mode=week]').hasAttribute('aria-current')");
    await evaluate("document.querySelector('.nebula-tab[data-period-mode=day]').click()");await pause(400);
    await evaluate("document.querySelector('.nebula-panel.is-entries .nebula-panel-minimize').click()");await pause(400);
    assert(await evaluate("document.querySelector('.nebula-panel.is-entries').classList.contains('is-minimized')"));
    await side(3);await until("!document.querySelector('.nebula-panel.is-entries').classList.contains('is-minimized')");
    await pause(100);await side(4);await until("document.querySelector('.nebula-panel.is-entries').classList.contains('is-minimized')");
    await pause(100);await evaluate("document.querySelector('.nebula-notebook-toggle').click()");
    await until("Boolean(document.querySelector('.notebook .cm-content'))");
    await evaluate("document.querySelector('.notebook .cm-content').scrollIntoView({block:'center'});document.querySelector('.notebook .cm-content').focus()");await pause(400);
    const notePoint=await evaluate("(() => {const n=document.querySelector('.notebook .cm-content'),r=n.getBoundingClientRect();return {x:r.left+20,y:r.top+10};})()");
    await side(3,notePoint);await until("!document.querySelector('.nebula-notebook-toggle').classList.contains('is-open')");
    await pause(100);await side(4);await until("document.querySelector('.nebula-notebook-toggle').classList.contains('is-open')");
    assert.deepEqual(errors,[]);console.log('Interaction fixes passed: editable poster, untagged shortcut, board zoom and stable positions, view and Nebula layout history.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'calendar-connected-spans') {
    const month=await evaluate('window.__uiTest.date.slice(0,7)');
    await evaluate(`(() => {const month='${month}';const entry=(id,end)=>({id,kind:'event',text:id,time:'00:00',end,done:false,cancelled:false,priority:false});return Promise.all([
      window.__uiTest.store({date:month+'-02',title:'',revision:1,entries:[entry('connected-long','288:00')]}),
      window.__uiTest.store({date:month+'-04',title:'',revision:1,entries:[entry('connected-overlap','96:00')]}),
      window.__uiTest.store({date:month+'-09',title:'',revision:1,entries:[entry('connected-later','72:00')]})]);})()`);
    await until("document.querySelectorAll('.sidebar .cal-month-span').length>=4");
    const geometry=await evaluate("[...document.querySelectorAll('.sidebar .cal-month-span')].map(n=>({id:n.dataset.spanEntry,top:parseFloat(getComputedStyle(n).marginTop),width:n.getBoundingClientRect().width,cell:n.parentElement.querySelector('.cal-month-day').getBoundingClientRect().width}))");
    assert(geometry.filter(n=>n.id==='connected-long').every(n=>n.top===geometry.find(n=>n.id==='connected-long').top),'A span stays in one lane across weeks.');
    assert(geometry.some(n=>n.width>n.cell*2),'A connected bar crosses day boundaries.');
    assert(geometry.find(n=>n.id==='connected-overlap').top>geometry.find(n=>n.id==='connected-long').top);
    await screenshot('calendar-connected-month.png');
    // Grab inside the middle of the bar: the shift is based on that day, preserving the complete interval.
    const source=await evaluate(`(() => {const cell=document.querySelector('.sidebar .cal-month-day[data-date="${month}-05"]'),r=cell.getBoundingClientRect(),bar=[...cell.parentElement.querySelectorAll('.cal-month-span')].find(n=>n.dataset.spanEntry==='connected-long').getBoundingClientRect();return {x:r.left+r.width/2,y:bar.top+bar.height/2};})()`);
    const target=await evaluate(`(() => {const r=document.querySelector('.sidebar .cal-month-day[data-date="${month}-06"]').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+45};})()`);
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',...source});
    await command('Input.dispatchMouseEvent',{type:'mousePressed',...source,button:'left',buttons:1,clickCount:1});
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',...target,button:'left',buttons:1});
    await until(`document.querySelector('.cal-drag-preview')?.dataset.dropDate==='${month}-03'`);
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',...target,button:'left',buttons:0,clickCount:1});
    await until("window.__uiTest.invoked.some(([cmd,p])=>cmd==='move_calendar_entry' && p.id==='connected-long')");
    await evaluate("document.querySelector('.sidebar .cal-views [role=tab]').click()");
    await until("document.querySelectorAll('.sidebar .cal-year-span').length>0");
    assert(await evaluate("[...document.querySelectorAll('.sidebar .cal-year-span')].every(n=>{const s=getComputedStyle(n);return s.backgroundColor==='rgba(0, 0, 0, 0)' && s.backgroundImage==='none' && s.pointerEvents==='none' && parseFloat(s.borderTopWidth)>0})"),'Year ranges are transparent outlines and leave existing markings accessible.');
    assert(await evaluate("document.querySelectorAll('.sidebar .cal-year-day.has-mark .cal-year-mark').length>0"));
    for(const theme of ['classic','journal','nebula']) for(const pixel of [false,true]) {
      await evaluate(`document.documentElement.dataset.theme='${theme}';if(${pixel})document.documentElement.dataset.pixel='';else delete document.documentElement.dataset.pixel`);
      const radius=await evaluate("parseFloat(getComputedStyle(document.querySelector('.sidebar .cal-year-span.is-span-start')).borderTopLeftRadius)");
      assert.equal(radius===0,pixel || theme==='nebula',`${theme} pixel=${pixel}: range end caps follow the theme.`);
    }
    await evaluate("document.documentElement.dataset.theme='classic';delete document.documentElement.dataset.pixel");
    await evaluate(`document.querySelector('.sidebar .cal-year-day[data-date="${month}-05"]').closest('.cal-year-month').scrollIntoView({block:'center'})`);
    await screenshot('calendar-connected-year.png');
    assert.deepEqual(errors,[]);console.log('Connected calendar spans passed: lanes, week boundaries, dragging, year outlines and theme end caps.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'calendar-drag') {
    const mouse=(type,point,button='left',buttons=1)=>command('Input.dispatchMouseEvent',{type,...point,button,buttons,clickCount:1});
    const pos=expr=>evaluate(`(() => {const r=(${expr}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    const today=await evaluate('window.__uiTest.date'), tomorrow=await evaluate('window.__uiTest.shift(1)');
    const item=`document.querySelector('.sidebar [data-range-date="${today}"] .cal-item')`;
    await until(`Boolean(${item})`);
    const start=await pos(item), dest=await pos(`document.querySelector('.sidebar [data-range-date="${tomorrow}"]')`);
    await mouse('mouseMoved',start,'none',0);await mouse('mousePressed',start);await mouse('mouseMoved',dest);
    await until("Boolean(document.querySelector('.cal-drag-preview')) && Boolean(document.querySelector('.cal-drop-outline'))");
    assert(await evaluate(`(() => { const source=${item},copy=document.querySelector('.cal-drag-preview'),a=source.getBoundingClientRect(),b=copy.getBoundingClientRect();return Math.abs(a.width-b.width)<1 && Math.abs(a.height-b.height)<1 && source.querySelector('.cal-item-text').textContent===copy.querySelector('.cal-item-text').textContent && getComputedStyle(source).backgroundColor===getComputedStyle(copy).backgroundColor; })()`),'The held entry retains its dimensions, text and background.');
    await mouse('mouseReleased',dest,'left',0);
    await until("!document.querySelector('.cal-drag-preview,.cal-drop-outline')");
    await until("window.__uiTest.invoked.some(([cmd])=>cmd==='move_calendar_entry')");
    const moved=await evaluate("window.__uiTest.invoked.filter(([cmd])=>cmd==='move_calendar_entry').at(-1)[1]");assert.equal(moved.from,today);assert.equal(moved.to,tomorrow);
    const from=await evaluate(`(() => {const r=document.querySelector('.sidebar [data-range-date="${today}"]').getBoundingClientRect();return {x:r.left+8,y:r.bottom-8}})()`),to=await evaluate(`(() => {const r=document.querySelector('.sidebar [data-range-date="${tomorrow}"]').getBoundingClientRect();return {x:r.left+8,y:r.bottom-8}})()`);
    await mouse('mouseMoved',from,'none',0);await mouse('mousePressed',from,'right',2);await mouse('mouseMoved',to,'right',2);await mouse('mouseReleased',to,'right',0);
    await until("Boolean(document.querySelector('.cal-multi-form')) && document.querySelectorAll('.sidebar [data-range-selected]').length>=2");
    await key('Escape');await evaluate("document.querySelectorAll('.sidebar .cal-views [role=tab]')[2].click()");await until("Boolean(document.querySelector('.sidebar .cal-time-column'))");
    const col=await pos("document.querySelector('.sidebar .cal-time-column')");
    await mouse('mouseMoved',col,'none',0);await mouse('mousePressed',col,'right',2);await mouse('mouseMoved',{x:col.x,y:col.y+50},'right',2);await mouse('mouseReleased',{x:col.x,y:col.y+50},'right',0);
    await until("Boolean(document.querySelector('.cal-selection'))");await key('Escape');
    await evaluate(`window.__uiTest.store({...window.__uiTest.day(),entries:[...window.__uiTest.day().entries,{id:'77777777-7777-4777-8777-777777777777',kind:'event',text:'Timed drag',time:'09:00',end:'10:00',done:false,cancelled:false,priority:false,reminder:false,plan:null},{id:'88888888-8888-4888-8888-888888888888',kind:'event',text:'Span drag',time:'09:00',end:'57:00',done:false,cancelled:false,priority:false,reminder:false,plan:null}]})`);
    const timed=`document.querySelector('.sidebar .cal-time-column[data-date="${today}"] .cal-item[aria-label*="Timed drag"]')`;
    await until(`Boolean(${timed})`);
    await evaluate(`${timed}.scrollIntoView({block:'center'})`);
    const timedStart=await pos(timed), nextCol=await pos(`document.querySelector('.sidebar .cal-time-column[data-date="${tomorrow}"]')`);
    const hour=await evaluate("parseFloat(getComputedStyle(document.querySelector('.sidebar .cal-time')).getPropertyValue('--hour'))");
    const timedEnd={x:nextCol.x,y:timedStart.y+hour};
    await mouse('mouseMoved',timedStart,'none',0);await mouse('mousePressed',timedStart);await mouse('mouseMoved',timedEnd);
    await until("document.querySelector('.cal-drag-preview')?.dataset.dropTime==='10:00'");
    assert.match(await evaluate("document.querySelector('.cal-drag-label').textContent"), /10:00.*11:00/);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.cal-drag-label')).opacity"),'1');
    assert(await evaluate(`(() => {const mark=document.querySelector('.sidebar .cal-time-column[data-date="${tomorrow}"] .cal-drop-outline'),col=mark?.parentElement;return mark && Math.abs(parseFloat(mark.style.top)-10*${hour}-1)<1 && Math.abs(mark.clientHeight-(${hour}-5))<2;})()`),'Destination outline marks the actual snapped time and duration.');
    assert(await evaluate("(() => {const b=document.querySelector('.cal-drag-label'),r=b.getBoundingClientRect();return b.clientWidth>=b.firstElementChild.scrollWidth && r.top>=0 && r.bottom<=innerHeight && getComputedStyle(b).overflow==='visible';})()"),'The entire live time label is readable without clipping.');
    await screenshot('calendar-drag-time-preview.png');
    await mouse('mouseReleased',timedEnd,'left',0);
    await until("window.__uiTest.invoked.some(([cmd,p])=>cmd==='move_calendar_entry' && p.id==='77777777-7777-4777-8777-777777777777')");
    const timedMove=await evaluate("window.__uiTest.invoked.find(([cmd,p])=>cmd==='move_calendar_entry' && p.id==='77777777-7777-4777-8777-777777777777')[1]");
    assert.deepEqual([timedMove.from,timedMove.to,timedMove.time,timedMove.end],[today,tomorrow,'10:00','11:00']);
    const span="document.querySelector('.sidebar .cal-multiday-bar .cal-item[aria-label*=\"Span drag\"]')";
    await until(`Boolean(${span})`);
    const barStart=await pos(`document.querySelector('.sidebar .cal-time-allday-cell[data-range-date="${today}"]')`);
    const barNext=await pos(`document.querySelector('.sidebar .cal-time-allday-cell[data-range-date="${tomorrow}"]')`);
    const spanRect=await evaluate(`(() => {const r=${span}.getBoundingClientRect();return {y:r.top+r.height/2}})()`);
    const spanStart={x:barStart.x,y:spanRect.y},spanEnd={x:barNext.x,y:spanRect.y};
    await mouse('mouseMoved',spanStart,'none',0);await mouse('mousePressed',spanStart);await mouse('mouseMoved',spanEnd);
    const dateRange=await evaluate("document.querySelector('.cal-drag-label').textContent");
    const shortDate=value=>value.slice(8,10)+'.'+value.slice(5,7)+'.';
    assert.equal(dateRange,shortDate(tomorrow)+' \u2013 '+shortDate(await evaluate('window.__uiTest.shift(3)')));
    await mouse('mouseReleased',spanEnd,'left',0);
    await until("window.__uiTest.invoked.some(([cmd,p])=>cmd==='move_calendar_entry' && p.id==='88888888-8888-4888-8888-888888888888')");
    const spanMove=await evaluate("window.__uiTest.invoked.find(([cmd,p])=>cmd==='move_calendar_entry' && p.id==='88888888-8888-4888-8888-888888888888')[1]");
    assert.deepEqual([spanMove.from,spanMove.to,spanMove.time,spanMove.end],[today,tomorrow,'09:00','57:00']);
    await pause(350);
    const blank=await pos(`document.querySelector('.sidebar .cal-time-allday-cell[data-range-date="${today}"]')`);
    await mouse('mouseMoved',blank,'none',0);await mouse('mousePressed',blank,'right',2);await mouse('mouseReleased',blank,'right',0);
    await until("Boolean(document.querySelector('.cal-composer-text'))");
    await key('Escape');await until("!document.querySelector('.cal-composer')");
    await evaluate(`window.__uiTest.emit('calendar:request',{id:'remote-check',kind:'move',entry:{id:'88888888-8888-4888-8888-888888888888'},from:'${tomorrow}',to:'${today}',time:'09:00',end:'57:00'})`);
    await until("window.__uiTest.invoked.filter(([cmd,p])=>cmd==='move_calendar_entry' && p.id==='88888888-8888-4888-8888-888888888888').length===2");
    // A clipped overnight block must regain its full duration while moving back before midnight.
    await evaluate(`window.__uiTest.store({...window.__uiTest.day(),entries:[...window.__uiTest.day().entries,{id:'99999999-9999-4999-8999-999999999999',kind:'event',text:'Night drag',time:'23:00',end:'25:00',done:false,cancelled:false,priority:false}]})`);
    const night=`document.querySelector('.sidebar .cal-time-column[data-date="${today}"] .cal-item[aria-label*="Night drag"]')`;
    await until(`Boolean(${night})`);await evaluate(`${night}.scrollIntoView({block:'center'})`);
    const nightStart=await pos(night),early={x:nightStart.x,y:nightStart.y-hour*2};
    await mouse('mouseMoved',nightStart,'none',0);await mouse('mousePressed',nightStart);await mouse('mouseMoved',early);
    await until("document.querySelector('.cal-drag-preview')?.dataset.dropTime==='21:00'");
    assert(Math.abs(await evaluate("document.querySelector('.cal-drag-preview').getBoundingClientRect().height")-(2*hour-3))<1,'Moving the clipped midnight block earlier restores its complete height.');
    await mouse('mouseMoved',nightStart);
    await until("document.querySelector('.cal-drag-preview')?.dataset.dropTime==='23:00'");
    assert.equal(await evaluate("[...document.querySelectorAll('.cal-drag-preview')].filter(n=>getComputedStyle(n).display!=='none').length"),2);
    await mouse('mouseMoved',early);
    await until("document.querySelector('.cal-drag-preview')?.dataset.dropTime==='21:00'");
    assert(Math.abs(await evaluate("document.querySelector('.cal-drag-preview').getBoundingClientRect().height")-(2*hour-3))<1);
    await key('Escape');await mouse('mouseReleased',early,'left',0);
    assert.equal(await evaluate("document.querySelector('.cal-drag-preview,.cal-drag-label,.cal-drop-outline')"),null);
    const rest=`document.querySelector('.sidebar .cal-time-column[data-date="${tomorrow}"] .cal-item.is-night-rest[aria-label*="Night drag"]')`;
    await evaluate(`${rest}.scrollIntoView({block:'center'})`);const restStart=await pos(rest),restEnd={x:restStart.x,y:restStart.y+hour};
    await mouse('mouseMoved',restStart,'none',0);await mouse('mousePressed',restStart);await mouse('mouseMoved',restEnd);
    await until("document.querySelector('.cal-drag-preview')?.dataset.dropTime==='00:00'");
    assert.equal(await evaluate("document.querySelector('.cal-drag-preview').dataset.dropDate"),tomorrow,'Grabbing the continuation shifts the original start through midnight.');
    await key('Escape');await mouse('mouseReleased',restEnd,'left',0);
    const allDayItem=`document.querySelector('.sidebar .cal-time-allday-cell[data-range-date="${today}"] .cal-item')`;
    const allDayStart=await pos(allDayItem),allDayEnd={x:barNext.x,y:allDayStart.y};
    await mouse('mouseMoved',allDayStart,'none',0);await mouse('mousePressed',allDayStart);await mouse('mouseMoved',allDayEnd);
    assert.equal(await evaluate("document.querySelector('.cal-drag-label').textContent"),shortDate(tomorrow),'All-day entries show a destination date without a time.');
    await key('Escape');await mouse('mouseReleased',allDayEnd,'left',0);
    assert.deepEqual(errors,[]);
    console.log('Calendar drag checks passed.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'allday-columns') {
    for (const viewIndex of [2,3,4]) {
      await evaluate(`document.querySelectorAll('.sidebar .cal-views [role=tab]')[${viewIndex}].click()`);
      await until("Boolean(document.querySelector('.sidebar .cal-time-allday-cell'))");
      for (const theme of ['classic','journal']) for (const pixel of [false,true]) {
        await evaluate(`document.documentElement.dataset.theme='${theme}';if(${pixel})document.documentElement.dataset.pixel='';else delete document.documentElement.dataset.pixel;`);
        await pause(80);
        const aligned=await evaluate(`(() => {const root=document.querySelector('.sidebar .cal'),corner=root.querySelector('.cal-time-allday > .cal-time-corner').getBoundingClientRect(),week=root.querySelector('.cal-time-head > .cal-time-corner').getBoundingClientRect(),cells=[...root.querySelectorAll('.cal-time-allday-cell')],headers=[...root.querySelectorAll('.cal-time-day')],timed=[...root.querySelectorAll('.cal-time-column')];return Math.abs(corner.left-week.left)<1 && cells.every((cell,i)=>{const r=cell.getBoundingClientRect(),h=headers[i].getBoundingClientRect(),t=timed[i].getBoundingClientRect();return Math.abs(r.left-h.left)<1 && Math.abs(r.width-h.width)<1 && Math.abs(r.left-t.left)<1;});})()`);
        assert(aligned,`All-day columns align with weekdays: view ${viewIndex}, ${theme}, pixel=${pixel}`);
      }
    }
    await screenshot('allday-columns.png');
    assert.deepEqual(errors,[]);
    console.log('All-day column alignment passed for week, workweek and day, with both designs and pixel on/off.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'journal-layout') {
    await evaluate("localStorage.setItem('journal.settings',JSON.stringify({...JSON.parse(localStorage.getItem('journal.settings')||'{}'),theme:'journal',colorTheme:'paper'}));localStorage.setItem('journal.calendarDrawer','1')");
    await command('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
    await until("Boolean(document.querySelector('.calendar-drawer.is-overlay.is-open'))");await pause(500);
    assert.equal(await evaluate("document.querySelector('.statusbar')"),null);
    assert(await evaluate("Boolean(document.querySelector('.book-tag-register .tag-filter-button'))"));
    const tab=await evaluate("(() => {const r=document.querySelector('.calendar-tab').getBoundingClientRect(),b=document.querySelector('.book-spread').getBoundingClientRect();return {right:r.right-b.left,inside:r.left>=0};})()");
    assert(tab.right<=8 && tab.inside,'The calendar tab hangs out of the book on the left, inside the window.');
    await evaluate("document.querySelector('.book-tag-register .tag-filter-button').click()");
    await until("Boolean(document.querySelector('.tag-filter-list'))");
    await evaluate("document.querySelector('.tag-filter-row').click()");
    await until("document.querySelector('.book-tag-register .tag-filter-button').classList.contains('is-filtering')");
    await key('Escape');await until("!document.querySelector('.tag-filter-list')");

    assert.equal(await evaluate("document.querySelector('.titlebar-help, .topbar')"),null,'No title bar and no F1 hint.');
    assert(await evaluate("(() => {const s=document.querySelector('.calendar-drawer-sheet').getBoundingClientRect(),b=document.querySelector('.book-spread').getBoundingClientRect(),stage=document.querySelector('.book-stage').getBoundingClientRect();return s.top<b.top-10 && s.top>=stage.top;})()"),'Overlay extends above the page without clipping.');
    for(const width of [1380,900,720,540,360]){
      await command('Emulation.setDeviceMetricsOverride',{width,height:780,deviceScaleFactor:1,mobile:false});await pause(350);
      const geometry=await evaluate("(() => {const root=document.querySelector('.book-window-bar'),buttons=[...root.querySelectorAll('button')].filter(e=>e.getBoundingClientRect().width>0).map(e=>{const r=e.getBoundingClientRect();return {name:e.getAttribute('aria-label')||e.title||e.textContent,left:r.left,right:r.right,top:r.top,bottom:r.bottom};});return {width:innerWidth,buttons};})()");
      assert(await evaluate("[...document.querySelectorAll('.book-register button')].every(e=>{const r=e.getBoundingClientRect();return r.left>=-1 && r.right<=innerWidth+1;})"),'Book register fits at '+width);
      for(const b of geometry.buttons)assert(b.left>=-1 && b.right<=width+1,'Titlebar control stays in the window at '+width+': '+JSON.stringify(b));
      for(let i=0;i<geometry.buttons.length;i++)for(let j=i+1;j<geometry.buttons.length;j++){const a=geometry.buttons[i],b=geometry.buttons[j];assert(a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1,'Controls overlap at '+width+': '+JSON.stringify([a,b]));}
      if(width===720)await screenshot('journal-toolbar-responsive.png');
    }
    assert(await evaluate("[...document.querySelectorAll('.book-corner')].every(e=>e.querySelector('svg path') && getComputedStyle(e,'::before').content==='none')"),'Corners use thin arrow paths rather than folded paper.');
    const page=await evaluate("document.querySelector('.book-page:not(.is-outgoing)').dataset.page");
    await evaluate("document.querySelector('.book-page:not(.is-outgoing) .book-corner.is-next').click()");
    await until("document.querySelector('.book-page:not(.is-outgoing)').dataset.page!=="+JSON.stringify(page));
    await key('F1', 'F1');await until("Boolean(document.querySelector('.shortcuts'))");
    console.log('Journal layout passed: no footer, no title bar (F1 still opens the shortcuts), overlay above page, window controls fit from 360 to 1380px.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'journal-sheet') {
    // The journal style's page: navigation on the sheet, register cut-outs at the top right, the ribbon to today.
    await evaluate("localStorage.setItem('journal.settings',JSON.stringify({...JSON.parse(localStorage.getItem('journal.settings')||'{}'),theme:'journal',colorTheme:'paper'}));localStorage.setItem('journal.calendarDrawer','0');localStorage.setItem('journal.bookView','double')");
    await command('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
    await until("Boolean(document.querySelector('.book-page .book-nav'))"); await pause(700);
    const sheetDate = "document.querySelector('.book-page:not(.is-outgoing)[data-page=entries]')?.dataset.date";
    // No title bar: the day is turned on the page.
    assert.equal(await evaluate("document.querySelectorAll('.topbar').length"),0);
    assert.equal(await evaluate("document.querySelectorAll('.book-page .book-nav').length"),1,'One head with the navigation per spread.');
    assert.equal(await evaluate("document.querySelectorAll('.book-page .eyebrow, .book-marks, .calendar-ribbon').length"),0);
    assert.equal(await evaluate("[...document.querySelectorAll('.book-page:not(.is-outgoing) .book-page-foot')].every(f => f.children.length===1 && /^\\d+$/.test(f.textContent))"),true,'The footer is the page number.');
    // Today: the ribbon lies over the pages (and does not catch clicks there).
    assert.equal(await evaluate("document.querySelector('.book-ribbon').classList.contains('is-here')"),true);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.book-ribbon')).pointerEvents"),'none');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.book-ribbon')).opacity"),'1');
    // Register: every kind keeps its tab at the same height and width; the data page (right) keeps its own.
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.book-page.is-right')).getPropertyValue('--tab').trim()"),'1');
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.book-cut-tab')].map(b => b.dataset.page)"),['entries','data','board']);
    // The entries page is open on the left: its tab is paper too, the board's is not.
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.book-cut-tab')].map(b => getComputedStyle(b).backgroundColor === getComputedStyle(document.querySelector('.book-page.is-right')).backgroundColor || b.getAttribute('aria-current')==='page')"),[true,true,false]);
    const tabBoxes = "JSON.stringify([...document.querySelectorAll('.book-cut-tab')].map(b => { const r=b.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.width)]; }))";
    const tabsAtData = await evaluate(tabBoxes);
    await screenshot('journal-sheet-today.png');
    // A day on: the ribbon only hangs out below the book; pulling it opens today again.
    const today = await evaluate('window.__uiTest.date');
    await evaluate("document.querySelectorAll('.book-nav .book-nav-step')[1].click()");
    await until(`${sheetDate}===${JSON.stringify(await evaluate('window.__uiTest.shift(1)'))}`); await pause(600);
    assert.equal(await evaluate("document.querySelector('.book-ribbon').classList.contains('is-here')"),false);
    assert(await evaluate("(() => { const r=document.querySelector('.book-ribbon').getBoundingClientRect(), b=document.querySelector('.book-spread').getBoundingClientRect(); return r.bottom>b.bottom+20 && r.bottom<=innerHeight; })()"),'The ribbon end shows below the book.');
    await screenshot('journal-sheet-other-day.png');
    await evaluate("document.querySelector('.book-ribbon').click()");
    await until(`${sheetDate}===${JSON.stringify(today)}`); await pause(600);
    // The date on the page opens the mini calendar.
    await evaluate("document.querySelector('.book-nav-date').click()");
    await until("Boolean(document.querySelector('.book-nav .mini-picker-panel'))");
    await screenshot('journal-sheet-picker.png');
    await key('Escape'); await until("!document.querySelector('.mini-picker-panel')");
    // One page: all tabs still show, the entries tab is current; a tab turns the page.
    await command('Emulation.setDeviceMetricsOverride',{width:800,height:780,deviceScaleFactor:1,mobile:false}); await pause(500);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.book-cut-tab')].map(b => b.dataset.page)"),['entries','data','board']);
    assert.equal(await evaluate("document.querySelector('.book-cut-tab[aria-current=page]').dataset.page"),'entries');
    await screenshot('journal-sheet-single.png');
    await evaluate("document.querySelector('.book-cut-tab[data-page=data]').click()");
    assert(await evaluate("Boolean(document.querySelector('.book-page.is-lift-off'))"),'A register tab turns the page.');
    await until("document.querySelector('.book-page:not(.is-outgoing)').dataset.page==='data'"); await pause(500);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.book-cut-tab')].map(b => b.dataset.page)"),['entries','data','board']);
    await evaluate("document.querySelector('.book-cut-tab[data-page=board]').click()");
    await until("document.querySelector('.book-page:not(.is-outgoing)').dataset.page==='board'"); await pause(500);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.book-cut-tab')].map(b => b.dataset.page)"),['entries','data','board'],'The last page still shows the tabs before it.');
    assert.equal(await evaluate(tabBoxes),tabsAtData,'The tabs keep their height and width on every page.');
    await command('Emulation.setDeviceMetricsOverride',{width:1180,height:780,deviceScaleFactor:1,mobile:false}); await pause(400);
    // The calendar comes out of its tab on the left.
    await evaluate("document.querySelector('.calendar-tab').click()");
    await until("Boolean(document.querySelector('.calendar-drawer.is-open'))"); await pause(700);
    await screenshot('journal-sheet-calendar.png');
    await evaluate("document.querySelector('.calendar-tab').click()");
    await until("!document.querySelector('.calendar-drawer.is-open')");
    // A week: its head steps weeks; the activities page shows through the note page's cut.
    await evaluate("document.querySelector('.book-register-tab[data-period-mode=week]').click()");
    await until("document.querySelector('.book-page:not(.is-outgoing)')?.dataset.page==='notes'"); await pause(600);
    await screenshot('journal-sheet-week.png');
    // The journal with the pixel look: still the book, in the pixel type.
    await evaluate("document.querySelector('.book-register-tab[data-period-mode=day]').click()");
    await key(',', 'Comma', 2);
    await until("Boolean(document.querySelector('[data-pixel-toggle]'))");
    await evaluate("document.querySelector('[data-pixel-toggle]').click()");
    await key('Escape');
    await until("!document.querySelector('.settings') && document.documentElement.dataset.pixel!==undefined && document.documentElement.dataset.theme==='journal'"); await pause(500);
    assert(await evaluate("Boolean(document.querySelector('.book-page .book-nav'))"));
    assert.match(await evaluate("getComputedStyle(document.querySelector('.book-nav h1')).fontFamily"), /Pixelify/);
    assert.match(await evaluate("getComputedStyle(document.querySelector('.book-page .entry-text')).fontFamily"), /VT323/);
    await screenshot('journal-sheet-pixel.png');
    assert.deepEqual(errors,[]);
    console.log('Journal sheet passed: navigation on the page, decluttered heads, cut register, ribbon to today, calendar tab.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'journal-grid') {
    await evaluate("localStorage.setItem('journal.settings',JSON.stringify({...JSON.parse(localStorage.getItem('journal.settings')||'{}'),theme:'journal',colorTheme:'paper'}))");
    await command('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?window=calendar`});
    await until("document.documentElement.dataset.theme==='journal' && Boolean(document.querySelector('.cal-viewbar'))");
    await evaluate("document.querySelector('.cal-viewbar button[title*=Woche]').click()");
    await until("Boolean(document.querySelector('.cal-time-body'))");
    const read=()=>evaluate("(() => {const body=document.querySelector('.cal-time-body'),column=document.querySelector('.cal-time-column'),style=getComputedStyle(body);const label=document.querySelector('.cal-time-hours').children[4].getBoundingClientRect();return {hour:parseFloat(getComputedStyle(document.querySelector('.cal-time')).getPropertyValue('--hour')),square:parseFloat(style.backgroundSize.split(' ')[1]),columns:Number(getComputedStyle(column).getPropertyValue('--paper-columns')),vertical:parseFloat(getComputedStyle(column).backgroundSize.split(',')[1]),origin:getComputedStyle(column).backgroundOrigin,phase:style.backgroundPosition,outer:getComputedStyle(document.querySelector('.cal')).backgroundImage,label:label.top+label.height/2-body.getBoundingClientRect().top,column:column.getBoundingClientRect().top-body.getBoundingClientRect().top};})()");
    const aligned=async()=>{const v=await read();assert(Math.abs(v.square*4-v.hour)<.01);assert(Number.isInteger(v.columns) && v.columns>=1);assert(Math.abs(v.vertical*v.columns-100)<.01);assert(v.origin.includes('border-box'));assert(Math.abs(v.label-4*v.hour)<.05);assert(Math.abs(v.column)<.05);assert.equal(v.outer,'none');return v;};
    await pause(350);const before=await aligned();
    const point=await evaluate("(() => {const r=document.querySelector('.cal-time').getBoundingClientRect();return {x:r.left+120,y:r.top+250};})()");
    await command('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:-240,modifiers:2});
    await until("parseFloat(getComputedStyle(document.querySelector('.cal-time')).getPropertyValue('--hour'))>"+before.hour);
    await aligned();await screenshot('journal-grid-zoom.png');
    await command('Emulation.setDeviceMetricsOverride',{width:1380,height:1000,deviceScaleFactor:1,mobile:false});
    await pause(400);await aligned();
    await command('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:240,modifiers:2});
    await pause(300);await aligned();
    for(const title of ['Arbeitswoche','Tag']){await evaluate("[...document.querySelectorAll('.cal-viewbar button')].find(e=>e.title.startsWith("+JSON.stringify(title)+")).click()");await pause(300);await aligned();}
    for(const [title,selector] of [['Monat','.cal-month-day'],['Jahr','.cal-year-grid > *']]){
      await evaluate("[...document.querySelectorAll('.cal-viewbar button')].find(e=>e.title.startsWith("+JSON.stringify(title)+")).click()");
      for(const width of [1180,760]){
        await command('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:false});await pause(300);
        const cells=await evaluate("[...document.querySelectorAll("+JSON.stringify(selector)+")].map(e=>{const s=getComputedStyle(e);return {columns:Number(s.getPropertyValue('--paper-columns')),rows:Number(s.getPropertyValue('--paper-rows')),tile:s.backgroundSize,origin:s.backgroundOrigin};})");
        assert(cells.length>0);for(const c of cells){const [x,y]=c.tile.split(',')[0].trim().split(' ').map(parseFloat);assert(Number.isInteger(c.columns)&&Number.isInteger(c.rows)&&c.columns>=1&&c.rows>=1);assert(Math.abs(x*c.columns-100)<.01 && Math.abs(y*c.rows-100)<.01,'Paper cells align at '+title+' '+width);assert(c.origin.includes('border-box'));}
      }
      await screenshot('journal-grid-'+title+'.png');
    }
    console.log('Journal grid passed: hour alignment plus month/year cell boundaries adapt to resizing.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'mail-view-zoom') {
    await evaluate("document.querySelector('.cal-viewbar button[title*=Woche]').click()");
    await until("Boolean(document.querySelector('.cal-time'))");
    const before=await evaluate("({hour:parseFloat(document.querySelector('.cal-time').style.getPropertyValue('--hour')),scale:document.documentElement.dataset.scale})");
    const point=await evaluate("(() => {const r=document.querySelector('.cal-time-body').getBoundingClientRect();return {x:r.left+100,y:300};})()");
    await command('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:-240,modifiers:2});
    await until("parseFloat(document.querySelector('.cal-time').style.getPropertyValue('--hour'))>"+before.hour);
    assert.equal(await evaluate('document.documentElement.dataset.scale'),before.scale,'Ctrl-wheel must not change the whole app scale.');
    await command('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:240,modifiers:2});
    await until("Math.abs(parseFloat(document.querySelector('.cal-time').style.getPropertyValue('--hour'))-"+before.hour+")<1");
    await evaluate("(() => {const d=window.__uiTest.day();d.entries[0].description='journal-mail:v1\\n'+JSON.stringify({subject:'Mail preview',sender:'test@example.org',html:'<html><head><style>.mail-heading{background-color:rgb(12,34,56);font-size:26px}</style></head><body style=\"background-color:rgb(230,240,250)\"><h1 class=\"mail-heading\" style=\"color:red\">Formatted mail</h1><script>parent.__unsafe=true</script></body></html>',text:'Formatted mail'});window.__uiTest.store(d);window.__uiTest.emit('history:restored',null);})()");
    await evaluate("document.querySelector('.cal-viewbar button[title*=Monat]').click()");
    await until("Boolean(document.querySelector('.cal-item'))");
    await evaluate("[...document.querySelectorAll('.cal-item')].find(e=>e.textContent.includes('Eine Runde')).click()");
    await until("Boolean(document.querySelector('.mail-content iframe'))");
    assert.equal(await evaluate("document.querySelector('.mail-content iframe').getAttribute('sandbox')"),'');
    assert(await evaluate("document.querySelector('.mail-content iframe').srcdoc.includes('color:red') && !document.querySelector('.mail-content iframe').srcdoc.includes('<script>')"));
    assert.equal(await evaluate('Boolean(window.__unsafe)'),false);
    await pause(250);
    const frameTree=await command('Page.getFrameTree');
    const mailFrame=frameTree.frameTree.childFrames?.find(item=>item.frame.url==='about:srcdoc');
    let contextId,mailSession;
    if(mailFrame){const world=await command('Page.createIsolatedWorld',{frameId:mailFrame.frame.id,worldName:'mail-css-check'});contextId=world.executionContextId;}
    else{const targets=await command('Target.getTargets');const target=targets.targetInfos.find(t=>t.type==='iframe' && t.url==='about:srcdoc');assert(target,'Sandboxed mail frame exists: '+JSON.stringify(targets.targetInfos));mailSession=(await command('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;}
    const computed=await command('Runtime.evaluate',{...(contextId?{contextId}:{}),expression:"(() => {const h=document.querySelector('h1');const style=getComputedStyle(h);return {color:style.color,background:style.backgroundColor,size:style.fontSize,body:getComputedStyle(document.body).backgroundColor};})()",returnByValue:true},mailSession);
    assert.deepEqual(computed.result.value,{color:'rgb(255, 0, 0)',background:'rgb(12, 34, 56)',size:'26px',body:'rgb(230, 240, 250)'},'Inline CSS and embedded styles apply under the real nonce-based CSP.');
    await key('Escape');
    // A mail with a PDF: long subjects and senders fit in the unified head; attachments keep their own box.
    for (const subject of ['Kurz', 'Ihre Rechnung Nr. 2026-11-0042 für den Zeitraum Oktober bis November – bitte bis zum 20. November begleichen']) {
      const mail = { subject, sender:'Buchhaltung Beispiel GmbH <rechnungen-und-mahnungen@buchhaltung.example.org>', html:'<p>Siehe Anhang.</p>', text:'Siehe Anhang.', notes:'Rechnung.pdf · Betrag 42,00 € · fällig am 20.11.2026\nKundennummer 4711 · IBAN DE00 1234 5678 9000' };
      await evaluate(`(() => {const d=window.__uiTest.day();d.entries[0].description=${JSON.stringify('journal-mail:v1\n' + JSON.stringify(mail))};return window.__uiTest.store(d);})()`);
      await pause(300);
      await evaluate("[...document.querySelectorAll('.cal-item')].find(e=>e.textContent.includes('Eine Runde')).click()");
      await until("Boolean(document.querySelector('.mail-content-remote')) && Boolean(document.querySelector('.mail-content-notes pre'))");
      const place = await evaluate("(() => { const h=document.querySelector('.mail-content-head').getBoundingClientRect(), b=document.querySelector('.mail-content-remote').getBoundingClientRect(); return { right:h.right-b.right, top:b.top-h.top }; })()");
      assert(place.right >= 0 && place.top >= 0, 'The switch stays inside the organized head whatever the subject: '+JSON.stringify(place));
      if (subject !== 'Kurz') { await pause(200); await screenshot('mail-content-pdf.png'); }
      await key('Escape'); await until("!document.querySelector('.mail-content')");
    }
    const origin=await evaluate('window.__uiTest.shift(-1)');const next=await evaluate('window.__uiTest.date');
    await evaluate("(() => {const d=window.__uiTest.day();const e={...d.entries[0],id:'40000000-0000-4000-8000-000000000001',text:'Two-day delivery',time:'00:00',end:'47:59',description:''};window.__uiTest.store({date:window.__uiTest.shift(-1),title:'',revision:1,entries:[e]});window.__uiTest.emit('history:restored',null);})()");
    // Multi-day entries occupy one spanning bar above the individual day cells.
    const continuedBar="document.querySelector('.cal-month-day[data-date=\""+next+"\"]').closest('.cal-month-week').querySelector('.cal-month-span[data-span-entry=\"40000000-0000-4000-8000-000000000001\"] .cal-item')";
    await until("Boolean("+continuedBar+")");
    await evaluate(continuedBar+".click()");
    await until("Boolean(document.querySelector('.cal-details'))");
    assert(await evaluate("document.querySelector('.cal-details-meta').textContent.includes('"+Number(origin.slice(8))+".')"),'Continued entry opens with the original start date.');
    await key('Escape');
    await evaluate("document.querySelector('.cal-viewbar button[title*=Jahr]').click()");
    await until("document.querySelector('.cal-year-day[data-date=\""+next+"\"]').classList.contains('has-mark')");

    console.log('Mail view and calendar zoom passed: Ctrl-wheel scales only hours; HTML styles render in a sandbox without scripts.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'search') {
    // The search in each design: Ctrl+F, words and filters with suggestions, a result opens where it was made.
    for (const theme of ['classic', 'journal', 'nebula']) {
      await evaluate(`localStorage.setItem('journal.settings', JSON.stringify({...JSON.parse(localStorage.getItem('journal.settings')||'{}'), theme:'${theme}', popupStyle:'a', colorTheme:'${theme === 'journal' ? 'paper' : 'original'}'}))`);
      await command('Page.reload');
      await until("document.querySelectorAll('.entry').length>=5");
      await pause(300);
      await key('f', 'KeyF', 2);
      await until("document.activeElement?.classList.contains('search-input')");
      await command('Input.insertText', { text:'@Auf' });
      await until("[...document.querySelectorAll('.search-suggestion')].some(item => item.textContent.includes('Aufgabe'))");
      await pause(200); await screenshot(`search-${theme}-suggest.png`);
      await key('Enter', 'Enter');
      await until("document.querySelector('.search-input').value.startsWith('@Aufgabe ')");
      await command('Input.insertText', { text:'Park' });
      await until("[...document.querySelectorAll('.search-result')].some(item => item.textContent.includes('Park'))");
      await pause(200); await screenshot(`search-${theme}-results.png`);
      await key('Enter', 'Enter');
      await until("document.activeElement?.closest('.entry')?.textContent.includes('Park') && !document.querySelector('.search-panel')");
    }
    console.log('Search checks passed.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'review') {
    // Screenshots for a look: a multi-day entry in the year view, an entry edited in the hours, the folder pick.
    await evaluate("(() => { const day = window.__uiTest.day(); day.entries.push({ id:'30000000-0000-4000-8000-000000000001', kind:'event', text:'Reise', done:false, cancelled:false, priority:false, time:'09:00', end:'57:00', showInJournal:false }, { id:'30000000-0000-4000-8000-000000000002', kind:'event', text:'Besprechung', done:false, cancelled:false, priority:false, time:'10:00', end:'11:30' }); return window.__uiTest.store(day); })()");
    await evaluate("document.querySelector('.sidebar .cal').focus()"); await key('j','KeyJ');
    await until("Boolean(document.querySelector('.cal-year-span'))");
    await evaluate("document.querySelector('.cal-year-span').scrollIntoView({block:'center'})");
    await pause(300); await screenshot('review-year-span.png');
    await evaluate("document.querySelector('.sidebar .cal').focus()"); await key('t','KeyT');
    await until("[...document.querySelectorAll('.sidebar .cal-item.is-block')].some(item => item.textContent.includes('Besprechung'))");
    await evaluate("[...document.querySelectorAll('.sidebar .cal-item.is-block')].find(item => item.textContent.includes('Besprechung')).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");
    await until("Boolean(document.querySelector('.cal-selection.is-edit')) && Boolean(document.querySelector('.cal-composer.is-placed'))");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.cal-selection.is-edit')).outlineStyle"), 'dashed');
    await pause(300); await screenshot('review-edit.png');
    // A left click elsewhere discards the card.
    const elsewhere = await evaluate("(() => { const r=document.querySelector('.sidebar .cal-time-column').getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+40 }; })()");
    await command('Input.dispatchMouseEvent',{type:'mousePressed',...elsewhere,button:'left',buttons:1,clickCount:1});
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',...elsewhere,button:'left',buttons:0,clickCount:1});
    await until("!document.querySelector('.cal-composer') && !document.querySelector('.cal-selection')");
    // A frame drawn around the block chooses it; Delete removes it.
    const block = await evaluate("(() => { const r=[...document.querySelectorAll('.sidebar .cal-item.is-block')].find(item => item.textContent.includes('Besprechung')).getBoundingClientRect(); return { x1:r.left-12, y1:r.top-12, x2:r.right+6, y2:r.bottom+12 }; })()");
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:block.x1,y:block.y1});
    await command('Input.dispatchMouseEvent',{type:'mousePressed',x:block.x1,y:block.y1,button:'left',buttons:1,clickCount:1});
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:(block.x1+block.x2)/2,y:(block.y1+block.y2)/2,button:'left',buttons:1});
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:block.x2,y:block.y2,button:'left',buttons:1});
    await until("Boolean(document.querySelector('.cal-frame')) && [...document.querySelectorAll('.sidebar .cal-item.is-selected')].some(item => item.textContent.includes('Besprechung'))");
    await pause(150); await screenshot('review-frame.png');
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:block.x2,y:block.y2,button:'left',buttons:0,clickCount:1});
    await until("!document.querySelector('.cal-frame') && document.querySelectorAll('.sidebar .cal-item.is-selected').length===1");
    await key('Delete','Delete');
    await until("!window.__uiTest.day().entries.some(entry => entry.text === 'Besprechung')");
    // Two chosen entries move together (both shown moving) and stay chosen afterwards.
    await evaluate("(() => { const day = window.__uiTest.day(); day.entries.push({ id:'30000000-0000-4000-8000-000000000004', kind:'event', text:'Eins', done:false, cancelled:false, priority:false, time:'12:00', end:'13:00' }, { id:'30000000-0000-4000-8000-000000000005', kind:'event', text:'Zwei', done:false, cancelled:false, priority:false, time:'14:00', end:'15:00' }); return window.__uiTest.store(day); })()");
    await until("['Eins','Zwei'].every(text => [...document.querySelectorAll('.sidebar .cal-item.is-block')].some(item => item.textContent.includes(text)))");
    const pair = await evaluate("(() => { const find = text => [...document.querySelectorAll('.sidebar .cal-item.is-block')].find(item => item.textContent.includes(text)).getBoundingClientRect(); const a=find('Eins'), b=find('Zwei'); return { x1:a.left-10, y1:a.top-10, x2:b.right+6, y2:b.bottom+10, gx:a.left+a.width/2, gy:a.top+a.height/2 }; })()");
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:pair.x1,y:pair.y1});
    await command('Input.dispatchMouseEvent',{type:'mousePressed',x:pair.x1,y:pair.y1,button:'left',buttons:1,clickCount:1});
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:pair.x2,y:pair.y2,button:'left',buttons:1});
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:pair.x2,y:pair.y2,button:'left',buttons:0,clickCount:1});
    await until("document.querySelectorAll('.sidebar .cal-item.is-selected').length===2");
    const hour = await evaluate("parseFloat(getComputedStyle(document.querySelector('.sidebar .cal-time')).getPropertyValue('--hour'))");
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:pair.gx,y:pair.gy});
    await command('Input.dispatchMouseEvent',{type:'mousePressed',x:pair.gx,y:pair.gy,button:'left',buttons:1,clickCount:1});
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:pair.gx,y:pair.gy+hour/2,button:'left',buttons:1});
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:pair.gx,y:pair.gy+hour,button:'left',buttons:1});
    await until("document.querySelectorAll('.cal-drag-preview').length===2");
    await pause(150); await screenshot('review-group-drag.png');
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:pair.gx,y:pair.gy+hour,button:'left',buttons:0,clickCount:1});
    await until("(() => { const entries = window.__uiTest.day().entries; return entries.find(e => e.text==='Eins')?.time==='13:00' && entries.find(e => e.text==='Zwei')?.time==='15:00'; })()");
    await until("document.querySelectorAll('.sidebar .cal-item.is-selected').length===2");
    await key('Escape');
    await until("!document.querySelector('.sidebar .cal-item.is-selected')");
    // An entry past midnight: both its parts wear the dashed edge while edited.
    await evaluate("(() => { const day = window.__uiTest.day(); day.entries.push({ id:'30000000-0000-4000-8000-000000000003', kind:'event', text:'Nachtfahrt', done:false, cancelled:false, priority:false, time:'21:00', end:'27:00' }); return window.__uiTest.store(day); })()");
    await evaluate("document.querySelector('.sidebar .cal').focus()"); await key('w','KeyW');
    await until("[...document.querySelectorAll('.sidebar .cal-item.is-block')].filter(item => item.textContent.includes('Nachtfahrt')).length===2");
    await evaluate("[...document.querySelectorAll('.sidebar .cal-item.is-block')].find(item => item.textContent.includes('Nachtfahrt')).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");
    await until("document.querySelectorAll('.cal-selection.is-edit').length===2 && Boolean(document.querySelector('.cal-composer.is-placed'))");
    assert(await evaluate("[...document.querySelectorAll('.cal-selection.is-edit')].every(part => getComputedStyle(part).outlineStyle==='dashed')"), 'Both parts of an overnight entry wear the dashed edge.');
    await pause(300); await screenshot('review-night-edit.png');
    await key('Escape');
    console.log('Review screenshots taken.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'context-menus') {
    // Right-click menus in all six popup looks: the notebook's folders and notes (with submenus), the board's cards and cork.
    const rightClick = async expression => {
      const point = await evaluate(`(() => { const e=(${expression}); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return { x:r.left+Math.min(40,r.width/2), y:r.top+Math.min(14,r.height/2) }; })()`);
      await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:point.x, y:point.y });
      await command('Input.dispatchMouseEvent', { type:'mousePressed', x:point.x, y:point.y, button:'right', buttons:2, clickCount:1 });
      await command('Input.dispatchMouseEvent', { type:'mouseReleased', x:point.x, y:point.y, button:'right', buttons:0, clickCount:1 });
      return point;
    };
    for (const [theme, popups] of [['classic','a'],['classic','b'],['journal','a'],['journal','b'],['nebula','a'],['nebula','b']]) {
      const look = `${theme}-${popups}`;
      await evaluate(`(() => {
        localStorage.setItem('journal.settings', JSON.stringify({...JSON.parse(localStorage.getItem('journal.settings')||'{}'), theme:'${theme}', popupStyle:'${popups}', colorTheme:'${theme === 'journal' ? 'paper' : 'original'}'}));
        const card=(id,title,extra={})=>({id,kind:'note',title,text:'Notiz',dates:[],order:1,created:window.__uiTest.date,notebook:true,...extra});
        sessionStorage.setItem('boardFolders',JSON.stringify([{id:'work',name:'Arbeit',parent:null,order:1},{id:'sub',name:'Projekte',parent:'work',order:1},{id:'home',name:'Privat',parent:null,order:2}]));
        sessionStorage.setItem('boardCards',JSON.stringify([card('work-note','Projektplan',{folder:'work'}),card('home-note','Urlaubsplan',{folder:'home'}),card('board-note','Am Tag',{dates:[window.__uiTest.date],notebook:false,boardX:20,y:20})]));
        localStorage.setItem('journal.notebookNote','work-note'); localStorage.setItem('journal.notebookFolder','work'); localStorage.setItem('journal.notebookDrawer','1');
      })()`);
      await command('Page.reload');
      await until("Boolean(document.querySelector('.notebook [data-folder=work] .notebook-folder-name'))");
      await pause(400);
      // A folder: its menu in the look's build, the move submenu beside it.
      await rightClick("document.querySelector('.notebook [data-folder=work] .notebook-folder-name')");
      await until(`Boolean(document.querySelector('.ctx-menu.is-${look}'))`);
      await evaluate("[...document.querySelectorAll('.ctx-menu .ctx-item')].find(b => b.dataset.item==='move').click()");
      await until("Boolean(document.querySelector('.ctx-menu.is-sub'))");
      // The folder cannot go into itself or its subfolder.
      assert(await evaluate("(() => { const sub=document.querySelector('.ctx-menu.is-sub'); return sub.querySelector('[data-item=to-work]').disabled && sub.querySelector('[data-item=to-sub]').disabled && !sub.querySelector('[data-item=to-home]').disabled; })()"), 'A folder cannot move into itself.');
      await pause(250); await screenshot(`context-${look}-folder.png`);
      await key('Escape'); await key('Escape');
      await until("!document.querySelector('.ctx-menu')");
      // A note: the paper colour from a submenu by keys (→, ↓, Enter).
      await rightClick("document.querySelector('.notebook [data-note-id=work-note]')");
      await until("Boolean(document.querySelector('.ctx-menu [data-item=paper]'))");
      await evaluate("document.querySelector('.ctx-menu [data-item=paper]').focus()");
      await key('ArrowRight', 'ArrowRight');
      await until("document.activeElement?.closest('.ctx-menu.is-sub') && document.activeElement.dataset.item==='paper-yellow'");
      await key('ArrowDown', 'ArrowDown');
      await pause(200); await screenshot(`context-${look}-note.png`);
      await key('Enter', 'Enter');
      await until("JSON.parse(sessionStorage.boardCards).find(c=>c.id==='work-note').paper==='blue' && !document.querySelector('.ctx-menu')");
      // The empty side: a new folder from there.
      await rightClick("document.querySelector('.notebook-tree-head')");
      await until("Boolean(document.querySelector('.ctx-menu [data-item=new-folder]'))");
      await evaluate("document.querySelector('.ctx-menu [data-item=new-folder]').click()");
      await until("Boolean(document.querySelector('.notebook-rename'))");
      await key('Escape');
      // The board: a card's menu, and a note made where the cork was clicked.
      await key('N', 'KeyN', 10);
      await pause(300);
      if (await evaluate("Boolean(document.querySelector('.board-card[data-board-id=board-note]')) && document.querySelector('.board-card[data-board-id=board-note]').getBoundingClientRect().width > 0")) {
        await rightClick("document.querySelector('.board-card[data-board-id=board-note] .board-pin')");
        await until(`Boolean(document.querySelector('.ctx-menu.is-${look} [data-item=paper]'))`);
        await pause(200); await screenshot(`context-${look}-card.png`);
        await key('Escape');
        await until("!document.querySelector('.ctx-menu')");
        const at = await evaluate("(() => { const r=document.querySelector('.board-viewport').getBoundingClientRect(); return { x:r.right-60, y:r.top+Math.min(r.height-30, 140) }; })()");
        await command('Input.dispatchMouseEvent', { type:'mouseMoved', ...at });
        await command('Input.dispatchMouseEvent', { type:'mousePressed', ...at, button:'right', buttons:2, clickCount:1 });
        await command('Input.dispatchMouseEvent', { type:'mouseReleased', ...at, button:'right', buttons:0, clickCount:1 });
        await until("Boolean(document.querySelector('.ctx-menu [data-item=note]'))");
        await pause(200); await screenshot(`context-${look}-board.png`);
        await evaluate("document.querySelector('.ctx-menu [data-item=note]').click()");
        await until("JSON.parse(sessionStorage.boardCards).filter(c=>c.dates.includes(window.__uiTest.date)).length===2");
        assert(await evaluate("JSON.parse(sessionStorage.boardCards).some(c => c.id!=='board-note' && c.dates.includes(window.__uiTest.date) && c.boardX > 100)"), 'The new note lies where the cork was clicked.');
      } else console.log(`(${look}: no board on screen, card menu skipped)`);
    }
    console.log('Context menu checks passed.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'looks') {
    // Each popup look builds an entry's actions its own way (ActionSheet); Normal · Karte keeps the orbit.
    for (const [theme, popups] of [['classic','a'],['classic','b'],['journal','a'],['journal','b'],['nebula','a'],['nebula','b']]) {
      await evaluate(`localStorage.setItem('journal.settings', JSON.stringify({...JSON.parse(localStorage.getItem('journal.settings')||'{}'), theme:'${theme}', popupStyle:'${popups}', colorTheme:'${theme === 'journal' ? 'paper' : 'original'}'}))`);
      await command('Page.reload');
      await until("document.querySelectorAll('.entry').length>=5");
      await pause(300);
      await evaluate("document.querySelector('.entry[data-entry-kind=task][data-status=open] .entry-symbol').click()");
      await until(`Boolean(document.querySelector('.entry-dock-shell.is-open ${theme === 'classic' ? popups === 'a' ? '.dock-orbit' : '.dock-word' : '.sheet'}'))`);
      await pause(450);
      await screenshot(`look-${theme}-${popups}.png`);
      // Holo-Papier: pressed buttons in mint foil behind frosted film, deleting in orange.
      if (theme === 'nebula' && popups === 'b') {
        // The window is as wide as its widest toolbar row, the close button in its corner.
        assert(await evaluate("(() => { const w=document.querySelector('.entry-dock-shell.is-open .sheet-window'), r=w.getBoundingClientRect(), x=w.querySelector('.sheet-close').getBoundingClientRect(), rows=[...w.querySelectorAll('.sheet-toolbar-row')].map(row => [...row.children].reduce((sum, group) => sum + group.getBoundingClientRect().width + 4, -4)); return rows.length === 2 && r.right - x.right < 6 && r.width - Math.max(...rows) < 20; })()"), 'The action window fits its toolbar, the close button sits in the corner.');
        const remove = await evaluate("(() => { const r=document.querySelector('.entry-dock-shell.is-open .sheet-remove').getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; })()");
        await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:remove.x, y:remove.y }); await pause(250);
        assert.match(await evaluate("getComputedStyle(document.querySelector('.entry-dock-shell.is-open .sheet-remove')).backgroundImage"), /linear-gradient.*url/, 'Deleting shows the frosted orange foil.');
        await screenshot('look-nebula-b-remove.png');
      }
      if (!(theme === 'classic' && popups === 'a')) {
        const id = await evaluate("document.querySelector('.entry-dock-shell.is-open').closest('.entry').dataset.entryId");
        if (theme === 'nebula' && popups === 'a') { await command('Input.insertText',{text:'done'}); await key('Enter','Enter'); }
        else if (theme === 'journal' && popups === 'b') await evaluate("document.querySelector('.entry-dock-shell.is-open .sheet-tab.is-status').click(); document.querySelector('.entry-dock-shell.is-open .sheet-done').click()");
        else if (theme === 'classic') await evaluate("document.querySelector('.entry-dock-shell.is-open .dock-done').click()");
        else await evaluate("document.querySelector('.entry-dock-shell.is-open .sheet-done').click()");
        await until(`document.querySelector('[data-entry-id="${id}"]').dataset.status==='done'`);
        if (theme === 'classic') await key('Escape');
      } else await key('Escape');
      // The planner (Alt T) and the tag picker (Alt G) in the same look; views switch by tab where the look has them.
      await evaluate("document.querySelector('.entry[data-entry-kind=task][data-status=open] .entry-text')?.focus() ?? document.querySelector('.entry[data-entry-kind=task] .entry-text').focus()");
      await key('t','KeyT',1);
      await until("Boolean(document.querySelector('.entry-dock-shell.is-open .planner'))");
      if (!(theme === 'classic' && popups === 'a')) {
        assert(await evaluate("Boolean(document.querySelector('.planner > .chrome-head')) && document.querySelectorAll('.planner .chrome-tabs [role=tab]').length===3"), `The ${theme}-${popups} planner has its own head and tabs.`);
        await evaluate("document.querySelectorAll('.planner .chrome-tabs [role=tab]')[1].click()");
        await until("document.querySelector('.planner').classList.contains('is-time')");
      }
      await pause(350); await screenshot(`look-${theme}-${popups}-planner.png`);
      await key('Escape'); await key('Escape');
      await until("!document.querySelector('.entry-dock-shell.is-open')");
      await evaluate("document.querySelector('.entry .entry-text').focus()");
      await key('g','KeyG',1);
      await until("Boolean(document.querySelector('.tag-picker'))");
      await pause(250); await screenshot(`look-${theme}-${popups}-tags.png`);
      await key('Escape');
      // The calendar's card (right click on an entry), where a calendar is on screen.
      if (await evaluate("Boolean(document.querySelector('.cal-item'))")) {
        await evaluate("document.querySelector('.cal-item').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");
        await until("Boolean(document.querySelector('.cal-composer.is-placed'))");
        if (!(theme === 'classic' && popups === 'a')) assert(await evaluate("Boolean(document.querySelector('.cal-composer > .chrome-head')) && Boolean(document.querySelector('.cal-composer .chrome-submit'))"), 'The card has its head and worded buttons.');
        await pause(300); await screenshot(`look-${theme}-${popups}-composer.png`);
        await key('Escape');
        await until("!document.querySelector('.cal-composer')");
      }
    }
    console.log('Look checks passed.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'multiday') {
    const points=await evaluate("(() => {const cells=[...document.querySelectorAll('.cal-month-day')];return [cells[9],cells[18]].map(e=>{const r=e.getBoundingClientRect();return {x:r.right-12,y:r.bottom-12,date:e.dataset.date};});})()");
    await command('Input.dispatchMouseEvent',{type:'mousePressed',x:points[0].x,y:points[0].y,button:'right',buttons:2,clickCount:1});
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:points[1].x,y:points[1].y,button:'right',buttons:2});
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:points[1].x,y:points[1].y,button:'right',buttons:0,clickCount:1});
    // The normal card opens, with the span's end and everything else (kinds, tag, repeating, reminder).
    await until("Boolean(document.querySelector('.cal-composer.is-placed .cal-multi-form')) && document.activeElement===document.querySelector('.cal-composer-text')");
    assert.equal(await evaluate("document.querySelector('.cal-multi-input.is-end').dataset.value"),points[1].date);
    assert(await evaluate("['.cal-composer-kinds','.cal-composer-repeat','.cal-composer-tag','.cal-composer-reminder','.cal-composer-priority'].every(s=>document.querySelector('.cal-composer '+s))"), 'The span uses the normal calendar card.');
    assert(await evaluate(`document.querySelector('[data-range-date="${points[0].date}"]').hasAttribute('data-range-selected')`),'The draft stays highlighted while the popup is open.');
    const later = new Date(Date.parse(points[0].date)+86400000).toISOString().slice(0,10);
    // Start and end are the app's own fields: a month popup for the day, two scrolling columns for the time.
    const setStart = async value => { await evaluate("document.querySelector('.cal-multi-input.is-start').click()"); await until(`Boolean(document.querySelector('.field-picker [data-date="${value}"]'))`); await evaluate(`document.querySelector('.field-picker [data-date="${value}"]').click()`); await until("!document.querySelector('.field-picker')"); };
    await setStart(later);
    await until(`document.querySelector('.cal-multi-input.is-start').dataset.value===${JSON.stringify(later)} && !document.querySelector('[data-range-date="${points[0].date}"]').hasAttribute('data-range-selected')`);
    await setStart(points[0].date);
    await until(`document.querySelector('[data-range-date="${points[0].date}"]').hasAttribute('data-range-selected')`);
    // The start time in its two columns: an hour, then a minute (which closes the popup).
    await evaluate("document.querySelectorAll('.cal-multi-form .field-trigger.is-time')[0].click()");
    await until("document.querySelectorAll('.field-picker .time-column').length===2");
    assert.equal(await evaluate("document.activeElement?.closest('.time-column.is-hour') ? document.activeElement.dataset.value : null"),'00','The chosen hour has the focus.');
    await pause(250); await screenshot('multi-time-columns.png');
    await evaluate("document.querySelector('.field-picker .time-column.is-hour [data-value=\"09\"]').click()");
    await evaluate("document.querySelector('.field-picker .time-column.is-minute [data-value=\"30\"]').click()");
    await until("!document.querySelector('.field-picker') && document.querySelectorAll('.cal-multi-form .field-trigger.is-time')[0].dataset.value==='09:30'");
    await evaluate("document.querySelector('.cal-composer-text').focus()");
    await pause(300); await screenshot('multi-composer.png');
    // The same fields in Holo-Papier: room between the type and the black frame.
    await evaluate("document.documentElement.dataset.theme='nebula';document.documentElement.dataset.popups='b'");
    await pause(250); await screenshot('multi-composer-holo.png');
    assert(await evaluate("[...document.querySelectorAll('.cal-multi-form .field-trigger')].every(b => { const r=b.getBoundingClientRect(), t=b.querySelector('span').getBoundingClientRect(); return t.top-r.top>=4 && r.bottom-t.bottom>=4 && t.left-r.left>=6; })"), 'Holo fields leave room around their text.');
    await evaluate("document.documentElement.dataset.theme='classic';document.documentElement.dataset.popups='a'");
    await command('Input.insertText',{text:'Multiple days'});
    await key('Enter','Enter');
    await until("!document.querySelector('.cal-composer')");
    await key('s','KeyS',2);
    await until("window.__uiTest.day("+JSON.stringify(points[0].date)+")?.entries.some(e=>e.text==='Multiple days')");
    const saved=await evaluate("window.__uiTest.day("+JSON.stringify(points[0].date)+").entries.find(e=>e.text==='Multiple days')");
    assert.equal(saved.end,'239:59');
    // Open its week and check it occupies the top band, not the hours.
    await evaluate("document.querySelector('.cal-viewbar button[title*=Woche]')?.click()");
    await until("Boolean(document.querySelector('.cal-multiday-bar'))");
    assert(await evaluate("![...document.querySelectorAll('.cal-time-body .cal-item')].some(e=>e.textContent.includes('Multiple days'))"));
    const band=await evaluate("(() => {const cells=[...document.querySelectorAll('.cal-time-allday-cell')],r=cells[0].getBoundingClientRect(),root=document.querySelector('.cal').getBoundingClientRect();return {x:r.left+10,y:r.top+10,right:root.right-5};})()");
    const oldTitle=await evaluate("document.querySelector('.cal-title').textContent");
    await command('Input.dispatchMouseEvent',{type:'mousePressed',x:band.x,y:band.y,button:'right',buttons:2,clickCount:1});
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:band.right,y:band.y,button:'right',buttons:2});
    await until("document.querySelector('.cal-title').textContent!=="+JSON.stringify(oldTitle));
    await pause(150);
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:band.right,y:band.y,button:'right',buttons:0,clickCount:1});
    await until("Boolean(document.querySelector('.cal-composer .cal-multi-form'))");
    const range=await evaluate("[document.querySelector('.cal-composer').getAttribute('aria-label'),document.querySelector('.cal-multi-input.is-end').dataset.value]");
    assert(Date.parse(range[1])-Date.now()>5*86400000,'Drag continues into the next week: '+JSON.stringify(range));
    console.log('Multiday UI passed: ten-day entry, top-band rendering and dragging into the next week.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'calendar-actions') {
    await evaluate("document.querySelector('.cal-item').click()");
    await until("Boolean(document.querySelector('.cal-details'))");
    assert.equal(await evaluate("document.querySelector('.cal-item-note')"),null);
    await key('c','KeyC',2);
    await until("Boolean(localStorage.getItem('journal.calendarClipboard')) && Boolean(document.querySelector('.cal-action-notice'))");
    await key('Escape');
    await until("!document.querySelector('.cal-details')");
    const today=await evaluate('window.__uiTest.date');
    await hoverAt(`document.querySelector('.cal-month-day[data-date="${today}"]')`);
    await key('v','KeyV',2);
    await until("document.querySelectorAll('.entry').length===6");
    await key('s','KeyS',2);
    await hoverAt("document.querySelector('.cal-item')");
    await key('Delete');
    await until("document.querySelectorAll('.entry').length===5");
    await evaluate("(() => {const e=JSON.parse(localStorage.getItem('journal.calendarClipboard'));e.repeat={series:crypto.randomUUID(),horizon:window.__uiTest.shift(10),rule:{start:window.__uiTest.date,unit:'day',every:1,end:{count:3}}};localStorage.setItem('journal.calendarClipboard',JSON.stringify(e));})()");
    await hoverAt(`document.querySelector('.cal-month-day[data-date="${today}"]')`);
    await key('v','KeyV',2);
    await until("document.querySelectorAll('.cal-paste-choice button').length===2");
    await evaluate("document.querySelectorAll('.cal-paste-choice button')[1].click()");
    await until("document.querySelectorAll('.entry').length===6");
    await key('s','KeyS',2);
    await until("window.__uiTest.series.size>0");
    console.log('Calendar actions passed: click details, copy feedback, paste, hover Delete and copying a new repeating series.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'small-fixes') {
    await key(',', 'Comma', 2);
    await until("Boolean(document.querySelector('.scale-slider input'))");
    await evaluate("(() => {const e=document.querySelector('.scale-slider input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'137');e.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await until("document.querySelector('.scale-slider output').textContent==='137 %'");
    assert.equal(await evaluate("JSON.parse(localStorage.getItem('journal.settings')).uiScale"),'137');
    await key('Escape');
    await until("!document.querySelector('.settings')");
    assert(await evaluate("Boolean(document.querySelector('.has-journal-content'))"),'Days with journal content have an outline.');
    await evaluate("document.querySelector('.board-actions button').click()");
    await until("Boolean(document.querySelector('.board-note .cm-content'))");
    await evaluate("document.querySelector('.board-note .cm-content').focus()");
    await command('Input.insertText',{text:'First line\nLast line editable'});
    await evaluate("document.querySelector('.board-card').style.height='160px';document.querySelector('.board-card').classList.add('has-height');document.querySelector('.board-note').scrollTop=999;document.documentElement.dataset.pixel=''");
    await pause(400);
    const point=await evaluate("(() => {const l=[...document.querySelectorAll('.board-note .cm-line')].at(-1);l.scrollIntoView({block:'center'});const r=l.getBoundingClientRect();return {x:r.left+8,y:r.top+r.height/2};})()");
    await command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1});
    await command('Input.insertText',{text:'X'});
    await until("document.querySelector('.board-note .entry-text').value.includes('XLast') || document.querySelector('.board-note .entry-text').value.includes('LXast')");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.board-card')).overflow"),'visible');
    console.log('Small fixes passed: arbitrary scale, journal outline, last-line mouse editing and unclipped note card.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'undo') {
    await evaluate("window.__sameApp=document.querySelector('.app');window.__sameRow=document.querySelector('.entry');true");
    await key('a','KeyA',1);
    await until("document.querySelectorAll('.entry').length===6 && document.activeElement?.classList.contains('entry-text')");
    const id=await evaluate("document.activeElement.closest('[data-entry-id]').dataset.entryId");
    await command('Input.insertText',{text:'Undo text'});
    await key('z','KeyZ',2);
    await until("document.activeElement.value===''");
    await key('z','KeyZ',2);
    await until(`!document.querySelector('[data-entry-id="${id}"]')`);
    assert(await evaluate("window.__sameApp===document.querySelector('.app') && window.__sameRow===document.querySelector('.entry')"), 'Undo must preserve mounted UI elements.');
    await key('y','KeyY',2);
    await until(`Boolean(document.querySelector('[data-entry-id="${id}"]'))`);
    assert(await evaluate("window.__sameApp===document.querySelector('.app')"), 'Redo must not reload the page.');
    // An external history restore also refreshes the existing editor, without remounting it.
    await evaluate("(() => {const d=window.__uiTest.day();d.entries[0].text='Restored content';window.__uiTest.store(d);window.__uiTest.emit('history:restored',null);})()");
    await until("document.querySelector('.entry .entry-text').value==='Restored content'");
    assert(await evaluate("window.__sameRow===document.querySelector('.entry')"));
    console.log('Undo UI passed: local text undo, empty entry removal, redo and in-place refresh.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'board') {
    await until("Boolean(document.querySelector('.bulletin-board'))");
    await evaluate("document.querySelector('.board-actions button').click()");
    await until("document.querySelectorAll('.board-card').length===1");
    await evaluate("document.querySelector('.board-note .cm-content').focus()");
    await command('Input.insertText',{text:'**Markdown note**'});
    await until("JSON.parse(sessionStorage.boardCards)[0].text==='**Markdown note**'");
    // Notes also know blocks: heading, bullets, checkboxes, a code block with copy, a table that grows by + and Enter.
    await evaluate("(() => {const view=document.querySelector('.board-note .cm-content').cmView?.view; return true;})()");
    await command('Input.insertText',{text:'\n# Plan\n- Punkt\n- [ ] Erledigen\n```js\nconst a = 1;\n```\n| A | B |\n| --- | --- |\n| 1 | 2 |'});
    await until("JSON.parse(sessionStorage.boardCards)[0].text.endsWith('| 1 | 2 |')");
    await evaluate("document.querySelector('.board-head h3').click(); document.activeElement.blur()");
    await until("Boolean(document.querySelector('.board-note .md-h1')) && Boolean(document.querySelector('.board-note .md-bullet')) && Boolean(document.querySelector('.board-note .md-checkbox')) && Boolean(document.querySelector('.board-note .md-code-copy')) && document.querySelectorAll('.board-note .md-table td').length===2");
    await evaluate("document.querySelector('.board-note .md-checkbox').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}))");
    await until("JSON.parse(sessionStorage.boardCards)[0].text.includes('- [x] Erledigen')");
    await evaluate("document.querySelector('.board-note .md-table-add-row').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}))");
    await until("JSON.parse(sessionStorage.boardCards)[0].text.trim().split('\\n').filter(line=>line.startsWith('|')).length===4");
    await evaluate("document.querySelector('.board-head h3').click(); document.activeElement.blur()");
    await until("Boolean(document.querySelector('.board-note .md-table-add-col'))");
    await evaluate("document.querySelector('.board-note .md-table-add-col').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}))");
    await until("JSON.parse(sessionStorage.boardCards)[0].text.includes('| A | B |   |')");
    await evaluate("document.querySelector('.board-head h3').click(); document.activeElement.blur()");
    await pause(200); await screenshot('board-note-blocks.png');
    // The format menu by key (Ctrl+.) in front of the cards, its buttons reachable by arrows; Escape returns to the text.
    await evaluate("document.querySelector('.board-note .cm-content').focus()");
    await key('.', 'Period', 2);
    await until("Boolean(document.querySelector('.format-menu .format-blocks')) && document.activeElement?.closest('.format-menu')!==null");
    assert(await evaluate("(() => {const m=document.querySelector('.format-menu'),r=m.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return m.contains(hit) && Number(getComputedStyle(m).zIndex)>1000;})()"), 'The format menu lies in front of the notes.');
    await key('ArrowRight', 'ArrowRight');
    await key('Escape');
    await until("!document.querySelector('.format-menu') && document.activeElement?.classList.contains('cm-content')");
    // A note's corner sets its size, kept after letting go.
    await evaluate("document.querySelector('.board-head h3').click(); document.activeElement.blur()");
    const corner=await evaluate("(() => {const c=document.querySelector('.board-card.is-note'),r=c.querySelector('.board-resize').getBoundingClientRect();return {id:c.dataset.boardId,width:c.offsetWidth,x:r.left+r.width/2,y:r.top+r.height/2};})()");
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:corner.x,y:corner.y});
    await command('Input.dispatchMouseEvent',{type:'mousePressed',x:corner.x,y:corner.y,button:'left',buttons:1,clickCount:1});
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:corner.x+80,y:corner.y+40,button:'left',buttons:1});
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:corner.x+80,y:corner.y+40,button:'left',buttons:0,clickCount:1});
    await until(`(() => {const card=JSON.parse(sessionStorage.boardCards).find(c=>c.id===${JSON.stringify(corner.id)});return Math.abs(card.w-${corner.width}-80)<3 && card.h>100;})()`);
    await evaluate("document.querySelectorAll('.board-actions button')[2].click()");
    await evaluate("document.querySelector('.board-link-form input').focus()");
    await command('Input.insertText',{text:'https://example.com/'});
    await evaluate("document.querySelector('.board-link-form').requestSubmit()");
    await until("document.querySelector('.board-link strong')?.textContent==='Board test page'");
    await evaluate("new Promise(resolve=>{const c=document.createElement('canvas');c.width=160;c.height=100;const ctx=c.getContext('2d');ctx.fillStyle='#AEFF00';ctx.fillRect(0,0,160,100);c.toBlob(blob=>{const transfer=new DataTransfer();transfer.items.add(new File([blob],'test-image.png',{type:'image/png'}));const input=document.querySelector('.bulletin-board input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));resolve(true);});})");
    await until("document.querySelectorAll('.board-card').length===3",30000);
    await until("document.querySelector('.board-image img')?.naturalWidth===160");
    assert(await evaluate("Object.values(sessionStorage).some(s=>s.startsWith('AAAA')&&s.includes('Z0')) || Object.keys(sessionStorage).some(k=>k.startsWith('boardImage:'))"));
    await evaluate("document.querySelector('.bulletin-board').scrollIntoView({block:'start'})");
    // Cards lie on the board without overlapping, each pinned; a click on an image opens it large.
    assert(await evaluate("(() => {const r=[...document.querySelectorAll('.board-card')].map(c=>c.getBoundingClientRect());return r.every((a,i)=>r.every((b,j)=>i===j||a.right<=b.left+8||b.right<=a.left+8||a.bottom<=b.top+8||b.bottom<=a.top+8)) && document.querySelectorAll('.board-card .board-pin').length===3;})()"), 'New cards find a free place on the board.');
    await screenshot('board-classic.png');
    await evaluate("document.querySelector('.board-image').click()");
    await until("document.querySelector('.board-lightbox img')?.naturalWidth===160");
    await pause(300); await screenshot('board-lightbox.png');
    await key('Escape');
    await until("!document.querySelector('.board-lightbox')");
    await evaluate("document.documentElement.dataset.pixel=''");
    await until("Boolean(document.querySelector('.board-pixel-switch'))");
    await evaluate("document.querySelector('.board-pixel-switch').click()");
    await until("document.querySelector('.board-image canvas')?.width===48");
    await screenshot('board-pixel.png');
    await evaluate("document.querySelector('.board-image').click()");
    await until("document.querySelector('.board-lightbox canvas')?.width===96");
    await pause(300); await screenshot('board-pixel-lightbox.png');
    await key('Escape');
    await until("!document.querySelector('.board-lightbox')");
    // New notebook threads: both ends persist together, and the thread menu cuts both ends.
    await evaluate("document.querySelector('.board-card.is-note').focus()");
    await key('l','KeyL',1);
    await until("Boolean(document.querySelector('.board-thread.is-drawing'))");
    await key('Enter');
    await until("JSON.parse(sessionStorage.boardCards).filter(c=>c.links?.length).length===2");
    await evaluate("document.querySelector('.board-thread-hit').focus()");await key('Enter');
    await until("Boolean(document.querySelector('.board-thread-cut'))");
    await evaluate("document.querySelector('.board-thread-cut').click()");
    await until("JSON.parse(sessionStorage.boardCards).every(c=>!c.links?.length)");
    // Every card has the reserved extra button. An image tied to a link makes a bundle; a note tied to it then has both.
    assert.equal(await evaluate("document.querySelectorAll('.board-card .board-extra').length"), 3, 'Each card has the extra button.');
    await evaluate("document.querySelector('.board-card.is-image').focus()");
    await key('l','KeyL',1);
    for (let i = 0; i < 3 && !(await evaluate("Boolean(document.querySelector('.board-card.is-link.is-link-target'))")); i++) await key('ArrowRight','ArrowRight');
    await key('Enter');
    await until("(() => {const c=JSON.parse(sessionStorage.boardCards),i=c.find(x=>x.kind==='image'),l=c.find(x=>x.kind==='link');return i.links?.includes(l.id)&&l.links?.includes(i.id);})()");
    assert.match(await evaluate("document.querySelector('.board-status')?.textContent||''"), /Bündel/, 'Image and link make a bundle.');
    await evaluate("document.querySelector('.board-thread-hit').focus()");await key('Enter');
    await until("Boolean(document.querySelector('.board-thread-cut'))");
    await evaluate("document.querySelector('.board-thread-cut').click()");
    await until("JSON.parse(sessionStorage.boardCards).every(c=>!c.links?.length) && !document.querySelector('.board-status')"); await pause(200);
    // Dragged by its paper, a card stays where it is let go (and comes to the top).
    const dragCard=await evaluate("(() => {const c=document.querySelector('.board-card.is-note'),r=c.getBoundingClientRect();return {id:c.dataset.boardId,left:c.offsetLeft,top:c.offsetTop,start:{x:r.left+18,y:r.top+6},end:{x:r.left+18+60,y:r.top+6+90}};})()");
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',...dragCard.start});
    await command('Input.dispatchMouseEvent',{type:'mousePressed',...dragCard.start,button:'left',buttons:1,clickCount:1});
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',...dragCard.end,button:'left',buttons:1});
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',...dragCard.end,button:'left',buttons:0,clickCount:1});
    await until(`(() => {const card=JSON.parse(sessionStorage.boardCards).find(c=>c.id===${JSON.stringify(dragCard.id)});return Math.abs(card.y-${dragCard.top}-90)<3;})()`);
    await evaluate("document.querySelector('.board-card header button[title*=schwebende]').click()");
    await until("window.__uiTest.invoked.some(x=>x[0]==='board_detach')");
    await command('Page.reload');
    await until("document.querySelectorAll('.board-card').length===3");
    assert(await evaluate("document.querySelector('.board-note').textContent.includes('Markdown note')"));
    const noteId=await evaluate("JSON.parse(sessionStorage.boardCards).find(c=>c.kind==='note').id");
    await evaluate(`document.querySelector('[data-board-id="${noteId}"] header button:last-child').click()`);
    await until("document.querySelectorAll('.board-card').length===2");
    await evaluate("document.querySelectorAll('.board-actions button')[3].click()");
    await evaluate("document.querySelector('.board-library>button').click()");
    await until("document.querySelectorAll('.board-card').length===3");
    await evaluate(`document.querySelector('[data-board-id="${noteId}"] .board-detach').click()`);
    await command('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?window=board-${noteId}`});
    await until("Boolean(document.querySelector('.floating-note .cm-content'))");
    await evaluate("document.querySelector('.floating-note .cm-content').focus()");
    await command('Input.insertText',{text:'Floating update '});
    await until("JSON.parse(sessionStorage.boardCards).some(c=>c.text.includes('Floating update'))");
    await evaluate("document.querySelector('.floating-note button[aria-pressed]').click()");
    await until("document.querySelector('.floating-note button[aria-pressed=false]')!==null");
    await screenshot('board-floating.png');
    assert.deepEqual(errors,[]);
    console.log('Board checks passed: markdown, AVIF encoding and decoding, link preview, pixel rendering, detach request and reload persistence.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'trackpad') {
    const position = await evaluate("(() => { const r=document.querySelector('.document-header').getBoundingClientRect();window.__stationaryHeader=document.querySelector('.document-header'); return {x:r.left+150,y:r.top+30}; })()");
    const wheel = (deltaX,deltaY) => command('Input.dispatchMouseEvent',{type:'mouseWheel',...position,deltaX,deltaY});
    const dateText = "document.querySelector('.date-picker-button').textContent";
    const initial = await evaluate(dateText);
    await wheel(35,0); await wheel(35,0);
    await until(`${dateText}!==${JSON.stringify(initial)}`);
    const second = await evaluate(dateText);
    await pause(350);
    await wheel(35,0); await wheel(35,0);
    await until(`${dateText}!==${JSON.stringify(second)}`);
    assert(await evaluate("window.__stationaryHeader===document.querySelector('.document-header')"));
    assert(await evaluate("(() => { const e=new WheelEvent('wheel',{deltaX:20,bubbles:true,cancelable:true});document.querySelector('.document-header').dispatchEvent(e);return e.defaultPrevented; })()"));
    await pause(350);
    for (let tab=1;tab<5;tab++) {
      await evaluate(`document.querySelectorAll('.journal-tab')[${tab}].click()`);
      const title = await evaluate("document.querySelector('.period-section h1').textContent");
      await evaluate("window.__beforeMain=document.querySelector('.main').getBoundingClientRect().toJSON()");
      await wheel(35,0); await wheel(35,0);
      await until(`document.querySelector('.period-section h1').textContent!==${JSON.stringify(title)}`);
      await pause(350);
      await wheel(0,120);
      await wheel(0,-120);
      assert(await evaluate("window.scrollX===0 && window.scrollY===0 && document.querySelector('.scroll').scrollLeft===0 && Math.abs(document.querySelector('.main').getBoundingClientRect().left-window.__beforeMain.left)<1"));
      await pause(350);
    }
    await evaluate("document.querySelectorAll('.journal-tab')[0].click()");
    await pause(350);
    const calPoint=await evaluate("(() => { const r=document.querySelector('.sidebar .cal-body').getBoundingClientRect();return {x:r.left+100,y:r.top+80}; })()");
    for(let gesture=0;gesture<2;gesture++) {
      const title=await evaluate("document.querySelector('.sidebar .cal-title').textContent");
      await command('Input.dispatchMouseEvent',{type:'mouseWheel',...calPoint,deltaX:80,deltaY:0});
      await until(`document.querySelector('.sidebar .cal-title').textContent!==${JSON.stringify(title)}`);
      await pause(350);
    }
    await evaluate("document.querySelectorAll('.journal-tab')[4].click()");
    await command('Emulation.setDeviceMetricsOverride', { width:820, height:780, deviceScaleFactor:1, mobile:false });
    await evaluate("document.querySelector('.heatmap-scroll').scrollIntoView({block:'center'})");
    const heatmapPoint=await evaluate("(() => { const e=document.querySelector('.heatmap-scroll'), r=e.getBoundingClientRect();e.scrollLeft=0;return {x:r.left+80,y:r.top+40}; })()");
    const samePeriod=await evaluate("document.querySelector('.period-section h1').textContent");
    await pause(350);
    await command('Input.dispatchMouseEvent',{type:'mouseWheel',...heatmapPoint,deltaX:110,deltaY:0});
    await until("document.querySelector('.heatmap-scroll').scrollLeft>0");
    assert.equal(await evaluate("document.querySelector('.period-section h1').textContent"),samePeriod);
    assert.deepEqual(errors,[]);
    console.log('Trackpad checks passed: successive stationary-pointer gestures, all period tabs, calendar paging and no document movement.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'activity-timer') {
    await until("Boolean(document.querySelector('.timer-start'))");
    const reading = "document.querySelector('.period-item[data-activity-id=reading]')";
    assert.equal(await evaluate(`getComputedStyle(${reading}.querySelector('input[type=checkbox]')).opacity`),'1');
    // The daily checklist has no reordering (the order is set in the settings) and no saved note.
    assert.equal(await evaluate("document.querySelectorAll('.period-section .activity-reorder, .period-save-status').length"),0);
    // Every activity gets its own tag at once; calendar entries with it count as the activity's time.
    await until("window.__uiTest.periodData?.definitions.every(d => d.calendarTagId && window.__uiTest.tags().some(t => t.id===d.calendarTagId && t.name===d.name))");
    await evaluate("window.__timerOffset=0;window.__realNow=Date.now;Date.now=()=>window.__realNow()+window.__timerOffset");
    await evaluate(`${reading}.querySelector('.timer-start').click()`);
    await until(`${reading}.querySelector('.timer-pause')!==null`);
    await evaluate('window.__timerOffset=120000');
    await evaluate(`${reading}.querySelector('.timer-pause').click()`);
    await until(`${reading}.querySelector('output').textContent==='00:02:00'`);
    await command('Page.reload');
    await until("Boolean(document.querySelector('.period-item .timer-stop'))");
    assert.equal(await evaluate(`${reading}.querySelector('output').textContent`),'00:02:00');
    await evaluate("window.__timerOffset=0;window.__realNow=Date.now;Date.now=()=>window.__realNow()+window.__timerOffset");
    await evaluate("document.querySelectorAll('.journal-tab')[1].click()");
    await evaluate("document.querySelectorAll('.journal-tab')[0].click()");
    await until(`${reading}.querySelector('.timer-start')!==null`);
    await evaluate('window.__timerOffset=300000');
    await evaluate(`${reading}.querySelector('.timer-start').click()`);
    await evaluate('window.__timerOffset=360000');
    await evaluate(`${reading}.scrollIntoView({block:'center'})`);
    await pause(600); await screenshot('activity-timer-running.png');
    await evaluate('window.__uiTest.failPeriodSave=true');
    await evaluate(`${reading}.querySelector('.timer-stop').click()`);
    await until(`${reading}.querySelector('.activity-timer .error')?.textContent.includes('Timer save test failure')`);
    assert.equal(await evaluate("window.__uiTest.day().entries.filter(e=>e.calendarUid?.startsWith('activity-time:')).length"),2);
    await evaluate(`${reading}.querySelector('.timer-stop').click()`);
    // The typed 30 minutes stay as they are; the timer's time comes from its calendar entries and is shown on top.
    await until("Object.keys(JSON.parse(localStorage.getItem('journal.activityTimers.v1'))).length===0");
    assert.equal(await evaluate("window.__uiTest.periodData.days[window.__uiTest.date].items.reading.minutes"),30);
    await until(`Number(${reading}.querySelector('input[type=number]').value)>=33`);
    assert.equal(await evaluate("window.__uiTest.day().entries.filter(e=>e.calendarUid?.startsWith('activity-time:')).length"),2);
    assert(await evaluate("window.__uiTest.day().entries.filter(e=>e.calendarUid?.startsWith('activity-time:')).every(e=>e.showInJournal===false && e.tag && e.end>e.time)"));
    // Changing that time in the calendar changes the checklist; a new entry with the tag adds to it.
    const readingTag = await evaluate("window.__uiTest.periodData.definitions.find(d => d.id==='reading').calendarTagId");
    await evaluate(`(() => { const day=window.__uiTest.day(); for (const e of day.entries) if (e.calendarUid?.startsWith('activity-time:')) { e.time='10:00'; e.end='10:00'; } { const first=day.entries.find(e => e.calendarUid?.startsWith('activity-time:')); first.end='10:40'; } day.entries.push({ id:crypto.randomUUID(), kind:'event', text:'Lesen im Park', done:false, cancelled:false, priority:false, time:'18:00', end:'18:20', tag:${JSON.stringify(readingTag)}, plan:null }); return window.__uiTest.store(day); })()`);
    await until(`${reading}.querySelector('input[type=number]').value==='90'`);
    assert.equal(await evaluate("window.__uiTest.periodData.days[window.__uiTest.date].items.reading.minutes"),30);
    await evaluate('Date.now=window.__realNow');
    await screenshot('activity-timer-saved.png');
    assert.deepEqual(errors,[]);
    console.log('Timer UI checks passed: checkbox, reorder, pause/resume, calendar import and retry without duplicate minutes or events.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'periods') {
    await until("Boolean(document.querySelector('#daily-rating'))");
    assert.equal(await evaluate("document.querySelectorAll('.journal-tab .icon').length"),6,'Five views and the notebook.');
    await evaluate("document.querySelector('#daily-rating').focus()");
    await key('End','End');
    await until("window.__uiTest.periodData?.days[window.__uiTest.date]?.rating===10");
    await evaluate("document.querySelector('.period-section').scrollIntoView({block:'start'})");
    await screenshot('period-orbit.png');
    // The journal's action layout is an entry setting: the checklist below keeps its look and size.
    const checklistShape = "JSON.stringify([...document.querySelectorAll('.period-item')].map(e => { const r=e.getBoundingClientRect(); return [document.querySelector('.period-section').className, r.height, r.width, getComputedStyle(e.querySelector('input[type=checkbox]')).boxShadow]; }))";
    const beforeLayout = await evaluate(checklistShape);
    await key(',', 'Comma', 2);
    await until("Boolean(document.querySelector('.settings'))");
    await evaluate("document.querySelector('[data-popup-style=b]').click()");
    await key('Escape');
    await until("!document.querySelector('.settings')");
    await pause(200);
    assert.equal(await evaluate(checklistShape), beforeLayout);
    await screenshot('period-inline.png');
    await key(',', 'Comma', 2);
    await until("Boolean(document.querySelector('[data-pixel-toggle]'))");
    await evaluate("(() => { const s=document.querySelector('[data-pixel-toggle]'); if (s.getAttribute('aria-checked')!=='true') s.click(); })()");
    await key('Escape');
    await until("!document.querySelector('.settings') && document.documentElement.dataset.pixel!==undefined");
    await evaluate("document.querySelector('.period-item input[type=checkbox]').click()");
    await evaluate("document.querySelector('.checklist-section-heading').scrollIntoView({block:'start'})");
    await pause(300); await screenshot('period-pixel.png');
    await evaluate("document.querySelector('.period-item input[type=checkbox]').click()");
    await key(',', 'Comma', 2);
    await until("Boolean(document.querySelector('[data-theme-choice=classic]'))");
    await evaluate("document.querySelector('[data-theme-choice=classic]').click()");
    await evaluate("(() => { const s=document.querySelector('[data-pixel-toggle]'); if (s.getAttribute('aria-checked')==='true') s.click(); })()");
    await key('Escape');
    await until("!document.querySelector('.settings') && document.documentElement.dataset.pixel===undefined");
    await evaluate("document.querySelector('.period-item input[type=number]').focus();document.querySelector('.period-item input[type=number]').select()");
    await command('Input.insertText',{text:'95'});
    await until("window.__uiTest.periodData?.days[window.__uiTest.date]?.items.reading.minutes===95");
    await evaluate("document.querySelector('.period-item input[type=checkbox]').click()");
    await evaluate("document.querySelectorAll('.journal-tab')[1].click()");
    // The week's total: the typed 95 minutes today plus the other days of this week so far.
    const weekMinutes = await evaluate("(() => { const d=window.__uiTest.periodData.days, t=new Date(); const monday=new Date(t.getFullYear(), t.getMonth(), t.getDate() - (t.getDay()+6)%7, 12); let sum=0; for (let i=0;i<7;i++) { const x=new Date(monday.getFullYear(), monday.getMonth(), monday.getDate()+i, 12); const key=[x.getFullYear(), String(x.getMonth()+1).padStart(2,'0'), String(x.getDate()).padStart(2,'0')].join('-'); sum += d[key]?.items?.reading?.minutes ?? 0; } return sum; })()");
    const weekText = `${Math.floor(weekMinutes / 60)} h${weekMinutes % 60 ? ` ${weekMinutes % 60} min` : ''}`;
    await until(`document.querySelector('.activity-metrics strong')?.textContent.includes(${JSON.stringify(weekText)})`);
    await evaluate("document.querySelector('.activity-summary-card').scrollIntoView({block:'center'})");
    await screenshot('period-week-activities.png');
    await evaluate("document.querySelector('.checklist-manage').click()");
    await until("Boolean(document.querySelector('#settings-activities'))");
    await pause(300);
    await screenshot('period-activity-settings.png');
    await evaluate("document.querySelector('.activity-settings-row .color-well').click()");
    await until("Boolean(document.querySelector('.color-picker-swatches'))");
    await evaluate("document.querySelector('.color-picker-swatches button[aria-label=\"#e6a85c\"]').click()");
    await key('Escape');
    await until("window.__uiTest.periodData.definitions[0].color==='#e6a85c'");
    assert.equal(await evaluate("document.querySelectorAll('.activity-settings-row:first-child .activity-palette-swatches > span').length"),7);
    assert.equal(await evaluate("document.querySelectorAll('.activity-settings-row:first-child .activity-palette-swatches > span')[3].style.backgroundColor"),'rgb(230, 168, 92)');
    await pause(200); await screenshot('period-activity-palette.png');
    await evaluate("document.querySelectorAll('.activity-settings-row .activity-options input')[1].click();document.querySelectorAll('.activity-settings-row .activity-options input')[2].click()");
    await until("window.__uiTest.periodData.definitions[0].trackTime===false && window.__uiTest.periodData.definitions[0].textField===false");
    await key('Escape');
    await evaluate("document.querySelectorAll('.journal-tab')[0].click()");
    await until("document.querySelectorAll('.period-item')[0].querySelector('input[type=number]')===null && document.querySelectorAll('.period-item')[0].querySelector('input[type=text]')===null");
    await evaluate("document.querySelector('.checklist-manage').click()");
    await until("Boolean(document.querySelector('#settings-activities'))");
    await evaluate("document.querySelectorAll('.activity-settings-row .activity-options input')[1].click()");
    await key('Escape');
    await until("!document.querySelector('.settings') && document.querySelector('.period-item input[type=number]')?.value==='95'");
    await evaluate("document.querySelectorAll('.journal-tab')[2].click()");
    await until("document.querySelectorAll('.chart-hit').length>=28");
    assert.equal(await evaluate("Boolean(document.querySelector('.nav-current-period'))"),false);
    await evaluate("document.querySelector('.scroll').scrollTop=0");
    await screenshot('period-month.png');
    await until("document.querySelectorAll('.activity-heatmap.is-calendar').length===2");
    const currentDate = await evaluate('window.__uiTest.date');
    assert.equal(await evaluate(`document.querySelector('.activity-heatmap [data-date="${currentDate}"]').dataset.level`),'4');
    await evaluate(`document.querySelector('.activity-heatmap [data-date="${currentDate}"]').focus()`);
    await key('ArrowRight','ArrowRight');
    assert.equal(await evaluate('document.activeElement.dataset.date'),await evaluate('window.__uiTest.shift(1)'));
    await evaluate("document.querySelector('.activity-summary-grid').scrollIntoView({block:'center'})");
    await screenshot('period-month-heatmap.png');
    await evaluate("document.querySelectorAll('.journal-tab')[3].click()");
    await until("document.querySelectorAll('.activity-heatmap.is-contributions').length===2");
    assert.equal(await evaluate("document.querySelector('.activity-heatmap').querySelectorAll('.heatmap-cell').length"),92);
    await evaluate("document.querySelector('.activity-summary-grid').scrollIntoView({block:'center'})");
    await screenshot('period-quarter-heatmap.png');
    await evaluate("document.querySelectorAll('.journal-tab')[4].click()");
    await until("document.querySelectorAll('.chart-hit').length===12");
    await screenshot('period-year.png');
    assert.equal(await evaluate("document.querySelector('.activity-heatmap').querySelectorAll('.heatmap-cell').length"),365);
    await evaluate("document.querySelector('.activity-summary-grid').scrollIntoView({block:'center'})");
    await screenshot('period-year-heatmap.png');
    await command('Emulation.setDeviceMetricsOverride', { width:820, height:780, deviceScaleFactor:1, mobile:false });
    await screenshot('period-year-heatmap-narrow.png');
    assert(await evaluate("document.querySelector('.main').scrollWidth<=document.querySelector('.main').clientWidth+1"));
    assert.deepEqual(errors,[]);
    console.log('Period UI checks passed: slider save, icons, layouts and monthly/yearly charts.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'drive') { await checkDrive(); } else if (process.env.JOURNAL_UI_SCOPE === 'colors') {
    await checkColors();
  } else if (process.env.JOURNAL_UI_SCOPE === 'tags') {
    await checkTags();
  } else if (process.env.JOURNAL_UI_SCOPE === 'language') {
    await checkLanguage();
  } else if (process.env.JOURNAL_UI_SCOPE === 'journal') {
    await checkJournalTheme();
  } else if (process.env.JOURNAL_UI_SCOPE === 'pixel') {
    await checkPixelTheme();
  } else if (process.env.JOURNAL_UI_SCOPE === 'nebula-sizing') {
    await evaluate("localStorage.setItem('journal.settings',JSON.stringify({...JSON.parse(localStorage.getItem('journal.settings')||'{}'),theme:'nebula'}));localStorage.removeItem('journal.nebulaLayout');localStorage.setItem('journal.calendarDrawer','1');localStorage.setItem('journal.notebookDrawer','1');localStorage.removeItem('journal.nebulaWindow.calendar');localStorage.removeItem('journal.nebulaWindow.notebook');");
    await command('Emulation.setDeviceMetricsOverride',{width:1800,height:900,deviceScaleFactor:1,mobile:false});
    await command('Page.reload');
    await until("Boolean(document.querySelector('.nebula-notebook.is-open'))");await pause(500);
    assert(await evaluate("Math.abs(document.querySelector('.nebula-calendar').getBoundingClientRect().right-document.querySelector('.nebula-notebook').getBoundingClientRect().left)<1"),'Windows share a seam');
    assert(await evaluate("Math.abs(document.querySelector('[data-panel=data]').getBoundingClientRect().height-document.querySelector('[data-panel=board]').getBoundingClientRect().height)<1"),'Default data and board heights match');
    await screenshot('nebula-adjacent.png');
    await evaluate("document.querySelector('.nebula-calendar-close').click();document.querySelector('.nebula-notebook .nebula-calendar-close').click()");
    const resize = async delta => { await evaluate(`(() => {const grip=document.querySelector('[data-panel=data] .nebula-panel-resize');grip.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientY:0}));window.dispatchEvent(new PointerEvent('pointermove',{clientY:${delta}}));window.dispatchEvent(new PointerEvent('pointerup'));})()`);await pause(150); };
    await resize(1000);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-panel=data] .nebula-panel-body')).overscrollBehaviorY"),'auto','A resized panel without overflow lets the desk scroll');
    await resize(-2000);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-panel=data] .nebula-panel-body')).overscrollBehaviorY"),'contain','Overflowing panel keeps scrolling inside');
    assert.deepEqual(errors,[]);console.log('Nebula sizing passed: adjacent windows, equal default heights and overflow-dependent scroll containment.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'nebula') {
    await checkNebulaTheme();
  } else if (process.env.JOURNAL_UI_SCOPE === 'popups') {
    // Two looks of the popups per design: the planner (Alt+T) and editing a calendar entry (right click).
    const origin = `http://127.0.0.1:${server.address().port}`;
    await command('Emulation.setDeviceMetricsOverride',{width:1380,height:860,deviceScaleFactor:1,mobile:false});
    for (const theme of ['classic', 'journal', 'nebula']) for (const style of ['a', 'b']) {
      await evaluate(`localStorage.setItem('journal.settings', JSON.stringify({...JSON.parse(localStorage.getItem('journal.settings')||'{}'), theme:'${theme}', popupStyle:'${style}', pixel:false, colorTheme:'${theme === 'journal' ? 'paper' : 'original'}'})); localStorage.setItem('journal.calendarDrawer','0'); localStorage.setItem('journal.calendar', JSON.stringify({view:'month', kinds:{event:true,task:true,note:false}}))`);
      await command('Page.navigate', { url:origin });
      await until(`document.documentElement.dataset.theme==='${theme}' && document.documentElement.dataset.popups==='${style}' && document.querySelectorAll('.entry').length===5`);
      await evaluate("document.fonts.ready.then(() => true)");
      await evaluate("[...document.querySelectorAll('.entry')].find(e => e.dataset.entryKind==='task' && e.dataset.status==='open').querySelector('.entry-text').focus()");
      await key('t', 'KeyT', 1);
      await until("Boolean(document.querySelector('.planner-grid'))");
      await pause(450); await screenshot(`popups-${theme}-${style}-planner.png`);
      assert(await evaluate("(() => { const r=document.querySelector('.planner').getBoundingClientRect(); return r.width>200 && r.top>=0 && r.bottom<=innerHeight; })()"), `The planner is on screen (${theme} ${style}).`);
      if (theme === 'nebula' && style === 'a') assert.match(await evaluate("getComputedStyle(document.querySelector('.planner'), '::before').content"), /plan\.sh/);
      await key('Escape'); await until("!document.querySelector('.planner-grid')");
      // Several days (Alt ⇧ T): a range of days in the look's own band, its ends as handles.
      await evaluate("[...document.querySelectorAll('.entry')].find(e => e.dataset.entryKind==='task' && e.dataset.status==='open').querySelector('.entry-text').focus()");
      await key('T', 'KeyT', 9);
      await until("Boolean(document.querySelector('.planner.is-multi .planner-grid'))");
      await pause(300);
      const rangeDays = await evaluate("[...document.querySelectorAll('.planner.is-multi .planner-day:not(.is-outside):not(.is-past)')].slice(1, 6).map(d => d.getAttribute('aria-label'))");
      for (const label of [rangeDays[0], rangeDays[4]]) { await evaluate(`document.querySelector('.planner-day[aria-label=${JSON.stringify(label)}]').click()`); await pause(120); }
      await until("document.querySelectorAll('.planner.is-multi .planner-day.in-range').length===5");
      const look = selector => evaluate(`(() => { const c=getComputedStyle(document.querySelector('${selector}')); return c.backgroundColor + ' ' + c.boxShadow; })()`);
      const ends = await look('.planner.is-multi .planner-day.range-end'), middle = await look('.planner.is-multi .planner-day.in-range:not(.range-start):not(.range-end)');
      assert.notEqual(ends, middle, `The range's ends stand out from its band (${theme} ${style}).`);
      await pause(300); await screenshot(`popups-${theme}-${style}-range.png`);
      await key('Escape'); await until("!document.querySelector('.planner-grid')");
      if (theme !== 'classic') { await evaluate("document.activeElement?.blur()"); await key('k', 'KeyK', 2); }
      const host = theme === 'classic' ? '.sidebar' : theme === 'journal' ? '.calendar-drawer' : '.nebula-calendar';
      await until(`Boolean(document.querySelector('${host} .cal-item'))`);
      await pause(theme === 'classic' ? 100 : 800);
      await evaluate(`(() => { const item=document.querySelector('${host} .cal-item'); const r=item.getBoundingClientRect(); item.dispatchEvent(new MouseEvent('contextmenu', { bubbles:true, cancelable:true, clientX:r.left+5, clientY:r.top+5 })); })()`);
      await until("Boolean(document.querySelector('.cal-composer.is-placed'))");
      await pause(450); await screenshot(`popups-${theme}-${style}-composer.png`);
      assert(await evaluate("(() => { const r=document.querySelector('.cal-composer').getBoundingClientRect(); return r.width>200 && r.top>=0 && r.left>=0 && r.bottom<=innerHeight && r.right<=innerWidth; })()"), `The composer is on screen (${theme} ${style}).`);
      await key('Escape'); await until("!document.querySelector('.cal-composer')");
    }
    assert.deepEqual(errors, []);
    console.log('Popup styles passed: planner and composer in both looks of the normal, journal and Nebula designs.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'calendar-start') {
    await checkCalendarStart();
  } else if (process.env.JOURNAL_UI_SCOPE === 'mail') {
    await checkMailSettings();
    console.log('Mail review checks passed: default off, notification opens review, edit/accept/reject, account switch, automatic ML/ICS updates, and retained calendar data.');
  } else if (process.env.JOURNAL_UI_SCOPE === 'calendar') {
    await command('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion',value:'reduce'}] });
    await checkCalendars();
    await checkCalendarStart();
  } else {
  // The custom titlebar keeps all controls in one row and replaces the OS date picker with the compact calendar.
  assert.equal(await evaluate("document.querySelector('input[type=date]')"), null);
  assert.equal(await evaluate("document.querySelectorAll('.window-controls button').length"), 3);
  await evaluate("document.querySelector('[aria-label=\"Datum auswählen\"]').click()");
  await until("document.querySelectorAll('.mini-picker-panel .cal-compact-day').length === 42 && document.activeElement?.classList.contains('cal-compact-day')");
  await screenshot('mini-calendar-picker.png');
  const pickerMonth = await evaluate("document.querySelector('.mini-picker-head strong').textContent");
  await evaluate("document.querySelector('.mini-picker-panel [aria-label=\"Nächster Monat\"]').click()");
  await until(`document.querySelector('.mini-picker-head strong').textContent !== ${JSON.stringify(pickerMonth)}`);
  await key('Escape');
  await until("!document.querySelector('.mini-picker-panel') && document.activeElement?.classList.contains('date-picker-button')");
  await key('g', 'KeyG', 2);
  await until("document.activeElement?.classList.contains('cal-compact-day')");
  await key('ArrowRight', 'ArrowRight');
  await key('Enter', 'Enter');
  await until("!document.querySelector('.mini-picker-panel') && document.querySelector('.date-picker-button span:not(.date-picker-weekday)').textContent === window.__uiTest.shift(1).split('-').reverse().join('.')");
  await key('h', 'KeyH', 1);
  await until("document.querySelector('.date-picker-button span:not(.date-picker-weekday)').textContent === window.__uiTest.date.split('-').reverse().join('.')");
  await evaluate("document.querySelector('.window-controls [aria-label=\"Minimieren\"]').click()");
  await until("window.__uiTest.invoked.at(-1)?.[0] === 'plugin:window|minimize'");
  await evaluate("document.querySelector('.window-controls [aria-label=\"Maximieren\"]').click()");
  await until("Boolean(document.querySelector('.window-controls [aria-label=\"Wiederherstellen\"]'))");
  await evaluate("document.querySelector('.window-controls [aria-label=\"Wiederherstellen\"]').click()");
  await until("Boolean(document.querySelector('.window-controls [aria-label=\"Maximieren\"]'))");
  await evaluate("document.querySelector('.titlebar-space').dispatchEvent(new MouseEvent('mousedown', { bubbles:true, button:0, detail:1 }))");
  await until("window.__uiTest.invoked.at(-1)?.[0] === 'plugin:window|start_dragging'");
  await evaluate("document.querySelector('.titlebar-space').dispatchEvent(new MouseEvent('mousedown', { bubbles:true, button:0, detail:2 }))");
  await until("window.__uiTest.invoked.at(-1)?.[0] === 'plugin:window|toggle_maximize'");
  await evaluate("document.querySelector('.window-controls [aria-label=\"Schließen\"]').click()");
  await until("window.__uiTest.invoked.at(-1)?.[0] === 'plugin:window|close'");
  for (const width of [720, 1180]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height:780, deviceScaleFactor:1, mobile:false });
    await pause(150);
    assert.equal(await evaluate("(() => { const parts=[...document.querySelectorAll('.topbar > .document-tab, .topbar > .navigation, .topbar > .window-controls')].map(p => p.getBoundingClientRect()); return parts.every((p, i) => p.right <= innerWidth + 1 && (i === 0 || p.left >= parts[i-1].right)); })()"), true, 'The navigation and window controls fit even at the minimum width.');
    if (width === 720) await screenshot('journal-titlebar-narrow.png');
  }
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
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.entry-dock-shell.is-open .dock-planning button')).map(button => ({label:button.getAttribute('aria-label'), disabled:button.disabled}))"), [{label:'Auf morgen verschieben',disabled:false},{label:'Datum und Uhrzeit planen',disabled:false},{label:'Mehrere Tage',disabled:false},{label:'Wiederholen',disabled:false}]);
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
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.entry-dock-shell.is-open .dock-planning button')).map(button => button.getAttribute('aria-label'))"), ['Datum und Uhrzeit planen','Mehrere Tage','Wiederholen'], 'Events can be planned and repeated but not moved to tomorrow in one click.');
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

  await saveNow();
  await until("window.__uiTest.saves === 1 && document.querySelector('.save-status').textContent === 'Gespeichert'");
  assert.equal(await evaluate('window.__uiTest.day().body'), 'Bestehender Freitext bleibt erhalten.');
  assert.equal(await evaluate('new Set(window.__uiTest.day().entries.map(entry => entry.id)).size'), 6);
  assert.deepEqual(await evaluate('window.__uiTest.day().entries.filter(entry => entry.priority).map(entry => entry.id).sort()'), [firstTask,noteId].sort());
  assert.equal(await evaluate(`document.activeElement === ${newRow}.querySelector('.entry-grip')`), true, 'Saving must not move focus away from the editor.');
  await evaluate(`${newRow}.querySelector('.entry-text').focus()`);
  await command('Input.insertText', { text:'!' });
  await saveNow();
  await until("window.__uiTest.saves === 2 && document.querySelector('.save-status').textContent === 'Gespeichert'");
  assert.equal(await evaluate(`document.activeElement === ${newRow}.querySelector('.entry-text')`), true, 'Saving while typing must keep the caret in the text.');
  await command('Input.dispatchKeyEvent', { type:'rawKeyDown', key:'Backspace', code:'Backspace', windowsVirtualKeyCode:8 });
  await command('Input.dispatchKeyEvent', { type:'keyUp', key:'Backspace', code:'Backspace', windowsVirtualKeyCode:8 });
  await saveNow();
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
  await saveNow();
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
  await saveNow();
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
  await saveNow();
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
    // The row may still be scrolling smoothly into view; the click waits until it stands still, in the middle of the list
    // (formatting scrolls the text into view, and scrolling closes the menu).
    await evaluate(`${row(md)}.scrollIntoView({ block:'center' })`);
    let point = null, still = 0;
    for (let attempt = 0; attempt < 40 && still < 4; attempt++) {
      const next = await evaluate(`(() => { const r=${row(md)}.querySelector('.entry-text').getBoundingClientRect(); return { x:r.left+16, y:r.top+12, scroll:document.querySelector('.scroll').scrollTop }; })()`);
      still = point && next.x === point.x && next.y === point.y && next.scroll === point.scroll ? still + 1 : 0;
      point = next; await pause(60);
    }
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
  // One page per part of the app; typing searches all of them; the keys stay inside their rows.
  assert(await evaluate("document.querySelectorAll('.shortcuts .settings-tabs [role=tab]').length") >= 7);
  assert(await evaluate("document.querySelectorAll('.shortcut').length") >= 6);
  for (let page = 0; page < 9; page++) {
    const fits = await evaluate(`(() => { const tab=document.querySelectorAll('.shortcuts .settings-tabs [role=tab]')[${page}]; if (!tab) return true; tab.click(); return true; })()`);
    await pause(60);
    assert(fits && await evaluate("[...document.querySelectorAll('.shortcut')].every(row => { const r=row.getBoundingClientRect(); return [...row.querySelectorAll('kbd, .shortcut-gesture')].every(key => { const k=key.getBoundingClientRect(); return k.left >= r.left && k.right <= r.right + 0.5 && k.top >= r.top && k.bottom <= r.bottom + 0.5; }); })"), `Every key sits inside its row (page ${page + 1}).`);
  }
  await evaluate("document.querySelector('.shortcut-search input').focus()");
  await command('Input.insertText', { text:'Uhr' });
  await until("document.querySelectorAll('.shortcut-pages h3').length >= 2 && [...document.querySelectorAll('.shortcut')].every(row => /uhr/i.test(row.textContent))");
  await key('Escape');
  await until("document.querySelector('.shortcut-search input').value === '' && Boolean(document.querySelector('.shortcuts'))");
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

  await saveNow();
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

  // The entry actions follow the popup look: Normal · Karte opens the orbit, Glas its own sheet (ActionSheet). The desktop
  // has no layout setting of its own any more (swiping stays for touch screens); the choice of look is remembered.
  assert.equal(await evaluate("document.querySelector('.app').classList.contains('actions-orbit')"), true, 'The orbit is the default.');
  await key(',', 'Comma', 2);
  await until("Boolean(document.querySelector('.settings')) && document.activeElement.dataset.themeChoice === 'classic'");
  assert.equal(await evaluate("document.querySelectorAll('.settings-option[data-layout]').length"), 0, 'No separate action layout on the desktop.');
  await pause(350);
  await screenshot('settings.png');
  await evaluate("document.querySelector('[data-popup-style=b]').click()");
  await until("document.querySelector('.app').classList.contains('actions-inline')");
  await key('Escape');
  await until("!document.querySelector('.settings')");
  await saveNow();
  await until("document.querySelector('.save-status').textContent === 'Gespeichert'");
  await command('Page.reload');
  await until("document.querySelectorAll('.entry').length > 0");
  assert.equal(await evaluate("document.querySelector('.app').classList.contains('actions-inline')"), true, 'The look is remembered: Glas lays the actions as words under the entry.');
  // The sheet: Alt+Enter opens it on the primary action, hovering previews, done finishes, planning opens in its place.
  await evaluate("document.querySelector('#title').focus()");
  await key('a', 'KeyA', 1);
  await until("document.activeElement.classList.contains('entry-text')");
  const sheetTask = await focusedId();
  await command('Input.insertText', { text:'Blatt testen' });
  await key('Enter', 'Enter', 1);
  await until(`document.activeElement?.classList.contains('dock-done')`);
  await hover(`[data-entry-id="${sheetTask}"] .dock-cancelled`);
  await until(`${row(sheetTask)}.dataset.preview === 'cancelled'`);
  await pause(250);
  await screenshot('sheet-glass.png');
  await evaluate(`${row(sheetTask)}.querySelector('.dock-done').click()`);
  await until(`${row(sheetTask)}.dataset.status === 'done'`);
  await key('Escape');
  await until("!document.querySelector('.entry-dock-shell.is-open')");
  await evaluate(`${row(sheetTask)}.querySelector('.entry-text').focus()`);
  await key('Enter', 'Enter', 1);
  await until(`Boolean(${row(sheetTask)}.querySelector('.entry-dock-shell.is-open .dock-plan'))`);
  await evaluate(`${row(sheetTask)}.querySelector('.dock-plan').click()`);
  await until(`Boolean(${row(sheetTask)}.querySelector('.planner-grid')) && Boolean(${row(sheetTask)}.querySelector('.planner > .chrome-head'))`);
  await pause(350);
  await screenshot('sheet-planner.png');
  await key('Escape');
  await until("!document.querySelector('.entry-dock-shell.is-open')");
  await evaluate(`${row(sheetTask)}.querySelector('.entry-text').focus()`);
  await key('Delete', 'Delete', 1);
  await until(`!${row(sheetTask)}`);
  await key(',', 'Comma', 2);
  await until("Boolean(document.querySelector('[data-popup-style=a]'))");
  await evaluate("document.querySelector('[data-popup-style=a]').click()");
  await until("document.querySelector('.app').classList.contains('actions-orbit')");
  await key('Escape');
  // Fifth layout: gestures instead of a menu.
  await evaluate("window.__journalSwipeLayout = true");
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
  assert.equal(downShort.color, await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--success').trim()"), 'Done uses the theme’s success colour.');
  assert.deepEqual([downShort.trailRing, downShort.trailBorder], ['none', 'none'], 'Only colour, no ring.');
  assert.equal(downShort.rowShift, 0, 'The text does not move.');
  await until(`${row(swiped)}.dataset.status === 'done'`);
  await swipeVertical(swiped, 42);
  await until(`${row(swiped)}.dataset.status === 'open'`);
  const downLong = await swipeVertical(swiped, 90, () => lane(swiped));
  assert.equal(downLong.preview, 'cancelled', 'Further down cancels.');
  assert.equal(downLong.color, await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--cancelled').trim()"), 'Cancel uses the theme’s cancelled colour.');
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
  assert.equal(short.text, 'morgen'); assert.equal(short.armed, true); assert.equal(short.color, await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--md-cyan').trim()"), 'Tomorrow uses the theme’s cyan.'); assert.equal(short.preview, 'tomorrow');
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
  assert.equal(remove.text, 'löschen'); assert.equal(remove.color, await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--error').trim()"));
  await until(`!${row(swiped)}`);
  const held = await swipeTask('Mehrere Tage planen');
  // Several days: two left clicks set a range, right clicks take days out of it or add days outside; then one trace with << and a copy per day.
  await evaluate(`${row(held)}.querySelector('.entry-text').focus()`);
  await key('T', 'KeyT', 9);
  await until(`Boolean(${row(held)}.querySelector('.planner.is-multi')) && ${row(held)}.querySelector('.planner-confirm').disabled`);
  assert.equal(await evaluate(`Boolean(${row(held)}.querySelector('.planner-repeat, .planner-multi'))`), false, 'Several days have neither a repeat nor a mode toggle.');
  const plusDays = n => evaluate(`(() => { const d=new Date(); d.setDate(d.getDate()+${n}); return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'); })()`);
  const days = [await plusDays(1), await plusDays(2), await plusDays(3), await plusDays(5)];
  const clickDay = async (date, right = false) => {
    // Focus can scroll the planner; locate the next day after the movement settles.
    await pause(350);
    const point = await evaluate(`(() => { const label=new Intl.DateTimeFormat('de-DE', { weekday:'long', day:'numeric', month:'long', year:'numeric' }).format(new Date('${date}T12:00')); const r=${row(held)}.querySelector('.planner-day[aria-label^="' + label + '"]').getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; })()`);
    await command('Input.dispatchMouseEvent', { type:'mousePressed', x:point.x, y:point.y, button:right ? 'right' : 'left', buttons:right ? 2 : 1, clickCount:1 });
    await command('Input.dispatchMouseEvent', { type:'mouseReleased', x:point.x, y:point.y, button:right ? 'right' : 'left', buttons:0, clickCount:1 });
    await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  };
  const outside = await plusDays(7), excluded = await plusDays(4);
  // Near a month's end the days lie in the next month: turn there first, so no click lands in the month's animation.
  if (days[0].slice(0, 7) !== await evaluate("window.__uiTest.date.slice(0, 7)")) {
    await evaluate(`${row(held)}.querySelector('.planner-nav[aria-label="Nächster Monat"]').click()`);
    await pause(400);
  }
  await clickDay(days[0]);
  await until(`${row(held)}.querySelectorAll('.planner-day.is-pending').length === 1`);
  await clickDay(days[3]);
  await until(`${row(held)}.querySelectorAll('.planner-day.in-range').length === 5 && ${row(held)}.querySelector('.planner-confirm').textContent === '5 Tage'`);
  // The start can be moved too: clicking it picks it up, the band follows the pointer before the next click sets it.
  await clickDay(days[0]);
  await until(`${row(held)}.querySelectorAll('.planner-day.is-pending').length === 1`);
  const hoverDay = async date => { const point = await evaluate(`(() => { const label=new Intl.DateTimeFormat('de-DE', { weekday:'long', day:'numeric', month:'long', year:'numeric' }).format(new Date('${date}T12:00')); const r=${row(held)}.querySelector('.planner-day[aria-label^="' + label + '"]').getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; })()`);
    await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:point.x, y:point.y }); };
  await hoverDay(days[2]);
  await until(`${row(held)}.querySelector('.planner-grid.is-previewing') && ${row(held)}.querySelectorAll('.planner-day.in-range').length === 3`);
  assert.equal(await evaluate(`${row(held)}.querySelector('.planner-confirm').textContent`), '5 Tage', 'The preview is not chosen yet.');
  await pause(200); await screenshot('multi-days-moving.png');
  await clickDay(days[1]);
  await until(`${row(held)}.querySelector('.planner-confirm').textContent === '4 Tage'`);
  // … and back: the start again, then the first day.
  await clickDay(days[1]);
  await clickDay(days[0]);
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
  await saveNow();
  await until(`window.__uiTest.saves === ${savesBeforeDays + 1}`);
  for (const date of days) assert.equal(await evaluate(`window.__uiTest.day('${date}').entries.filter(entry => entry.text === 'Mehrere Tage planen').length`), 1, `A copy on ${date}.`);
  await evaluate(`${row(held)}.querySelector('.entry-text').focus()`);
  await key('Delete', 'Delete', 1);
  await until(`Boolean(${row(held)}.querySelector('.scope-choice'))`);
  assert.deepEqual(await evaluate(`[...${row(held)}.querySelectorAll('.scope-choice button')].map(button => button.textContent)`), ['Nur diesen', 'Auch die 4 folgenden']);
  await key('ArrowRight', 'ArrowRight');
  await key('Enter', 'Enter');
  await until(`!${row(held)}`);
  await saveNow();
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

  // Reminders while the journal is in front pop up in the app: finishing a task, later, closing.
  const reminded = await swipeTask('Wäsche aufhängen');
  const reminderBase = { id:reminded, kind:'task', text:'**Wäsche** aufhängen', time:'14:15', end:null, late:false, snoozed:false };
  const remind = extra => evaluate(`window.__uiTest.emit('journal:reminder', Object.assign(${JSON.stringify(reminderBase)}, { date: window.__uiTest.date }, ${JSON.stringify(extra)}))`);
  await remind({ due:'2026-01-01T14:15' });
  await until("Boolean(document.querySelector('.reminder')) && document.querySelector('.reminder-text').textContent === 'Wäsche aufhängen'");
  assert.equal(await evaluate("document.querySelector('.reminder-when').textContent"), 'Erinnerung · 14:15');
  await pause(600);
  await screenshot('reminder.png');
  // The app has no status bar any more: the card sits in the window's bottom right corner.
  const placement = await evaluate("(() => { const card=document.querySelector('.reminder').getBoundingClientRect(); return { bottom:card.bottom, right:card.right, width:innerWidth, height:innerHeight }; })()");
  assert(placement.bottom <= placement.height - 8 && placement.right <= placement.width - 8, `The card sits inside the window (${JSON.stringify(placement)}).`);
  await pause(600);
  await screenshot('reminder.png');
  await evaluate("document.querySelector('.reminder-done').click()");
  await until(`!document.querySelector('.reminder') && ${row(reminded)}.dataset.status === 'done'`);
  await remind({ due:'2026-01-01T14:18' });
  await until("Boolean(document.querySelector('.reminder-cancel'))");
  await evaluate("document.querySelector('.reminder-cancel').click()");
  await until(`!document.querySelector('.reminder') && ${row(reminded)}.dataset.status === 'cancelled'`);
  await remind({ due:'2026-01-01T14:16', late:true, snoozed:true });
  await until("document.querySelector('.reminder-when')?.textContent === 'Erneut · 14:15'");
  await evaluate("document.querySelector('.reminder-snooze').click()");
  await until("/^Wieder um [0-9]{2}:[0-9]{2}$/.test(document.querySelector('.reminder-later')?.textContent ?? '')");
  await until(`!document.querySelector('.reminder') && window.__uiTest.invoked.some(([command, payload]) => command === 'snooze_reminder' && payload.id === '${reminded}' && payload.due === '2026-01-01T14:16')`);
  await remind({ due:'2026-01-01T14:17', kind:'event' });
  await until("Boolean(document.querySelector('.reminder')) && !document.querySelector('.reminder-done')");
  await evaluate("document.querySelector('.reminder-close').click()");
  await until("!document.querySelector('.reminder')");
  await evaluate(`${row(reminded)}.querySelector('.entry-text').focus()`);
  await key('Delete', 'Delete', 1);
  await until(`!${row(reminded)}`);

  // Repeating: Alt+W opens the repeat view over the calendar, exactly as large; the user's example: Mo, Do and Fr every
  // 4 weeks, with a 3-weeks-on, 1-off pause, ending after 10 times. The calendar then marks the occurrences, the row shows ↻.
  const repeated = await swipeTask('Sport');
  const panel = `${row(repeated)}.querySelector('.repeat')`, summary = () => evaluate(`${panel}.querySelector('.repeat-write').value`);
  // Closing discards the draft and its view: each action opens its own menu again, in either toolbar layout.
  for (const [style, layout] of [['a', 'orbit'], ['b', 'inline']]) {
    await key(',', 'Comma', 2);
    await until("Boolean(document.querySelector('.settings'))");
    await evaluate("document.querySelector('.settings-option[data-layout=orbit]')?.click()");
    await pause(100);
    await evaluate(`document.querySelector('[data-popup-style=${style}]').click()`);
    await until(`document.querySelector('.app').classList.contains('actions-${layout}')`);
    await key('Escape');
    const openAction = async action => {
      await evaluate(`${row(repeated)}.querySelector('.entry-text').focus()`);
      await key('Enter', 'Enter', 1);
      const selector = layout === 'orbit' ? `.dock-plan-${action === 'repeat' ? 'repeat' : 'date'}` : `.dock-${action}`;
      await until(`Boolean(${row(repeated)}.querySelector('${selector}'))`);
      await evaluate(`${row(repeated)}.querySelector('${selector}').click()`);
    };
    await openAction('repeat');
    await until(`Boolean(${panel}) && document.activeElement === ${panel}`);
    await key('ArrowUp');
    await until(`${panel}.querySelector('.repeat-value').textContent === '2'`);
    await tap(await evaluate("(() => { const r=document.querySelector('.save-status').getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; })()"));
    await until("!document.querySelector('.entry-dock-shell.is-open')");
    await openAction('plan');
    await until(`Boolean(${row(repeated)}.querySelector('.planner.is-date')) && !${panel}`);
    assert.equal(await evaluate(`${row(repeated)}.querySelector('.planner-repeat').getAttribute('aria-pressed')`), 'false', 'Cancelled repetition is not kept in the next planning draft.');
    await evaluate(`${row(repeated)}.querySelector('.planner-time-toggle').click()`);
    await until(`Boolean(${row(repeated)}.querySelector('.clock'))`);
    await key('Enter', 'Enter', 1);
    await until("!document.querySelector('.entry-dock-shell.is-open')");
    await openAction('repeat');
    await until(`Boolean(${panel}) && document.activeElement === ${panel}`);
    assert.equal(await evaluate(`${panel}.querySelector('.repeat-value').textContent`), '1', 'Reopening starts with the saved rule or the default interval.');
    assert.equal(await evaluate(`${row(repeated)}.querySelector('.planner-time-toggle span').textContent`), '--:--', 'Cancelled clock edits are not kept.');
    await key('Enter', 'Enter', 1);
    await until("!document.querySelector('.entry-dock-shell.is-open')");
  }
  await evaluate("window.__journalSwipeLayout = true");
  await key(',', 'Comma', 2);
  await until("Boolean(document.querySelector('.settings'))");
  await evaluate("document.querySelector('[data-popup-style=a]').click()");
  await pause(100);
  await evaluate("document.querySelector('.settings-option[data-layout=swipe]').click()");
  await until("document.querySelector('.app').classList.contains('actions-swipe')");
  await key('Escape');
  await evaluate(`${row(repeated)}.querySelector('.entry-text').focus()`);
  await key('w', 'KeyW', 1);
  await until(`Boolean(${panel}) && document.activeElement === ${panel}`);
  await pause(400);
  assert.deepEqual(await evaluate(`(() => { const body=${row(repeated)}.querySelector('.planner-body').getBoundingClientRect(), calendar=${row(repeated)}.querySelector('.planner-calendar'), box=${panel}.getBoundingClientRect();
    const inside = [...${panel}.querySelectorAll('button, span, div')].every(item => { const r=item.getBoundingClientRect(); return r.width === 0 || (r.left >= box.left - 1 && r.right <= box.right + 1 && r.bottom <= box.bottom + 1); });
    return [Math.round(box.width) === Math.round(body.width), Math.round(box.height) === calendar.offsetHeight, inside]; })()`), [true, true, true], 'The repeat view covers the calendar exactly and everything fits inside it.');
  assert.match(await summary(), /^Wöchentlich am (Mo|Di|Mi|Do|Fr|Sa|So)$/, 'Turning it on repeats weekly on the chosen day.');
  for (const [index, wanted] of [[0, true], [1, false], [2, false], [3, true], [4, true], [5, false], [6, false]]) {
    if (await evaluate(`${panel}.querySelectorAll('.repeat-weekdays button')[${index}].getAttribute('aria-pressed') === 'true'`) !== wanted) await key(String(index + 1), `Digit${index + 1}`);
  }
  for (let step = 0; step < 3; step++) await key('ArrowUp');
  await until(`${panel}.querySelector('.repeat-write').value === 'Alle 4 Wochen am Mo, Do, Fr'`);
  await key('p', 'KeyP');
  await until(`${panel}.querySelector('.repeat-pause').textContent.includes('3 an') && ${panel}.getAttribute('aria-label').endsWith('3 Wochen an, 1 Woche aus')`);
  // The year unit is yearly at once and offers the date (a birthday) and weekday positions; back to weeks, the chosen
  // days and the pause are still there, the interval starts again at 1.
  await evaluate(`[...${panel}.querySelectorAll('.repeat-units button')].find(button => button.textContent === 'Jahr').click()`);
  await until(`/^Jährlich am /.test(${panel}.querySelector('.repeat-write').value) && ${panel}.querySelectorAll('.repeat-on button').length >= 2 && !${panel}.querySelector('.repeat-pause')`);
  assert(await evaluate(`(() => { const chips=[...${panel}.querySelectorAll('.repeat-on .repeat-chip')].slice(0, 2); return Math.abs(chips[0].getBoundingClientRect().top - chips[1].getBoundingClientRect().top) < 1; })()`), 'The yearly date and weekday choices fit on the same line.');
  await pause(350);
  assert(await evaluate(`(() => { const box=${panel}.closest('.planner').getBoundingClientRect(), scroll=document.querySelector('.scroll').getBoundingClientRect(); return box.left >= scroll.left && box.right <= scroll.right; })()`), 'The wider planner stays inside the narrow journal pane.');
  await screenshot('repeat-year.png');
  assert.equal(await evaluate(`document.activeElement === ${panel}`), true, 'Choosing keeps the keys working.');
  await key('ArrowLeft'); await key('ArrowLeft');
  await until(`${panel}.querySelector('.repeat-write').value === 'Wöchentlich am Mo, Do, Fr' && ${panel}.querySelector('.repeat-pause').textContent.includes('3 an')`);
  for (let step = 0; step < 3; step++) await key('ArrowUp');
  await until(`${panel}.querySelector('.repeat-write').value === 'Alle 4 Wochen am Mo, Do, Fr'`);
  // "Datum" picks the end in the calendar; "Anzahl" counts instead.
  await pause(350);
  const plannerBack = await evaluate(`(() => { const r=${panel}.querySelector('.clock-back').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; })()`);
  await evaluate(`[...${panel}.querySelectorAll('.repeat-segments button')].find(button => button.textContent === 'Datum').click()`);
  await until(`Boolean(${row(repeated)}.querySelector('.planner.is-picking-end')) && !${panel} && ${row(repeated)}.querySelector('.planner-month').textContent.startsWith('Ende')`);
  assert.deepEqual(await evaluate(`[...${row(repeated)}.querySelectorAll('.planner-head button')].map(button => button.getAttribute('aria-label'))`), ['Zurück zur Wiederholung', 'Vorheriger Monat', 'Nächster Monat'], 'Picking the end shows only back and the months, like the calendar card.');
  assert.deepEqual(await evaluate(`(() => { const r=${row(repeated)}.querySelector('.planner-head .planner-nav').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; })()`), plannerBack, 'The planner also keeps the back button in place when picking the end.');
  await evaluate(`[...${row(repeated)}.querySelectorAll('.planner-day:not(.is-outside)')].at(-1).click()`);
  await until(`Boolean(${panel}) && ${panel}.querySelector('.repeat-segments .is-date')?.textContent.startsWith('bis ')`);
  assert(await evaluate(`(() => { const box=${panel}.getBoundingClientRect(); return [...${panel}.querySelectorAll('.repeat-row *')].every(item => item.getBoundingClientRect().right <= box.right + 1); })()`), 'With an end date the row stays inside the panel.');
  await evaluate(`[...${panel}.querySelectorAll('.repeat-segments button')].find(button => button.textContent === 'Anzahl').click()`);
  await until(`${panel}.getAttribute('aria-label').endsWith('· 10×')`);
  await pause(350);
  await screenshot('repeat.png');
  await key('Escape');
  await until(`!${panel} && ${row(repeated)}.querySelector('.planner-repeat').getAttribute('aria-pressed') === 'true' && ${row(repeated)}.querySelectorAll('.planner-day.is-repeat').length > 0`);
  assert.equal(await evaluate(`${row(repeated)}.querySelector('.planner-confirm svg').dataset.icon`), 'repeat');
  await pause(300);
  await screenshot('repeat-calendar.png');
  await key('Enter');
  await until(`!document.querySelector('.entry-dock-shell.is-open') && Boolean(${row(repeated)}.querySelector('.entry-when .entry-repeat'))`);
  assert.match(await evaluate(`${row(repeated)}.querySelector('.entry-when').title`), /^Alle 4 Wochen am Mo, Do, Fr · 3 Wochen an, 1 Woche aus · 10×$/);
  const savesBeforeRepeat = await evaluate('window.__uiTest.saves');
  await saveNow();
  await until(`window.__uiTest.saves === ${savesBeforeRepeat + 1}`);
  // The days (from today on) with an occurrence, as [days ahead, weekday].
  const sportDays = () => evaluate(`(() => { const out=[]; for (let n = 0; n < 1200; n++) { const d=new Date(); d.setDate(d.getDate()+n); const date=[d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'); if (window.__uiTest.day(date)?.entries.some(entry => entry.text === 'Sport')) out.push([n, d.getDay()]); } return out; })()`);
  const saved = await sportDays();
  assert.equal(saved.length, 10, 'Ten occurrences, the entry itself included.');
  assert.equal(await evaluate('window.__uiTest.series.size'), 1);
  assert(saved.every(([ahead, weekday]) => ahead === 0 || [1, 4, 5].includes(weekday)), 'After the entry itself only Mondays, Thursdays and Fridays.');
  // Opened again from the ↻ chip, the planner shows the rule; turning it off ends the series here: the later open ones go.
  await evaluate(`${row(repeated)}.querySelector('.entry-when').click()`);
  await until(`${row(repeated)}.querySelector('.planner-repeat')?.getAttribute('aria-pressed') === 'true'`);
  await key('w', 'KeyW');
  await until(`${panel}?.querySelector('.repeat-write').value === 'Alle 4 Wochen am Mo, Do, Fr'`);
  await key('Delete');
  await until(`!${panel} && ${row(repeated)}.querySelector('.planner-repeat').getAttribute('aria-pressed') === 'false'`);
  await key('Enter');
  await until(`!document.querySelector('.entry-dock-shell.is-open') && !${row(repeated)}.querySelector('.entry-repeat')`);
  await saveNow();
  await until(`window.__uiTest.saves === ${savesBeforeRepeat + 2}`);
  assert.deepEqual(await sportDays(), [[0, saved[0][1]]], 'Stopping keeps the entry and removes the later open occurrences.');
  assert.equal(await evaluate('window.__uiTest.series.size'), 0, 'A series without occurrences is gone.');
  await evaluate(`${row(repeated)}.querySelector('.entry-text').focus()`);
  await key('Delete', 'Delete', 1);
  await until(`!${row(repeated)}`);

  // Writing the repetition: "/" focuses the head; German and English set the rule at once, the foot says what was understood.
  const written = await swipeTask('In Worten');
  const writeField = `${row(written)}.querySelector('.repeat-write')`;
  const writeRule = async text => {
    await evaluate(`(() => { const field=${writeField}; field.select(); })()`);
    await command('Input.insertText', { text });
  };
  await key('w', 'KeyW', 1);
  await until(`Boolean(${writeField}) && document.activeElement === ${row(written)}.querySelector('.repeat')`);
  await key('/', 'Slash');
  await until(`document.activeElement === ${writeField}`);
  await writeRule('alle 3 Wochen am Montag, Mittwoch');
  await until(`${row(written)}.querySelector('.repeat-next').textContent === 'Alle 3 Wochen am Mo, Mi ✓' && ${row(written)}.querySelectorAll('.repeat-weekdays [aria-pressed=true]').length === 2`);
  await pause(300);
  await screenshot('repeat-write.png');
  await key('Enter', 'Enter');
  await until(`document.activeElement === ${row(written)}.querySelector('.repeat') && ${writeField}.value === 'Alle 3 Wochen am Mo, Mi'`);
  await key('/', 'Slash');
  await writeRule('every other week on tue and thu, 6 times bitte');
  await until(`${row(written)}.querySelector('.repeat-next').textContent === 'Alle 2 Wochen am Di, Do · 6× · ohne „bitte“'`);
  await key('Escape', 'Escape');
  await until(`${writeField}.value === 'Alle 3 Wochen am Mo, Mi' && Boolean(${row(written)}.querySelector('.repeat'))`);
  // Typing completes the word (grey after the cursor, Tab takes it), and months restrict the days.
  await key('/', 'Slash');
  await writeRule('jeden Mit');
  await until(`${row(written)}.querySelector('.repeat-ghost')?.textContent === 'jeden Mittwoch'`);
  // Suggestions open under the field like an editor's completions (the typed letters bold, what the word does on the
  // right), and the rows below step back while writing.
  await until(`${row(written)}.querySelector('.repeat-suggest-item.is-picked .repeat-suggest-word')?.textContent === 'Mittwoch' && ${row(written)}.querySelector('.repeat-suggest-item.is-picked b')?.textContent === 'M'`);
  assert.equal(await evaluate(`${row(written)}.querySelector('.repeat-suggest-item.is-picked .repeat-suggest-role').textContent`), 'Wochentag');
  await pause(260);
  assert(await evaluate(`Number(getComputedStyle(${row(written)}.querySelector('.repeat-units')).opacity) < 0.5 && ${row(written)}.querySelector('.repeat').classList.contains('is-writing')`), 'The rows below fade while writing.');
  await pause(200);
  await screenshot('repeat-suggest.png');
  await key('Tab', 'Tab');
  await command('Input.insertText', { text:'im Mä' });
  await until(`${row(written)}.querySelector('.repeat-ghost')?.textContent === 'jeden Mittwoch im März'`);
  await key('Tab', 'Tab');
  await until(`${writeField}.value === 'jeden Mittwoch im März ' && ${row(written)}.querySelector('.repeat-next').textContent === 'Wöchentlich am Mi · nur im Mär ✓'`);
  await pause(300);
  await screenshot('repeat-write-months.png');
  await key('Enter', 'Enter');
  await until(`${row(written)}.querySelector('.repeat-chip.is-months')?.textContent.startsWith('nur Mär')`);
  await evaluate(`${row(written)}.querySelector('.repeat-chip.is-months').click()`);
  await until(`!${row(written)}.querySelector('.repeat-chip.is-months') && ${writeField}.value === 'Wöchentlich am Mi'`);
  // A date of its own moves the entry there (a new repetition starts on its first day).
  await key('/', 'Slash');
  await writeRule('jedes Jahr am 24.12.');
  await until(`/^Jährlich am 24\. Dez/.test(${row(written)}.querySelector('.repeat-next').textContent)`);
  await key('Enter', 'Enter');
  assert.match(await evaluate(`${row(written)}.querySelector('.planner-confirm').textContent`), /24\.12\./, 'The planner now plans to that day.');
  await key('Escape');
  await until(`!${row(written)}.querySelector('.repeat') && document.activeElement?.classList.contains('planner-day')`);
  await key('Escape');
  await until("!document.querySelector('.entry-dock-shell.is-open')");
  await evaluate(`${row(written)}.querySelector('.entry-text').focus()`);
  await key('Delete', 'Delete', 1);
  await until(`!${row(written)}`);

  await key(',', 'Comma', 2);
  await until("Boolean(document.querySelector('.settings'))");
  await evaluate("document.querySelector('.settings-option[data-layout=orbit]').click()");
  await until("document.querySelector('.app').classList.contains('actions-orbit')");
  await key('Escape');

  await command('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion',value:'reduce'}] });
  await evaluate("document.querySelector('.entry-symbol').click()");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.entry-dock-shell.is-open')).transitionDuration"), '0s');
  await key('Escape');
  await checkMailSettings();
  console.log('Mail UI checks passed: providers, OAuth configuration, Proton Bridge restrictions, failed connection, automatic ML/ICS imports and updates, confirmation popup, model pause/resume, and account removal.');
  await checkCalendars();
  await checkCalendarStart();
  await checkPixelTheme();
  await checkLanguage();
  await checkColors();
  await checkTags();
  }
  assert.deepEqual(errors, [], 'No browser runtime errors.');
  console.log('UI checks passed: calendar window (month, week, work week, year, day; keys, swiping, filters, remembered, live updates, open in journal), compact month window, calendar in the resizable sidebar (creating entries by marking quarter hours, composer, editing by right click), changing kinds (keys, orbit cluster, preview), saving by itself (after a pause, before leaving the day), actions reaching linked entries (following / all, Escape cancels), calendar edits applied to this one / every weekday / all, editable traces passing edits to their copies, swiping days, settings (orbit/inline/swipe layout, remembered), swipe gestures (the icon stays at the symbol, a bar in each action’s own colour grows, full height sideways; right: tomorrow/plan/several days, left: remove, down: done/cancel, up: priority, tap, hold is a tap, keys, trackpad), planning several days (range by two clicks, right-click flips, copies per day, linked removal), embedded inline actions (in the flow, no surface, preview, calendar), IBM Plex Sans UI and bold Lilex title, live-preview Markdown (markers only at the cursor, hidden when not editing, click into hidden parts), format shortcuts with undo, colours, right-click format menu; shortcuts (F1, Alt+A/Enter/Backspace outliner, Alt+D/X/P/U/T/M/Enter/Entf, Ctrl+arrows, Alt+arrows/H), clock as large as the calendar with back button, Tab and typed digits; clock dial (tap on both rings, wheel, keys, quick times), calendar stays open on inner clicks, time after text, linked removal both ways; planning (calendar keyboard, time, reminder, traces >/</outlined <, undo, tomorrow, same-day time, copies on target days), asterisk/outlined event/thick note priority symbols, automatic priority order, drag and keyboard boundaries, toolbar focus, saved priority; action pill, previews, removal, grouping, caret, saving, cached navigation, wrapping and reduced motion.');
  console.log(`Screenshots: ${join(artifacts, 'journal.png')} and menu.png`);
} catch (error) {
  if (errors.length) console.error('Browser errors:', errors);
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      await screenshot('failure.png');
      await writeFile(join(artifacts, 'failure.json'), JSON.stringify(await evaluate("({repeat:[...document.querySelectorAll('.repeat-write')].map(input=>input.value),repeatPressed:document.querySelector('.cal-composer-repeat')?.getAttribute('aria-pressed'),active:document.activeElement?.outerHTML.slice(0,500),pill:(() => {const length=document.querySelector('.cal-composer-length'),pill=length?.parentElement;return length && {gap:pill.getBoundingClientRect().right-length.getBoundingClientRect().right,width:pill.getBoundingClientRect().width,text:length.textContent};})()})")));
    } catch {}
  }
  throw error;
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await command('Browser.close'); } catch {}
    socket.close();
  }
  browser.kill();
  server.closeAllConnections();
  server.close();
}
