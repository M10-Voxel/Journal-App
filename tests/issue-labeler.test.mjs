import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/issue-labeler.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
// Execute the actual github-script body against a fake API; no repository is modified.
const script = workflow.split('          script: |\n')[1].split('\n').map(line => line.replace(/^ {12}/, '')).join('\n');
const run = new (Object.getPrototypeOf(async function () {}).constructor)('github', 'context', script);
function fixture(body, current = [], known = current) {
  const issue = { number: 42, body, labels: current.map(name => ({ name })) };
  const labels = new Set(known), assigned = new Set(current), calls = [];
  const issues = {
    get: async () => ({ data: issue }),
    getLabel: async ({ name }) => { if (!labels.has(name)) throw Object.assign(new Error('missing'), { status: 404 }); return { data: { name } }; },
    createLabel: async ({ name }) => { labels.add(name); calls.push(['create', name]); },
    removeLabel: async ({ name }) => { assigned.delete(name); calls.push(['remove', name]); },
    addLabels: async ({ labels: names }) => { for (const name of names) { assert(labels.has(name)); assigned.add(name); } calls.push(['add', names]); },
  };
  return { issue, labels, assigned, calls, issues, execute: () => run({ rest: { issues } }, { repo: { owner: 'owner', repo: 'repo' }, issue: { number: 42 } }) };
}
test('dropdown selections create missing labels, including Other / Not sure', async () => {
  const f = fixture('### Before submitting\r\n\r\n- [x] Searched\r\n\r\n### Affected Areas\r\n\r\nMail, Google Drive, Other / Not sure\r\n\r\n### Bug Description\r\n\r\nStorage');
  await f.execute();
  assert.deepEqual([...f.assigned], ['Mail', 'Google Drive', 'Other / Not sure']);
  assert.equal(f.calls.filter(c => c[0] === 'create').length, 3);
});
test('editing areas removes stale area labels and preserves maintainer labels', async () => {
  const f = fixture('### Affected Areas\n\nMail\n\n### Description\nWidgets', ['Storage', 'wontfix', 'Mail']);
  await f.execute();
  assert.deepEqual([...f.assigned], ['wontfix', 'Mail']);
  const previous = f.calls.length;
  f.issue.labels = [...f.assigned].map(name => ({ name }));
  await f.execute();
  assert.equal(f.calls.length, previous, 'A second run does not repeat label changes.');
});
test('unknown options and text outside the area section cannot assign labels', async () => {
  const f = fixture('### Affected Areas\n\n- Mail\n- unknown\n- Mail\n\n### Details\nStorage', [], ['Mail']);
  await f.execute();assert.deepEqual([...f.assigned], ['Mail']);
  const manual = fixture('A manually created issue without the area section', ['Mail']);
  await manual.execute();assert.deepEqual([...manual.assigned], ['Mail']);assert.equal(manual.calls.length, 0);
});
test('area and theme dropdowns assign labels together without reading description text', async () => {
  const f = fixture('### Affected Areas\r\n\r\nMail\r\n\r\n### Affected Themes\r\n\r\nJournal Theme, Nebula Theme\r\n\r\n### Bug Description\r\n\r\nNormal Theme');
  await f.execute();
  assert.deepEqual([...f.assigned], ['Mail', 'Journal Theme', 'Nebula Theme']);
});

test('editing or clearing themes removes stale labels and preserves other selections', async () => {
  const f = fixture('### Affected Areas\n\nMail\n\n### Affected Themes\n\nNormal Theme', ['Mail', 'Journal Theme', 'wontfix']);
  await f.execute();
  assert.deepEqual([...f.assigned], ['Mail', 'wontfix', 'Normal Theme']);
  f.issue.labels = [...f.assigned].map(name => ({ name }));
  f.issue.body = '### Affected Areas\n\nMail\n\n### Affected Themes\n\n_No response_';
  await f.execute();
  assert.deepEqual([...f.assigned], ['Mail', 'wontfix']);
});

test('older issues still accept themes from the area dropdown', async () => {
  const f = fixture('### Affected Areas\n\nMail, Nebula Theme');
  await f.execute();
  assert.deepEqual([...f.assigned], ['Mail', 'Nebula Theme']);
});

test('concurrent label creation is tolerated but permission errors propagate', async () => {
  const f = fixture('### Affected Areas\n\nMail');
  f.issues.createLabel = async ({ name }) => { f.labels.add(name); throw Object.assign(new Error('exists'), { status: 422 }); };
  await f.execute();assert(f.assigned.has('Mail'));
  const denied = fixture('### Affected Areas\n\nMail');
  denied.issues.getLabel = async () => { throw Object.assign(new Error('forbidden'), { status: 403 }); };
  await assert.rejects(denied.execute(), /forbidden/);
});
test('chooser has exactly Task, Bug and Feature, mapped to GitHub issue types', () => {
  const root = new URL('../.github/ISSUE_TEMPLATE/', import.meta.url);
  const forms = readdirSync(root).filter(name => name.endsWith('.yml') && name !== 'config.yml').map(name => readFileSync(new URL(name, root), 'utf8').replace(/\r\n/g, '\n'));
  assert.equal(forms.length, 3);
  assert.deepEqual(forms.map(form => /^name: (.+)$/m.exec(form)[1]).sort(), ['Bug', 'Feature', 'Task']);
  for (const form of forms) {
    assert.equal(/^name: (.+)$/m.exec(form)[1], /^type: (.+)$/m.exec(form)[1]);
    assert.match(form, /^description: .+/m);
    assert.doesNotMatch(form, /^- \{\}/m);
    const fields = form.split(/^- type: /m);
    const areas = fields.find(field => /^  id: areas$/m.test(field));
    const themes = fields.find(field => /^  id: themes$/m.test(field));
    assert.doesNotMatch(areas, /Theme/);
    assert.match(themes, /label: Affected Themes/);
    assert.match(themes, /multiple: true/);
    assert.match(themes, /required: false/);
    for (const theme of ['Journal Theme', 'Nebula Theme', 'Normal Theme']) {
      assert(themes.includes('    - ' + theme + '\n'));
    }
  }
  assert.match(forms.find(form => form.startsWith('name: Task')), /Improve existing functionality/);
  assert.match(workflow, /types: \[opened, edited, reopened\]/);
});
