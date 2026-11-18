// Cloud sync (Supabase)
// --------------------
// Keeps the dashboard the same on every device you sign in on.
//
// - Sign in with email + password. (Email links/codes were avoided: on iPhone a
//   link opens Safari instead of the home-screen app, and Supabase's free email
//   service doesn't allow adding a code to its emails.)
// - Every change is saved to the cloud about a second after you make it.
// - Other open devices are told instantly ("realtime") and pull the change.
// - Works offline: changes are kept on the device and sent when back online.
// - If two devices changed things at the same time, both sets of changes are
//   combined (see merge.js) instead of one overwriting the other.
//
// The cloud keeps one row per user with a "version" number. A save only
// succeeds if the version hasn't moved since this device last synced; if it
// has, another device saved first, so we fetch, merge, and try again.

(() => {
  const config = window.DASHBOARD_CONFIG || {};
  const app = window.dashboardApp;
  const TABLE = 'dashboards';
  const META_KEY = 'officeDailyDashboard.sync';
  const PUSH_DELAY_MS = 1200;
  const POLL_MS = 60 * 1000;
  const RETRY_MS = 15 * 1000;

  const $ = id => document.getElementById(id);
  const noop = { onLocalSave() {}, isSignedIn: () => false };

  const configured = Boolean(config.supabaseUrl && config.supabaseKey && window.supabase?.createClient && app && window.DashboardMerge);
  if (!configured) {
    $('syncPanel').hidden = true;
    document.documentElement.classList.remove('needs-auth');
    window.dashboardSync = noop;
    return;
  }

  // "local" = this device was chosen to be used without an account.
  const MODE_KEY = 'officeDailyDashboard.mode';
  // What to clear when someone signs out: the dashboard and sync info, not the device's PIN.
  const KEEP_ON_SIGN_OUT = ['officeDailyDashboard.pin', 'officeDailyDashboard.pinAttempts', 'officeDailyDashboard.unlock'];
  const isOfflineMode = () => { try { return localStorage.getItem(MODE_KEY) === 'local'; } catch { return false; } };

  const { merge } = window.DashboardMerge;
  const sb = window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
    // detectSessionInUrl picks up email-confirmation and password-reset links.
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  let user = null;
  let meta = readMeta();      // { userId, version, base } - what this device last agreed with the cloud
  let busy = false;
  let again = false;
  let pushTimer = null;
  let retryTimer = null;
  let channel = null;

  // ---------- helpers ----------
  function readMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch { return {}; }
  }

  function writeMeta() {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* ignore */ }
  }

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const localData = () => JSON.parse(JSON.stringify(app.getData()));
  const isEmpty = data => !data.projects.length && !String(data.dayNotes || '').trim();
  const hasLocalChanges = () => !meta.version || !same(localData(), meta.base);
  const isNetworkError = error => !navigator.onLine || /fetch|network|load failed/i.test(String(error?.message || error));

  function toast(message) {
    if (typeof window.showToast === 'function') window.showToast(message);
  }

  function formatTime(date) {
    return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
  }

  // ---------- status display ----------
  function setStatus(kind, detail = '') {
    const messages = {
      syncing: 'Syncing…',
      ok: `Synced at ${formatTime(new Date())}`,
      offline: 'Offline. Changes will sync when you are back online.',
      error: `Sync problem: ${detail || 'unknown error'}. Retrying…`
    };
    const el = $('syncStatus');
    el.textContent = messages[kind] || detail;
    el.dataset.state = kind;
    $('avatarDot').dataset.state = kind;      // the small dot on your initial in the top bar
  }

  function renderPanel() {
    $('syncSignedOut').hidden = Boolean(user);
    $('syncSignedIn').hidden = !user;
    // Name on one line, domain underneath, so a long address never breaks mid-word.
    const [name, domain] = user ? [user.email.split('@')[0], user.email.slice(user.email.indexOf('@'))] : ['', ''];
    $('syncEmail').innerHTML = user ? `<span class="em-name"></span><span class="em-domain"></span>` : '';
    if (user) {
      $('syncEmail').querySelector('.em-name').textContent = name;
      $('syncEmail').querySelector('.em-domain').textContent = domain;
      $('syncEmail').title = user.email;
    }
    document.querySelectorAll('[data-when="signed-in"]').forEach(el => { el.hidden = !user; });
    const initial = user ? user.email.trim()[0].toUpperCase() : '';
    $('avatarInitial').textContent = initial;
    $('menuInitial').textContent = initial;
    $('menuBtn').classList.toggle('offline', !user);
    $('menuBtn').setAttribute('aria-label', user ? `Menu (${user.email})` : 'Menu (offline mode)');
    if (!user) $('avatarDot').dataset.state = 'none';
    $('offlineStrip').hidden = Boolean(user);
  }

  // ---------- talking to the cloud ----------
  async function fetchRemote() {
    const { data, error } = await sb.from(TABLE).select('data, version').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function tryUpdate(local) {
    const next = meta.version + 1;
    const { data, error } = await sb.from(TABLE)
      .update({ data: local, version: next, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('version', meta.version)
      .select('version');
    if (error) throw error;
    if (!data || !data.length) return false;          // another device saved first
    meta = { userId: user.id, version: next, base: local };
    writeMeta();
    return true;
  }

  async function tryInsert(local) {
    const { error } = await sb.from(TABLE).insert({ user_id: user.id, data: local, version: 1 });
    if (error) {
      if (error.code === '23505') return false;       // row was just created by another device
      throw error;
    }
    meta = { userId: user.id, version: 1, base: local };
    writeMeta();
    return true;
  }

  // One full sync: send our changes, or fetch and merge theirs.
  async function syncOnce() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const local = localData();
      const dirty = hasLocalChanges();

      if (meta.version && dirty && await tryUpdate(local)) return 'saved';

      const remote = await fetchRemote();
      if (!remote) {
        if (await tryInsert(local)) return 'saved';
        continue;
      }

      if (remote.version === meta.version) {
        if (!dirty) return 'up-to-date';
        continue;
      }

      // The cloud has changes this device hasn't seen yet.
      if (app.isEditing()) return 'deferred';         // don't redraw the screen while you're typing

      const firstSync = !meta.version;
      const takeRemote = (!dirty) || (firstSync && isEmpty(local));
      const next = takeRemote ? remote.data : merge(firstSync ? null : meta.base, local, remote.data);

      app.applyData(next);
      meta = { userId: user.id, version: remote.version, base: takeRemote ? localData() : remote.data };
      writeMeta();
      if (takeRemote) return 'pulled';
      // Merged: loop round and save the combined result.
    }
    throw new Error('the cloud kept changing, will try again');
  }

  async function sync() {
    if (!user) return;
    if (busy) { again = true; return; }
    clearTimeout(pushTimer);
    clearTimeout(retryTimer);
    if (!navigator.onLine) { setStatus('offline'); return; }

    busy = true;
    setStatus('syncing');
    try {
      const result = await syncOnce();
      if (result === 'deferred') {
        retryTimer = setTimeout(sync, 2000);
      }
      setStatus('ok');
    } catch (error) {
      console.warn('Sync failed', error);
      setStatus(isNetworkError(error) ? 'offline' : 'error', error?.message);
      retryTimer = setTimeout(sync, RETRY_MS);
    } finally {
      busy = false;
      if (again) {
        again = false;
        schedulePush(300);
      }
    }
  }

  function schedulePush(delay = PUSH_DELAY_MS) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(sync, delay);
  }

  // ---------- live updates from other devices ----------
  function subscribe() {
    unsubscribe();
    channel = sb.channel(`dashboard-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: `user_id=eq.${user.id}` }, payload => {
        const version = payload.new?.version;
        if (version && version !== meta.version) sync();
      })
      .subscribe();
  }

  function unsubscribe() {
    if (channel) sb.removeChannel(channel);
    channel = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync();
  });
  window.addEventListener('online', () => sync());
  window.addEventListener('offline', () => { if (user) setStatus('offline'); });
  setInterval(() => { if (document.visibilityState === 'visible') sync(); }, POLL_MS);

  // ---------- sign in / out ----------
  const appUrl = location.origin + location.pathname;

  function showGate(show) {
    document.documentElement.classList.toggle('needs-auth', show);
    if (show) openAuth('signin', true);
  }

  let sessionChecked = false;
  function handleSession(session) {
    const nextUser = session?.user || null;
    const firstCheck = !sessionChecked;
    sessionChecked = true;
    if (!firstCheck && (nextUser?.id || null) === (user?.id || null)) return;   // e.g. a routine token refresh
    user = nextUser;
    if (user) {
      try { localStorage.removeItem(MODE_KEY); } catch { /* ignore */ }
      if (meta.userId && meta.userId !== user.id) {
        // Someone else used this device before: start from this person's own data only.
        app.applyData(window.DashboardMerge.emptyData());
        meta = { userId: user.id };
        writeMeta();
      } else if (meta.userId !== user.id) {
        // First sign-in here (e.g. after offline use): what's on the device is added to the account.
        meta = { userId: user.id };
        writeMeta();
      }
      showGate(false);
      if ($('signInDialog').open) $('signInDialog').close();
    } else {
      showGate(!isOfflineMode());
    }
    renderPanel();
    if (user) {
      subscribe();
      sync();
    } else {
      unsubscribe();
    }
  }

  // Remove sign-in details from the address bar after an email link was opened.
  function cleanUrl() {
    if (/access_token|refresh_token|error_description|type=/.test(location.hash)) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  // An email link that failed (e.g. expired) arrives as an error in the address.
  const urlError = new URLSearchParams(location.hash.slice(1)).get('error_description');

  // Supabase recommends not calling it again from inside this callback, hence setTimeout.
  sb.auth.onAuthStateChange((event, session) => setTimeout(() => {
    handleSession(session);
    if (event === 'PASSWORD_RECOVERY') openAuth('newpassword');
    if (event === 'SIGNED_IN' && /type=signup/.test(location.hash)) toast('Email confirmed. Signed in.');
    cleanUrl();
  }, 0));

  if (urlError) {
    setTimeout(() => alert(`That email link didn't work: ${urlError.replace(/\+/g, ' ')}.\n\nIf it expired, ask for a new one.`), 300);
    cleanUrl();
  }

  // The sign-in box has four modes.
  const MODES = {
    signin: {
      title: 'Sign in to sync',
      text: 'Use the same email and password on every device.',
      submit: 'Sign in', email: true, password: 'current-password',
      links: ['authToSignup', 'authToForgot']
    },
    signup: {
      title: 'Create your account',
      text: 'Do this once, on your first device. Then sign in with the same details everywhere else. Use at least 8 characters.',
      submit: 'Create account', email: true, password: 'new-password',
      links: ['authToSignin']
    },
    forgot: {
      title: 'Reset your password',
      text: "We'll email you a link. Open it, choose a new password, then sign in here with it.",
      submit: 'Send reset link', email: true, password: null,
      links: ['authToSignin']
    },
    newpassword: {
      title: 'Choose a new password',
      text: 'At least 8 characters. You will use it to sign in on all your devices.',
      submit: 'Save password', email: false, password: 'new-password',
      links: []
    }
  };

  let mode = 'signin';

  function openAuth(nextMode, inGate = document.documentElement.classList.contains('needs-auth')) {
    mode = nextMode;
    const form = $('authForm');
    if (inGate) {
      if ($('signInDialog').open) $('signInDialog').close();
      $('authGateSlot').appendChild(form);
    } else {
      $('signInDialog').appendChild(form);
    }
    $('authCancel').hidden = inGate;
    const m = MODES[mode];
    $('authTitle').textContent = m.title;
    $('authText').textContent = m.text;
    $('authSubmit').textContent = m.submit;
    $('authEmailWrap').hidden = !m.email;
    $('authPasswordWrap').hidden = !m.password;
    $('authPassword').autocomplete = m.password || 'off';
    $('authPassword').value = '';
    $('authError').textContent = '';
    $('authMessage').textContent = '';
    ['authToSignup', 'authToForgot', 'authToSignin'].forEach(id => { $(id).hidden = !m.links.includes(id); });
    if (!inGate && !$('signInDialog').open) $('signInDialog').showModal();
    (m.email && !$('authEmail').value ? $('authEmail') : (m.password ? $('authPassword') : $('authEmail'))).focus();
  }

  function friendlyError(error) {
    const text = String(error?.message || error || '');
    if (/invalid login credentials/i.test(text)) return 'Wrong email or password.';
    if (/email not confirmed/i.test(text)) return 'Please click the confirmation link we emailed you first, then sign in.';
    if (/signups? not allowed|signup is disabled/i.test(text)) return 'New accounts are turned off for this app. Ask the person who runs it.';
    if (/database error saving new user|limited to company/i.test(text)) return 'Accounts are only for company email addresses. Use your work email.';
    if (/not authorized|email address .* invalid/i.test(text)) return "We couldn't send an email to that address. Ask the person who runs the app to turn off email confirmation.";
    if (/at least|weak password|password should/i.test(text)) return 'Choose a longer password (at least 8 characters).';
    if (/rate limit|too many/i.test(text)) return 'Too many attempts. Please wait a few minutes and try again.';
    if (/should be different/i.test(text)) return 'Choose a password different from your old one.';
    if (isNetworkError(error)) return 'No connection. Check your internet and try again.';
    return text || 'Something went wrong. Please try again.';
  }

  $('syncSignInBtn').addEventListener('click', () => openAuth('signin', false));
  $('syncChangePassword').addEventListener('click', () => openAuth('newpassword', false));

  // ---------- "use without an account" ----------
  $('useOfflineBtn').addEventListener('click', () => $('offlineDialog').showModal());
  $('offlineBack').addEventListener('click', () => $('offlineDialog').close());
  $('offlineConfirm').addEventListener('click', () => {
    try { localStorage.setItem(MODE_KEY, 'local'); } catch { /* ignore */ }
    $('offlineDialog').close();
    showGate(false);
    renderPanel();
    toast('Offline mode: data stays on this device');
  });
  $('authCancel').addEventListener('click', () => $('signInDialog').close());
  $('authToSignup').addEventListener('click', () => openAuth('signup'));
  $('authToForgot').addEventListener('click', () => openAuth('forgot'));
  $('authToSignin').addEventListener('click', () => openAuth('signin'));

  $('authForm').addEventListener('submit', async event => {
    event.preventDefault();
    const email = $('authEmail').value.trim();
    const password = $('authPassword').value;
    const m = MODES[mode];
    $('authError').textContent = '';
    $('authMessage').textContent = '';

    if (m.email && !/^\S+@\S+\.\S+$/.test(email)) return ($('authError').textContent = 'Enter a valid email address.');
    if (m.password && mode !== 'signin' && password.length < 8) return ($('authError').textContent = 'Use at least 8 characters.');
    if (m.password && !password) return ($('authError').textContent = 'Enter your password.');

    const button = $('authSubmit');
    button.disabled = true;
    try {
      if (mode === 'signin') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        $('signInDialog').close();
        toast('Signed in. Syncing…');
      } else if (mode === 'signup') {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: appUrl } });
        if (error) throw error;
        if (data.session) {
          $('signInDialog').close();
          toast('Account created. Syncing…');
        } else {
          openAuth('signin');
          $('authMessage').textContent = 'Almost done: we emailed you a confirmation link. Click it, then come back and sign in here.';
        }
      } else if (mode === 'forgot') {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl });
        if (error) throw error;
        $('authMessage').textContent = 'If that email has an account, a reset link is on its way. It can take a minute; check spam too.';
      } else if (mode === 'newpassword') {
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw error;
        $('signInDialog').close();
        toast('Password updated');
      }
    } catch (error) {
      $('authError').textContent = friendlyError(error);
    } finally {
      button.disabled = false;
    }
  });

  $('syncSignOut').addEventListener('click', async () => {
    if (!confirm('Sign out on this device?\n\nYour dashboard is removed from this device. It stays safe in your account; sign in again to get it back.')) return;
    if (hasLocalChanges()) {
      await sync();
      if (hasLocalChanges() && !confirm("Some recent changes haven't reached your account yet (you may be offline).\n\nSign out anyway and lose them?")) return;
    }
    unsubscribe();
    window.dashboardLock && (window.dashboardLock.wiping = true);   // stop the app saving while we clear
    await sb.auth.signOut({ scope: 'local' }).catch(() => {});      // this device only
    try {
      Object.keys(localStorage)
        .filter(key => (key.startsWith('officeDailyDashboard.') || key.startsWith('officeProjectDashboard.') || key.startsWith('sb-')) && !KEEP_ON_SIGN_OUT.includes(key))
        .forEach(key => localStorage.removeItem(key));
    } catch { /* ignore */ }
    location.reload();
  });

  // ---------- connection to app.js ----------
  window.dashboardSync = {
    onLocalSave() {
      if (user && hasLocalChanges()) schedulePush();
    },
    isSignedIn: () => Boolean(user),
    syncNow: () => sync()
  };

  $('syncPanel').hidden = false;
  renderPanel();
})();
