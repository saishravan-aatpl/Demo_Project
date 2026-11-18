const { chromium, devices } = require('playwright');
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) process.exitCode = 1; };
const at = t => new Date(`2026-11-17T${t}:00Z`);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 14'], timezoneId: 'UTC', serviceWorkers: 'block' });
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.DASHBOARD_CONFIG={}' }));
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
  await p.clock.install({ time: at('09:00') });
  await p.goto('http://localhost:8123/');
  const locked = () => p.evaluate(() => document.documentElement.classList.contains('locked'));
  const unlockWith = async pin => { await p.fill('#lockPin', pin); await p.waitForTimeout(600); };
  const toastText = () => p.textContent('#toast');

  // 9:00 - set a PIN (leaving time defaults to 5:00 PM)
  await p.click('#menuBtn'); await p.click('#settingsBtn'); await p.click('#pinBtn'); await p.fill('#pinNew', '2468'); await p.fill('#pinConfirm', '2468');
  await p.click('#pinDialogForm button[type=submit]'); await p.waitForTimeout(600);
  ok(!(await locked()) && (await toastText()).includes('until 5:00 PM'), '9:00 set PIN -> stays open, "Unlocked until 5:00 PM"');

  await p.clock.setSystemTime(at('13:00')); await p.reload();
  ok(!(await locked()), '1:00 PM reopen app -> no PIN needed');

  await p.clock.setSystemTime(at('16:58')); await p.reload();
  ok(!(await locked()), '4:58 PM still open');
  await p.clock.runFor(3 * 60 * 1000);
  ok(await locked(), '5:01 PM -> locks by itself at leaving time');

  // After hours
  await unlockWith('2468');
  ok(!(await locked()) && (await toastText()).includes('10 min'), '5:01 PM unlock -> after-hours mode (10 min idle)');
  await p.clock.runFor(8 * 60 * 1000);
  ok(!(await locked()), '8 min without use -> still open');
  await p.mouse.wheel(0, 200); await p.mouse.click(200, 420);
  await p.clock.runFor(8 * 60 * 1000);
  ok(!(await locked()), 'tapping restarts the 10 min -> still open 8 min later');
  await p.clock.runFor(3 * 60 * 1000);
  ok(await locked(), '11 min without use -> locks');

  // Next morning
  await unlockWith('2468');
  await p.clock.setSystemTime(new Date('2026-11-18T08:30:00Z')); await p.reload();
  ok(await locked(), 'Next morning -> PIN needed again');
  await unlockWith('2468');
  ok((await toastText()).includes('until 5:00 PM'), 'Morning unlock -> open until 5:00 PM');

  // Changing leaving time extends the unlock
  await p.click('#timePill'); await p.fill('#leaveTime', '19:00'); await p.locator('#leaveTime').dispatchEvent('change');
  await p.clock.setSystemTime(new Date('2026-11-18T18:00:00Z')); await p.reload();
  ok(!(await locked()), 'Leaving time moved to 7 PM -> still open at 6 PM');

  // Lock now
  await p.click('#menuBtn'); await p.click('#lockNowBtn');
  await p.reload();
  ok(await locked(), 'Lock now -> stays locked after reopening');

  // Remove PIN -> never locks
  await unlockWith('2468');
  await p.click('#menuBtn'); await p.click('#settingsBtn'); await p.click('#pinBtn'); await p.fill('#pinCurrent', '2468'); await p.click('#pinRemove'); await p.waitForTimeout(600);
  await p.clock.setSystemTime(new Date('2026-11-19T22:00:00Z')); await p.reload();
  ok(!(await locked()), 'PIN removed -> opens without PIN any time');

  ok(errors.length === 0, `No page errors ${errors.join(';')}`);
  await b.close();
})();
