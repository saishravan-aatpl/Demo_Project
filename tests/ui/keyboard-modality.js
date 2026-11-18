const { chromium, devices } = require('playwright');
const fs = require('fs');
const data = fs.readFileSync(process.argv[2], 'utf8');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
async function page(b, opts) {
  const c = await b.newContext({ ...opts, serviceWorkers: 'block' });
  await c.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.DASHBOARD_CONFIG={}' }));
  await c.addInitScript(d => { localStorage.setItem('officeDailyDashboard.stable.v2', d); }, data);
  const p = await c.newPage(); await p.goto('http://localhost:8123/'); await p.waitForTimeout(400); return p;
}
const outlineOf = (p, id) => p.evaluate(id => { const e = document.getElementById(id); const cs = getComputedStyle(e); const box = cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px'; const dark = cs.backgroundColor === 'rgb(17, 24, 39)'; return box ? 'outline' : dark ? 'dark' : 'none'; }, id);
(async () => {
  const b = await chromium.launch();
  // Phone: tap menu, even if the first row somehow gets focus (as on a real iPhone)
  let p = await page(b, devices['iPhone 13']);
  await p.locator('#menuBtn').tap(); await p.waitForTimeout(300);
  await p.evaluate(() => document.getElementById('usualLeaveBtn').focus());
  ok(await outlineOf(p, 'usualLeaveBtn') === 'none', 'phone: no box around Usual leaving time even when it has focus');
  await p.context().close();
  // Laptop: mouse open, arrows show the box, click hides it again
  p = await page(b, { viewport: { width: 1300, height: 800 } });
  await p.locator('#menuBtn').click(); await p.waitForTimeout(200);
  ok(await outlineOf(p, 'usualLeaveBtn') === 'none', 'laptop: no box after opening with the mouse');
  await p.keyboard.press('ArrowDown'); await p.waitForTimeout(300);
  ok(await outlineOf(p, 'usualLeaveBtn') !== 'none', 'laptop: ↓ shows the box on the selected row');
  { const bb = await p.locator('#menuDialog').boundingBox(); await p.mouse.click(bb.x + 4, bb.y + 4); } await p.waitForTimeout(100);
  ok(await p.evaluate(() => !document.documentElement.classList.contains('using-keys')), 'laptop: clicking hides keyboard highlights again');
  await b.close();
})();
