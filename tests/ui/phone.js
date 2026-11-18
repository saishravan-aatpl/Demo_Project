const { chromium, devices } = require('playwright');
const [backup, out] = process.argv.slice(2);
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch();
  for (const [name, dev] of [['iphone-se', devices['iPhone SE']], ['iphone14', devices['iPhone 14']], ['pixel', devices['Pixel 7']]]) {
    const ctx = await b.newContext({ ...dev, serviceWorkers: 'block' });
    await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.DASHBOARD_CONFIG={}' }));
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
    await p.goto('http://localhost:8123/');
    const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#settingsBtn').then(() => p.click('#importBtn'))]);
    await ch.setFiles(backup); await p.waitForTimeout(400);
    // a long task name to prove wrapping
    await p.locator('.project-card').first().locator('.show-task-form').click();
    await p.locator('.project-card').first().locator('.new-task').fill('Follow up with the vendor on revised quotation and delivery timelines for the next batch');
    await p.locator('.project-card').first().locator('.new-task').press('Enter');
    await p.locator('.project-card').first().locator('.cancel-task').click();
    await p.waitForTimeout(200);

    const r = await p.evaluate(() => {
      const fits = el => { const a = el.getBoundingClientRect(), c = el.parentElement.closest('section,article,.top-panel').getBoundingClientRect(); return a.left >= c.left - 0.5 && a.right <= c.right + 0.5; };
      const texts = [...document.querySelectorAll('.task-text')];
      return {
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        timeFits: fits(document.getElementById('leaveTime')),
        allTextVisible: texts.every(t => t.scrollHeight <= t.clientHeight + 1),
        longWraps: texts.find(t => t.value.startsWith('Follow up with the vendor')).clientHeight > 40,
        rowsInsideCards: [...document.querySelectorAll('.task-item')].every(fits),
        handlesVisible: getComputedStyle(document.querySelector('.task-handle')).display !== 'none',
      };
    });
    ok(!r.overflow, `${name}: nothing sticks out sideways`);
    ok(r.timeFits, `${name}: leaving-time box fits inside its panel`);
    ok(r.allTextVisible && r.longWraps, `${name}: every task name fully visible; long ones wrap`);
    ok(r.rowsInsideCards, `${name}: task rows stay inside their cards`);
    ok(r.handlesVisible, `${name}: drag handles shown`);

    if (name === 'iphone14') {
      await p.screenshot({ path: `${out}/phone-top.png` });
      await p.locator('.project-card').nth(1).scrollIntoViewIfNeeded();
      await p.evaluate(() => window.scrollBy(0, -120));
      await p.screenshot({ path: `${out}/phone-tasks.png` });

      // Touch reorder: drag the 1st task of project 2 below the 2nd
      const card = p.locator('.project-card').nth(1);
      const before = await card.locator('.task-text').evaluateAll(t => t.map(x => x.value));
      const h = await card.locator('.task-handle').first().boundingBox();
      const target = await card.locator('.task-item').nth(1).boundingBox();
      const cdp = await ctx.newCDPSession(p);
      const touch = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: h.x + h.width / 2, y }] });
      await touch('touchStart', h.y + h.height / 2);
      for (let y = h.y + h.height / 2; y <= target.y + target.height * 0.8; y += 8) await touch('touchMove', y);
      await touch('touchEnd');
      await p.waitForTimeout(300);
      const after = await p.locator('.project-card').nth(1).locator('.task-text').evaluateAll(t => t.map(x => x.value));
      ok(before.length === 2 && after[0] === before[1] && after[1] === before[0], 'iphone14: touch-drag a task reorders it');
      await p.reload(); await p.waitForTimeout(300);
      const persisted = await p.locator('.project-card').nth(1).locator('.task-text').evaluateAll(t => t.map(x => x.value));
      ok(persisted[0] === before[1], 'iphone14: new order is saved');

      // project reorder
      const names = () => p.locator('.project-title').evaluateAll(t => t.map(x => x.value));
      const pb = await names();
      await p.locator('.project-card').first().evaluate(el => el.scrollIntoView({ block: 'start' }));
      await p.waitForTimeout(100);
      const ph = await p.locator('.drag-handle').first().boundingBox();
      const pt = await p.locator('.project-card').nth(1).boundingBox();
      const touch2 = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: ph.x + ph.width / 2, y }] });
      await touch2('touchStart', ph.y + ph.height / 2);
      for (let y = ph.y + ph.height / 2; y <= pt.y + pt.height * 0.75; y += 10) await touch2('touchMove', y);
      await touch2('touchEnd'); await p.waitForTimeout(300);
      const pa = await names();
      ok(pa[0] === pb[1] && pa[1] === pb[0], 'iphone14: touch-drag a project reorders it');

      // Enter in task text doesn't add a new line; text edit saved
      const t = p.locator('.task-text').first();
      await t.click(); await t.evaluate(el => el.setSelectionRange(el.value.length, el.value.length)); await p.keyboard.type(' (edited)'); await p.keyboard.press('Enter');
      await p.waitForTimeout(200);
      const v = await p.locator('.task-text').first().inputValue();
      ok(v.endsWith('(edited)') && !v.includes('\n'), 'iphone14: editing a task works; Enter finishes instead of adding a line');

      // Person menu fits on screen
      await p.locator('.task-item .person-field').first().click();
      const menu = await p.locator('.person-menu.open').boundingBox();
      ok(menu && menu.x >= 0 && menu.x + menu.width <= 390, 'iphone14: assign-person menu fits on screen');
      await p.screenshot({ path: `${out}/phone-person-menu.png` });
      await p.keyboard.press('Escape');

      // people view wraps
      await p.click('#personSelectButton');
      await p.locator('.person-select-option', { hasText: 'Sam' }).click();
      await p.waitForTimeout(200);
      const pv = await p.evaluate(() => [...document.querySelectorAll('.people-task-text')].every(e => e.scrollWidth <= e.clientWidth + 1));
      ok(pv, 'iphone14: "View: Sam" list shows full task names');
    }
    ok(errors.length === 0, `${name}: no page errors ${errors.join(';')}`);
    await ctx.close();
  }
  // desktop sanity
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.DASHBOARD_CONFIG={}' }));
  const p = await ctx.newPage(); await p.goto('http://localhost:8123/');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#settingsBtn').then(() => p.click('#importBtn'))]);
  await ch.setFiles(backup); await p.waitForTimeout(300);
  const h = await p.locator('.task-item').first().boundingBox();
  ok(h.height < 50, `desktop: task rows still single-line height (${Math.round(h.height)}px)`);
  await p.screenshot({ path: `${out}/desktop-after.png` });
  await b.close();
})();
