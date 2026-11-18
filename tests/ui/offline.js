const { chromium } = require('playwright');
const VERSION = require('fs').readFileSync(__dirname + '/../../sw.js', 'utf8').match(/CACHE_VERSION = '([^']+)'/)[1];
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await chromium.launch(); const c = await b.newContext({ viewport: { width: 1300, height: 800 } });
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/');
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload(); await p.waitForTimeout(500);
  ok(await p.evaluate(() => !!navigator.serviceWorker.controller), 'offline helper is running');
  ok(await p.evaluate(async v => (await caches.keys()).includes(v), VERSION), 'saved copy ' + VERSION + ' created');
  await c.setOffline(true);
  await p.reload(); await p.waitForTimeout(800);
  ok(await p.title() === 'Workstack' && (await p.locator('#appbar').isVisible() || await p.locator('#authGate').isVisible()), 'app still opens with no internet (' + await p.evaluate(() => document.documentElement.className) + ')');
  await c.setOffline(false);
  ok(errs.length === 0, 'no errors ' + errs.join(';'));
  await b.close();
})();
