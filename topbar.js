// Shrinking header
// ----------------
// The header is full size at the top of the page. As you scroll down, its content
// moves up with your finger; the clock and "time left" ride up with their cards,
// shrinking as they go, until they dock into a slim bar at the top, which then stays.
// Tap the slim bar to open the full header again; scrolling a little closes it.
//
// How: the header is fixed to the top of the screen, and a "spacer" of the same full
// height sits in the page under it. One number, --p (0 = full, 1 = slim), drives
// every size, fade and movement in styles.css. Scrolling sets --p; tapping animates it.

(() => {
  const $ = id => document.getElementById(id);
  const header = $('topbar');
  if (!header) return;

  const root = document.documentElement;
  const inner = $('topbarInner');
  const full = $('topbarFull');
  const compact = $('topbarCompact');
  const spacer = $('topbarSpacer');
  const backdrop = $('topbarBackdrop');

  // Pairs that glide between a big position (in the full header) and a small one (in the slim bar).
  const morphs = [
    { el: $('morphClock'), from: $('currentTime'), to: $('tbClockSlot') },
    { el: $('morphLeft'), from: $('remainingTime'), to: $('tbLeftSlot') }
  ];

  const CLOSE_AFTER_SCROLL = 30;   // px of scrolling that closes a header you opened by tapping
  let fullHeight = 0;
  let compactHeight = 56;
  let range = 1;
  let dockSpeed = 1;               // how much faster than --p the clock reaches the bar
  let current = 0;
  let opened = false;              // opened by tapping while scrolled down
  let openedAt = 0;
  let ticking = false;
  let animTimer = null;

  // ---------- applying a position between full (0) and slim (1) ----------
  function setProgress(p) {
    current = p;
    header.style.setProperty('--p', p.toFixed(4));
    header.classList.toggle('is-collapsing', p > 0.001);
    header.classList.toggle('is-compact', p * dockSpeed > 0.5);
    root.style.setProperty('--topbar-h', `${Math.round(fullHeight - (fullHeight - compactHeight) * p)}px`);
    if (p > 0.001 && typeof closePersonFilterDropdown === 'function') closePersonFilterDropdown();
  }

  function animateTo(p) {
    header.classList.add('animating');
    setProgress(p);
    clearTimeout(animTimer);
    animTimer = setTimeout(() => header.classList.remove('animating'), 280);
  }

  const scrollProgress = () => Math.min(1, Math.max(0, window.scrollY) / range);

  // ---------- measuring (on load, resize, and when content changes) ----------
  function relativeRect(el) {
    const r = el.getBoundingClientRect();
    const base = inner.getBoundingClientRect();
    return { left: r.left - base.left, top: r.top - base.top };
  }

  function measure() {
    header.classList.remove('animating');                 // no half-finished animation while measuring
    header.style.setProperty('--p', '0');                 // measure in the full layout

    fullHeight = Math.ceil(full.offsetTop + full.offsetHeight);
    compactHeight = Math.ceil(compact.offsetTop + compact.offsetHeight);
    range = Math.max(1, fullHeight - compactHeight);

    morphs.forEach(({ el, from, to }, index) => {
      const a = relativeRect(from);
      const b = relativeRect(to);
      // It travels up with the page until it reaches the bar: that takes (a.top - b.top) px
      // of the total `range` px of scrolling, so it moves `k` times faster than --p.
      const k = range / Math.max(1, a.top - b.top);
      el.style.setProperty('--k', k.toFixed(4));
      if (index === 0) {
        dockSpeed = k;
        header.style.setProperty('--k', k.toFixed(4));
      }
      const bigSize = parseFloat(getComputedStyle(from).fontSize);
      const smallSize = parseFloat(getComputedStyle(to).fontSize);
      el.style.fontSize = `${bigSize}px`;
      el.style.setProperty('--x', `${a.left}px`);
      el.style.setProperty('--y', `${a.top}px`);
      el.style.setProperty('--dx', `${b.left - a.left}px`);
      el.style.setProperty('--dy', `${b.top - a.top}px`);
      el.style.setProperty('--s', (smallSize / bigSize).toFixed(4));
    });

    header.style.setProperty('--hf', `${fullHeight}px`);
    header.style.setProperty('--hc', `${compactHeight}px`);
    root.style.setProperty('--topbar-compact', `${compactHeight}px`);
    spacer.style.height = `${fullHeight}px`;
    setProgress(opened ? 0 : scrollProgress());
  }

  let measureQueued = false;
  function scheduleMeasure() {
    if (measureQueued) return;
    measureQueued = true;
    requestAnimationFrame(() => { measureQueued = false; measure(); });
  }

  // ---------- copy the clock, time left and View into the slim bar ----------
  function minutesFrom(text) {
    const match = /(\d+)h\s*(\d+)m/.exec(text);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }

  function syncTexts() {
    const clock = $('currentTime').textContent;
    const left = $('remainingTime').textContent;
    const over = left.startsWith('+');
    const minutes = minutesFrom(left);
    const state = minutes === null ? 'none' : over ? 'over' : minutes <= 60 ? 'soon' : 'ok';

    $('morphClock').textContent = clock;
    $('tbClockSlot').textContent = clock;
    $('morphLeft').textContent = left;
    $('tbLeftSlot').textContent = left;
    $('tbLeftWord').textContent = over ? 'over' : 'left';
    $('tbLeft').dataset.state = state;
    $('morphLeft').dataset.state = state;
    $('tbDate').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
    $('tbView').textContent = $('personSelectLabel').textContent || 'View: All';
    scheduleMeasure();
  }

  const watch = new MutationObserver(syncTexts);
  ['currentTime', 'remainingTime', 'personSelectLabel'].forEach(id => {
    watch.observe($(id), { childList: true, characterData: true, subtree: true });
  });

  // ---------- open / close by tapping ----------
  function open() {
    if (current < 0.01) return;
    opened = true;
    openedAt = window.scrollY;
    header.classList.add('is-open');
    backdrop.classList.add('show');
    animateTo(0);
  }

  function close() {
    if (!opened) return;
    opened = false;
    header.classList.remove('is-open');
    backdrop.classList.remove('show');
    animateTo(scrollProgress());
  }

  compact.addEventListener('click', open);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });

  // ---------- scrolling ----------
  function onFrame() {
    ticking = false;
    if (opened) {
      // Keep it open while you're typing in it (the phone keyboard can scroll the page).
      if (Math.abs(window.scrollY - openedAt) > CLOSE_AFTER_SCROLL && !header.contains(document.activeElement)) close();
      return;
    }
    if (header.contains(document.activeElement) && current < 0.01) return;
    setProgress(scrollProgress());
  }

  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(onFrame); }
  }, { passive: true });
  window.addEventListener('resize', scheduleMeasure);
  new ResizeObserver(scheduleMeasure).observe(full);
  document.fonts?.ready.then(scheduleMeasure);

  syncTexts();
  measure();
  window.dashboardTopbar = { open, close, measure, progress: () => current };
})();
