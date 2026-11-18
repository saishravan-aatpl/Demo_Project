const { chromium, devices } = require('playwright');
const [backup, out] = process.argv.slice(2);
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) process.exitCode = 1; };
const wait = ms => new Promise(r => setTimeout(r, ms));

async function setup(b, opts) {
  const ctx = await b.newContext({ ...opts, serviceWorkers: 'block' });
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.DASHBOARD_CONFIG={}' }));
  const p = await ctx.newPage(); p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('http://localhost:8123/');
  await p.click('#menuBtn');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#settingsBtn').then(() => p.click('#importBtn'))]);
  await ch.setFiles(backup); await p.waitForTimeout(400);
  return { ctx, p };
}
const data = p => p.evaluate(() => JSON.parse(JSON.stringify(window.dashboardApp.getData())));
const tasksOf = async (p, name) => (await data(p)).projects.find(x => x.name === name).tasks.map(t => t.text);
const center = async loc => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

(async () => {
  const b = await chromium.launch();

  // ================= PHONE =================
  const { ctx, p } = await setup(b, devices['iPhone 14']);
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  async function fingerDrag(from, toFn, { hold = 450, steps = 12 } = {}) {
    await touch('touchStart', from.x, from.y);
    await wait(hold);
    const to = await toFn();
    for (let i = 1; i <= steps; i++) { await touch('touchMove', from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await wait(16); }
    await wait(60);
    await touch('touchEnd'); await wait(400);
  }
  const card = name => p.locator('.project-card', { has: p.locator(`.project-title:text-is("${name}")`) });
  const taskRow = text => p.locator('.task-item', { has: p.locator('.task-text', { hasText: text }) });
  const scrollTo = async loc => { await loc.evaluate(el => el.scrollIntoView({ block: 'center' })); await wait(80); };

  const layout = await p.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    clipped: [...document.querySelectorAll('.task-text')].some(t => t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1),
    personCol: [...document.querySelectorAll('.person-wrap')].every(e => Math.round(e.getBoundingClientRect().width) === 76),
    timeFits: (() => { const a = document.getElementById('timePill').getBoundingClientRect(); return a.left >= 0 && a.right <= innerWidth; })(),
    oneRowHeader: [...document.querySelectorAll('.project-header')].every(h => h.getBoundingClientRect().height < 90)
  }));
  ok(!layout.overflow && !layout.clipped, 'phone: nothing sticks out, every task name fully visible');
  ok(layout.timeFits, 'phone: time pill fits in the top bar');
  ok(layout.personCol && layout.oneRowHeader, 'phone: laptop-style rows (person column) and one-row project headers');

  // reorder within a project by press-and-hold
  await scrollTo(card('Mobile App'));
  let before = await tasksOf(p, 'Mobile App');
  await fingerDrag(await center(taskRow(before[0]).locator('.task-text')), async () => {
    const r = await taskRow(before[1]).boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height * 0.9 };
  });
  let after = await tasksOf(p, 'Mobile App');
  ok(after[0] === before[1] && after[1] === before[0], 'phone: press-and-hold drag reorders tasks');
  await p.reload(); await wait(300);
  ok((await tasksOf(p, 'Mobile App'))[0] === before[1], 'phone: new order saved');

  // quick swipe = scroll, not drag
  await scrollTo(card('Mobile App'));
  before = await tasksOf(p, 'Mobile App');
  const sy = await p.evaluate(() => scrollY);
  const s0 = await center(taskRow(before[0]).locator('.task-text'));
  await touch('touchStart', s0.x, s0.y);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', s0.x, s0.y - i * 25); await wait(16); }
  await touch('touchEnd'); await wait(400);
  ok(JSON.stringify(await tasksOf(p, 'Mobile App')) === JSON.stringify(before) && await p.locator('.drag-floating').count() === 0, 'phone: a quick swipe does not drag');
  ok((await p.evaluate(() => scrollY)) !== sy, 'phone: ...it scrolls the page instead');

  // drag into another (expanded) project
  await p.locator('.project-card').first().evaluate(el => el.scrollIntoView({ block: 'start' }));
  const moving = (await tasksOf(p, 'Web Portal'))[0];
  await fingerDrag(await center(taskRow(moving).locator('.task-text')), async () => {
    const r = await card('Mobile App').locator('.task-item').first().boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height * 0.8 };
  });
  ok((await tasksOf(p, 'Mobile App')).includes(moving) && !(await tasksOf(p, 'Web Portal')).includes(moving), 'phone: drag a task into a different project');
  ok((await p.textContent('#undoMessage')).includes('Moved to Mobile App'), 'phone: confirms "Moved to Mobile App"');

  // drop onto a collapsed project
  await card('Client Demo').locator('.project-more').click();
  await p.locator('.action-menu-item', { hasText: 'Collapse' }).click(); await wait(200);
  await scrollTo(card('Client Demo'));
  const m2 = (await tasksOf(p, 'Data Hub'))[0];
  await fingerDrag(await center(taskRow(m2).locator('.task-text')), async () => center(card('Client Demo').locator('.project-title')));
  ok((await tasksOf(p, 'Client Demo')).includes(m2), 'phone: drop a task onto a collapsed project');
  ok(await card('Client Demo').evaluate(el => el.classList.contains('collapsed')), 'phone: collapse via ⋯ menu works (and stays collapsed)');
  await card('Client Demo').locator('.project-more').click();
  await p.locator('.action-menu-item', { hasText: 'Expand' }).click(); await wait(200);

  // tap to edit
  await scrollTo(card('Data Hub'));
  const editRow = card('Data Hub').locator('.task-item').first();
  await editRow.locator('.task-text').tap();
  ok(await p.locator('textarea.task-text.editing').count() === 1, 'phone: tapping a task name opens it for editing');
  await p.locator('textarea.task-text.editing').evaluate(el => el.setSelectionRange(el.value.length, el.value.length));
  await p.keyboard.type(' now'); await p.keyboard.press('Enter'); await wait(200);
  const edited = (await tasksOf(p, 'Data Hub'))[0];
  ok(edited.endsWith(' now') && !edited.includes('\n') && await p.locator('textarea.task-text').count() === 0, 'phone: edit saved with Enter');

  // ⋯ menu: move to project (submenu), move to top, delete
  const t3 = (await tasksOf(p, 'App Speedup'))[1];
  await scrollTo(card('App Speedup'));
  await taskRow(t3).locator('.task-more').tap();
  const menuItems = await p.locator('.action-menu-item').allTextContents();
  ok(JSON.stringify(menuItems) === JSON.stringify(['Pin for today', 'Move to project', 'Move to top', 'Delete task']), 'phone: task ⋯ menu shows 4 short options');
  const mb = await p.locator('.action-menu').boundingBox();
  ok(mb.x >= 0 && mb.x + mb.width <= 390 && mb.y >= 0 && mb.y + mb.height <= 664, 'phone: menu fits on screen');
  await p.locator('.action-menu-item', { hasText: 'Move to top' }).tap(); await wait(200);
  ok((await tasksOf(p, 'App Speedup'))[0] === t3, 'phone: Move to top');
  await taskRow(t3).locator('.task-more').tap();
  await p.locator('.action-menu-item', { hasText: 'Move to project' }).tap();
  ok(await p.locator('.action-menu-item.back').count() === 1, 'phone: Move to project opens project list with Back');
  await p.locator('.action-menu-item', { hasText: 'Others' }).tap(); await wait(200);
  ok((await tasksOf(p, 'Others')).includes(t3), 'phone: Move to project → Others');
  const t4 = (await tasksOf(p, 'Others'))[0];
  await scrollTo(card('Others'));
  await taskRow(t4).locator('.task-more').tap();
  await p.locator('.action-menu-item', { hasText: 'Delete task' }).tap(); await wait(200);
  ok(!(await tasksOf(p, 'Others')).includes(t4), 'phone: Delete task');

  // tick and assign still work, and don't start a drag
  await scrollTo(card('Miscellaneous'));
  const tr = card('Miscellaneous').locator('.task-item').first();
  await tr.locator('.task-check').tap(); await wait(200);
  ok((await data(p)).projects.find(x => x.name === 'Miscellaneous').tasks.some(t => t.done), 'phone: ticking a task works');
  const unassigned = card('Web Speedup').locator('.task-item').first();
  await scrollTo(unassigned);
  await unassigned.locator('.person-field').tap();
  await p.locator('.person-menu.open .person-search').fill('Nina'); await p.keyboard.press('Enter'); await wait(200);
  ok((await data(p)).projects.find(x => x.name === 'Web Speedup').tasks[0].person === 'Nina', 'phone: assigning a person works');

  // project drag by ☰
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.locator('.project-card').first().evaluate(el => el.scrollIntoView({ block: 'start' }));
  const names = async () => (await data(p)).projects.map(x => x.name);
  const pb = await names();
  const h = await center(p.locator('.project-card').first().locator('.project-title'));
  await fingerDrag(h, async () => { const r = await p.locator('.project-card').nth(1).boundingBox(); return { x: h.x, y: r.y + r.height * 0.85 }; });
  const pa = await names();
  ok(pa[0] === pb[1] && pa[1] === pb[0], 'phone: press-and-hold a project header to drag it');

  // project delete via ⋯
  await card('Others').locator('.project-more').tap();
  await p.locator('.action-menu-item', { hasText: 'Delete project' }).tap(); await wait(200);
  ok(!(await names()).includes('Others'), 'phone: Delete project via ⋯ (after confirm)');
  ok(p.errors.length === 0, `phone: no page errors ${p.errors.join(';')}`);
  await ctx.close();

  // ================= LAPTOP =================
  const L = await setup(b, { viewport: { width: 1280, height: 900 } });
  const q = L.p;
  const lcard = name => q.locator('.project-card', { has: q.locator(`.project-title:text-is("${name}")`) });
  const lrow = text => q.locator('.task-item', { has: q.locator('.task-text', { hasText: text }) });
  await lcard('Mobile App').evaluate(el => el.scrollIntoView({ block: 'start' }));
  await lrow('Collect quotes').hover(); await wait(250);
  ok(await lrow('Collect quotes').locator('.task-handle').evaluate(el => getComputedStyle(el).opacity) === '1', 'laptop: ⋮⋮ handle appears on hover');
  const lb = await tasksOf(q, 'Mobile App');
  const from = await center(lrow(lb[0]).locator('.task-text'));
  const tb = await lrow(lb[1]).boundingBox();
  await q.mouse.move(from.x, from.y); await q.mouse.down();
  for (let i = 1; i <= 10; i++) { await q.mouse.move(from.x, from.y + (tb.y + tb.height * 0.9 - from.y) * i / 10); await wait(16); }
  await q.mouse.up(); await wait(400);
  ok((await tasksOf(q, 'Mobile App'))[0] === lb[1], 'laptop: mouse drag reorders tasks');
  ok(await q.locator('textarea.task-text').count() === 0, 'laptop: dragging does not open the editor');
  const g = await center(lrow('Collect quotes').locator('.task-text'));
  const target = await lcard('Mobile App').locator('.project-header').boundingBox();
  await q.mouse.move(g.x, g.y); await q.mouse.down();
  for (let i = 1; i <= 12; i++) { await q.mouse.move(g.x, g.y + (target.y + target.height / 2 - g.y) * i / 12); await wait(16); }
  await q.mouse.up(); await wait(400);
  ok((await tasksOf(q, 'Mobile App'))[0] === 'Collect quotes', 'laptop: drag a task onto another project\'s header → goes to its top');
  await lrow('Collect quotes').locator('.task-text').click();
  ok(await q.locator('textarea.task-text.editing').count() === 1, 'laptop: click on a task name edits it');
  await q.keyboard.press('Escape');
  const lpb = (await data(q)).projects.map(x => x.name);
  await q.evaluate(() => window.scrollTo(0, 0)); await wait(200);
  const lh = await center(q.locator('.project-card').nth(2).locator('.project-title'));
  const lt = await q.locator('.project-card').nth(0).boundingBox();
  await q.mouse.move(lh.x, lh.y); await q.mouse.down();
  for (let i = 1; i <= 12; i++) { await q.mouse.move(lh.x, lh.y + (lt.y + 10 - lh.y) * i / 12); await wait(16); }
  await q.mouse.up(); await wait(400);
  ok((await data(q)).projects.map(x => x.name)[0] === lpb[2], 'laptop: drag a project by its header to the top');
  ok(q.errors.length === 0, `laptop: no page errors ${q.errors.join(';')}`);
  await b.close();
})();
