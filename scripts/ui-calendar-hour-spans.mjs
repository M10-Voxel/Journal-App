import assert from 'node:assert/strict';

// Synthetic IPC fixtures only, invoked by JOURNAL_UI_SCOPE=calendar-hour-grid-spans.
export async function verifyHourSpans({ evaluate, until, screenshot, command, key, errors }) {
  const dates = await evaluate(`(() => {
    const today=new Date(window.__uiTest.date+'T12:00:00Z');
    const monday=new Date(today);monday.setUTCDate(today.getUTCDate()-((today.getUTCDay()+6)%7));
    return [2,3,4].map(offset=>{const d=new Date(monday);d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);});
  })()`);
  await evaluate(`window.__uiTest.store({date:'${dates[0]}',title:'',body:'',revision:1,entries:[
    {id:'hour-grid-range',kind:'event',text:'Wednesday to Friday',time:'14:00',end:'64:00',timeGrid:true,done:false,cancelled:false,priority:false},
    {id:'traditional-range',kind:'event',text:'Traditional multiday',time:'14:00',end:'64:00',done:false,cancelled:false,priority:false}
  ]})`);
  await evaluate("document.querySelectorAll('.sidebar .cal-views [role=tab]')[2].click()");
  await until("document.querySelectorAll('.sidebar .cal-time-column [data-calendar-entry=\"hour-grid-range\"]').length===3");
  const pieces = await evaluate(`Array.from(document.querySelectorAll('.sidebar .cal-time-column [data-calendar-entry="hour-grid-range"]'),node=>({
    day:node.closest('.cal-time-column').dataset.date,time:node.dataset.calendarTime,end:node.dataset.calendarEnd,
    top:parseFloat(node.style.top),height:parseFloat(node.style.height),hour:parseFloat(getComputedStyle(node.closest('.cal-time')).getPropertyValue('--hour'))
  }))`);
  assert.deepEqual(pieces.map(piece=>[piece.day,piece.time,piece.end]),[
    [dates[0],'14:00','24:00'],[dates[1],'00:00','24:00'],[dates[2],'00:00','16:00'],
  ]);
  assert(Math.abs(pieces[1].height-24*pieces[1].hour)<4,'The entire middle day occupies its hour column.');
  assert(Math.abs(pieces[2].height-16*pieces[2].hour)<4,'The final piece ends at 16:00.');
  assert.equal(await evaluate("document.querySelectorAll('.sidebar .cal-multiday-bar [data-calendar-entry=\"hour-grid-range\"]').length"),0);
  assert.equal(await evaluate("document.querySelectorAll('.sidebar .cal-time-column [data-calendar-entry=\"traditional-range\"]').length"),0);
  assert(await evaluate("document.querySelectorAll('.sidebar [data-calendar-entry=\"traditional-range\"]').length>0"),'A conventional multiday entry keeps its band.');
  await screenshot('calendar-hour-grid-spans.png');
  // Editing a continuation must target the single entry on its original Wednesday.
  await evaluate(`document.querySelector('.sidebar .cal-time-column[data-date="${dates[2]}"] [data-calendar-entry="hour-grid-range"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`);
  await until("Boolean(document.querySelector('.cal-composer'))");
  assert.equal(await evaluate("document.querySelector('.cal-composer-text').value"),'Wednesday to Friday');
  await key('Escape');
  await evaluate(`window.__uiTest.store({date:'${dates[0]}',title:'',body:'',revision:2,entries:[]})`);
  await until("!document.querySelector('.sidebar [data-calendar-entry=\"hour-grid-range\"]')");
  await evaluate("document.querySelector('.sidebar .cal-time').scrollTop=12*parseFloat(getComputedStyle(document.querySelector('.sidebar .cal-time')).getPropertyValue('--hour'))");
  const point = (day, hour) => evaluate(`(() => {
    const column=document.querySelector('.sidebar .cal-time-column[data-date="${day}"]'),r=column.getBoundingClientRect();
    const step=parseFloat(getComputedStyle(column.closest('.cal-time')).getPropertyValue('--hour'));
    return {x:r.left+r.width/2,y:r.top+${hour}*step+1};
  })()`);
  const from=await point(dates[0],14),to=await point(dates[2],15.75);
  await command('Input.dispatchMouseEvent',{type:'mouseMoved',...from});
  await command('Input.dispatchMouseEvent',{type:'mousePressed',...from,button:'right',buttons:2,clickCount:1});
  await command('Input.dispatchMouseEvent',{type:'mouseMoved',...to,button:'right',buttons:2});
  await screenshot('calendar-hour-grid-drag.png');
  await until("document.querySelectorAll('.sidebar .cal-selection').length===3");
  await command('Input.dispatchMouseEvent',{type:'mouseReleased',...to,button:'right',buttons:0,clickCount:1});
  await until("document.activeElement?.classList.contains('cal-composer-text')");
  await command('Input.insertText',{text:'Drawn hour origin'});
  await key('Enter');
  await until(`window.__uiTest.day('${dates[0]}')?.entries.some(entry=>entry.text==='Drawn hour origin' && entry.timeGrid===true)`);
  assert.equal(await evaluate(`window.__uiTest.day('${dates[0]}').entries.find(entry=>entry.text==='Drawn hour origin').end`),'64:00');
  assert.deepEqual(errors,[]);
  console.log('Hour-grid spans passed: three day slices, exact end, traditional bands, continuation editing and a saved mouse-drawn range.');
}
