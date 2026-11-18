// Small, medium and Android phones: nothing sticks out sideways, long task names wrap, rows stay inside cards.
const { chromium, devices } = require('playwright');
const [backup] = process.argv.slice(2);
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) process.exitCode = 1; };
const LONG = 'Follow up with the vendor on revised quotation and delivery timelines for the next batch';
(async () => {
  const b = await chromium.launch();
  for (const [name, dev] of [['iphone-se', devices['iPhone SE']], ['iphone14', devices['iPhone 14']], ['pixel', devices['Pixel 7']]]) {
    const ctx = await b.newContext({ ...dev, serviceWorkers: 'block' });
    await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.DASHBOARD_CONFIG={}' }));
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
    await p.goto('http://localhost:8123/');
    await p.click('#menuBtn');
    const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#settingsBtn').then(() => p.click('#importBtn'))]);
    await ch.setFiles(backup); await p.waitForTimeout(400);
    await p.evaluate(text => { const d = window.dashboardApp.getData(); d.projects[0].tasks.push({ id: 'long-1', text, done: false, person: '' }); window.dashboardApp.applyData(d); }, LONG);
    await p.waitForTimeout(300);
    const r = await p.evaluate(long => {
      const inside = el => { const a = el.getBoundingClientRect(), c = el.closest('.project-card').getBoundingClientRect(); return a.left >= c.left - 0.5 && a.right <= c.right + 0.5; };
      const texts = [...document.querySelectorAll('.task-text')];
      const longEl = texts.find(t => (t.value ?? t.textContent).startsWith(long.slice(0, 20)));
      return {
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        found: !!longEl,
        longWraps: !!longEl && longEl.getBoundingClientRect().height > 40,
        allVisible: texts.every(t => t.scrollHeight <= t.clientHeight + 2),
        rowsInside: [...document.querySelectorAll('.project-card .task-item')].every(inside),
        barFits: document.getElementById('appbar').getBoundingClientRect().right <= window.innerWidth + 0.5,
      };
    }, LONG);
    ok(!r.overflow, `${name}: nothing sticks out sideways`);
    ok(r.found && r.longWraps, `${name}: a long task name wraps onto more lines`);
    ok(r.allVisible, `${name}: every task name is fully visible`);
    ok(r.rowsInside, `${name}: task rows stay inside their cards`);
    ok(r.barFits, `${name}: top bar fits the screen`);
    ok(errors.length === 0, `${name}: no errors ${errors.join('; ')}`);
    await ctx.close();
  }
  await b.close();
})();
