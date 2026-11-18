const { chromium, devices } = require('playwright');
const [backup] = process.argv.slice(2);
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) process.exitCode = 1; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

(async () => {
  const b = await chromium.launch();
  for (const [name, opts] of [['phone', devices['iPhone 14']], ['laptop', { viewport: { width: 1280, height: 800 } }]]) {
    const ctx = await b.newContext({ ...opts, serviceWorkers: 'block' });
    await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.DASHBOARD_CONFIG={}' }));
    const p = await ctx.newPage(); const errors = [];
    p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
    await p.goto('http://localhost:8123/');
    const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('#settingsBtn').then(() => p.click('#importBtn'))]);
    await ch.setFiles(backup); await wait(400);
    const st = () => p.evaluate(() => {
      const r = el => el.getBoundingClientRect();
      const bar = document.getElementById('slimbar'), header = document.getElementById('pageHeader');
      const parts = ['sbClock', 'sbDate', 'sbLeft', 'sbViewLabel'].map(id => document.getElementById(id)).filter(e => e.offsetParent).concat([document.querySelector('.sb-chevron')]).map(r);
      const overlap = parts.some((a, i) => parts.some((c, j) => i < j && a.right > c.left + 0.5 && c.right > a.left + 0.5 && a.bottom > c.top && c.bottom > a.top));
      return {
        barShown: bar.classList.contains('shown') && !bar.classList.contains('covered'), barTop: r(bar).top, barBottom: r(bar).bottom,
        floating: header.classList.contains('floating'), dropped: header.classList.contains('dropped'), headerTop: r(header).top,
        backdrop: document.getElementById('slimbarBackdrop').classList.contains('show'),
        placeholder: document.getElementById('headerPlaceholder').offsetHeight, scrollY: window.scrollY,
        firstCard: r(document.querySelector('.project-card')).top, overlap,
        clock: document.getElementById('sbClock').textContent, bigClock: document.getElementById('currentTime').textContent,
        left: document.getElementById('sbLeft').textContent, leftState: document.getElementById('sbLeft').dataset.state,
        view: document.getElementById('sbViewLabel').textContent, svgArrow: !!document.querySelector('.sb-chevron svg'),
        overflow: document.documentElement.scrollWidth > window.innerWidth
      };
    });
    const scrollTo = async y => { await p.evaluate(y => window.scrollTo(0, y), y); await wait(450); };

    await scrollTo(0);
    let s = await st();
    ok(!s.barShown && !s.floating && s.barBottom <= 0, `${name}: at the top, full header only (no slim bar)`);
    await scrollTo(900); s = await st();
    ok(s.barShown && s.barTop === 0 && !s.floating, `${name}: scrolled down, slim bar slides in`);
    ok(s.clock === s.bigClock && /^(\d+h )?\d+m left$/.test(s.left) && s.view === 'View: All', `${name}: bar shows time "${s.clock}", "${s.left}", "${s.view}"`);
    ok(!s.overlap && s.svgArrow, `${name}: nothing in the bar overlaps; arrow is drawn, not a "v"`);
    ok(!s.overflow, `${name}: nothing sticks out sideways`);

    // steadiness: the bar is either fully in or fully out, never half-way, at every scroll position
    let steady = true;
    for (let y = 0; y <= 1400; y += 70) { await p.evaluate(y => window.scrollTo(0, y), y); await wait(320); const t = (await st()).barTop; if (!(t === 0 || (await st()).barBottom <= 0)) steady = false; }
    ok(steady, `${name}: bar never sits half-way (no bouncing)`);

    // drop the real header down
    await scrollTo(900); const before = await st();
    await p.click('#slimbarToggle'); await wait(450); s = await st();
    ok(s.floating && s.dropped && s.headerTop === 0 && s.backdrop, `${name}: tapping the bar slides the real header down from the top`);
    ok(!s.barShown, `${name}: the slim bar tucks away while the header is down (nothing shown twice)`);
    ok(s.scrollY === before.scrollY && Math.abs(s.firstCard - before.firstCard) < 1, `${name}: page underneath doesn't jump`);
    await p.fill('#projectName', 'From dropped header'); await p.press('#projectName', 'Enter'); await wait(250);
    ok(await p.evaluate(() => window.dashboardApp.getData().projects.some(x => x.name === 'From dropped header')), `${name}: can add a project from it`);
    s = await st(); ok(s.floating && s.dropped, `${name}: stays down while you're using it`);
    await p.evaluate(() => document.activeElement.blur());

    const y0 = (await st()).scrollY;
    await scrollTo(y0 + 120); s = await st();
    ok(!s.floating && s.barShown && s.placeholder === 0, `${name}: scrolling slides it back up; slim bar returns`);
    await p.click('#slimbarToggle'); await wait(450);
    await p.click('#headerCollapse'); await wait(450); s = await st();
    ok(!s.floating && s.barShown, `${name}: the ⌃ button puts it away`);
    await p.click('#slimbarToggle'); await wait(450);
    const vh = await p.evaluate(() => innerHeight);
    await p.mouse.click(20, vh - 20); await wait(450); s = await st();
    ok(!s.floating && s.barShown, `${name}: tapping outside puts it away`);
    await p.click('#slimbarToggle'); await wait(450);
    await p.keyboard.press('Escape'); await wait(450); s = await st();
    ok(!s.floating, `${name}: Escape puts it away`);

    // pick a person from the dropped header -> their list is shown
    await p.click('#slimbarToggle'); await wait(450);
    await p.click('#personSelectButton');
    await p.locator('.person-select-option', { hasText: 'Sage' }).click(); await wait(1200);
    const rs = await p.evaluate(() => { const r = document.getElementById('peopleResults').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, open: document.getElementById('peopleResults').classList.contains('open') }; });
    s = await st();
    ok(!s.floating && rs.open && rs.top >= 0 && rs.top < (await p.evaluate(() => innerHeight)), `${name}: choosing "Sage" closes the header and scrolls to Sage's tasks`);
    await scrollTo(1200); s = await st();
    ok(s.view === 'View: Sage', `${name}: bar shows "View: Sage"`);

    // time-left colours
    await scrollTo(0);
    await p.fill('#leaveTime', hhmm(new Date(Date.now() + 30 * 60000))); await p.locator('#leaveTime').dispatchEvent('change'); await wait(200);
    s = await st(); ok(s.leftState === 'soon' && s.left.endsWith('left'), `${name}: last hour → amber "left"`);
    await p.fill('#leaveTime', hhmm(new Date(Date.now() - 30 * 60000))); await p.locator('#leaveTime').dispatchEvent('change'); await wait(200);
    s = await st(); ok(s.leftState === 'over' && s.left.endsWith('over'), `${name}: past leaving time → red "over"`);
    ok(errors.length === 0, `${name}: no page errors ${errors.join(';')}`);
    await ctx.close();
  }
  await b.close();
})();
