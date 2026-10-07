'use strict';
// T32-T40: end-to-end F-05 contract through the real Edge Function code
// (supabase/functions/_shared/kimlik_siniri.mjs) against the real disposable
// PostgreSQL 16 schema. Supabase Auth is replaced by an explicit behaviour
// model backed by auth.users (documented GoTrue semantics: password grant
// does bcrypt only for an existing email; with signup disabled /signup
// rejects before any lookup). The model is NOT a platform test; the live
// checks in docs/LIVE-VALIDATION.md cover real Auth configuration.
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const ORIGIN = 'https://arsiv.sosyolab.tr';
// Floor must exceed the real per-request work of this harness (3 docker-exec
// psql round trips: limiter, resolver, Auth model). If real work exceeds it,
// T36 fails on purpose (giris_taban_asildi / spread) instead of passing.
const FLOOR = 2500;
const PW = { student: 'Student-Pass-1', pending: 'Pending-Pass-1', approved: 'Approved-Pass-1', legacy: 'Legacy-Pass-1', admin: 'Admin-Pass-1' };
const lit = v => (v === null || v === undefined) ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

module.exports = async function authBoundary({ name }) {
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

  // ---- service_role RPC exactly as the Edge Function calls PostgREST ----
  const rpcSql = {
    kullanici_email_bul: a => `select to_jsonb(public.kullanici_email_bul(${lit(a.p_username)}));`,
    kayit_on_kontrol: a => `select to_jsonb(public.kayit_on_kontrol(${lit(a.p_username)},${lit(a.p_sifreli_davet_kodu)},${lit(a.p_display_name)}));`,
    kullanici_kaydi_tamamla: a => `select public.kullanici_kaydi_tamamla(${lit(a.p_user_id)}::uuid,${lit(a.p_username)},${lit(a.p_sifreli_davet_kodu)},${lit(a.p_display_name)});`,
    istek_siniri_tuket: a => `select to_jsonb(public.istek_siniri_tuket(${lit(JSON.stringify(a.p_kovalar))}::jsonb));`,
    kayit_sonucunu_kesinlestir: a => `select public.kayit_sonucunu_kesinlestir(${lit(a.p_user_id)}::uuid);`
  };
  const faults = { createFails: false, deleteFails: false, finalizeResponseLost: false, statusUnknown: false };
  const rpcCalls = [];
  async function rpc(fn, args) {
    rpcCalls.push(fn);
    if (fn === 'kayit_sonucunu_kesinlestir' && faults.statusUnknown) return { error: { status: 0 } };
    const r = await psql(rpcSql[fn](args), 'service_role');
    if (r.status !== 0) return { error: { status: 400 } };
    if (fn === 'kullanici_kaydi_tamamla' && faults.finalizeResponseLost) return { error: { status: 0 } };
    return { data: JSON.parse(r.stdout) };
  }

  // ---- Supabase Auth behaviour model over auth.users ----
  const auth = {
    signupEnabled: false,
    creates: 0,
    async publicSignup(email, password) {
      if (!this.signupEnabled) return { status: 422, body: { code: 422, error_code: 'signup_disabled', msg: 'Signups not allowed for this instance' } };
      const out = await q(`select exists(select 1 from auth.users where email=${lit(email)});`);
      if (out === 't') return { status: 422, body: { error_code: 'user_already_exists', msg: 'User already registered' } };
      const id = await q(`insert into auth.users(id,email,encrypted_password) values (gen_random_uuid(),${lit(email)},
        extensions.crypt(${lit(password)},extensions.gen_salt('bf',4))) returning id;`);
      return { status: 200, body: { user: { id } } };
    },
    async passwordGrant({ email, password }) {
      // GoTrue: unknown email fails fast; existing email pays bcrypt.
      const out = await q(`select case when u.id is null then 'yok'
          when u.encrypted_password = extensions.crypt(${lit(password)}, u.encrypted_password) then u.id::text
          else 'hatali' end
        from (select 1) d left join auth.users u on u.email = ${lit(email)} and not u.is_anonymous;`);
      if (out === 'yok' || out === 'hatali' || !out) return { status: 400, body: { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' } };
      return { status: 200, body: { access_token: 'model-access.' + out, refresh_token: 'model-refresh.' + out, expires_in: 3600,
        expires_at: 1, token_type: 'bearer', user: { id: out, email } } };
    },
    async adminCreateUser({ email, password }) {
      this.creates++;
      if (faults.createFails) return { error: { status: 500, code: 'unexpected_failure' } };
      const id = await q(`insert into auth.users(id,email,encrypted_password,is_anonymous)
        values (gen_random_uuid(),${lit(email)},extensions.crypt(${lit(password)},extensions.gen_salt('bf',10)),false) returning id;`);
      return { id };
    },
    async adminDeleteUser(id) {
      if (faults.deleteFails) return { error: { status: 500 } };
      await q(`delete from auth.users where id=${lit(id)}::uuid;`);
      return {};
    }
  };

  const logs = [];
  const deps = {
    rpc, passwordGrant: a => auth.passwordGrant(a), adminCreateUser: a => auth.adminCreateUser(a),
    adminDeleteUser: id => auth.adminDeleteUser(id),
    log: (olay, ayrinti) => logs.push([olay, ayrinti])
  };
  const adminEmail = await q(`select runtime_test.email(1);`);
  // T32-T40 exercise identity/registration semantics; limits are set high so
  // the real DB limiter runs on every request without interfering. T41+ test
  // the limiter itself with production-shaped limits.
  const genis = { limit: 100000, pencere: 3600 };
  const cfg = { allowedOrigins: [ORIGIN], adminEmail, loginFloorMs: FLOOR, registerFloorMs: 300,
    rateLimits: { girisIpAd: genis, girisIp: genis, girisAd: genis, kayitIp: genis } };
  const sinir = core.createAuthBoundary(deps, cfg);
  const ham = core.createAuthBoundary(deps, Object.assign({}, cfg, { loginFloorMs: 0 }));
  const observed = [];
  async function call(handler, body, extra = {}) {
    const req = new Request('https://edge.local/functions/v1/x', {
      method: extra.method || 'POST',
      headers: Object.assign({ 'content-type': 'application/json', origin: ORIGIN }, extra.headers || {}),
      body: (extra.method === 'OPTIONS' || extra.method === 'GET') ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
    });
    const t0 = process.hrtime.bigint();
    const res = await handler(req);
    const text = await res.text();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const headers = [...res.headers.entries()].sort().map(([k, v]) => k + ':' + v).join('|');
    const o = { status: res.status, text, headers, ms, sig: res.status + '\n' + headers + '\n' + text };
    observed.push(o);
    return o;
  }
  const login = (u, p, h = sinir) => call(h.handleLogin, { kullanici_adi: u, parola: p });
  const register = (u, p, kod, ad = null) => call(sinir.handleRegister, { kullanici_adi: u, parola: p, davet_kodu: kod, ad_soyad: ad });
  const authCount = async () => Number(await q('select count(*) from auth.users;'));
  const invite = async label => Number(await q(`select kullanim_sayisi from public.davet_kodlari where etiket=${lit(label)};`));
  const orphanQuery = `select count(*) from auth.users u left join public.profiles p on p.id=u.id
    where p.id is null and u.email like 'u.%@auth.sosyolab.local' and u.created_at > (select min(created_at) from runtime_test.t32_start)`;

  // ---- fixtures: synthetic invites, legacy backfill aligned with Auth, admin password ----
  await q(`create table runtime_test.t32_start as select now() as created_at;
    select public.admin_davet_kodu_olustur(repeat('A',32),'student',3::smallint,'boundary student',null,100);
    select public.admin_davet_kodu_olustur(repeat('B',32),'teacher',null,'boundary teacher',null,100);
    select public.admin_davet_kodu_olustur(repeat('C',32),'student',1::smallint,'boundary expired',null,100);
    update public.davet_kodlari set gecerlilik_sonu=now()-interval '1 day' where etiket='boundary expired';
    select public.admin_davet_kodu_olustur(repeat('D',32),'student',1::smallint,'boundary exhausted',null,1);
    update public.davet_kodlari set kullanim_sayisi=1 where etiket='boundary exhausted';
    select public.admin_davet_kodu_olustur(repeat('E',32),'student',2::smallint,'boundary last slot',null,1);
    select public.admin_davet_kodu_olustur(repeat('F',32),'student',4::smallint,'boundary replay',null,1);
    select set_config('request.jwt.claims','',false);
    update auth.users u set email=p.auth_login_email,
      encrypted_password=extensions.crypt(${lit(PW.legacy)},extensions.gen_salt('bf',10))
      from public.profiles p where p.id=u.id and p.username='legacy.teacher';
    update auth.users set encrypted_password=extensions.crypt(${lit(PW.admin)},extensions.gen_salt('bf',10))
      where id=runtime_test.identity(1);`);
  const A = 'A'.repeat(32), B = 'B'.repeat(32), C = 'C'.repeat(32), D = 'D'.repeat(32), E = 'E'.repeat(32), F = 'F'.repeat(32);

  // ======================= T37 REGISTRATION =======================
  let before = await authCount();
  let r = await register('auth.student', PW.student, A);
  assert.strictEqual(r.status, 200, r.text);
  assert.deepStrictEqual(JSON.parse(r.text), { ok: true, audience_type: 'student', teacher_status: null });
  assert.strictEqual(await q(`select role||':'||class_year||':'||coalesce(teacher_status,'-')||':'||
    (auth_login_email ~ '^u\\.[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}@auth\\.sosyolab\\.local$')::text
    from public.profiles where username='auth.student';`), 'user:3:-:true');
  assert.strictEqual(await authCount(), before + 1, 'one Auth user per successful registration');
  assert.strictEqual(await invite('boundary student'), 1, 'valid invite consumed once');
  r = await register('auth.pending', PW.pending, B, 'Synthetic Boundary Pending');
  assert.strictEqual(r.status, 200, r.text);
  assert.strictEqual(JSON.parse(r.text).teacher_status, 'pending');
  r = await register('auth.approved', PW.approved, B, 'Synthetic Boundary Approved');
  assert.strictEqual(r.status, 200, r.text);
  await q(`select runtime_test.login(1); set role authenticated;
    select public.ogretmen_basvurusunu_karara_bagla((select id from public.profiles where username='auth.approved'),'approve');
    reset role; select set_config('request.jwt.claims','',false);`);
  // Invalid / expired / exhausted invite, teacher without name: one identical
  // failure, no Auth user, no consumption. Existing vs missing username does
  // not change the answer when the invite is not valid.
  before = await authCount();
  const creates0 = auth.creates;
  const counts = await q(`select string_agg(etiket||'='||kullanim_sayisi, ',' order by etiket) from public.davet_kodlari;`);
  const fails = [
    await register('fresh.user1', 'Fresh-Pass-1', 'SYNTHETIC-WRONG'),
    await register('auth.student', 'Fresh-Pass-1', 'SYNTHETIC-WRONG'),
    await register('fresh.user2', 'Fresh-Pass-1', C),
    await register('auth.student', 'Fresh-Pass-1', C),
    await register('fresh.user3', 'Fresh-Pass-1', D),
    await register('pending.teacher', 'Fresh-Pass-1', D),
    await register('fresh.user4', 'Fresh-Pass-1', B),
    await register('auth.student', 'Fresh-Pass-1', '0'.repeat(32))
  ];
  for (const f of fails) assert.strictEqual(f.sig, fails[0].sig, 'invalid invite responses identical');
  assert.strictEqual(fails[0].status, 422);
  assert.strictEqual(fails[0].text, '{"ok":false,"hata":"kayit_basarisiz"}');
  assert.strictEqual(await authCount(), before, 'invalid/expired/exhausted invite creates no Auth user');
  assert.strictEqual(auth.creates, creates0, 'Admin API never called before a valid invite pre-check');
  assert.strictEqual(await q(`select string_agg(etiket||'='||kullanim_sayisi, ',' order by etiket) from public.davet_kodlari;`), counts,
    'failed registrations consume no invite');
  console.log('PASS T37 (valid student/teacher; invalid/expired/exhausted/no-name identical, no Auth user, no consumption)');

  // ======================= T38 REPLAY + CONCURRENCY =======================
  r = await register('replay.user', 'Replay-Pass-1', F);
  assert.strictEqual(r.status, 200, r.text);
  before = await authCount();
  const creates1 = auth.creates;
  const rep1 = await register('replay.user', 'Replay-Pass-1', F);
  const rep2 = await register('replay.user2', 'Replay-Pass-1', F);
  const rep3 = await register('replay.user', 'Replay-Pass-1', A);
  for (const x of [rep1, rep2, rep3]) assert.strictEqual(x.sig, fails[0].sig, 'replay rejected identically');
  assert.strictEqual(await invite('boundary replay'), 1, 'replay never re-consumes');
  assert.strictEqual(await authCount(), before, 'replay creates no Auth user');
  assert.strictEqual(auth.creates, creates1, 'replay never reaches Admin API');
  before = await authCount();
  const race = await Promise.all([register('race.slot1', 'Race-Pass-1', E), register('race.slot2', 'Race-Pass-1', E)]);
  assert.strictEqual(race.filter(x => x.status === 200).length, 1, 'exactly one last-slot winner');
  assert.strictEqual(await invite('boundary last slot'), 1, 'last slot consumed once');
  assert.strictEqual(await authCount(), before + 1, 'loser Auth user compensated (no orphan)');
  before = await authCount();
  const same = await Promise.all([register('race.same', 'Race-Pass-1', A), register('race.same', 'Race-Pass-1', A)]);
  assert.strictEqual(same.filter(x => x.status === 200).length, 1, 'same-username race: one winner');
  assert.strictEqual(await authCount(), before + 1, 'same-username loser compensated');
  console.log('PASS T38 (replay x3 rejected; concurrent last slot and same-username races: one winner, no orphan)');

  // ======================= T39 CONSISTENCY =======================
  const inviteA = await invite('boundary student');
  // (a) Auth created, profile insert fails -> rollback + Auth user deleted.
  await q(`create function runtime_test.fail_profile() returns trigger language plpgsql as $f$
    begin if new.username='fail.profile' then raise exception 'synthetic profile failure'; end if; return new; end $f$;
    create trigger zz_fail_profile before insert on public.profiles for each row execute function runtime_test.fail_profile();`);
  before = await authCount();
  r = await register('fail.profile', 'Fail-Pass-1', A);
  assert.strictEqual(r.sig, fails[0].sig);
  assert.strictEqual(await authCount(), before, 'Auth user of failed profile deleted');
  assert.strictEqual(await invite('boundary student'), inviteA, 'failed profile consumes no invite');
  // (b) compensation itself fails -> inert orphan: no profile, no stamp, not resolvable, cleanup query finds it.
  faults.deleteFails = true;
  r = await register('fail.profile', 'Fail-Pass-1', A);
  faults.deleteFails = false;
  assert.strictEqual(r.sig, fails[0].sig);
  assert.strictEqual(await q(orphanQuery + ';'), '1', 'cleanup query lists the inert orphan');
  assert.strictEqual(await q(`select count(*) from public.davet_dogrulamalari d join auth.users u on u.id=d.user_id
    left join public.profiles p on p.id=u.id where p.id is null;`), '0', 'orphan has no invite stamp');
  assert.strictEqual(await invite('boundary student'), inviteA, 'orphan consumed no invite');
  assert.ok(logs.some(l => l[0] === 'kayit_telafi_basarisiz'), 'operator log records failed compensation');
  // (e) finalize failed and the profile check itself errors -> fail closed:
  //     report failure, never delete a possibly-complete registration.
  faults.statusUnknown = true;
  r = await register('fail.profile', 'Fail-Pass-1', A);
  faults.statusUnknown = false;
  assert.strictEqual(r.sig, fails[0].sig);
  assert.strictEqual(await q(orphanQuery + ';'), '2', 'unknown state keeps the inert Auth user for cleanup');
  assert.ok(logs.some(l => l[0] === 'kayit_durumu_belirsiz'));
  assert.strictEqual(await invite('boundary student'), inviteA, 'unknown state consumed no invite');
  // Operator cleanup (documented query; real deletion via Admin API).
  await q(`drop trigger zz_fail_profile on public.profiles; drop function runtime_test.fail_profile();
    delete from auth.users u where not exists(select 1 from public.profiles p where p.id=u.id)
      and u.email like 'u.%@auth.sosyolab.local' and u.created_at > (select min(created_at) from runtime_test.t32_start);`);
  assert.strictEqual(await q(orphanQuery + ';'), '0');
  // (c) DB committed but response lost -> profile found, success, nothing deleted.
  faults.finalizeResponseLost = true;
  before = await authCount();
  r = await register('lost.response', 'Lost-Pass-1', A);
  faults.finalizeResponseLost = false;
  assert.strictEqual(r.status, 200, r.text);
  assert.strictEqual(await authCount(), before + 1);
  assert.strictEqual(await q(`select count(*) from public.profiles where username='lost.response';`), '1');
  assert.strictEqual(await invite('boundary student'), inviteA + 1, 'lost response: invite consumed exactly once');
  // (d) Auth creation fails -> nothing changes.
  faults.createFails = true;
  before = await authCount();
  r = await register('create.fails', 'Create-Pass-1', A);
  faults.createFails = false;
  assert.strictEqual(r.sig, fails[0].sig);
  assert.strictEqual(await authCount(), before);
  assert.strictEqual(await invite('boundary student'), inviteA + 1);
  // (f) profile without Auth cannot exist: FK + cascade.
  await q(`select runtime_test.denied($q$select public.kullanici_kaydi_tamamla(gen_random_uuid(),'no.auth.user',repeat('A',32))$q$,'P0001','Kayıt kimliği geçersiz');`, 'service_role');
  await q(`delete from auth.users where id=(select id from public.profiles where username='lost.response');`);
  assert.strictEqual(await q(`select count(*) from public.profiles where username='lost.response';`), '0', 'Auth delete cascades profile');
  assert.strictEqual(await q(orphanQuery + ';'), '0', 'no orphan Auth user left by the boundary');
  console.log('PASS T39 (profile failure compensated; failed compensation / unknown state inert+listed; lost response idempotent; create failure clean; no profile without Auth)');

  // ======================= T35 LOGIN SUCCESS =======================
  const okCases = [['auth.student', PW.student], ['  Auth.Student ', PW.student], ['AUTH.PENDING', PW.pending],
    ['auth.approved', PW.approved], ['legacy.teacher', PW.legacy], ['sosyolog35', PW.admin], [' SOSYOLOG.35 ', PW.admin]];
  for (const [u, p] of okCases) {
    const x = await login(u, p);
    assert.strictEqual(x.status, 200, `${u}: ${x.text}`);
    const b = JSON.parse(x.text);
    assert.deepStrictEqual(Object.keys(b).sort(), ['ok', 'oturum']);
    assert.deepStrictEqual(Object.keys(b.oturum).sort(), ['access_token', 'expires_at', 'expires_in', 'refresh_token', 'token_type']);
    assert.ok(!x.text.includes('@'), 'session response carries no email');
  }
  console.log('PASS T35 (student, case/space variant, pending, approved, backfilled legacy, admin alias: session only)');

  // ======================= T36 LOGIN ENUMERATION =======================
  const rnd = n => Array.from({ length: n }, (_, i) => 'cand' + require('crypto').randomBytes(5).toString('hex').slice(0, 6 + (i % 4)));
  const existingWrong = [['auth.student', 'Wrong-Pass-9'], ['auth.pending', 'Wrong-Pass-9'], ['auth.approved', 'Wrong-Pass-9'],
    ['legacy.teacher', 'Wrong-Pass-9'], [' Auth.Student ', 'Wrong-Pass-9'], ['student.user', 'Wrong-Pass-9']];
  const missing = [['no.such.user', 'Random-Pass-7'], ['ghost.user', 'Random-Pass-7'], [' Ghost.User ', 'Random-Pass-7'],
    ['legacy.anon', 'Random-Pass-7'], ...rnd(8).map(u => [u, 'Random-' + u])];
  const ex = [], mi = [];
  for (let i = 0; i < Math.max(existingWrong.length, missing.length); i++) {
    if (existingWrong[i]) ex.push(await login(...existingWrong[i]));
    if (missing[i]) mi.push(await login(...missing[i]));
  }
  for (const x of [...ex, ...mi]) {
    assert.strictEqual(x.sig, ex[0].sig, 'existing+wrong vs missing: identical status/headers/body');
  }
  assert.strictEqual(ex[0].status, 401);
  assert.strictEqual(ex[0].text, '{"ok":false,"hata":"giris_basarisiz"}');
  const all = [...ex, ...mi].map(x => x.ms);
  assert.ok(Math.min(...all) >= FLOOR - 5, 'every failure waits for the floor');
  assert.ok(Math.max(...all) - Math.min(...all) < 150, `padded timing spread ${Math.round(Math.max(...all) - Math.min(...all))}ms`);
  const dPad = Math.abs(median(ex.map(x => x.ms)) - median(mi.map(x => x.ms)));
  assert.ok(dPad < 40, `padded median difference ${dPad.toFixed(1)}ms`);
  assert.ok(!logs.some(l => l[0] === 'giris_taban_asildi'), 'real work stayed under the floor');
  // Without the floor the model's bcrypt-only-for-existing difference is visible:
  // proves the floor (not luck) removes the timing channel.
  const rawEx = [], rawMi = [];
  for (let i = 0; i < 8; i++) {
    rawEx.push((await login('auth.student', 'Wrong-Pass-9', ham)).ms);
    rawMi.push((await login('cand' + i + 'zz', 'Random-Pass-7', ham)).ms);
  }
  console.log(`INFO T36 padded median diff=${dPad.toFixed(1)}ms spread=${Math.round(Math.max(...all) - Math.min(...all))}ms; unpadded median existing=${median(rawEx).toFixed(0)}ms missing=${median(rawMi).toFixed(0)}ms`);
  console.log('PASS T36 (existing+wrong vs missing/random/variants: byte-identical 401, equal padded timing)');

  // ======================= T32 IDENTITY NEVER REACHES THE CLIENT =======================
  for (const o of observed) {
    assert.ok(!o.text.includes('auth.sosyolab.local') && !o.text.includes(adminEmail), 'no internal identity in any response');
  }
  for (const role of ['anon', 'authenticated']) {
    for (const u of ['auth.student', 'no.such.user']) {
      await q(`select runtime_test.denied($q$select public.kullanici_email_bul(${lit(u)})$q$,'42501');
        select runtime_test.denied($q$select public.kayit_on_kontrol(${lit(u)},repeat('A',32))$q$,'42501');`, role);
    }
  }
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  for (const bad of ['auth.signUp(', 'signInWithPassword(', 'signInWithOtp(', 'rpc("kullanici_email_bul"', 'auth.sosyolab.local', 'sosyolog.35@', 'auth_login_email']) {
    assert.ok(!app.includes(bad), `browser code must not contain ${bad}`);
  }
  // F-04 at the privilege layer (not string matching): a signed-in member can
  // read its own profile row, but never the internal identity column, not even
  // its own, and not via select *. Same for anon. Admin RLS bypass is moot:
  // the column privilege is missing for the whole authenticated role.
  await q(`select set_config('request.jwt.claims', json_build_object('sub',
      (select id from public.profiles where username='auth.student'))::text, false);
    set role authenticated;
    select runtime_test.assert_true((select username='auth.student' from public.profiles where id=auth.uid()),'own row readable');
    select runtime_test.denied($q$select auth_login_email from public.profiles where id=auth.uid()$q$,'42501');
    select runtime_test.denied($q$select * from public.profiles$q$,'42501');
    select runtime_test.denied($q$select p from public.profiles p$q$,'42501');
    reset role;
    select runtime_test.login(1); set role authenticated;
    select runtime_test.assert_true(public.is_admin(),'fixture 1 is admin');
    select runtime_test.denied($q$select auth_login_email from public.profiles$q$,'42501');
    reset role; set role anon;
    select runtime_test.denied($q$select auth_login_email from public.profiles$q$,'42501');
    select runtime_test.denied($q$select id from public.profiles$q$,'42501');`);
  for (const m of app.matchAll(/from\("profiles"\)\s*\.select\("([^"]*)"\)/g)) {
    assert.ok(!/auth_login_email|\*/.test(m[1]), 'browser profile select must not request internal identity: ' + m[1]);
  }
  console.log(`PASS T32 (${observed.length} boundary responses carry no identity; resolver/peek 42501 for clients; browser has no Auth identity path)`);

  // ======================= T33 PUBLIC SIGNUP DISABLED =======================
  const realEmail = await q(`select auth_login_email from public.profiles where username='auth.student';`);
  const legacyEmail = await q(`select auth_login_email from public.profiles where username='legacy.teacher';`);
  before = await authCount();
  const probes = [realEmail, legacyEmail, core.yeniKayitKimligi(() => require('crypto').randomUUID()),
    'u.' + require('crypto').createHash('md5').update('login:auth.student:v2').digest('hex') + '@auth.sosyolab.local'];
  const su = [];
  for (const e of probes) su.push(await auth.publicSignup(e, 'Probe-Pass-1'));
  for (const s of su) assert.deepStrictEqual(s, su[0], 'signup disabled: identical rejection for existing and missing identity');
  assert.strictEqual(su[0].body.error_code, 'signup_disabled');
  assert.strictEqual(await authCount(), before, 'public signup creates no Auth user (no orphan)');
  console.log('PASS T33 (public signup disabled: existing/missing/offline-candidate identities rejected identically, no user created)');

  // ======================= T34 DEFENSE IN DEPTH: SIGNUP MISCONFIGURED ON =======================
  // Even if signup were re-enabled, the attacker has no identity to probe:
  // every identity it can compute or guess is not an account.
  auth.signupEnabled = true;
  const shape = h => 'u.' + h.slice(0, 12) + '4' + h.slice(13, 16) + '89ab'[parseInt(h[32] || '0', 16) % 4] + h.slice(17, 32) + '@auth.sosyolab.local';
  const crypto = require('crypto');
  const cands = [];
  for (const u of ['auth.student', 'auth.pending', 'auth.approved', 'legacy.teacher', 'student.user', 'no.such.user']) {
    cands.push('u.' + crypto.createHash('md5').update('login:' + u + ':v2').digest('hex') + '@auth.sosyolab.local');
    cands.push(shape(crypto.createHash('sha256').update('login:v3:' + u).digest('hex')));
    cands.push(shape(crypto.createHmac('sha256', '').update('login:v3:' + u).digest('hex')));
  }
  for (let i = 0; i < 40; i++) cands.push(core.yeniKayitKimligi(() => crypto.randomUUID()));
  before = await authCount();
  const hits = [];
  for (const e of cands) { const s = await auth.publicSignup(e, 'Probe-Pass-1'); if (s.body.error_code === 'user_already_exists') hits.push(e); }
  auth.signupEnabled = false;
  assert.deepStrictEqual(hits, [], 'no attacker-computable identity names an existing account');
  assert.strictEqual(await authCount(), before + cands.length);
  await q(`delete from auth.users where email in (${cands.map(lit).join(',')});`);
  console.log(`PASS T34 (signup misconfigured on: ${cands.length} offline/guessed identities, 0 existence signals)`);

  // ======================= T40 RETRY + HTTP SURFACE + ADAPTER =======================
  before = await authCount();
  const inv = await invite('boundary student');
  r = await register('auth.student', PW.student, A);
  assert.strictEqual(r.sig, fails[0].sig, 'retry after success rejected');
  assert.strictEqual(await invite('boundary student'), inv, 'retry after success consumes nothing');
  r = await register('retry.user', 'Retry-Pass-1', 'SYNTHETIC-WRONG');
  assert.strictEqual(r.status, 422);
  r = await register('retry.user', 'Retry-Pass-1', A);
  assert.strictEqual(r.status, 200, 'retry after failure succeeds');
  assert.strictEqual(await invite('boundary student'), inv + 1);
  assert.strictEqual(await authCount(), before + 1);
  assert.strictEqual((await login('retry.user', 'Retry-Pass-1')).status, 200);
  const pre = await call(sinir.handleLogin, null, { method: 'OPTIONS' });
  assert.strictEqual(pre.status, 204);
  assert.ok(pre.headers.includes('access-control-allow-origin:' + ORIGIN));
  assert.strictEqual((await call(sinir.handleLogin, {}, { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.strictEqual((await call(sinir.handleLogin, null, { method: 'GET' })).status, 405);
  const bad = [await call(sinir.handleLogin, '{not json'), await call(sinir.handleLogin, { kullanici_adi: 'auth.student' }),
    await call(sinir.handleLogin, { kullanici_adi: 'no.such.user' }), await call(sinir.handleLogin, 'x'.repeat(5000))];
  for (const b of bad) assert.strictEqual(b.sig, bad[0].sig, 'malformed requests identical (shape-only)');
  assert.strictEqual(bad[0].status, 400);
  // Adapter: real Supabase REST/Auth wiring with a fake fetch (no network).
  const sent = [];
  const fakeFetch = async (url, init) => {
    sent.push({ url, init });
    const u = new URL(url);
    const reply = (status, body) => new Response(JSON.stringify(body), { status });
    if (u.pathname === '/rest/v1/rpc/kullanici_email_bul') return reply(200, 'u.0123456789ab4cde8f0123456789abcd@auth.sosyolab.local');
    if (u.pathname === '/auth/v1/token') return reply(400, { error_code: 'invalid_credentials' });
    if (u.pathname === '/rest/v1/rpc/kayit_on_kontrol') return reply(200, true);
    if (u.pathname === '/auth/v1/admin/users' && init.method === 'POST') return reply(200, { id: '11111111-1111-4111-8111-111111111111' });
    if (u.pathname === '/rest/v1/rpc/kullanici_kaydi_tamamla') return reply(400, { code: 'P0001' });
    if (u.pathname === '/rest/v1/rpc/istek_siniri_tuket') return reply(200, true);
    if (u.pathname === '/rest/v1/rpc/kayit_sonucunu_kesinlestir') return reply(200, { durum: 'iptal' });
    if (u.pathname.startsWith('/auth/v1/admin/users/') && init.method === 'DELETE') return reply(200, {});
    return reply(404, {});
  };
  const serviceKey = 'dummy-service-key-for-local-test-only';
  const anonKey = 'dummy-publishable-key-for-local-test-only';
  const live = core.createAuthBoundary(
    Object.assign(core.supabaseDeps({ url: 'https://project.example', anonKey, serviceKey, ipForwarding: 'disabled', fetchImpl: fakeFetch }), { log: () => {} }),
    { allowedOrigins: [ORIGIN], adminEmail, loginFloorMs: 0, registerFloorMs: 0 });
  const l1 = await call(live.handleLogin, { kullanici_adi: 'someone', parola: 'x' });
  const k1 = await call(live.handleRegister, { kullanici_adi: 'some.one', parola: 'Some-Pass-1', davet_kodu: A });
  assert.strictEqual(l1.status, 401);
  assert.strictEqual(k1.status, 422);
  const byPath = p => sent.filter(s => new URL(s.url).pathname.startsWith(p));
  assert.strictEqual(byPath('/auth/v1/token')[0].init.headers.apikey, anonKey, 'password grant uses the public key');
  assert.ok(!('authorization' in byPath('/auth/v1/token')[0].init.headers));
  assert.strictEqual(JSON.parse(byPath('/auth/v1/admin/users')[0].init.body).email_confirm, true);
  assert.ok(core.KANONIK_KIMLIK.test(JSON.parse(byPath('/auth/v1/admin/users')[0].init.body).email), 'server generates canonical identity');
  assert.strictEqual(byPath('/auth/v1/admin/users/').filter(s => s.init.method === 'DELETE').length, 1, 'adapter compensates via Admin API');
  for (const o of [l1, k1, ...observed]) assert.ok(!o.text.includes(serviceKey) && !o.headers.includes(serviceKey), 'service key never in a response');
  assert.strictEqual(byPath('/rest/v1/rpc/kayit_sonucunu_kesinlestir').length, 1, 'compensation only after DB reconciliation');
  assert.throws(() => core.supabaseDeps({ url: 'https://project.example', anonKey, serviceKey: '', ipForwarding: 'disabled', fetchImpl: fakeFetch }), /eksik/);
  const jwtLike = core.supabaseDeps({ url: 'https://p.example', anonKey, serviceKey: 'eyJ' + 'x'.repeat(10), ipForwarding: 'disabled', fetchImpl: fakeFetch });
  await jwtLike.rpc('kullanici_email_bul', { p_username: 'x' });
  assert.strictEqual(sent[sent.length - 1].init.headers.authorization, 'Bearer eyJ' + 'x'.repeat(10), 'legacy JWT key also sent as bearer');
  console.log('PASS T40 (retry after success/failure; CORS/405/403/400 shape-only; Supabase adapter wiring, fail-closed config, no key leak)');

  await q('drop table runtime_test.t32_start;');
};
