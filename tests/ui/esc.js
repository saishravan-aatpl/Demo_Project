const { chromium } = require('playwright');
const fs = require('fs');
const data = fs.readFileSync(process.argv[2], 'utf8'); const S = process.argv[3];
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch(); const c = await b.newContext({ viewport: { width: 1300, height: 800 }, serviceWorkers: 'block' });
  await c.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.DASHBOARD_CONFIG={}' }));
  await c.addInitScript(d => { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x','1'); localStorage.clear(); localStorage.setItem('officeDailyDashboard.stable.v2', d); } }, data);
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/'); await p.waitForTimeout(400);
  const isOpen = id => p.evaluate(id => document.getElementById(id).open, id);
  const esc = async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(150); };
  const row = () => p.locator('.task-item').nth(1);
  // person picker, various focus spots
  for (const [what, act] of [
    ['typing box', async m => {}],
    ['after clicking empty space in the picker', async m => { const bb = await m.boundingBox(); await p.mouse.click(bb.x + bb.width - 12, bb.y + bb.height - 4); }],
    ['after Tab to Clear', async m => { await p.keyboard.press('Tab'); }],
    ['after Tab to Close', async m => { await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); }],
    ['after hovering a name', async m => { await m.locator('.person-option').nth(1).hover(); }],
  ]) {
    await row().hover(); await row().locator('.person-field').click(); await p.waitForTimeout(100);
    const m = row().locator('.person-menu'); await act(m); await esc();
    ok(!(await m.evaluate(e => e.classList.contains('open'))), 'name picker closes on Esc: ' + what);
    await p.evaluate(() => document.querySelectorAll('.person-menu.open').forEach(x => x.classList.remove('open')));
  }
  // time dialog
  await p.locator('#timePill').click(); await p.waitForTimeout(150); await p.locator('#leaveTime').click(); await esc();
  ok(!(await isOpen('timeDialog')), 'time pop-up closes on Esc after clicking the time box');
  await p.locator('#timePill').click(); await p.waitForTimeout(150); await esc();
  ok(!(await isOpen('timeDialog')), 'time pop-up closes on Esc');
  // add dialog
  await p.locator('#addBtn').click(); await p.waitForTimeout(150); await p.locator('#addProjects button').nth(1).click(); await esc();
  ok(!(await isOpen('addDialog')), 'quick add closes on Esc after choosing a project');
  await p.locator('#addBtn').click(); await p.waitForTimeout(150); await p.locator('#addPinWrap').click(); await esc();
  ok(!(await isOpen('addDialog')), 'quick add closes on Esc after ticking Pin');
  await p.locator('#addBtn').click(); await p.waitForTimeout(150); await p.locator('#addDialog .seg button').nth(1).click(); await esc();
  ok(!(await isOpen('addDialog')), 'quick add closes on Esc after switching to Project');
  // menu
  await p.locator('#menuBtn').click(); await p.waitForTimeout(150); await esc();
  ok(!(await isOpen('menuDialog')), 'main menu closes on Esc');
  // plan today
  if (await p.locator('#planTodayBtn').isVisible()) {
    await p.locator('#planTodayBtn').click(); await p.waitForTimeout(150);
    await p.locator('#planList input[type=checkbox]').first().click(); await esc();
    ok(!(await isOpen('planDialog')), 'Plan today closes on Esc after ticking one');
  }
  // ⋯ menu inside submenu
  await row().hover(); await row().locator('.task-more').click(); await p.locator('.action-menu-item.has-submenu').click(); await esc();
  ok(await p.evaluate(() => !document.querySelector('.action-menu')), '⋯ submenu closes on Esc');
  // ⋯ menu after clicking empty space inside it
  await row().hover(); await row().locator('.task-more').click(); const am = await p.locator('.action-menu').boundingBox(); await p.mouse.click(am.x + 3, am.y + 3); await esc();
  ok(await p.evaluate(() => !document.querySelector('.action-menu')), '⋯ menu closes on Esc after clicking its edge');
  // project menu
  const proj = p.locator('.project-card').first(); await proj.locator('.project-more').click(); await esc();
  ok(await p.evaluate(() => !document.querySelector('.action-menu')), 'project ⋯ menu closes on Esc');
  // new task form
  await proj.locator('.show-task-form').click(); await p.waitForTimeout(100); await esc();
  ok(!(await proj.locator('.task-form').evaluate(e => e.classList.contains('open'))), 'add-task box closes on Esc');
  // @ in new task box
  await proj.locator('.show-task-form').click(); await p.keyboard.type('x @'); await esc();
  ok(await proj.locator('.mention-box').isHidden(), '@ list closes on Esc (in a project)');
  await esc();
  ok(!(await proj.locator('.task-form').evaluate(e => e.classList.contains('open'))), '...and a second Esc closes the add-task box');
  // rename + task edit
  await proj.locator('.project-title').click(); await p.waitForTimeout(100); await esc();
  ok(await p.locator('.project-title-input').count() === 0, 'project rename cancels on Esc');
  await row().locator('.task-text').click(); await p.waitForTimeout(100); await esc();
  ok(await p.evaluate(() => !document.querySelector('textarea.task-text, .task-editor')), 'task edit cancels on Esc');
  // + next to Projects (laptop list)
  await p.locator('#railAddProject').click(); await p.waitForTimeout(150); await esc();
  ok(!(await isOpen('addDialog')), 'new project (+ in the list) closes on Esc');
  await p.locator('#railAddProject').click(); await p.waitForTimeout(150); await p.keyboard.type('Abc'); await esc();
  ok(!(await isOpen('addDialog')), 'new project closes on Esc after typing');
  // menu behind the initial, after clicking inside it
  await p.locator('#menuBtn').click(); await p.waitForTimeout(150);
  const md = await p.locator('#menuDialog').boundingBox(); await p.mouse.click(md.x + 10, md.y + 10); await esc();
  ok(!(await isOpen('menuDialog')), 'main menu closes on Esc after clicking inside it');
  await p.locator('#menuBtn').click(); await p.waitForTimeout(150); await esc();
  await p.locator('#menuBtn').click(); await p.waitForTimeout(150); await esc();
  ok(!(await isOpen('menuDialog')), 'main menu closes on Esc twice in a row');
  ok(await p.evaluate(() => document.activeElement.id) === 'menuBtn', 'focus goes back to the initial');
  // notes
  await p.locator('#dayNotes').click(); await esc();
  ok(await p.evaluate(() => document.activeElement.id !== 'dayNotes'), 'Esc leaves the notes box');
  // × colour
  await row().hover(); await row().locator('.person-field').click(); await p.keyboard.press('ArrowDown');
  const cols = await p.evaluate(() => [...document.querySelectorAll('.person-menu.open .person-remove')].map(b => getComputedStyle(b).color));
  ok(cols.includes('rgb(255, 255, 255)') && cols.includes('rgb(55, 65, 81)') && !cols.some(c => /220|185|239, 68/.test(c)), '× is dark, white on the highlighted row: ' + [...new Set(cols)].join(' / '));
  const pm = await row().locator('.person-menu').boundingBox();
  await p.screenshot({ path: S + '/esc-picker.png', clip: { x: pm.x - 8, y: pm.y - 8, width: pm.width + 16, height: pm.height + 16 } });
  await esc();
  ok(errs.length === 0, 'no errors ' + errs.join(';'));
  await b.close();
})();
