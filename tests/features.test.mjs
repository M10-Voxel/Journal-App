import test from 'node:test';
import assert from 'node:assert/strict';
import { availableMode, defaultFeatures, enabledModes, hasModule, modulesOf, normalizeFeatures, periodBoards, withModule, withView } from '../src/features.ts';

test('the defaults show what the app showed before views could be chosen', () => {
  const features = defaultFeatures();
  assert.deepEqual(enabledModes(features), ['day', 'week', 'month', 'quarter', 'year']);
  assert.equal(features.notebook, true);
  assert.deepEqual(features.views.day.modules, ['entries', 'rating', 'scales', 'activities', 'board']);
  assert.deepEqual(periodBoards(features), ['month', 'year'], 'Weeks and quarters have no board by default.');
  assert.equal(modulesOf('day').includes('evaluation'), false, 'A single day has no evaluation.');
  assert.deepEqual(normalizeFeatures(undefined), features);
  assert.deepEqual(normalizeFeatures({ nonsense: true }), features);
});

test('stored features are made valid: known modules in order, empty views off, never no view at all', () => {
  const features = normalizeFeatures({ notebook: false, views: { day: { on: true, modules: ['board', 'evaluation', 'x', 'entries'] }, week: { on: true, modules: [] }, month: { on: false }, quarter: { on: true, modules: ['scales', 'entries'] } } });
  assert.equal(features.notebook, false);
  assert.deepEqual(features.views.day.modules, ['entries', 'board'], 'Unknown modules and the evaluation (not for days) go; the order is fixed.');
  assert.equal(features.views.week.on, false, 'A view without modules is off.');
  assert.equal(features.views.month.on, false);
  assert.deepEqual(features.views.month.modules, ['note', 'evaluation', 'board'], 'Without stored modules the defaults stay for later.');
  assert.deepEqual(features.views.quarter.modules, ['entries', 'scales']);
  assert.deepEqual(features.views.year, defaultFeatures().views.year, 'A view not stored keeps its default.');
  const none = normalizeFeatures({ views: { day: { on: false }, week: { on: false }, month: { on: false }, quarter: { on: false }, year: { on: false } } });
  assert.deepEqual(enabledModes(none), ['day'], 'With every view off the day comes back.');
});

test('switching views and modules keeps at least one of each', () => {
  let features = defaultFeatures();
  for (const mode of ['day', 'week', 'month', 'quarter']) features = withView(features, mode, false);
  assert.deepEqual(enabledModes(features), ['year']);
  assert.equal(withView(features, 'year', false), features, 'The last view stays on.');
  assert.equal(availableMode(features, 'day'), 'year');
  assert.equal(availableMode(withView(features, 'month', true), 'week'), 'month', 'The nearest view that is on.');
  features = withModule(features, 'year', 'note', false);
  features = withModule(features, 'year', 'board', false);
  assert.deepEqual(features.views.year.modules, ['evaluation']);
  assert.equal(withModule(features, 'year', 'evaluation', false), features, 'The last module stays.');
  assert.equal(withModule(features, 'day', 'evaluation', true), features, 'A day takes no evaluation.');
  features = withModule(features, 'year', 'entries', true);
  assert.deepEqual(features.views.year.modules, ['entries', 'evaluation']);
  assert(hasModule(features, 'year', 'entries'));
  assert(!hasModule(features, 'day', 'entries'), 'A view switched off shows nothing.');
  const week = withModule(withView(features, 'week', true), 'week', 'board', true);
  assert.deepEqual(periodBoards(week), ['week'], 'Only boards of views that are on are offered.');
});
