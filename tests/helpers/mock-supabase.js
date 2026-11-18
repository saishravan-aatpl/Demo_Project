window.supabase = { createClient() {
  const KEY = 'sb-mock-auth-token';
  const listeners = [];
  let session = JSON.parse(localStorage.getItem(KEY) || 'null');
  const api = (path, body) => fetch('http://localhost:8124' + path, { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());
  const notify = () => listeners.forEach(cb => cb('CHANGE', session));
  return {
    from() {
      const q = { f: {} };
      const b = {
        select() { return b; },
        eq(k, v) { q.f[k] = v; return b; },
        update(vals) { q.vals = vals; return b; },
        insert(vals) { return api('/insert', vals).then(r => ({ error: r.error || null })); },
        maybeSingle() { return api('/get', { user: q.f.user_id }).then(r => ({ data: r.row, error: null })); },
        then(ok, bad) { return api('/update', { user: q.f.user_id, expect: q.f.version, vals: q.vals }).then(r => ({ data: r.rows, error: null })).then(ok, bad); }
      };
      return b;
    },
    auth: {
      onAuthStateChange(cb) { listeners.push(cb); setTimeout(() => cb('INITIAL_SESSION', session), 0); return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithPassword({ email, password }) {
        if (password !== 'Secret123!') return { error: { message: 'Invalid login credentials' } };
        session = { user: { id: 'user-' + email, email } };
        localStorage.setItem(KEY, JSON.stringify(session)); notify(); return { error: null };
      },
      async signUp({ email }) {
        if (email.startsWith('confirm')) return { data: { session: null }, error: null };
        session = { user: { id: 'user-' + email, email } };
        localStorage.setItem(KEY, JSON.stringify(session)); notify(); return { data: { session }, error: null };
      },
      async resetPasswordForEmail() { return { error: null }; },
      async updateUser() { return { error: null }; },
      async signOut() { session = null; localStorage.removeItem(KEY); notify(); return { error: null }; }
    },
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
    removeChannel() {}
  };
} };
