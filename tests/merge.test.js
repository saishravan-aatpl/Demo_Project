// Run with: node tests/merge.test.js
const assert = require('assert');
const { merge } = require('../merge.js');

const task = (id, text, extra = {}) => ({ id, text, done: false, person: '', ...extra });
const project = (id, name, tasks, extra = {}) => ({ id, name, collapsed: false, tasks, ...extra });
const data = (projects, extra = {}) => ({ projects, people: [], usualLeaveTime: '17:00', leaveTime: '17:00', leaveDate: '', dayNotes: '', ...extra });
const copy = x => JSON.parse(JSON.stringify(x));

const base = data([
  project('p1', 'Alpha', [task('t1', 'one'), task('t2', 'two')]),
  project('p2', 'Beta', [task('t3', 'three')])
], { people: ['Sam', 'Miles'] });

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ', name); }

test('Phone ticks a task while laptop adds a task: both kept', () => {
  const phone = copy(base); phone.projects[0].tasks[0].done = true;
  const laptop = copy(base); laptop.projects[1].tasks.push(task('t4', 'four'));
  const out = merge(base, phone, laptop);
  assert.equal(out.projects[0].tasks[0].done, true);
  assert.deepEqual(out.projects[1].tasks.map(t => t.id), ['t3', 't4']);
});

test('Different fields of the same task changed on each device: both kept', () => {
  const a = copy(base); a.projects[0].tasks[1].text = 'two (renamed)';
  const b = copy(base); b.projects[0].tasks[1].person = 'Sam';
  const out = merge(base, a, b);
  assert.equal(out.projects[0].tasks[1].text, 'two (renamed)');
  assert.equal(out.projects[0].tasks[1].person, 'Sam');
});

test('Deleted on one device, untouched on the other: stays deleted', () => {
  const a = copy(base); a.projects[0].tasks.splice(1, 1);
  const out = merge(base, a, copy(base));
  assert.deepEqual(out.projects[0].tasks.map(t => t.id), ['t1']);
  const out2 = merge(base, copy(base), a);
  assert.deepEqual(out2.projects[0].tasks.map(t => t.id), ['t1']);
});

test('Deleted on one device but edited on the other: edit survives', () => {
  const a = copy(base); a.projects.splice(1, 1);
  const b = copy(base); b.projects[1].tasks[0].done = true;
  const out = merge(base, a, b);
  assert.equal(out.projects.length, 2);
  assert.equal(out.projects[1].tasks[0].done, true);
});

test('Same field changed on both: this device wins', () => {
  const a = copy(base); a.dayNotes = 'mine';
  const b = copy(base); b.dayNotes = 'theirs';
  assert.equal(merge(base, a, b).dayNotes, 'mine');
});

test('Re-ordering on one device is kept, new items still included', () => {
  const a = copy(base); a.projects.reverse();
  const b = copy(base); b.projects.push(project('p3', 'Gamma', []));
  assert.deepEqual(merge(base, a, b).projects.map(p => p.id), ['p2', 'p1', 'p3']);
});

test('People: additions from both sides kept, removals respected', () => {
  const a = copy(base); a.people = ['Sam', 'Miles', 'Nina'];
  const b = copy(base); b.people = ['Sam', 'Kendall'];          // removed Miles, added Kendall
  assert.deepEqual(merge(base, a, b).people, ['Sam', 'Kendall', 'Nina']);
});

test('First sync of two devices with the same imported backup: no duplicates', () => {
  const out = merge(null, copy(base), copy(base));
  assert.equal(out.projects.length, 2);
  assert.equal(out.projects[0].tasks.length, 2);
});

test('First sync with different data on each device: union of both', () => {
  const a = data([project('pa', 'From laptop', [])]);
  const b = data([project('pb', 'From phone', [])]);
  assert.deepEqual(merge(null, a, b).projects.map(p => p.id).sort(), ['pa', 'pb']);
});

test('Nothing changed anywhere: result equals base', () => {
  assert.deepEqual(merge(base, copy(base), copy(base)), base);
});

test('Pinning on one device and ticking on another: both kept', () => {
  const a = copy(base); a.projects[0].tasks[1].pinnedOn = '2026-11-18';
  const b = copy(base); b.projects[0].tasks[1].done = true;
  const out = merge(base, a, b);
  assert.equal(out.projects[0].tasks[1].pinnedOn, '2026-11-18');
  assert.equal(out.projects[0].tasks[1].done, true);
});

test('Unpinning on one device is kept', () => {
  const pinnedBase = copy(base); pinnedBase.projects[0].tasks[0].pinnedOn = '2026-11-18';
  const a = copy(pinnedBase); delete a.projects[0].tasks[0].pinnedOn;
  const out = merge(pinnedBase, a, copy(pinnedBase));
  assert.equal(out.projects[0].tasks[0].pinnedOn, undefined);
});

test("Today's leaving time and the usual time sync independently", () => {
  const a = copy(base); a.leaveTime = '18:30'; a.leaveDate = '2026-11-18';
  const b = copy(base); b.usualLeaveTime = '17:30';
  const out = merge(base, a, b);
  assert.equal(out.leaveTime, '18:30');
  assert.equal(out.leaveDate, '2026-11-18');
  assert.equal(out.usualLeaveTime, '17:30');
});

console.log(`\n${passed} merge tests passed`);
