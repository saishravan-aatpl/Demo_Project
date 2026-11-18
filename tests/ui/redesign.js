const { chromium, devices } = require('playwright');
const [backup] = process.argv.slice(2);
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) process.exitCode = 1; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const today = () => new Date().toLocaleDateString('en-CA');

async function setup(b, opts) {
  const ctx = await b.newContext({ ...opts, serviceWorkers: 'block' });
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.DASHBOARD_CONFIG={}' }));
  const p = await ctx.newPage(); p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('http://localhost:8123/');
  await p.click('#menuBtn');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#settingsBtn').then(() => p.click('#importBtn'))]);
  await ch.setFiles(backup); await wait(400);
  await p.evaluate(() => window.hideUndoToast && hideUndoToast());
  return { ctx, p };
}
const data = p => p.evaluate(() => JSON.parse(JSON.stringify(window.dashboardApp.getData())));
const task = async (p, text) => (await data(p)).projects.flatMap(x => x.tasks.map(t => ({ ...t, project: x.name }))).find(t => t.text === text);
const visibleProjects = p => p.locator('.project-card .project-title').allTextContents();

(async () => {
  const b = await chromium.launch();

  // ===================== PHONE =====================
  const { ctx, p } = await setup(b, devices['iPhone 14']);
  const layout = await p.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    clock: document.getElementById('currentTime').textContent,
    pill: getComputedStyle(document.getElementById('timePill')).display !== 'none',
    brandHidden: getComputedStyle(document.querySelector('.ab-brand')).display === 'none',
    addHidden: getComputedStyle(document.getElementById('addBtn')).display === 'none',
    tabs: getComputedStyle(document.getElementById('tabbar')).display !== 'none',
    fab: getComputedStyle(document.getElementById('fabAdd')).display !== 'none',
    rail: getComputedStyle(document.getElementById('rail')).display === 'none',
    chips: document.querySelectorAll('#chips .chip').length,
    barH: document.getElementById('appbar').getBoundingClientRect().height
  }));
  ok(!layout.overflow && /\d:\d\d (AM|PM)/.test(layout.clock) && layout.pill, 'phone: slim app bar with time and time pill, nothing sticks out');
  ok(layout.brandHidden && layout.addHidden && layout.rail, 'phone: name, Add button and left list hidden');
  ok(layout.tabs && layout.fab && layout.chips >= 10, `phone: bottom tabs, + button and chips (${layout.chips}) shown`);
  ok(layout.barH <= 60, `phone: top bar is small (${Math.round(layout.barH)}px)`);
  const pill = await p.evaluate(() => ({ main: document.querySelector('.pill-main').textContent, sub: document.getElementById('pillSub').textContent, ring: !!document.querySelector('.ring') }));
  ok(/^(\d+h )?\d+m (left|over)$/.test(pill.main) && /^(until|since) \d+:\d\d (AM|PM)$/.test(pill.sub) && !pill.ring, `two-line pill: "${pill.main}" / "${pill.sub}", no ring`);
  const zoom = await p.evaluate(() => ({ meta: document.querySelector('meta[name=viewport]').content, small: [...document.querySelectorAll('input, textarea, select')].filter(el => !['checkbox', 'file', 'hidden'].includes(el.type) && parseFloat(getComputedStyle(el).fontSize) < 16).map(el => el.id || el.className) }));
  ok(zoom.meta.includes('maximum-scale=1') && zoom.meta.includes('user-scalable=no'), 'phone: zooming turned off');
  ok(zoom.small.length === 0, `phone: every text box has 16px text (no auto-zoom) ${zoom.small.join(',')}`);

  // chips filter
  await p.locator('#chips .chip', { hasText: 'Mobile App' }).click(); await wait(200);
  ok(JSON.stringify(await visibleProjects(p)) === '["Mobile App"]' && await p.textContent('#viewTitleText') === 'Mobile App', 'phone: tapping a project chip shows just that project');
  await p.click('#viewClear'); await wait(200);
  ok((await visibleProjects(p)).length === 8, '"Show all" brings everything back');

  // quick add
  await p.click('#fabAdd'); await wait(300);
  ok(await p.isVisible('#addDialog') && await p.evaluate(() => document.activeElement.id) === 'addText', 'phone: + opens quick add, ready to type');
  await p.locator('#addText').pressSequentially('Send quote to vendor @pri', { delay: 20 }); await wait(150);
  const sugg = await p.locator('#addDialog .mention-option').allTextContents();
  ok(await p.isVisible('#addDialog .mention-box') && sugg[0].includes('Priya') && sugg.some(t => t.includes('Add "pri" as a new person')), 'typing @pri suggests Priya (and offers a new person)');
  await p.locator('#addDialog .mention-option', { hasText: 'Priya' }).dispatchEvent('pointerdown'); await wait(100);
  ok(await p.inputValue('#addText') === 'Send quote to vendor @Priya ' && !(await p.isVisible('#addDialog .mention-box')), 'tapping it fills in "@Priya"');
  await p.locator('#addProjects .chip', { hasText: 'Data Hub' }).click();
  await p.click('#addPinWrap');
  await p.click('#addSubmit'); await wait(300);
  let t = await task(p, 'Send quote to vendor');
  ok(t && t.project === 'Data Hub' && t.person === 'Priya' && t.pinnedOn === today(), 'quick add: task in Data Hub, assigned to Priya, pinned for today');
  ok((await p.textContent('#undoMessage')) === 'Added to Data Hub', 'quick add: "Added to Data Hub · Undo"');
  await p.click('#fabAdd'); await wait(200);
  await p.locator('#addForm .seg button', { hasText: 'Project' }).click();
  await p.fill('#addText', 'New Pump Line'); await p.press('#addText', 'Enter'); await wait(300);
  ok((await data(p)).projects.some(x => x.name === 'New Pump Line'), 'quick add: create a project (Enter adds)');
  await p.click('#fabAdd'); await wait(200);
  ok((await p.locator('#addProjects .chip').first().textContent()) === 'New Pump Line' || (await p.locator('#addProjects .chip').first().textContent()) === 'Data Hub', 'quick add: last used project offered first');
  await p.keyboard.press('Escape'); await wait(200);

  // leaving time pill
  await p.click('#timePill'); await wait(300);
  ok(await p.isVisible('#timeDialog') && (await p.locator('.time-chip').count()) >= 5, 'phone: time pill opens quick picks');
  await p.locator('.time-chip[data-time="18:30"]').click(); await wait(200);
  let d = await data(p);
  ok(d.leaveTime === '18:30' && d.leaveDate === today() && d.usualLeaveTime === '17:00', "pick 6:30 → today only; usual stays 5:00");
  await p.evaluate(() => { state.leaveDate = '2000-01-01'; updateRemainingTime(); });
  ok(await p.evaluate(() => leaveTimeToday()) === '17:00', 'next day: back to the usual time');
  await p.click('#menuBtn'); await wait(200);
  ok(await p.isVisible('#menuDialog') && await p.isVisible('#settingsBtn') && await p.isVisible('#usualLeaveBtn'), 'phone: menu opens with leaving time, Settings');
  await p.click('#usualLeaveBtn'); await wait(300);
  await p.locator('.time-chip[data-time="17:30"]').click(); await wait(200);
  ok((await data(p)).usualLeaveTime === '17:30' && (await p.textContent('#usualLeaveLabel')) === '5:30 PM', 'menu: usual leaving time set to 5:30 PM');

  // pinning: menu, swipe, plan today, carry-over
  const row = text => p.locator('.task-item', { has: p.locator('.task-text', { hasText: text }) });
  await row('Collect quotes').locator('.task-more').click(); await wait(150);
  const items = await p.locator('.action-menu-item').allTextContents();
  ok(items[0] === 'Pin for today', '⋯ menu starts with "Pin for today"');
  await p.locator('.action-menu-item', { hasText: 'Pin for today' }).click(); await wait(200);
  ok((await task(p, 'Collect quotes')).pinnedOn === today() && await p.locator('#focusList .focus-task', { hasText: 'Collect quotes' }).count() === 1, 'pinned via menu; appears in "Pinned for today"');
  ok(await row('Collect quotes').locator('.task-pin').isVisible() && !(await row('Follow up on test plan').locator('.task-pin').isVisible()), 'phone: pin shows only on pinned tasks');

  const cdp = await ctx.newCDPSession(p);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const target = row('Follow up on test plan');
  await target.scrollIntoViewIfNeeded();
  const bb = await target.locator('.task-text').boundingBox();
  const sx = bb.x + 10, sy = bb.y + bb.height / 2;
  await touch('touchStart', sx, sy);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', sx + i * 12, sy); await wait(16); }
  const midSwipeWidth = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  await touch('touchEnd'); await wait(400);
  ok(midSwipeWidth <= 0, 'phone: mid-swipe the page never gets wider than the screen (no zoom-out)');
  ok((await task(p, 'Follow up on test plan')).pinnedOn === today(), 'phone: swipe right pins a task');
  ok(await p.locator('textarea.task-text').count() === 0, 'swipe does not open the task for editing');

  await p.evaluate(() => window.scrollTo(0, 0));
  await p.click('#planTodayBtn'); await wait(300);
  ok(await p.isVisible('#planDialog') && (await p.locator('#planList input:checked').count()) >= 3, 'Plan today lists open tasks with pinned ones ticked');
  await p.locator('.plan-row', { hasText: 'Collect quotes' }).locator('input').uncheck();
  await p.locator('.plan-row', { hasText: 'Idea planning' }).locator('input').check();
  ok((await p.textContent('#planDone')).startsWith('Pin '), 'button shows how many will be pinned');
  await p.click('#planDone'); await wait(300);
  ok(!(await task(p, 'Collect quotes')).pinnedOn && (await task(p, 'Idea planning')).pinnedOn === today(), 'Plan today: unticked unpinned, ticked pinned');

  await p.evaluate(() => { const t = allTasks().find(x => x.task.text === 'Garden pump concept').task; t.pinnedOn = '2000-01-01'; saveState(false); render(); });
  ok(await p.isVisible('#focusCarry') && (await p.textContent('#focusCarryText')).includes('1 task'), 'next morning: "1 task you pinned earlier is still open"');
  await p.click('#carryKeep'); await wait(200);
  ok((await task(p, 'Garden pump concept')).pinnedOn === today() && !(await p.isVisible('#focusCarry')), 'Keep re-pins it for today');

  // pinned chip view
  await p.locator('#chips .chip', { hasText: 'Pinned' }).click(); await wait(200);
  ok(await p.isVisible('#focusPanel') && (await visibleProjects(p)).length === 0, 'Pinned chip: only the pinned list');
  await p.locator('#chips .chip', { hasText: 'All' }).first().click(); await wait(200);

  // collapse / expand, rename
  await p.click('#toggleAllBtn'); await wait(200);
  ok(await p.locator('.project-card.collapsed').count() === 9 && (await p.locator('.project-card').nth(1).locator('.project-summary').textContent()).includes('open'), 'Collapse all: one-line summaries ("2 open · Sam, Sage")');
  ok((await p.textContent('#toggleAllBtn')) === 'Expand all', 'button switches to "Expand all"');
  await p.locator('.project-card').nth(1).locator('.collapse-btn').click(); await wait(200);
  ok(!(await p.locator('.project-card').nth(1).evaluate(el => el.classList.contains('collapsed'))), 'arrow opens a single project');
  await p.locator('.project-card').nth(1).locator('.project-title').click();
  await p.fill('.project-title-input', 'Mobile App (EU)'); await p.press('.project-title-input', 'Enter'); await wait(200);
  ok((await data(p)).projects[1].name === 'Mobile App (EU)', 'tap a project name to rename it');

  // tabs
  await p.locator('#tabbar [data-tab="people"]').click(); await wait(200);
  ok(await p.isVisible('#colPeople') && !(await p.isVisible('#colMain')), 'People tab replaces the projects');
  await p.locator('.person-head', { hasText: 'Sage' }).click(); await wait(200);
  ok(await p.locator('.person-block.open .focus-task', { hasText: 'Get layout details from Robin' }).count() === 1, "tap Sage: his open tasks with project names");
  await p.locator('#tabbar [data-tab="notes"]').click(); await wait(200);
  ok(await p.isVisible('#dayNotes') && !(await p.isVisible('#fabAdd')), 'Notes tab: notes full screen');
  await p.fill('#dayNotes', 'Wrapped up early'); await wait(100);
  ok((await data(p)).dayNotes === 'Wrapped up early' && (await p.textContent('#progressText')).includes('pinned done'), 'notes save; progress line shows pinned');
  await p.locator('#tabbar [data-tab="projects"]').click(); await wait(200);

  // copy summary
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await p.click('#copySummaryBtn'); await wait(300);
  const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => buildSummaryText()));
  ok(clip.includes('Focus today:') && (await p.textContent('#toast')).includes('copied'), 'copy icon copies the summary (pinned tasks first)');
  ok(p.errors.length === 0, `phone: no page errors ${p.errors.join(';')}`);
  await ctx.close();

  // ===================== LAPTOP =====================
  const L = await setup(b, { viewport: { width: 1360, height: 860 } });
  const q = L.p;
  const lay = await q.evaluate(() => ({
    rail: getComputedStyle(document.getElementById('rail')).display !== 'none',
    notes: getComputedStyle(document.getElementById('colNotes')).display !== 'none',
    tabs: getComputedStyle(document.getElementById('tabbar')).display === 'none',
    chips: getComputedStyle(document.getElementById('chips')).display === 'none',
    word: document.getElementById('remainingWord').textContent
  }));
  ok(lay.rail && lay.notes && lay.tabs && lay.chips && /left|over/.test(lay.word), 'laptop: left list, notes column, no tabs/chips, two-line pill');
  await q.locator('.project-card').nth(1).locator('.show-task-form').click();
  await q.locator('.project-card').nth(1).locator('.new-task').pressSequentially('Check @mo', { delay: 15 }); await wait(150);
  ok((await q.locator('.project-card').nth(1).locator('.mention-option').first().textContent()).includes('Miles'), "a project's own add-task box suggests names too");
  await q.keyboard.press('Escape'); await q.keyboard.press('Escape'); await wait(100);
  await q.locator('.rail-item', { hasText: 'Sam' }).first().click(); await wait(200);
  const samTasks = await q.locator('.task-item .person-field').allTextContents();
  ok(samTasks.length >= 9 && samTasks.every(n => n === 'Sam') && (await q.textContent('#viewTitleText')) === "Sam's tasks", 'laptop: click "Sam" → only Sam\'s tasks');
  ok(await q.locator('#searchInput').count() === 0, 'laptop: search removed');
  const rheads = await q.evaluate(() => [...document.querySelectorAll('.rail-head')].map(h => getComputedStyle(h).borderTopWidth));
  ok(rheads.length >= 2 && rheads.every(w => w === '1px'), 'laptop list: a dividing line before Projects and People');
  await q.locator('.rail-item', { hasText: 'All tasks' }).click(); await wait(200);
  await q.locator('h2.notes-title').click();
  await q.keyboard.press('n'); await wait(300);
  await q.keyboard.type('Review drawings @sa', { delay: 20 }); await wait(150);
  ok((await q.locator('#addDialog .mention-option').first().textContent()).includes('Sam'), 'laptop: @sa suggests Sam first (most open tasks)');
  await q.keyboard.press('ArrowDown'); await q.keyboard.press('Enter'); await wait(100);
  ok(await q.inputValue('#addText') === 'Review drawings @Sage ', 'arrow keys + Enter pick a suggestion (Enter does not add the task yet)');
  await q.fill('#addText', ''); await q.keyboard.type('Ask about samples @Nina', { delay: 15 }); await wait(150);
  await q.keyboard.press('Enter'); await wait(100);
  await q.keyboard.press('Enter'); await wait(300);
  ok((await task(q, 'Ask about samples'))?.person === 'Nina', 'a known name typed in full is used without picking');
  await q.keyboard.press('n'); await wait(300);
  await q.keyboard.type('Draft spec @Ravi', { delay: 15 }); await wait(150);
  await q.locator('#addDialog .mention-option', { hasText: 'as a new person' }).dispatchEvent('pointerdown'); await wait(100);
  await q.keyboard.press('Enter'); await wait(300);
  ok((await task(q, 'Draft spec'))?.person === 'Ravi', 'a new person can be added from the suggestions');
  await q.keyboard.press('n'); await wait(300);
  const dlg = await q.locator('#addDialog').boundingBox(); const btn = await q.locator('#addBtn').boundingBox();
  ok(await q.isVisible('#addDialog') && Math.abs(dlg.y - (btn.y + btn.height + 8)) < 3, '"N" opens quick add as a pop-up under the Add button');
  await q.keyboard.press('Escape'); await wait(200);
  const r = q.locator('.task-item', { has: q.locator('.task-text', { hasText: 'Collect quotes' }) });
  ok(!(await r.locator('.task-pin').isVisible()), 'laptop: pin hidden until you hover');
  await r.hover(); await wait(100);
  ok(await r.locator('.task-pin').isVisible(), 'hovering shows the pin');
  await r.locator('.task-pin').click(); await wait(200);
  ok((await task(q, 'Collect quotes')).pinnedOn === today(), 'click the pin → pinned for today');
  // drag still works on laptop (All view)
  const lb = (await data(q)).projects[1].tasks.map(t => t.text);
  const from = await q.locator('.project-card').nth(1).locator('.task-item').first().locator('.task-text').boundingBox();
  const to = await q.locator('.project-card').nth(1).locator('.task-item').nth(1).boundingBox();
  await q.mouse.move(from.x + 20, from.y + from.height / 2); await q.mouse.down();
  for (let i = 1; i <= 10; i++) { await q.mouse.move(from.x + 20, from.y + from.height / 2 + (to.y + to.height * 0.9 - from.y - from.height / 2) * i / 10); await wait(16); }
  await q.mouse.up(); await wait(400);
  ok((await data(q)).projects[1].tasks[0].text === lb[1], 'laptop: drag to reorder still works');
  const pb = (await data(q)).projects.map(x => x.name);
  const ph = await q.locator('.project-card').nth(2).locator('.project-title').boundingBox();
  const pt = await q.locator('.project-card').nth(0).boundingBox();
  await q.mouse.move(ph.x + 30, ph.y + 8); await q.mouse.down();
  for (let i = 1; i <= 12; i++) { await q.mouse.move(ph.x + 30, ph.y + 8 + (pt.y + 8 - ph.y - 8) * i / 12); await wait(16); }
  await q.mouse.up(); await wait(400);
  ok((await data(q)).projects[0].name === pb[2], 'laptop: drag a project by its header');
  ok(q.errors.length === 0, `laptop: no page errors ${q.errors.join(';')}`);

  // ===================== TABLET =====================
  const T = await setup(b, { viewport: { width: 820, height: 1000 } });
  const tl = await T.p.evaluate(() => ({
    rail: getComputedStyle(document.getElementById('rail')).display === 'none',
    chips: getComputedStyle(document.getElementById('chips')).display !== 'none',
    notes: getComputedStyle(document.getElementById('colNotes')).display !== 'none',
    overflow: document.documentElement.scrollWidth > innerWidth
  }));
  ok(tl.rail && tl.chips && tl.notes && !tl.overflow, 'tablet: chips instead of the left list, notes column kept');
  await b.close();
})();
