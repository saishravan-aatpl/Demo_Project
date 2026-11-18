// Fake cloud: same rules as the real table (one row per user, version check on update).
const http = require('http');
const rows = new Map();
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.end();
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const b = body ? JSON.parse(body) : {};
    const send = x => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(x)); };
    if (req.url === '/get') return send({ row: rows.get(b.user) || null });
    if (req.url === '/insert') {
      if (rows.has(b.user_id)) return send({ error: { code: '23505', message: 'duplicate' } });
      rows.set(b.user_id, { data: b.data, version: b.version }); return send({});
    }
    if (req.url === '/update') {
      const row = rows.get(b.user);
      if (!row || row.version !== b.expect) return send({ rows: [] });
      rows.set(b.user, { data: b.vals.data, version: b.vals.version }); return send({ rows: [{ version: b.vals.version }] });
    }
    if (req.url === '/dump') return send(Object.fromEntries(rows));
    res.statusCode = 404; res.end();
  });
}).listen(8124, () => console.log('fake cloud on 8124'));
