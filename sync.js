// Cloud sync (Supabase)
// --------------------
// Keeps the dashboard the same on every device you sign in on.
//
// - Sign in with a one-time code sent to your email (works inside the iPhone
//   home-screen app, where email links would open Safari instead).
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
    window.dashboardSync = noop;
    return;
  }

  const { merge } = window.DashboardMerge;
  const sb = window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
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
  }

  function renderPanel() {
    $('syncSignedOut').hidden = Boolean(user);
    $('syncSignedIn').hidden = !user;
    $('syncEmail').textContent = user ? user.email : '';
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
  function handleSession(session) {
    const nextUser = session?.user || null;
    if ((nextUser?.id || null) === (user?.id || null)) return;   // e.g. a routine token refresh
    user = nextUser;
    if (user && meta.userId !== user.id) {
      meta = { userId: user.id };
      writeMeta();
    }
    renderPanel();
    if (user) {
      subscribe();
      sync();
    } else {
      unsubscribe();
    }
  }

  // Supabase recommends not calling it again from inside this callback, hence setTimeout.
  sb.auth.onAuthStateChange((_event, session) => setTimeout(() => handleSession(session), 0));

  let pendingEmail = '';

  function showEmailStep() {
    $('signInEmailForm').hidden = false;
    $('signInCodeForm').hidden = true;
    $('signInEmailError').textContent = '';
    $('signInEmail').focus();
  }

  function showCodeStep() {
    $('signInEmailForm').hidden = true;
    $('signInCodeForm').hidden = false;
    $('signInCode').value = '';
    $('signInCodeError').textContent = '';
    $('signInCodeText').textContent = `We sent a code to ${pendingEmail}. Type it below. It can take a minute to arrive; check spam too.`;
    $('signInCode').focus();
  }

  $('syncSignInBtn').addEventListener('click', () => {
    $('signInDialog').showModal();
    showEmailStep();
  });

  $('signInCancel').addEventListener('click', () => $('signInDialog').close());
  $('signInBack').addEventListener('click', showEmailStep);

  $('signInEmailForm').addEventListener('submit', async event => {
    event.preventDefault();
    const email = $('signInEmail').value.trim();
    if (!email) return;
    const button = $('signInSend');
    button.disabled = true;
    $('signInEmailError').textContent = '';
    try {
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) throw error;
      pendingEmail = email;
      showCodeStep();
    } catch (error) {
      $('signInEmailError').textContent = error.message || 'Could not send the code. Try again.';
    } finally {
      button.disabled = false;
    }
  });

  $('signInCode').addEventListener('input', event => {
    event.target.value = event.target.value.replace(/\D/g, '');
  });

  $('signInCodeForm').addEventListener('submit', async event => {
    event.preventDefault();
    const token = $('signInCode').value.trim();
    if (!token) return;
    const button = $('signInVerify');
    button.disabled = true;
    $('signInCodeError').textContent = '';
    try {
      const { error } = await sb.auth.verifyOtp({ email: pendingEmail, token, type: 'email' });
      if (error) throw error;
      $('signInDialog').close();
      toast('Signed in. Syncing…');
    } catch (error) {
      $('signInCodeError').textContent = /expired|invalid/i.test(error.message || '')
        ? 'That code is wrong or has expired. Check the latest email, or go back and send a new one.'
        : (error.message || 'Could not verify the code.');
    } finally {
      button.disabled = false;
    }
  });

  $('syncSignOut').addEventListener('click', async () => {
    const confirmed = confirm('Sign out on this device?\n\nYour dashboard stays on this device but will stop syncing until you sign in again.');
    if (!confirmed) return;
    unsubscribe();
    await sb.auth.signOut({ scope: 'local' });   // only this device
    meta = {};
    writeMeta();
    toast('Signed out');
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
