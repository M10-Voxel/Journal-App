import test from 'node:test';
import assert from 'node:assert/strict';
import { moveWidgetRect, placeWidgetPopup } from '../src/widgetPopupGeometry.ts';

const bounds = { left: 0, top: 0, width: 1920, height: 1040 };
test('widget dragging preserves dimensions and allows negative desktop coordinates', () => {
  assert.deepEqual(moveWidgetRect({left:20,top:30,width:600,height:500},-150,40,'',360,260),{left:-130,top:70,width:600,height:500});
});
test('resizing the north-west corner keeps the opposite corner in place at the minimum size', () => {
  const start = {left:100,top:80,width:600,height:500};
  assert.deepEqual(moveWidgetRect(start,400,400,'nw',360,260),{left:340,top:320,width:360,height:260});
  assert.deepEqual(moveWidgetRect(start,-70,-40,'nw',360,260),{left:30,top:40,width:670,height:540});
});
test('south and east resizing leave the top-left corner fixed', () => {
  assert.deepEqual(moveWidgetRect({left:100,top:80,width:600,height:500},75,30,'se',360,260),{left:100,top:80,width:675,height:530});
});
test('popup may extend past a narrow widget while staying on its monitor', () => {
  const result = placeWidgetPopup({ left: 300, top: 180, width: 320, height: 40 }, { width: 680, height: 400 }, bounds);
  assert.deepEqual(result, { left: 300, top: 226, width: 680, height: 400 });
});
test('popup near the bottom opens above the entry', () => {
  const result = placeWidgetPopup({ left: 1700, top: 900, width: 100, height: 40 }, { width: 500, height: 400 }, bounds);
  assert.equal(result.left, 1412);
  assert.equal(result.top, 494);
});
test('popup uses the work area origin and fits small screens', () => {
  const result = placeWidgetPopup({ left: -1200, top: 5, width: 300, height: 20 }, { width: 1800, height: 1000 }, { left: -1280, top: 30, width: 1280, height: 720 });
  assert.deepEqual(result, { left: -1272, top: 38, width: 1264, height: 704 });
});
