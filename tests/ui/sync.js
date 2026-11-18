const { chromium, devices } = require('playwright');
const fs = require('fs');
const [backup, out, mock] = process.argv.slice(2);
const mockJs = fs.readFileSync(mock, 'utf8');
const configJs = `window.DASHBOARD_CONFIG = { supabaseUrl: 'https://mock.supabase.co', supabaseKey: 'sb_publishable_test' };`;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
const cloud = () => fetch('http://localhost:8124/dump', { method: 'POST' }).then(r => r.json());
const wait = ms => new Promise(r => setTimeout(r, ms));

async function device(browser, opts, name) {
  const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' });
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: configJs }));
  await ctx.route('**/vendor/supabase-js-*.js', r => r.fulfill({ contentType: 'application/javascript', body: mockJs }));
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(`${name}: ${e.message}`));
  page.on('dialog', d => d.accept());
  await page.goto('http://localhost:8123/');
  return { ctx, page };
}

async function signIn(page, password = 'Secret123!', email = 'me@example.com') {
  const gate = await page.evaluate(() => document.documentElement.classList.contains('needs-auth'));
  if (!gate) { await page.click('#menuBtn'); await page.click('#syncSignInBtn'); }
  await page.fill('#authEmail', email);
  await page.fill('#authPassword', password);
  await page.click('#authSubmit');
  await page.waitForTimeout(1500);
}

const gateShown = page => page.evaluate(() => document.documentElement.classList.contains('needs-auth') && getComputedStyle(document.querySelector('.app')).display === 'none');
const notes = page => page.inputValue('#dayNotes');
const projects = page => page.locator('.project-card').count();

(async () => {
  const browser = await chromium.launch();
  const laptop = await device(browser, { viewport: { width: 1280, height: 900 } }, 'laptop');
  const phone = await device(browser, devices['iPhone 14'], 'phone');
  const L = laptop.page, P = phone.page;

  ok(await gateShown(L) && await L.isVisible('#authGate #authForm'), 'Not signed in: the sign-in screen shows first; dashboard hidden');
  ok(!(await L.isVisible('#authCancel')), 'Sign-in screen has no Cancel (signing in is required)');

  // Wrong password
  await L.fill('#authEmail', 'me@example.com');
  await L.fill('#authPassword', 'nope');
  await L.click('#authSubmit');
  await L.waitForTimeout(300);
  ok(await L.textContent('#authError') === 'Wrong email or password.', 'Wrong password shows a clear error');
  // Forgot password
  await L.click('#authToForgot');
  ok(!(await L.isVisible('#authPassword')), 'Forgot password mode hides the password box');
  await L.click('#authSubmit');
  await L.waitForTimeout(300);
  ok((await L.textContent('#authMessage')).includes('reset link is on its way'), 'Forgot password confirms the email is on its way');
  // Sign-up that needs email confirmation
  await L.click('#authToSignin');
  await L.click('#authToSignup');
  await L.fill('#authEmail', 'confirm@example.com');
  await L.fill('#authPassword', 'short');
  await L.click('#authSubmit');
  ok(await L.textContent('#authError') === 'Use at least 8 characters.', 'Sign-up rejects passwords under 8 characters');
  await L.fill('#authPassword', 'Secret123!');
  await L.click('#authSubmit');
  await L.waitForTimeout(300);
  ok((await L.textContent('#authMessage')).includes('confirmation link') && await L.textContent('#authSubmit') === 'Sign in', 'Sign-up needing confirmation explains next step and switches to Sign in');
  // Use without an account: warnings first
  await L.click('#useOfflineBtn');
  ok(await L.isVisible('#offlineDialog') && (await L.textContent('#offlineDialog')).includes('No backup'), '"Use without an account" shows the warnings first');
  await L.click('#offlineBack');
  ok(await gateShown(L), '"Back to sign in" keeps you on the sign-in screen');
  await L.click('#useOfflineBtn'); await L.click('#offlineConfirm'); await L.waitForTimeout(300);
  ok(!(await gateShown(L)) && await L.isVisible('#offlineStrip'), 'Offline mode: dashboard opens with an "only on this device" warning');
  await L.reload(); await L.waitForTimeout(800);
  ok(!(await gateShown(L)), 'Offline mode is remembered on this device');

  // Laptop has data (offline), then signs up -> becomes the cloud copy
  await L.click('#menuBtn');
  const [chooser] = await Promise.all([L.waitForEvent('filechooser'), L.click('#settingsBtn').then(() => L.click('#importBtn'))]);
  await chooser.setFiles(backup);
  await L.waitForTimeout(300);
  await L.click('#menuBtn'); await L.click('#syncSignInBtn');
  ok(await L.isVisible('#signInDialog #authForm') && await L.isVisible('#authCancel'), 'From offline mode, Sign in opens as a pop-up');
  await L.click('#authToSignup');
  await L.fill('#authEmail', 'me@example.com');
  await L.fill('#authPassword', 'Secret123!');
  await L.click('#authSubmit');
  await L.waitForTimeout(1500);
  ok(await L.textContent('#syncEmail') === 'me@example.com', 'Laptop signed in, email shown');
  let c = await cloud();
  let row = c['user-me@example.com'];
  ok(row && row.version === 1 && row.data.projects.length === 8, 'Offline data is added to the new account (8 projects, version 1)');
  ok(!(await L.isVisible('#offlineStrip')), 'Offline warning gone once signed in');
  ok((await L.textContent('#syncStatus')).startsWith('Synced at'), 'Laptop status says Synced');
  await L.screenshot({ path: `${out}/sync-laptop.png` });

  // Phone: sign-in screen, then gets everything
  ok(await gateShown(P), 'Phone shows the sign-in screen first');
  await signIn(P);
  ok(!(await gateShown(P)), 'Phone: sign-in screen goes away after signing in');
  ok(await projects(P) === 8, 'Phone signs in and receives all 8 projects');

  // Phone ticks a task -> cloud -> laptop
  const firstCheck = P.locator('.task-check').first();
  await firstCheck.check();
  await P.waitForTimeout(2000);
  c = await cloud(); row = c['user-me@example.com'];
  ok(row.version === 2, 'Phone change saved to cloud (version 2)');
  await L.evaluate(() => window.dashboardSync.syncNow());
  await L.waitForTimeout(800);
  ok(await L.evaluate(() => window.dashboardApp.getData().projects[0].tasks.some(t => t.done)), 'Laptop receives the ticked task');

  // Conflict: phone offline adds a task, laptop edits notes meanwhile
  await phone.ctx.setOffline(true);
  await P.locator('.project-card').nth(1).locator('.show-task-form').click();
  await P.locator('.project-card').nth(1).locator('.new-task').fill('Added on phone while offline');
  await P.locator('.project-card').nth(1).locator('.new-task').press('Enter');
  await P.locator('.project-card').nth(1).locator('.cancel-task').click();
  await P.waitForTimeout(1600);
  ok((await P.textContent('#syncStatus')).startsWith('Offline'), 'Phone shows Offline status');

  await L.fill('#dayNotes', 'Written on laptop');
  await L.locator('#listTitle').click();
  await L.waitForTimeout(1800);
  c = await cloud(); row = c['user-me@example.com'];
  ok(row.version === 3 && row.data.dayNotes === 'Written on laptop', 'Laptop notes saved (version 3)');

  await phone.ctx.setOffline(false);
  await P.evaluate(() => window.dispatchEvent(new Event('online')));
  await P.waitForTimeout(2000);
  c = await cloud(); row = c['user-me@example.com'];
  const hasPhoneTask = d => d.projects.some(p => p.tasks.some(t => t.text === 'Added on phone while offline'));
  ok(row.version === 4 && hasPhoneTask(row.data) && row.data.dayNotes === 'Written on laptop', 'Back online: phone merged both changes and saved (version 4)');
  ok(await notes(P) === 'Written on laptop', 'Phone now shows laptop notes');

  await L.evaluate(() => window.dashboardSync.syncNow());
  await L.waitForTimeout(800);
  ok(hasPhoneTask(await L.evaluate(() => window.dashboardApp.getData())), 'Laptop now shows the offline phone task');

  // Typing protection: laptop is typing when a remote change arrives
  await L.locator('#dayNotes').focus();
  await L.keyboard.type(' + more');
  const doneBefore = await P.evaluate(() => window.dashboardApp.getData().projects.flatMap(p => p.tasks).filter(t => t.done).length);
  await P.locator('.task-item', { has: P.locator('.task-text:text-is("Get layout details from Robin")') }).locator('.task-check').click();
  await P.waitForTimeout(1800);
  await L.evaluate(() => window.dashboardSync.syncNow());
  await L.waitForTimeout(500);
  ok(await L.evaluate(() => document.activeElement.id) === 'dayNotes', 'Remote change waits while you are typing (focus not lost)');
  await L.locator('#listTitle').click();
  await L.waitForTimeout(4000);
  c = await cloud(); row = c['user-me@example.com'];
  ok(row.data.dayNotes === 'Written on laptop + more' && row.data.projects.flatMap(p => p.tasks).find(t => t.text === 'Get layout details from Robin').done && row.data.projects.flatMap(p => p.tasks).filter(t => t.done).length === doneBefore + 1, 'After typing: both the typed notes and phone tick are in the cloud');

  // Reload keeps you signed in
  await P.reload(); await P.waitForTimeout(1200);
  ok(await P.textContent('#syncEmail') === 'me@example.com', 'Phone stays signed in after reopening');

  // Sign out clears the device
  await P.click('#menuBtn');
  await Promise.all([P.waitForNavigation(), P.click('#syncSignOut')]); await P.waitForTimeout(800);
  ok(await gateShown(P), 'Sign out: back to the sign-in screen');
  ok(await P.evaluate(() => {
    const stored = ['officeDailyDashboard.stable.v2', 'officeProjectDashboard.v2'].map(k => JSON.parse(localStorage.getItem(k) || '{"projects":[],"people":[]}'));
    const noSignIn = !Object.keys(localStorage).some(k => k.startsWith('sb-'));
    return noSignIn && !localStorage.getItem('officeDailyDashboard.sync') && stored.every(d => d.projects.length === 0 && d.people.length === 0);
  }), 'Sign out: no tasks, people or sign-in left on the device');

  // A colleague signs in on the same phone: sees only their own (empty) dashboard
  await signIn(P, 'Secret123!', 'colleague@example.com');
  ok(await projects(P) === 0, "Colleague on the same device doesn't see the previous person's tasks");
  c = await cloud();
  ok(c['user-colleague@example.com'].data.projects.length === 0 && c['user-me@example.com'].data.projects.length === 8, 'Each person has their own row in the cloud');
  await P.click('#menuBtn');
  await Promise.all([P.waitForNavigation(), P.click('#syncSignOut')]); await P.waitForTimeout(800);
  await signIn(P);
  ok(await projects(P) === 8, 'Signing back in as yourself brings your dashboard back');

  // Change password
  await P.click('#menuBtn'); await P.click('#settingsBtn'); await P.click('#syncChangePassword');
  ok(await P.isVisible('#signInDialog') && (await P.textContent('#authTitle')) === 'Choose a new password', 'Change password opens');
  await P.fill('#authPassword', 'NewSecret456!'); await P.click('#authSubmit'); await P.waitForTimeout(300);
  ok(!(await P.isVisible('#signInDialog')), 'Change password saves');

  // Forgot PIN also signs out
  await L.click('#menuBtn'); await L.click('#settingsBtn'); await L.click('#pinBtn'); await L.fill('#pinNew', '1234'); await L.fill('#pinConfirm', '1234');
  await L.click('#pinDialogForm button[type=submit]'); await L.waitForTimeout(400);
  await L.evaluate(() => localStorage.removeItem('officeDailyDashboard.unlock'));
  await L.reload();
  await Promise.all([L.waitForNavigation(), L.click('#lockForgot')]);
  await L.waitForTimeout(1200);
  ok(await gateShown(L), 'Forgot PIN: data erased, signed out, back to sign-in');
  await signIn(L);
  ok(await projects(L) === 8, '...and signing back in restores everything from the cloud');
  await P.screenshot({ path: `${out}/sync-phone.png`, fullPage: false });

  const errors = [...L.errors, ...P.errors];
  ok(errors.length === 0, `No page errors ${errors.join(' | ')}`);
  await browser.close();
})();
