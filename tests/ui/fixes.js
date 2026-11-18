const { chromium, devices } = require('playwright');
const fs = require('fs');
const S = process.argv[3];
const many = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (let i = 3; i <= 6; i++) many.projects.push({ id: 'p' + i, name: 'Project ' + i, collapsed: false, tasks: [1,2,3,4].map(n => ({ id: `p${i}t${n}`, text: `Task ${n} of project ${i}`, done: false, person: '' })) });
const data = JSON.stringify(many);
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
async function ctx(b, opts) {
  const c = await b.newContext({ ...opts, serviceWorkers: 'block' });
  await c.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.DASHBOARD_CONFIG={}' }));
  await c.addInitScript(d => { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x','1'); localStorage.clear(); localStorage.setItem('officeDailyDashboard.stable.v2', d); } }, data);
  const p = await c.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.goto('http://localhost:8123/'); await p.waitForTimeout(400); return p;
}
(async () => {
  const b = await chromium.launch();
  // Laptop
  let p = await ctx(b, { viewport: { width: 1300, height: 700 } });
  await p.mouse.wheel(0, 900); await p.waitForTimeout(500);
  const top = sel => p.evaluate(s => Math.round(document.querySelector(s).getBoundingClientRect().top), sel);
  ok(await p.evaluate(() => scrollY) > 300, 'laptop: page scrolled');
  ok(await top('#appbar') === 0, 'laptop: top bar stays at the top');
  ok(Math.abs(await top('#rail') - 76) < 4, 'laptop: left list stays put (' + await top('#rail') + ')');
  ok(Math.abs(await top('#colNotes') - 76) < 4, 'laptop: notes stay put (' + await top('#colNotes') + ')');
  // arrows in side list
  await p.locator('#rail .rail-item').first().focus();
  for (let i = 0; i < 6; i++) { await p.keyboard.press('ArrowDown'); if (await p.evaluate(() => (document.activeElement.dataset.view || '').startsWith('project:'))) break; }
  const f1 = await p.evaluate(() => document.activeElement.textContent);
  ok(/Website|Quarterly/.test(f1), 'laptop: arrows move in the side list -> ' + f1.trim());
  await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.activeElement.classList.contains('rail-item')), 'laptop: focus stays in list after Enter');
  await p.locator('#rail .rail-item').first().click(); await p.waitForTimeout(200);
  // ⋯ menu with arrows
  const row = p.locator('.task-item').first(); await row.hover(); await row.locator('.task-more').click();
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown');
  const second = await p.evaluate(() => document.activeElement.textContent);
  ok(/Move to project/.test(second), 'laptop: ↓ in ⋯ menu -> ' + second);
  await p.keyboard.press('ArrowRight');
  const sub = await p.evaluate(() => [...document.querySelectorAll('.action-menu-item')].map(b => b.textContent).join('|'));
  ok(/Back/.test(sub), 'laptop: → opens submenu');
  await p.keyboard.press('ArrowLeft');
  ok(/Pin for today|Unpin/.test(await p.evaluate(() => document.querySelector('.action-menu').textContent)), 'laptop: ← goes back');
  await p.keyboard.press('Escape');
  ok(await p.evaluate(() => !document.querySelector('.action-menu') && document.activeElement.classList.contains('task-more')), 'laptop: Esc closes and returns to ⋯');
  // quick add chips arrows
  await p.keyboard.press('n'); await p.waitForTimeout(200);
  await p.locator('#addProjects button').first().focus(); await p.keyboard.press('ArrowRight');
  ok(await p.evaluate(() => document.activeElement.parentElement.id === 'addProjects' && document.activeElement !== document.querySelector('#addProjects button')), 'laptop: → moves between project chips');
  ok(p.errs.length === 0, 'laptop: no errors ' + p.errs.join(';'));
  await p.close();

  // Phone
  p = await ctx(b, devices['iPhone 13']);
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(400);
  ok(await top('#appbar') === 0, 'phone: top bar stays at the top');
  const last = await p.locator('.task-item').last().locator('.task-more').boundingBox();
  const fab = await p.locator('#fabAdd').boundingBox();
  ok(last.y + last.height < fab.y - 4, `phone: last ⋯ clear of + button (${Math.round(last.y + last.height)} < ${Math.round(fab.y)})`);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone: nothing sticks out sideways');
  await p.screenshot({ path: S + '/fix-phone-bottom.png' });
  // swipe mid-way screenshot
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300);
  const t = p.locator('.task-item').nth(1); const bb = await t.boundingBox();
  const cdp = await p.context().newCDPSession(p);
  const y = bb.y + bb.height / 2, x0 = bb.x + 60;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
  for (let dx = 10; dx <= 100; dx += 10) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dx, y }] });
  await p.waitForTimeout(100);
  const rowBox = await t.boundingBox();
  ok(Math.abs(rowBox.x - bb.x) < 1 && Math.abs(rowBox.width - bb.width) < 1, 'phone: row frame stays in place while swiping');
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone: swipe doesn\'t stick out');
  await p.screenshot({ path: S + '/fix-swipe.png', clip: { x: 0, y: bb.y - 20, width: 390, height: bb.height + 40 } });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(400);
  ok(await t.evaluate(el => el.classList.contains('pinned') || !!el.closest('.task-item')), 'phone: swipe finished');
  ok(await p.evaluate(() => !document.querySelector('.swiping, .swipe-return')), 'phone: swipe tidied up');
  ok(p.errs.length === 0, 'phone: no errors ' + p.errs.join(';'));
  await b.close();
})();
