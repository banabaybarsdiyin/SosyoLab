'use strict';
// T41-T51: F-01 rate limiting through the real Edge Function core
// (supabase/functions/_shared/kimlik_siniri.mjs) and the real DB limiter
// (public.istek_siniri_tuket) on the disposable PG16 schema. Supabase Auth is
// the same explicit behaviour model as T32-T40 (NOT a platform test); hosted
// header/IP-forwarding behaviour is a LIVE-VALIDATION gate.
// Runs after runtime_006_auth_boundary_test.js (reuses its synthetic users).
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const ORIGIN = 'https://arsiv.sosyolab.tr';
const PW_STUDENT = 'Student-Pass-1';
const lit = v => (v === null || v === undefined) ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
const pause = ms => new Promise(r => setTimeout(r, ms));
const tag = () => crypto.randomBytes(3).toString('hex');

module.exports = async function rateLimit({ name }) {
  const root = path.resolve(__dirname, '..');
  const core = await import(pathToFileURL(path.join(root, 'supabase/functions/_shared/kimlik_siniri.mjs')).href);

  function psql(source, role) {
    return new Promise((resolve, reject) => {
      const child = spawn('docker', ['exec', '-i', name, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1']);
      let stdout = '', stderr = '';
      child.stdout.setEncoding('utf8').on('data', d => { stdout += d; });
      child.stderr.setEncoding('utf8').on('data', d => { stderr += d; });
      child.on('error', reject);
      child.on('close', status => resolve({ status, stdout: stdout.trim(), stderr }));
      child.stdin.end(`set statement_timeout='20s';\n${role ? `set role ${role};\n` : ''}${source}\n`);
    });
  }
  async function q(source, role) {
    const r = await psql(source, role);
    if (r.status !== 0) throw new Error(`SQL failed: ${r.stderr}`);
    return r.stdout;
  }

  // ---- real service_role RPCs (as PostgREST would call them) ----
  const rpcSql = {
    istek_siniri_tuket: a => `select to_jsonb(public.istek_siniri_tuket(${lit(JSON.stringify(a.p_kovalar))}::jsonb));`,
    kullanici_email_bul: a => `select to_jsonb(public.kullanici_email_bul(${lit(a.p_username)}));`,
    kayit_on_kontrol: a => `select to_jsonb(public.kayit_on_kontrol(${lit(a.p_username)},${lit(a.p_sifreli_davet_kodu)},${lit(a.p_display_name)}));`,
    kullanici_kaydi_tamamla: a => `select public.kullanici_kaydi_tamamla(${lit(a.p_user_id)}::uuid,${lit(a.p_username)},${lit(a.p_sifreli_davet_kodu)},${lit(a.p_display_name)});`,
    kayit_sonucunu_kesinlestir: a => `select public.kayit_sonucunu_kesinlestir(${lit(a.p_user_id)}::uuid);`
  };
  const calls = [];
  const fault = { limiter: null };
  async function rpc(fn, args) {
    calls.push(fn);
    if (fn === 'istek_siniri_tuket' && fault.limiter === 'error') return { error: { status: 503 } };
    if (fn === 'istek_siniri_tuket' && fault.limiter === 'garbage') return { data: 'true' };
    const r = await psql(rpcSql[fn](args), 'service_role');
    if (r.status !== 0) return { error: { status: 400 } };
    return { data: JSON.parse(r.stdout) };
  }
  const auth = {
    grants: 0, creates: 0,
    async passwordGrant({ email, password }) {
      this.grants++;
      const out = await q(`select case when u.id is null then 'yok'
          when u.encrypted_password = extensions.crypt(${lit(password)}, u.encrypted_password) then u.id::text
          else 'hatali' end
        from (select 1) d left join auth.users u on u.email = ${lit(email)} and not u.is_anonymous;`);
      if (out === 'yok' || out === 'hatali' || !out) return { status: 400, body: { error_code: 'invalid_credentials' } };
      return { status: 200, body: { access_token: 'model-access.' + out, refresh_token: 'model-refresh.' + out, expires_in: 3600, expires_at: 1, token_type: 'bearer' } };
    },
    async adminCreateUser() { this.creates++; return { error: { status: 500 } }; },
    async adminDeleteUser() { return {}; }
  };
  const deps = {
    rpc, passwordGrant: a => auth.passwordGrant(a), adminCreateUser: a => auth.adminCreateUser(a),
    adminDeleteUser: id => auth.adminDeleteUser(id), log: () => {}
  };
  const genis = { limit: 100000, pencere: 3600 };
  function sinir(limits, extra = {}) {
    return core.createAuthBoundary(deps, Object.assign({
      allowedOrigins: [ORIGIN], adminEmail: null, loginFloorMs: 0, registerFloorMs: 0,
      rateLimits: Object.assign({ girisIpAd: genis, girisIp: genis, girisAd: genis, kayitIp: genis }, limits)
    }, extra));
  }
  async function call(handler, body, headers = {}) {
    const req = new Request('https://edge.local/functions/v1/x', {
      method: 'POST', headers: Object.assign({ 'content-type': 'application/json', origin: ORIGIN }, headers), body: JSON.stringify(body)
    });
    const res = await handler(req);
    const text = await res.text();
    const hdr = [...res.headers.entries()].sort().map(([k, v]) => k + ':' + v).join('|');
    return { status: res.status, text, sig: res.status + '\n' + hdr + '\n' + text };
  }
  const login = (s, u, p, h) => call(s.handleLogin, { kullanici_adi: u, parola: p }, h);
  const xff = ip => ({ 'x-forwarded-for': ip });
  const statuses = rs => rs.map(r => r.status).join(',');
  const RL = '{"ok":false,"hata":"cok_fazla_istek"}';

  // ======================= T41 SERIAL + EXISTENCE-INDEPENDENT =======================
  // Reusable contract (also run against DB mutants in T51).
  async function limiterContract() {
    const t = tag();
    const s = sinir({ girisIpAd: { limit: 3, pencere: 3600 }, girisAd: { limit: 5, pencere: 3600 } });
    const ipA = '198.51.100.' + (10 + parseInt(t.slice(0, 2), 16) % 200);
    const ex = [], mi = [];
    for (let i = 0; i < 5; i++) ex.push(await login(s, 'auth.student', 'Wrong-Pass-' + t, xff(ipA)));
    for (let i = 0; i < 5; i++) mi.push(await login(s, 'ghost.' + t, 'Wrong-Pass-' + t, xff(ipA)));
    assert.strictEqual(statuses(ex), '401,401,401,429,429', 'existing username: limited after 3');
    assert.strictEqual(statuses(mi), statuses(ex), 'missing username: identical limiter sequence');
    for (let i = 0; i < 5; i++) assert.strictEqual(mi[i].sig, ex[i].sig, 'existing/missing indistinguishable at step ' + i);
    // Short-circuit: IP A is over its (ip, ad) bucket; hammering more must not
    // burn the username's global bucket (limit 5).
    for (let i = 0; i < 10; i++) await login(s, 'auth.student', 'Wrong-Pass-' + t, xff(ipA));
    const ipB = '203.0.113.' + (10 + parseInt(t.slice(2, 4), 16) % 200);
    const other = [];
    for (let i = 0; i < 3; i++) other.push(await login(s, 'auth.student', 'Wrong-Pass-' + t, xff(ipB)));
    assert.strictEqual(statuses(other), '401,401,429', 'global username bucket = 3 (IP A, capped) + 2 (IP B)');
  }
  // The suite shares one username ('auth.student') across contract runs, so
  // its global bucket is scoped by a fresh window per run via unique limits.
  let contractRun = 0;
  const runContract = async () => {
    contractRun++;
    const realSinir = sinir;
    // distinct pencere per run => distinct HMAC key => fresh global bucket.
    sinir = (limits, extra) => realSinir(Object.assign({}, limits, {
      girisAd: { limit: 5, pencere: 3600 - contractRun }, girisIpAd: { limit: 3, pencere: 3600 - contractRun } }), extra);
    try { await limiterContract(); } finally { sinir = realSinir; }
  };
  const before41 = auth.grants;
  await runContract();
  assert.strictEqual(auth.grants - before41, 3 + 3 + 2, 'Auth reached only by allowed requests (no Auth call on 429)');
  console.log('PASS T41 (serial limit; existing vs missing username: byte-identical 401/429 sequence; 429 never reaches resolver/Auth; short-circuit)');

  // 429 shape: identical status/headers/body shape class across endpoints.
  {
    const t = tag();
    const s = sinir({ girisIpAd: { limit: 1, pencere: 3600 } });
    await login(s, 'shape.' + t, 'x', xff('192.0.2.77'));
    const r = await login(s, 'shape.' + t, 'x', xff('192.0.2.77'));
    assert.strictEqual(r.status, 429);
    assert.strictEqual(r.text, RL);
    assert.ok(!/retry-after|x-ratelimit/i.test(r.sig), 'no per-account counters/timers exposed');
  }

  // ======================= T42 SAME IP, DIFFERENT USERNAMES =======================
  {
    const t = tag();
    const s = sinir({ girisIpAd: { limit: 3, pencere: 3600 }, girisIp: { limit: 5, pencere: 3600 } });
    const ip = '198.18.0.' + (1 + parseInt(t.slice(0, 2), 16) % 250);
    const a = [], b = [], c = [];
    for (let i = 0; i < 3; i++) a.push(await login(s, 'u1.' + t, 'x', xff(ip)));
    for (let i = 0; i < 2; i++) b.push(await login(s, 'u2.' + t, 'x', xff(ip)));
    c.push(await login(s, 'u3.' + t, 'x', xff(ip)));
    assert.strictEqual(statuses(a) + '|' + statuses(b) + '|' + statuses(c), '401,401,401|401,401|429',
      'per-(IP,user) buckets independent; per-IP bucket caps username spraying');
  }
  console.log('PASS T42 (same IP + different usernames: separate (IP,user) buckets; IP bucket stops spraying)');

  // ======================= T43 DIFFERENT IP, SAME USERNAME =======================
  {
    const t = tag();
    const s = sinir({ girisIpAd: { limit: 3, pencere: 3600 }, girisAd: { limit: 6, pencere: 3600 } });
    const user = 'target.' + t;
    const r1 = [], r2 = [], r3 = [];
    for (let i = 0; i < 4; i++) r1.push(await login(s, user, 'x', xff('198.19.1.1')));
    for (let i = 0; i < 4; i++) r2.push(await login(s, user, 'x', xff('198.19.2.2')));
    r3.push(await login(s, user, 'x', xff('198.19.3.3')));
    assert.strictEqual(statuses(r1), '401,401,401,429', 'IP 1 limited on its own (IP,user) bucket');
    assert.strictEqual(statuses(r2), '401,401,401,429', 'IP 2 has its own (IP,user) bucket');
    assert.strictEqual(statuses(r3), '429', 'global username bucket (6) bounds distributed guessing');
  }
  console.log('PASS T43 (different IPs + same username: per-IP buckets independent, global username bucket caps distributed guessing)');

  // ======================= T44 PARALLEL =======================
  {
    const t = tag();
    const s = sinir({ girisIpAd: { limit: 10, pencere: 3600 } });
    const rs = await Promise.all(Array.from({ length: 25 }, () => login(s, 'par.' + t, 'x', xff('198.51.100.250'))));
    assert.strictEqual(rs.filter(r => r.status !== 429).length, 10, 'atomic counter: exactly limit requests pass under concurrency');
    assert.strictEqual(rs.filter(r => r.status === 429).length, 15);
  }
  console.log('PASS T44 (25 concurrent requests, limit 10: exactly 10 pass)');

  // ======================= T45 WINDOW RESET + TTL =======================
  {
    const t = tag();
    // Fixed windows are epoch-aligned in the DB (now()); the container shares
    // the host clock. 10 s windows keep the 3 fill requests (~1.3 s each here)
    // inside one window; the window id is asserted, so a crossing cannot pass.
    const P = 10;
    const s = sinir({ girisIpAd: { limit: 2, pencere: P } });
    const pencereNo = () => Math.floor(Date.now() / (P * 1000));
    const waitBoundary = async () => { const ms = P * 1000 - (Date.now() % (P * 1000)); await pause(ms + 150); };
    await waitBoundary();
    const w0 = pencereNo();
    const w1 = [];
    for (let i = 0; i < 3; i++) w1.push(await login(s, 'win.' + t, 'x', xff('192.0.2.45')));
    assert.strictEqual(pencereNo(), w0, 'fill requests stayed in one window (harness timing)');
    assert.strictEqual(statuses(w1), '401,401,429', 'window fills');
    await waitBoundary();
    const w2 = await login(s, 'win.' + t, 'x', xff('192.0.2.45'));
    assert.strictEqual(w2.status, 401, 'new window resets the counter');
    await waitBoundary();
    await login(s, 'ttl.' + t, 'x', xff('192.0.2.46'));
    assert.strictEqual(await q(`select count(*) from sosyolab_private.istek_sayaclari where bitis < now();`), '0',
      'expired windows deleted on the next limiter call (TTL)');
  }
  console.log('PASS T45 (window fill, reset at next window, expired counters cleaned)');

  // ======================= T46 CLIENT IP: SPOOF / GARBAGE / IPV6 / MISSING =======================
  {
    const t = tag();
    const lim = { girisIpAd: { limit: 2, pencere: 3600 } };
    // (a) Only the configured header counts; client-added headers are ignored.
    const s = sinir(lim);
    const a = [];
    for (let i = 0; i < 4; i++) {
      a.push(await login(s, 'spoof.' + t, 'x', Object.assign(xff('198.51.100.33'),
        { 'x-real-ip': '10.0.0.' + i, 'cf-connecting-ip': '10.1.0.' + i, 'true-client-ip': '10.2.0.' + i })));
    }
    assert.strictEqual(statuses(a), '401,401,429,429', 'rotating non-configured IP headers does not reset the bucket');
    // (b) Trusted header configured as cf-connecting-ip: rotating XFF is ignored.
    const cf = sinir(lim, { clientIpHeader: 'cf-connecting-ip' });
    const b = [];
    for (let i = 0; i < 4; i++) b.push(await login(cf, 'spoofcf.' + t, 'x', { 'cf-connecting-ip': '198.51.100.34', 'x-forwarded-for': '10.9.0.' + i }));
    assert.strictEqual(statuses(b), '401,401,429,429', 'rotating XFF under cf-connecting-ip config does not bypass');
    // (c) Garbage / unparseable values collapse into ONE shared bucket (no bypass, no fail-open).
    const c = [];
    for (const v of ['not-an-ip', '999.1.1.1', 'unknown', '1.2.3', '::ffff:999.1.1.1', '<script>']) {
      c.push(await login(s, 'garbage.' + t, 'x', xff(v)));
    }
    assert.strictEqual(statuses(c), '401,401,429,429,429,429', 'invalid client IP values share the unknown bucket');
    // (d) Missing header -> same shared unknown bucket (already exhausted for this user).
    assert.strictEqual((await login(s, 'garbage.' + t, 'x', {})).status, 429, 'missing IP header is not a bypass');
    // (e) IPv6 rotation inside one /64 is one bucket; IPv4-mapped IPv6 == IPv4.
    const e = [];
    for (const v of ['2001:db8:1:2::1', '2001:db8:1:2:aaaa::5', '2001:0db8:0001:0002:ffff:ffff:ffff:ffff']) e.push(await login(s, 'v6.' + t, 'x', xff(v)));
    assert.strictEqual(statuses(e), '401,401,429', 'IPv6 addresses in one /64 share a bucket');
    const m = [await login(s, 'map.' + t, 'x', xff('198.51.100.90')), await login(s, 'map.' + t, 'x', xff('::ffff:198.51.100.90')),
      await login(s, 'map.' + t, 'x', xff('198.51.100.90'))];
    assert.strictEqual(statuses(m), '401,401,429', 'IPv4-mapped IPv6 is the same client');
    // (f) First XFF element is taken (gateway-written value per LIVE gate).
    assert.deepStrictEqual(core.ipCoz('203.0.113.9'), { adres: '203.0.113.9', kova: '203.0.113.9' });
    assert.strictEqual(core.ipCoz('2001:db8::1').kova, '2001:0db8:0000:0000::/64');
    for (const bad of ['', ' ', '1.2.3.256', '1:2:3:4:5:6:7:8:9', '::1::2', 'g::1', '1.2.3.4.5', '01234::', '64:ff9b::1.2.3.4']) {
      assert.strictEqual(core.ipCoz(bad), null, 'rejects ' + JSON.stringify(bad));
    }
  }
  console.log('PASS T46 (only configured header trusted; spoofed/garbage/missing IP cannot bypass; IPv6 /64 bucketing)');

  // ======================= T47 LIMITER FAILURE = FAIL-CLOSED =======================
  {
    const s = sinir({});
    for (const mode of ['error', 'garbage']) {
      fault.limiter = mode;
      const g0 = auth.grants, c0 = calls.length;
      const ex = await login(s, 'auth.student', PW_STUDENT, xff('192.0.2.200'));
      const mi = await login(s, 'ghost.failclosed', 'x', xff('192.0.2.200'));
      const kr = await call(s.handleRegister, { kullanici_adi: 'fail.closed', parola: 'Fail-Pass-1', davet_kodu: 'A'.repeat(32) }, xff('192.0.2.200'));
      fault.limiter = null;
      assert.strictEqual(ex.status, 503, mode + ': even a correct password is not checked');
      assert.strictEqual(ex.sig, mi.sig, mode + ': existing/missing identical');
      assert.strictEqual(ex.text, '{"ok":false,"hata":"gecici_hata"}');
      assert.strictEqual(kr.status, 503);
      assert.strictEqual(auth.grants, g0, mode + ': no Auth password check without a limiter decision');
      assert.deepStrictEqual(calls.slice(c0), ['istek_siniri_tuket', 'istek_siniri_tuket', 'istek_siniri_tuket'], mode + ': nothing after the failed limiter');
    }
    // Malformed bucket definitions are rejected by the DB function itself.
    for (const bad of ['[]', '{}', '[{"anahtar":"x","limit":0,"pencere":10}]', '[{"anahtar":"","limit":1,"pencere":10}]',
      '[{"anahtar":"x","limit":1,"pencere":100000}]', '[{"anahtar":"x","limit":"1","pencere":10}]']) {
      await q(`select runtime_test.denied($q$select public.istek_siniri_tuket(${lit(bad)}::jsonb)$q$,'P0001');`, 'service_role');
    }
  }
  console.log('PASS T47 (limiter DB error / non-boolean -> 503, no resolver/Auth/precheck; malformed buckets rejected)');

  // ======================= T48 SUCCESS IS COUNTED; 429 HIDES PASSWORD CORRECTNESS =======================
  {
    const t = tag();
    const s = sinir({ girisIpAd: { limit: 3, pencere: 3600 - 100 }, girisAd: { limit: 100000, pencere: 3500 - contractRun } });
    const ip = '192.0.2.' + (100 + parseInt(t.slice(0, 2), 16) % 100);
    const r = [];
    r.push(await login(s, 'auth.student', 'Wrong-Pass-1', xff(ip)));
    r.push(await login(s, 'auth.student', 'Wrong-Pass-2', xff(ip)));
    r.push(await login(s, 'auth.student', PW_STUDENT, xff(ip)));
    const okAfterLimit = await login(s, 'auth.student', PW_STUDENT, xff(ip));
    const wrongAfterLimit = await login(s, 'auth.student', 'Wrong-Pass-3', xff(ip));
    const wrongAfterLimit2 = await login(s, 'auth.student', 'Wrong-Pass-4', xff(ip));
    assert.strictEqual(statuses(r), '401,401,200', 'correct password inside the budget logs in');
    assert.strictEqual(okAfterLimit.status, 429, 'successful login counts; no reset');
    assert.strictEqual(okAfterLimit.sig, wrongAfterLimit.sig, '429 identical for correct and wrong password');
    assert.strictEqual(okAfterLimit.sig, wrongAfterLimit2.sig);
  }
  console.log('PASS T48 (successful login counted, no reset oracle; 429 identical for correct/wrong password)');

  // ======================= T49 REGISTRATION LIMIT =======================
  {
    const s = sinir({ kayitIp: { limit: 2, pencere: 3600 } });
    const ip = '192.0.2.9';
    const reg = (u, kod) => call(s.handleRegister, { kullanici_adi: u, parola: 'Reg-Pass-12', davet_kodu: kod }, xff(ip));
    const c0 = auth.creates;
    const r = [await reg('reg.one', 'SYNTHETIC-WRONG'), await reg('reg.two', 'SYNTHETIC-WRONG')];
    const n0 = calls.length;
    const limited = [await reg('reg.three', 'SYNTHETIC-WRONG'), await reg('reg.four', 'A'.repeat(32))];
    assert.strictEqual(statuses(r), '422,422');
    assert.strictEqual(statuses(limited), '429,429', 'valid and invalid code both limited');
    assert.strictEqual(limited[0].sig, limited[1].sig);
    assert.deepStrictEqual(calls.slice(n0), ['istek_siniri_tuket', 'istek_siniri_tuket'], 'precheck/finalize never reached when limited');
    assert.strictEqual(auth.creates, c0, 'Admin API never reached');
  }
  console.log('PASS T49 (registration limited per IP before invite/username checks and Admin API)');

  // ======================= T50 AUTH IP FORWARDING ADAPTER CONTRACT =======================
  {
    const sent = [];
    const fakeFetch = async (url, init) => {
      sent.push({ url, init });
      const p = new URL(url).pathname;
      const reply = (status, body) => new Response(JSON.stringify(body), { status });
      if (p === '/rest/v1/rpc/istek_siniri_tuket') return reply(200, true);
      if (p === '/rest/v1/rpc/kullanici_email_bul') return reply(200, 'u.0123456789ab4cde8f0123456789abcd@auth.sosyolab.local');
      if (p === '/auth/v1/token') return reply(400, { error_code: 'invalid_credentials' });
      return reply(404, {});
    };
    const SECRET = 'sb_secret_dummy_local_test_only';
    const PUB = 'sb_publishable_dummy_local_test_only';
    const LEGACY_SVC = 'eyJ' + 'legacy-service'.padEnd(20, 'x');
    const mkLive = d => core.createAuthBoundary(Object.assign(d, { log: () => {} }),
      { allowedOrigins: [ORIGIN], loginFloorMs: 0, registerFloorMs: 0 });
    const tokenReqs = () => sent.filter(s => new URL(s.url).pathname === '/auth/v1/token');

    // required + secret key: forwarded IP, secret on apikey only.
    const req = core.supabaseDeps({ url: 'https://p.example', anonKey: PUB, serviceKey: LEGACY_SVC, secretKey: SECRET, ipForwarding: 'required', fetchImpl: fakeFetch });
    const r1 = await call(mkLive(req).handleLogin, { kullanici_adi: 'someone', parola: 'x' }, xff('203.0.113.5, 10.0.0.1'));
    let tr = tokenReqs().pop().init.headers;
    assert.strictEqual(tr.apikey, SECRET, 'Sb-Forwarded-For requires the secret key');
    assert.strictEqual(tr['sb-forwarded-for'], '203.0.113.5', 'end-user IP forwarded to Auth');
    assert.ok(!('authorization' in tr), 'secret key is not a bearer JWT');
    assert.strictEqual(r1.status, 401);
    assert.ok(!r1.sig.includes(SECRET) && !r1.sig.includes('203.0.113.5'), 'no key/IP echo');
    // Unknown client IP -> no header (Auth falls back; never a forged value).
    await call(mkLive(req).handleLogin, { kullanici_adi: 'someone', parola: 'x' }, xff('garbage'));
    tr = tokenReqs().pop().init.headers;
    assert.ok(!('sb-forwarded-for' in tr), 'no Sb-Forwarded-For without a valid client IP');
    // Service RPCs use the secret key when available.
    assert.strictEqual(sent.find(s => s.url.includes('/rest/v1/rpc/')).init.headers.apikey, SECRET);
    // disabled: publishable/anon key, never with Sb-Forwarded-For.
    const dis = core.supabaseDeps({ url: 'https://p.example', anonKey: PUB, serviceKey: LEGACY_SVC, ipForwarding: 'disabled', fetchImpl: fakeFetch });
    await call(mkLive(dis).handleLogin, { kullanici_adi: 'someone', parola: 'x' }, xff('203.0.113.5'));
    tr = tokenReqs().pop().init.headers;
    assert.strictEqual(tr.apikey, PUB);
    assert.ok(!('sb-forwarded-for' in tr), 'publishable key never carries Sb-Forwarded-For');
    for (const s of sent) {
      const h = s.init.headers;
      if ('sb-forwarded-for' in h) assert.strictEqual(h.apikey, SECRET, 'Sb-Forwarded-For only with secret key');
    }
    // Fail-closed configuration.
    const base = { url: 'https://p.example', anonKey: PUB, serviceKey: LEGACY_SVC, fetchImpl: fakeFetch };
    assert.throws(() => core.supabaseDeps(Object.assign({}, base, { ipForwarding: 'required' })), /secret_key_eksik/, 'required without secret key');
    assert.throws(() => core.supabaseDeps(Object.assign({}, base, { ipForwarding: 'required', secretKey: LEGACY_SVC })), /secret_key_eksik/, 'legacy JWT is not a secret key');
    assert.throws(() => core.supabaseDeps(Object.assign({}, base, { ipForwarding: 'required', secretKey: PUB })), /secret_key_eksik/, 'publishable is not a secret key');
    assert.throws(() => core.supabaseDeps(Object.assign({}, base, { ipForwarding: 'off', secretKey: SECRET })), /modu_gecersiz/);
    assert.throws(() => core.supabaseDeps(Object.assign({}, base, { ipForwarding: undefined, secretKey: SECRET })), /modu_gecersiz/);
    // Hosted env wiring: SUPABASE_SECRET_KEYS JSON {"default": ...}; default mode = required.
    const env = o => k => (o[k] === undefined ? '' : o[k]);
    const hosted = { SUPABASE_URL: 'https://p.example', SUPABASE_ANON_KEY: PUB, SUPABASE_SERVICE_ROLE_KEY: LEGACY_SVC };
    assert.strictEqual(core.secretKeyFromEnv(env(Object.assign({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }) }, hosted))), SECRET);
    assert.strictEqual(core.secretKeyFromEnv(env({ SUPABASE_SECRET_KEYS: '{not json' })), '');
    assert.throws(() => core.supabaseDepsFromEnv(env(hosted), fakeFetch), /secret_key_eksik/, 'default mode is required: no silent fallback');
    core.supabaseDepsFromEnv(env(Object.assign({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }) }, hosted)), fakeFetch);
    core.supabaseDepsFromEnv(env(Object.assign({ AUTH_IP_FORWARDING: 'disabled' }, hosted)), fakeFetch);
    // Limits/header from env.
    const c = core.configFromEnv(env({ RL_GIRIS_IP_AD: '5/600', RL_GIRIS_IP: 'bogus', CLIENT_IP_HEADER: 'CF-Connecting-IP' }));
    assert.deepStrictEqual(c.rateLimits.girisIpAd, { limit: 5, pencere: 600 });
    assert.deepStrictEqual(c.rateLimits.girisIp, core.VARSAYILAN_LIMITLER.girisIp, 'invalid env falls back to safe default, never unlimited');
    assert.strictEqual(c.clientIpHeader, 'cf-connecting-ip');
  }
  console.log('PASS T50 (Sb-Forwarded-For only with sb_secret key; publishable/legacy never; required mode fail-closed; env wiring)');

  // ======================= T51 LIMITER MUTATION TESTS =======================
  const orig = await q(`select pg_get_functiondef('public.istek_siniri_tuket(jsonb)'::regprocedure);`);
  const mutants = {
    'always-allow': orig.replace(/if v_sayac > v_limit then\s*return false;\s*end if;/, ''),
    'no-short-circuit': orig.replace('v_sayac integer;', 'v_sayac integer; v_red boolean := false;')
      .replace(/return false;/, 'v_red := true;').replace(/return true;\s*end;\s*\$function\$/, 'return not v_red; end; $function$'),
    // Drops the last "|segment" of every bucket key inside the HMAC input
    // (username for ip_ad/ad buckets) -> buckets stop being per-username.
    'username-ignored': orig.replace("|| (v_kova->>'anahtar'), 'UTF8')",
      () => "|| regexp_replace(v_kova->>'anahtar', '[|][^|]*$', ''), 'UTF8')")
  };
  for (const [ad, src] of Object.entries(mutants)) {
    assert.notStrictEqual(src, orig, 'mutant applied: ' + ad);
    await q(src);
    let caught = null;
    try { await runContract(); } catch (e) { caught = e; }
    await q(orig);
    assert.ok(caught instanceof assert.AssertionError, `limiter contract must FAIL on mutant ${ad}`);
  }
  await runContract();
  console.log('PASS T51 (limiter contract fails on always-allow / no-short-circuit / username-ignored DB mutants; passes on restored function)');
};
