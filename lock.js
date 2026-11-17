// PIN lock
// ---------
// An optional privacy screen for this device. It stops someone who picks up your
// unlocked phone or laptop from seeing the dashboard.
//
// How it works:
// - The PIN is never stored. We store a "hash": a scrambled fingerprint of the PIN
//   (PBKDF2-SHA256 with a random salt). To check a PIN, we scramble what was typed
//   the same way and compare fingerprints.
// - How long it stays unlocked depends on the time of day:
//     * Unlocked during work hours (before your "Leaving for the day" time):
//       stays unlocked until that time, even if you close and reopen the app.
//     * Unlocked after work hours: locks after AFTER_HOURS_IDLE_MS without use.
//     * "Lock now" locks immediately; a new day always needs the PIN again.
// - "Forgot PIN" erases this device's dashboard data, otherwise the lock would be
//   pointless. Data can be restored with Import Backup.

(() => {
  const PIN_KEY = 'officeDailyDashboard.pin';
  const ATTEMPTS_KEY = 'officeDailyDashboard.pinAttempts';
  // All of this app's saved data uses these prefixes (see app.js).
  // 'sb-' is the cloud sign-in, so "Forgot PIN" also signs this device out of sync.
  const DATA_KEY_PREFIXES = ['officeDailyDashboard.', 'officeProjectDashboard.', 'sb-'];
  const SESSION_KEY = 'officeDailyDashboard.unlock';     // when the current unlock expires
  const STATE_KEY = 'officeDailyDashboard.stable.v2';     // app data (to read the leaving time early)
  const AFTER_HOURS_IDLE_MS = 10 * 60 * 1000;
  const CHECK_EVERY_MS = 20 * 1000;
  const MAX_ATTEMPTS = 5;
  const LOCKOUT_MS = 30 * 1000;
  const ITERATIONS = 150000;

  const root = document.documentElement;
  const $ = id => document.getElementById(id);

  // Shared with app.js so it can stop autosaving while data is being erased.
  const api = { wiping: false, lock: () => lock() };
  window.dashboardLock = api;

  // ---------- storage helpers ----------
  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }

  function removeKey(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }

  const getPinRecord = () => readJson(PIN_KEY);
  const hasPin = () => Boolean(getPinRecord()?.hash);
  const isValidPin = pin => /^\d{4,6}$/.test(pin);
  const cryptoAvailable = () => Boolean(window.crypto?.subtle);

  // ---------- hashing ----------
  const toB64 = buffer => btoa(String.fromCharCode(...new Uint8Array(buffer)));
  const fromB64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

  async function hashPin(pin, salt, iterations) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
    return toB64(bits);
  }

  async function savePin(pin) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await hashPin(pin, salt, ITERATIONS);
    return writeJson(PIN_KEY, { v: 1, salt: toB64(salt), hash, iterations: ITERATIONS, length: pin.length });
  }

  async function checkPin(pin) {
    const record = getPinRecord();
    if (!record) return true;
    if (!pin) return false;
    const hash = await hashPin(pin, fromB64(record.salt), record.iterations);
    return hash === record.hash;
  }

  // ---------- wrong-attempt limit ----------
  function lockoutRemaining() {
    const attempts = readJson(ATTEMPTS_KEY);
    return attempts?.until ? Math.max(0, attempts.until - Date.now()) : 0;
  }

  function recordFailure() {
    const attempts = readJson(ATTEMPTS_KEY) || { count: 0 };
    attempts.count = (attempts.count || 0) + 1;
    if (attempts.count >= MAX_ATTEMPTS) {
      attempts.count = 0;
      attempts.until = Date.now() + LOCKOUT_MS;
    }
    writeJson(ATTEMPTS_KEY, attempts);
    return attempts;
  }

  // ---------- lock screen ----------
  function setError(id, message) {
    $(id).textContent = message;
  }

  let lockoutTimer = null;
  function updateLockout() {
    clearTimeout(lockoutTimer);
    const ms = lockoutRemaining();
    const input = $('lockPin');
    const button = $('lockSubmit');
    if (ms > 0) {
      input.disabled = true;
      button.disabled = true;
      setError('lockError', `Too many attempts. Try again in ${Math.ceil(ms / 1000)}s.`);
      lockoutTimer = setTimeout(updateLockout, 1000);
    } else if (input.disabled) {
      input.disabled = false;
      button.disabled = false;
      setError('lockError', '');
      input.focus();
    }
  }

  // ---------- how long an unlock lasts ----------
  const todayKey = () => new Date().toLocaleDateString('en-CA');   // e.g. 2026-11-17

  function leaveTimeToday() {
    let value = window.dashboardApp?.getData().leaveTime;
    if (!value) value = readJson(STATE_KEY)?.leaveTime;
    const [hours, minutes] = String(value || '17:00').split(':').map(Number);
    const leave = new Date();
    leave.setHours(Number.isFinite(hours) ? hours : 17, Number.isFinite(minutes) ? minutes : 0, 0, 0);
    return leave.getTime();
  }

  function startSession() {
    const now = Date.now();
    const leave = leaveTimeToday();
    const session = now < leave
      ? { mode: 'work', day: todayKey(), until: leave }
      : { mode: 'after', until: now + AFTER_HOURS_IDLE_MS };
    writeJson(SESSION_KEY, session);
    return session;
  }

  // The current unlock, or null if it has expired.
  function currentSession() {
    const session = readJson(SESSION_KEY);
    if (!session) return null;
    if (session.mode === 'work') {
      if (session.day !== todayKey()) return null;          // a new day
      const leave = leaveTimeToday();                       // follow changes to the leaving time
      if (leave !== session.until) {
        session.until = leave;
        writeJson(SESSION_KEY, session);
      }
    }
    return session.until > Date.now() ? session : null;
  }

  function checkSession() {
    if (!hasPin() || root.classList.contains('locked')) return;
    if (!currentSession()) lock();
  }

  // After hours, any tap, key or scroll restarts the idle timer (at most every 15s).
  let lastActivity = 0;
  function noteActivity() {
    if (root.classList.contains('locked')) return;
    const now = Date.now();
    if (now - lastActivity < 15000) return;
    lastActivity = now;
    const session = currentSession();
    if (!session) { if (hasPin()) lock(); return; }
    if (session.mode === 'after') {
      session.until = now + AFTER_HOURS_IDLE_MS;
      writeJson(SESSION_KEY, session);
    }
  }

  function unlockMessage(session) {
    if (session.mode === 'work') {
      const time = new Date(session.until).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
      return `Unlocked until ${time}`;
    }
    return 'Unlocked. After work hours it locks after 10 min without use.';
  }

  function lock() {
    if (!hasPin()) return;
    removeKey(SESSION_KEY);
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    root.classList.add('locked');
    $('lockPin').value = '';
    setError('lockError', '');
    updateLockout();
    setTimeout(() => { if (!$('lockPin').disabled) $('lockPin').focus(); }, 50);
  }

  function unlock() {
    removeKey(ATTEMPTS_KEY);
    const session = startSession();
    root.classList.remove('locked');
    $('lockPin').blur();
    if (typeof window.showToast === 'function') window.showToast(unlockMessage(session));
  }

  let checking = false;
  async function tryUnlock() {
    const input = $('lockPin');
    const pin = input.value.trim();
    if (checking || !pin || lockoutRemaining() > 0) return;
    checking = true;
    try {
      if (await checkPin(pin)) {
        unlock();
        return;
      }
      const attempts = recordFailure();
      input.value = '';
      const card = $('lockForm');
      card.classList.remove('shake');
      void card.offsetWidth; // restart the shake animation
      card.classList.add('shake');
      if (lockoutRemaining() > 0) {
        updateLockout();
      } else {
        const left = MAX_ATTEMPTS - attempts.count;
        setError('lockError', `Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left.`);
      }
    } finally {
      checking = false;
    }
  }

  $('lockForm').addEventListener('submit', event => {
    event.preventDefault();
    tryUnlock();
  });

  // Unlock automatically once the full PIN has been typed.
  $('lockPin').addEventListener('input', event => {
    event.target.value = event.target.value.replace(/\D/g, '');
    const length = getPinRecord()?.length;
    if (length && event.target.value.length === length) tryUnlock();
  });

  $('lockForgot').addEventListener('click', () => {
    const confirmed = confirm(
      'Forgot your PIN?\n\n' +
      'This removes the PIN, erases all dashboard data on this device and signs it out of sync. ' +
      'You can restore it afterwards with Import Backup.\n\nErase and continue?'
    );
    if (!confirmed) return;
    api.wiping = true;
    try {
      Object.keys(localStorage)
        .filter(key => DATA_KEY_PREFIXES.some(prefix => key.startsWith(prefix)))
        .forEach(removeKey);
    } catch { /* ignore */ }
    location.reload();
  });

  // ---------- auto-lock ----------
  setInterval(checkSession, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkSession();
  });
  // iPhone/Safari can restore a page from memory without reloading it.
  window.addEventListener('pageshow', () => checkSession());
  ['pointerdown', 'keydown', 'scroll'].forEach(type => {
    window.addEventListener(type, noteActivity, { capture: true, passive: true });
  });

  // ---------- Set / change / remove PIN ----------
  function updatePinButtons() {
    const on = hasPin();
    $('pinBtn').textContent = on ? 'Change PIN' : 'Set PIN';
    $('lockNowBtn').hidden = !on;
  }

  function openPinDialog() {
    if (!cryptoAvailable()) {
      alert('The PIN lock only works when the app is opened from its web address (https://...).');
      return;
    }
    const on = hasPin();
    $('pinDialogTitle').textContent = on ? 'Change or remove PIN' : 'Set a PIN';
    $('pinDialogText').textContent = on
      ? 'Enter your current PIN, then either choose a new one or remove the PIN.'
      : 'Choose a 4–6 digit PIN. Once unlocked, the app stays open until your leaving time; after work hours it locks after 10 minutes without use. If you forget the PIN, the data on this device has to be erased, so keep a backup.';
    $('pinCurrentWrap').hidden = !on;
    $('pinRemove').hidden = !on;
    ['pinCurrent', 'pinNew', 'pinConfirm'].forEach(id => { $(id).value = ''; });
    setError('pinDialogError', '');
    $('pinDialog').showModal();
    (on ? $('pinCurrent') : $('pinNew')).focus();
  }

  function closePinDialog(message) {
    $('pinDialog').close();
    updatePinButtons();
    if (message && typeof window.showToast === 'function') window.showToast(message);
  }

  $('pinBtn').addEventListener('click', openPinDialog);
  $('lockNowBtn').addEventListener('click', () => lock());
  $('pinCancel').addEventListener('click', () => $('pinDialog').close());

  ['pinCurrent', 'pinNew', 'pinConfirm'].forEach(id => {
    $(id).addEventListener('input', event => {
      event.target.value = event.target.value.replace(/\D/g, '');
    });
  });

  $('pinDialogForm').addEventListener('submit', async event => {
    event.preventDefault();
    const on = hasPin();
    const current = $('pinCurrent').value.trim();
    const next = $('pinNew').value.trim();
    const confirmNext = $('pinConfirm').value.trim();

    if (on && !(await checkPin(current))) return setError('pinDialogError', 'Current PIN is wrong.');
    if (!isValidPin(next)) return setError('pinDialogError', 'New PIN must be 4 to 6 digits.');
    if (next !== confirmNext) return setError('pinDialogError', "The two new PINs don't match.");
    if (!(await savePin(next))) return setError('pinDialogError', 'Could not save the PIN on this device.');
    const session = startSession();   // you're already in, so count this as unlocking
    closePinDialog(on ? 'PIN changed' : `PIN set. ${unlockMessage(session)}`);
  });

  $('pinRemove').addEventListener('click', async () => {
    if (!(await checkPin($('pinCurrent').value.trim()))) {
      return setError('pinDialogError', 'Enter your current PIN to remove it.');
    }
    removeKey(PIN_KEY);
    removeKey(ATTEMPTS_KEY);
    removeKey(SESSION_KEY);
    closePinDialog('PIN removed');
  });

  // ---------- start ----------
  updatePinButtons();
  if (hasPin() && !currentSession()) {
    lock();
  } else {
    root.classList.remove('locked');
  }
})();
