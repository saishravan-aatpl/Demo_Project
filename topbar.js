// Header and slim bar
// -------------------
// - The full header is ordinary page content: it scrolls away with the page.
// - Once its time cards have scrolled out of view, a slim bar slides down from the
//   top (time, time left, current View, and an arrow). It slides away again when
//   you scroll back up to the header. Nothing is ever shown twice.
// - Tapping the slim bar slides the REAL header down from the top, over the page.
//   Scrolling, tapping outside, Escape or its ▴ button slide it back up.
//
// Smoothness: the browser tells us when the time cards enter or leave the screen
// (IntersectionObserver), and the sliding itself is a CSS transition, so nothing is
// recalculated on every scroll step. That's what keeps it steady on iPhone.

(() => {
  const $ = id => document.getElementById(id);
  const header = $('pageHeader');
  const bar = $('slimbar');
  if (!header || !bar) return;

  const root = document.documentElement;
  const placeholder = $('headerPlaceholder');
  const backdrop = $('slimbarBackdrop');
  const toggle = $('slimbarToggle');
  const CLOSE_AFTER_SCROLL = 40;
  const SLIDE_MS = 280;

  let barShown = false;
  let popped = false;          // the full header is pulled down over the page
  let poppedAt = 0;
  let closeTimer = null;

  // ---------- slim bar: show when the time cards are hidden ----------
  function setBar(show) {
    if (show === barShown) return;
    barShown = show;
    bar.classList.toggle('shown', show);
    bar.setAttribute('aria-hidden', show ? 'false' : 'true');
    toggle.tabIndex = show ? 0 : -1;
    root.style.setProperty('--topbar-h', show ? `${bar.offsetHeight}px` : '0px');
    if (!show && popped) close(true);
  }

  const barHeight = () => bar.querySelector('.slimbar-surface').offsetHeight || 56;
  let observer = null;
  function observe() {
    observer?.disconnect();
    observer = new IntersectionObserver(([entry]) => {
      if (popped) return;
      // Hidden above the bar = scrolled past; below the screen = not relevant.
      setBar(!entry.isIntersecting && entry.boundingClientRect.top < barHeight());
    }, { rootMargin: `-${barHeight()}px 0px 0px 0px`, threshold: 0 });
    observer.observe(header.querySelector('.time-cards'));
  }

  // ---------- copy the clock, time left and View into the bar ----------
  function minutesFrom(text) {
    const match = /(\d+)h\s*(\d+)m/.exec(text);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }

  function syncTexts() {
    const left = $('remainingTime').textContent;
    const over = left.startsWith('+');
    const minutes = minutesFrom(left);
    const leftEl = $('sbLeft');
    $('sbClock').textContent = $('currentTime').textContent;
    $('sbDate').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
    leftEl.textContent = minutes === null ? '' : `${left.replace('+', '')} ${over ? 'over' : 'left'}`;
    leftEl.hidden = minutes === null;
    leftEl.dataset.state = over ? 'over' : minutes <= 60 ? 'soon' : 'ok';
    $('sbViewLabel').textContent = $('personSelectLabel').textContent || 'View: All';
  }

  const watch = new MutationObserver(syncTexts);
  ['currentTime', 'remainingTime', 'personSelectLabel'].forEach(id => {
    watch.observe($(id), { childList: true, characterData: true, subtree: true });
  });

  // Picking a person from the popped-down header: show their list (it sits just
  // under the header near the top of the page).
  let lastView = $('personSelectLabel').textContent;
  new MutationObserver(() => {
    const view = $('personSelectLabel').textContent;
    if (view === lastView) return;          // redrawn with the same text: nothing was picked
    lastView = view;
    if (!popped) return;
    const results = $('peopleResults');
    close();
    if (results.classList.contains('open')) {
      setTimeout(() => results.scrollIntoView({ behavior: 'smooth', block: 'start' }), SLIDE_MS);
    }
  }).observe($('personSelectLabel'), { childList: true, characterData: true, subtree: true });

  // ---------- pop the real header down / back up ----------
  function open() {
    if (popped || !barShown) return;
    popped = true;
    poppedAt = window.scrollY;
    clearTimeout(closeTimer);
    placeholder.style.height = `${header.offsetHeight}px`;   // keeps the page from jumping
    header.classList.add('floating');
    void header.offsetHeight;                               // start from "above the screen"
    header.classList.add('dropped');
    bar.classList.add('covered');
    backdrop.classList.add('show');
  }

  function close(instant = false) {
    if (!popped) return;
    popped = false;
    if (header.contains(document.activeElement)) document.activeElement.blur();
    header.classList.remove('dropped');
    bar.classList.remove('covered');
    backdrop.classList.remove('show');
    const finish = () => {
      header.classList.remove('floating');
      placeholder.style.height = '0px';
    };
    clearTimeout(closeTimer);
    if (instant) finish();
    else closeTimer = setTimeout(finish, SLIDE_MS);
  }

  toggle.addEventListener('click', open);
  $('headerCollapse').addEventListener('click', () => close());
  backdrop.addEventListener('click', () => close());
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });

  window.addEventListener('scroll', () => {
    if (!popped) return;
    // Keep it down while you're typing in it (the phone keyboard can scroll the page).
    if (header.contains(document.activeElement)) { poppedAt = window.scrollY; return; }
    if (Math.abs(window.scrollY - poppedAt) > CLOSE_AFTER_SCROLL) close();
  }, { passive: true });

  window.addEventListener('resize', () => { if (!popped) observe(); });

  syncTexts();
  observe();
  window.dashboardTopbar = { open, close, isBarShown: () => barShown, isOpen: () => popped };
})();
