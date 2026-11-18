const { chromium, devices } = require('playwright');
const [backup] = process.argv.slice(2);
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) process.exitCode = 1; };
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 14'], serviceWorkers: 'block' });
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.DASHBOARD_CONFIG={}' }));
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('http://localhost:8123/');
  await p.click('#menuBtn');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#settingsBtn').then(() => p.click('#importBtn'))]);
  await ch.setFiles(backup); await wait(400);
  const data = () => p.evaluate(() => JSON.stringify(window.dashboardApp.getData()));
  const names = async () => JSON.parse(await data()).projects.map(x => x.name);
  const card = name => p.locator('.project-card', { has: p.locator(`.project-title:text-is("${name}")`) });
  const undoShown = () => p.evaluate(() => document.getElementById('undoToast').classList.contains('show'));

  ok(await undoShown() && (await p.textContent('#undoMessage')) === 'Backup imported', 'Import offers Undo');
  await p.click('#undoBtn'); await wait(200);
  ok(JSON.parse(await data()).projects.length === 0, 'Undo import -> back to the empty dashboard');
  await p.click('#menuBtn');
  const [ch2] = await Promise.all([p.waitForEvent('filechooser'), p.click('#settingsBtn').then(() => p.click('#importBtn'))]);
  await ch2.setFiles(backup); await wait(300);
  const original = await data();

  // delete task
  await card('Mobile App').locator('.task-more').first().tap();
  await p.locator('.action-menu-item', { hasText: 'Delete task' }).tap(); await wait(200);
  ok(await undoShown() && (await p.textContent('#undoMessage')) === 'Task deleted', 'Delete task shows "Task deleted · Undo"');
  await p.locator('#undoBtn').tap(); await wait(200);
  ok(await data() === original, 'Undo brings the task back exactly where it was');
  ok(!(await undoShown()), 'Undo bar goes away after undoing');

  // delete project (no confirm popup any more)
  let dialogs = 0; p.on('dialog', () => dialogs++);
  await card('Data Hub').locator('.project-more').tap();
  await p.locator('.action-menu-item', { hasText: 'Delete project' }).tap(); await wait(200);
  ok(!(await names()).includes('Data Hub') && dialogs === 0, 'Delete project: no "are you sure" popup');
  ok((await p.textContent('#undoMessage')) === 'Deleted "Data Hub"', 'Shows "Deleted "Data Hub" · Undo"');
  await p.locator('#undoBtn').tap(); await wait(200);
  ok(await data() === original, 'Undo restores the project with all its tasks');

  // move via menu
  await card('Mobile App').locator('.task-more').first().tap();
  await p.locator('.action-menu-item', { hasText: 'Move to project' }).tap();
  await p.locator('.action-menu-item', { hasText: 'Others' }).tap(); await wait(200);
  ok((await p.textContent('#undoMessage')) === 'Moved to Others', 'Move shows "Moved to Others · Undo"');
  await p.locator('#undoBtn').tap(); await wait(200);
  ok(await data() === original, 'Undo puts the task back');

  // empty the text of a task = delete, undo restores original text
  const row = card('Client Demo').locator('.task-item').first();
  await row.locator('.task-text').tap();
  await p.locator('textarea.task-text.editing').fill(''); await p.keyboard.press('Enter'); await wait(200);
  ok((await p.textContent('#undoMessage')) === 'Task deleted', 'Clearing a task name deletes it, with Undo');
  await p.locator('#undoBtn').tap(); await wait(200);
  ok(await data() === original, 'Undo restores it with its original name');

  // several steps
  for (const n of ['Others', 'Miscellaneous']) {
    await card(n).locator('.project-more').tap();
    await p.locator('.action-menu-item', { hasText: 'Delete project' }).tap(); await wait(150);
  }
  await p.evaluate(() => undo()); await wait(100); await p.evaluate(() => undo()); await wait(150);
  ok(await data() === original, 'Multiple undos step back one change at a time');

  // bar hides by itself
  await card('Others').locator('.project-more').tap();
  await p.locator('.action-menu-item', { hasText: 'Delete project' }).tap(); await wait(6500);
  ok(!(await undoShown()), 'Undo bar disappears after ~6 seconds');
  await p.evaluate(() => undo()); await wait(150);
  ok(await data() === original, '...but undo still works afterwards (and with Ctrl+Z on a laptop)');

  // a change from another device clears the undo history
  await card('Others').locator('.project-more').tap();
  await p.locator('.action-menu-item', { hasText: 'Delete project' }).tap(); await wait(150);
  await p.evaluate(() => window.dashboardApp.applyData(window.dashboardApp.getData())); await wait(100);
  await p.evaluate(() => undo()); await wait(100);
  ok(!(await names()).includes('Others'), 'After a sync update, old undo steps are cleared (no overwriting other device)');
  ok(errors.length === 0, `No page errors ${errors.join(';')}`);
  await ctx.close();

  // laptop Ctrl+Z
  const c2 = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await c2.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.DASHBOARD_CONFIG={}' }));
  const q = await c2.newPage();
  await q.goto('http://localhost:8123/');
  await q.click('#menuBtn');
  const [ch3] = await Promise.all([q.waitForEvent('filechooser'), q.click('#settingsBtn').then(() => q.click('#importBtn'))]);
  await ch3.setFiles(backup); await wait(300);
  const before = await q.evaluate(() => JSON.stringify(window.dashboardApp.getData()));
  await q.locator('.task-more').first().click();
  await q.locator('.action-menu-item', { hasText: 'Delete task' }).click(); await wait(150);
  await q.keyboard.press('Control+z'); await wait(150);
  ok(await q.evaluate(() => JSON.stringify(window.dashboardApp.getData())) === before, 'Laptop: Ctrl+Z undoes');
  await q.locator('#dayNotes').fill('abc');
  await q.locator('#dayNotes').press('Control+z'); await wait(100);
  ok(await q.evaluate(() => window.dashboardApp.getData().projects.length) === 8, 'Laptop: Ctrl+Z inside a text box is left to the text box');
  await b.close();
})();
