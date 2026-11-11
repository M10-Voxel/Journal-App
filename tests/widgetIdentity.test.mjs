import test from 'node:test';
import assert from 'node:assert/strict';
import { isDesktopWidgetLabel, widgetIdFromLabel } from '../src/widgetIdentity.ts';
test('legacy and newly generated widget windows use the same identity rules', () => {
  assert.equal(widgetIdFromLabel('widget-entries'),'entries');
  assert.equal(widgetIdFromLabel('widget-a08f6e27-e47f-4e12-a511-023ab9ca732c'),'a08f6e27-e47f-4e12-a511-023ab9ca732c');
  assert(isDesktopWidgetLabel('widget-calendar-future'));
});
test('normal windows and malformed widget identities never become desktop widgets', () => {
  for(const label of ['main','calendar','panel-calendar','widget-','widget-../main','widget-Capital','widget-'+ 'x'.repeat(65)]) assert.equal(widgetIdFromLabel(label),null,label);
});
