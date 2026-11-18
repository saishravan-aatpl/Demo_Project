const { chromium, devices } = require('playwright');
const fs = require('fs');
const backup = fs.readFileSync(process.argv[2], 'utf8');
const out = process.argv[3];
(async () => {
  const browser = await chromium.launch();
  for (const [name, opts] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['iphone', devices['iPhone 14']]]) {
    const ctx = await browser.newContext(opts);
    await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.DASHBOARD_CONFIG={}' }));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => m.type() === 'error' && errors.push(m.text()));
    await page.goto('http://localhost:8123/');
    // Import backup through the real Import button
    await page.click('#menuBtn');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#settingsBtn').then(() => page.click('#importBtn'))]);
    await chooser.setFiles(process.argv[2]);
    await page.waitForTimeout(500);
    const projects = await page.locator('.project-card').count();
    // Add a task via the UI
    await page.locator('.project-card').first().locator('.show-task-form').click();
    await page.locator('.project-card').first().locator('.new-task').fill('Test task from ' + name);
    await page.locator('.project-card').first().locator('.new-task').press('Enter');
    await page.reload();
    const persisted = await page.locator('.task-text').evaluateAll(els => els.some(e => e.textContent.startsWith('Test task')));
    const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: name === 'iphone' ? false : true });
    const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${name}: ${m}`); if (!c) process.exitCode = 1; };
    ok(projects === JSON.parse(backup).projects.length, `import backup shows all ${projects} projects`);
    ok(persisted, 'a new task is still there after reload');
    ok(sw, 'offline helper (service worker) is active');
    ok(!overflow, 'no sideways scrolling');
    ok(errors.length === 0, 'no errors ' + errors.join('; '));
    await ctx.close();
  }
  await browser.close();
})();
