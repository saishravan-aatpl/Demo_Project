const { chromium, devices } = require('playwright');
const backup = process.argv[2], out = process.argv[3];
const ok = (cond, msg) => console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(devices['iPhone 14']);
    await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.DASHBOARD_CONFIG={}' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  const locked = () => page.evaluate(() => document.documentElement.classList.contains('locked'));
  const appVisible = () => page.locator('.app').isVisible();

  await page.goto('http://localhost:8123/');
  ok(!(await locked()) && await appVisible(), 'No PIN set: app opens directly');
  await page.click('#menuBtn');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#settingsBtn').then(() => page.click('#importBtn'))]);
  await chooser.setFiles(backup);
  await page.waitForTimeout(300);

  await page.click('#menuBtn'); await page.click('#settingsBtn'); await page.click('#pinBtn');
  await page.fill('#pinNew', '12');
  await page.fill('#pinConfirm', '12');
  await page.click('#pinDialogForm button[type=submit]');
  ok((await page.textContent('#pinDialogError')).includes('4 to 6'), 'Rejects too-short PIN');
  await page.fill('#pinNew', '1234');
  await page.fill('#pinConfirm', '1235');
  await page.click('#pinDialogForm button[type=submit]');
  ok((await page.textContent('#pinDialogError')).includes("don't match"), 'Rejects mismatched PINs');
  await page.fill('#pinConfirm', '1234');
  await page.screenshot({ path: `${out}/pin-dialog.png` });
  await page.click('#pinDialogForm button[type=submit]');
  await page.waitForTimeout(400);
  ok(await page.textContent('#pinBtn') === 'Change PIN' && await page.evaluate(() => !document.getElementById('lockNowBtn').hidden), 'PIN saved; buttons switch to Change PIN / Lock now');
  const stored = await page.evaluate(() => localStorage.getItem('officeDailyDashboard.pin'));
  ok(!stored.includes('1234'), 'PIN itself is not stored, only a hash');

  await page.evaluate(() => localStorage.removeItem('officeDailyDashboard.unlock')); await page.reload();
  ok(await locked() && !(await appVisible()), 'After reload: locked, dashboard hidden');
  await page.screenshot({ path: `${out}/lock-screen.png` });
  await page.fill('#lockPin', '0000');
  await page.waitForTimeout(400);
  ok((await page.textContent('#lockError')).includes('4 tries left'), 'Wrong PIN shows tries left');
  await page.fill('#lockPin', '1234');
  await page.waitForTimeout(400);
  ok(!(await locked()) && await appVisible(), 'Correct PIN unlocks automatically');
  ok(await page.locator('.project-card').count() === 8, 'Data still there after unlock');

  await page.click('#menuBtn'); await page.click('#lockNowBtn');
  ok(await locked(), 'Lock now locks');
  for (let i = 0; i < 5; i++) { await page.fill('#lockPin', '9999'); await page.waitForTimeout(350); }
  ok((await page.textContent('#lockError')).includes('Too many attempts') && await page.isDisabled('#lockPin'), '5 wrong tries => 30s lockout');
  await page.evaluate(() => localStorage.removeItem('officeDailyDashboard.unlock')); await page.reload();
  ok(await page.isDisabled('#lockPin'), 'Lockout survives a reload');
  // skip the wait for the test
  await page.evaluate(() => localStorage.removeItem('officeDailyDashboard.pinAttempts'));
  await page.evaluate(() => localStorage.removeItem('officeDailyDashboard.unlock')); await page.reload();
  await page.fill('#lockPin', '1234');
  await page.waitForTimeout(400);
  ok(!(await locked()), 'Unlocks after lockout ends');

  await page.click('#menuBtn'); await page.click('#settingsBtn'); await page.click('#pinBtn');
  await page.fill('#pinCurrent', '1111');
  await page.click('#pinRemove');
  await page.waitForTimeout(500);
  ok((await page.textContent('#pinDialogError')).includes('current PIN'), 'Remove needs correct current PIN');
  await page.fill('#pinCurrent', '1234');
  await page.fill('#pinNew', '567890');
  await page.fill('#pinConfirm', '567890');
  await page.click('#pinDialogForm button[type=submit]');
  await page.waitForTimeout(400);
  await page.evaluate(() => localStorage.removeItem('officeDailyDashboard.unlock')); await page.reload();
  await page.fill('#lockPin', '567890');
  await page.waitForTimeout(400);
  ok(!(await locked()), 'Changed 6-digit PIN works');

  await page.click('#menuBtn'); await page.click('#settingsBtn'); await page.click('#pinBtn');
  await page.fill('#pinCurrent', '567890');
  await page.click('#pinRemove');
  await page.waitForTimeout(300);
  await page.evaluate(() => localStorage.removeItem('officeDailyDashboard.unlock')); await page.reload();
  ok(!(await locked()) && await page.textContent('#pinBtn') === 'Set PIN', 'Removed PIN: opens without lock');

  // Forgot PIN flow
  await page.click('#menuBtn'); await page.click('#settingsBtn'); await page.click('#pinBtn');
  await page.fill('#pinNew', '4321'); await page.fill('#pinConfirm', '4321');
  await page.click('#pinDialogForm button[type=submit]');
  await page.waitForTimeout(300);
  await page.evaluate(() => localStorage.removeItem('officeDailyDashboard.unlock')); await page.reload();
  await Promise.all([page.waitForNavigation(), page.click('#lockForgot')]);
  await page.waitForTimeout(600);
  ok(!(await locked()) && await page.locator('.project-card').count() === 0, 'Forgot PIN: lock removed and data erased');

  ok(errors.length === 0, `No page errors ${errors.join('; ')}`);
  await browser.close();
})();
