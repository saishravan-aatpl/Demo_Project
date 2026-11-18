const { chromium } = require('playwright');
const base = { projects: [
  { id: 'p1', name: `O'Neil "big" <project>`, collapsed: false, priority: true, tasks: [
    { id: 't1', text: `Call D'Souza about "x" & <y>`, done: false, person: `D'Souza` },
    { id: 't2', text: '', done: true, person: '' },
    { id: 't3', text: 'pinned old', done: false, person: 'Zoë Ångström', pinnedOn: '2026-11-01' },
    { id: 't4', text: 'pinned today', done: false, person: 'A  B', pinnedOn: new Date().toLocaleDateString('en-CA') } ] },
  { id: 'p2', name: '', collapsed: true, tasks: [] } ],
  people: [`D'Souza`, 'Zoë Ångström', 'A  B', '  ', 'x"y'], usualLeaveTime: '17:30', leaveTime: '', leaveDate: '', dayNotes: '' };
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) process.exitCode = 1; };
const views = ['all', 'pinned', 'project:p1', 'project:gone', `person:D'Souza`, 'person:x"y', 'person:Nobody', 'unassigned', 'weird'];
(async () => {
  const b = await chromium.launch();
  for (const [vw, size] of [['laptop', { width: 1300, height: 800 }], ['phone', { width: 390, height: 800 }]]) for (const view of views) for (const tab of ['projects', 'people', 'notes']) {
    const c = await b.newContext({ viewport: size, serviceWorkers: 'block' });
    await c.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.DASHBOARD_CONFIG={}' }));
    await c.addInitScript(d => { localStorage.setItem('officeDailyDashboard.stable.v2', d); }, JSON.stringify({ ...base, view, tab }));
    const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:8123/'); await p.waitForTimeout(250);
    await p.locator('#menuBtn').click(); await p.waitForTimeout(100); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    const closed = !(await p.evaluate(() => document.getElementById('menuDialog').open));
    ok(!errs.length && closed, `${vw}, view ${view}, ${tab} tab: opens without errors and Esc closes the menu ${errs.join('; ')}`);
    await c.close();
  }
  await b.close();
})();
