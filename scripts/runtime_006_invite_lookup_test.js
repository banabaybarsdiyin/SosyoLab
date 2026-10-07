'use strict';
// T52: F-02 invite lookup = one HMAC + indexed equality (no per-request bcrypt
//      loop). Proven by crypt() call counting, cost scaling over 1/5/25 active
//      codes, query plan, privilege checks and a bcrypt-loop mutant.
// T53: F-06 registration reconciliation: kayit_sonucunu_kesinlestir waits for
//      an in-flight finalize (same advisory lock) and, when it cancels, a late
//      finalize can never consume the invite.
// Disposable PG16 only; runs last in runtime_006_security_test.js.
const assert = require('assert');
const { spawn } = require('child_process');

const lit = v => (v === null || v === undefined) ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
const pause = ms => new Promise(r => setTimeout(r, ms));

module.exports = async function inviteLookup({ name }) {
  function psql(source, role, keepOpen = false) {
    const child = spawn('docker', ['exec', '-i', name, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1']);
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', d => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', d => { stderr += d; });
    const done = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', status => resolve({ status, stdout: stdout.trim(), stderr }));
    });
    child.stdin.write(`set statement_timeout='30s';\n${role ? `set role ${role};\n` : ''}${source}\n`);
    if (!keepOpen) child.stdin.end();
    return { child, done, out: () => stdout };
  }
  async function q(source, role) {
    const r = await psql(source, role).done;
    if (r.status !== 0) throw new Error(`SQL failed: ${r.stderr}`);
    return r.stdout;
  }
  async function until(pred, label) {
    const end = Date.now() + 15000;
    while (Date.now() < end) { if (await pred()) return; await pause(100); }
    throw new Error('Timed out: ' + label);
  }

  // ======================= T53 F-06 RECONCILIATION =======================
  const KOD = '0123456789ABCDEF0123456789ABCDEF';
  await q(`select public.admin_davet_kodu_olustur(${lit(KOD)},'student',2::smallint,'reconcile slot',null,10);`);
  const used = async () => Number(await q(`select kullanim_sayisi from public.davet_kodlari where etiket='reconcile slot';`));
  const newAuthUser = async () => q(`insert into auth.users(id,email,encrypted_password,is_anonymous)
    values (gen_random_uuid(),'u.'||replace(gen_random_uuid()::text,'-','')||'@auth.sosyolab.local','x',false) returning id;`);
  const finalizeSql = (uid, user) => `select public.kullanici_kaydi_tamamla(${lit(uid)}::uuid,${lit(user)},${lit(KOD)},null);`;
  const reconcileSql = uid => `select public.kayit_sonucunu_kesinlestir(${lit(uid)}::uuid)->>'durum';`;
  const waitingOnLock = app => async () => (await q(`select count(*) from pg_stat_activity
    where application_name=${lit(app)} and wait_event_type='Lock';`)) === '1';

  // (a) finalize in flight (holds the lock, profile inserted, not committed):
  //     reconciliation waits, then sees the committed profile -> 'tamam'.
  let uid = await newAuthUser();
  let u0 = await used();
  let fin = psql(`begin;\n${finalizeSql(uid, 'inflight.ok')}\nselect 'HELD';`, 'service_role', true);
  await until(async () => fin.out().includes('HELD'), 'finalize holding lock');
  let rec = psql(`set application_name='t53_reconcile_a';\n${reconcileSql(uid)}`, 'service_role');
  await until(waitingOnLock('t53_reconcile_a'), 'reconcile waits for in-flight finalize');
  fin.child.stdin.end('commit;\n');
  assert.strictEqual((await fin.done).status, 0);
  let res = await rec.done;
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.split('\n').pop(), 'tamam', 'in-flight commit reconciled as success (no delete)');
  assert.strictEqual(await used(), u0 + 1);
  assert.strictEqual(await q(`select count(*) from sosyolab_private.kayit_iptalleri where user_id=${lit(uid)}::uuid;`), '0');

  // (b) finalize in flight then rolls back: reconciliation -> 'iptal', no quota used.
  uid = await newAuthUser();
  u0 = await used();
  fin = psql(`begin;\n${finalizeSql(uid, 'inflight.rb')}\nselect 'HELD';`, 'service_role', true);
  await until(async () => fin.out().includes('HELD'), 'finalize holding lock');
  rec = psql(`set application_name='t53_reconcile_b';\n${reconcileSql(uid)}`, 'service_role');
  await until(waitingOnLock('t53_reconcile_b'), 'reconcile waits');
  fin.child.stdin.end('rollback;\n');
  await fin.done;
  res = await rec.done;
  assert.strictEqual(res.stdout.split('\n').pop(), 'iptal');
  assert.strictEqual(await used(), u0, 'rolled back finalize consumed nothing');

  // (c) reconciliation first (response lost before finalize ran): late finalize
  //     is refused -> deleting the Auth user cannot strand a consumed invite.
  uid = await newAuthUser();
  u0 = await used();
  assert.strictEqual(await q(reconcileSql(uid), 'service_role'), 'iptal');
  await q(`select runtime_test.denied($q$${finalizeSql(uid, 'late.finalize')}$q$,'P0001','iptal edildi');`, 'service_role');
  assert.strictEqual(await used(), u0, 'late finalize after cancel consumes nothing');
  assert.strictEqual(await q(`select count(*) from public.profiles where username='late.finalize';`), '0');
  await q(`delete from auth.users where id=${lit(uid)}::uuid;`);
  assert.strictEqual(await q(`select count(*) from sosyolab_private.kayit_iptalleri where user_id=${lit(uid)}::uuid;`), '0', 'cancel marker cascades with the Auth user');
  // (d) client roles cannot reach the reconciliation / limiter / digest helpers.
  for (const role of ['anon', 'authenticated']) {
    await q(`select runtime_test.denied($q$select public.kayit_sonucunu_kesinlestir(gen_random_uuid())$q$,'42501');
      select runtime_test.denied($q$select public.istek_siniri_tuket('[]'::jsonb)$q$,'42501');
      select runtime_test.denied($q$select public.davet_arama_ozeti('x')$q$,'42501');`, role);
  }
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const t of ['sunucu_pepperlari', 'istek_sayaclari', 'kayit_iptalleri']) {
      await q(`select runtime_test.denied($q$select count(*) from sosyolab_private.${t}$q$,'42501');`, role);
    }
  }
  console.log('PASS T53 (reconcile waits for in-flight finalize: commit->tamam, rollback->iptal; cancel blocks late finalize; helpers/private tables closed)');

  // ======================= T52 F-02 INVITE LOOKUP =======================
  // crypt() calls inside one transaction (track_functions=all counts C functions).
  const cryptCalls = (stmt, role = 'service_role') => q(`begin;
    set local track_functions = 'all';
    set local role ${role};
    ${stmt};
    reset role;
    select 'CRYPT=' || coalesce(pg_stat_get_xact_function_calls('extensions.crypt(text,text)'::regprocedure), 0);
    commit;`).then(o => Number((o.match(/CRYPT=(\d+)/) || [])[1]));
  const invalidPrecheck = `select public.kayit_on_kontrol('lookup.user', repeat('0',32))`;
  // Positive control: the counter does see crypt().
  assert.ok(await cryptCalls(`select extensions.crypt('x', extensions.gen_salt('bf',4))`, 'postgres') >= 1, 'crypt counter works');

  async function aktifKodlar(n) {
    await q(`update public.davet_kodlari set aktif=false where aktif;
      do $$ begin for i in 1..${n} loop
        perform public.admin_davet_kodu_olustur(upper(md5(random()::text)),'student',1::smallint,'lookup perf',null,100);
      end loop; end $$;`);
  }
  async function avgMs(stmt, reps) {
    const r = await psql(`do $$ declare t timestamptz := clock_timestamp(); b boolean; begin
        for i in 1..${reps} loop b := ${stmt.replace(/^select /, '')}; end loop;
        raise notice 'MS=%', extract(epoch from clock_timestamp()-t)*1000/${reps}; end $$;`, 'service_role').done;
    return Number((r.stderr.match(/MS=([\d.]+)/) || [])[1]);
  }
  const timing = {};
  for (const n of [1, 5, 25]) {
    await aktifKodlar(n);
    assert.strictEqual(await cryptCalls(invalidPrecheck), 0, `${n} active codes: invalid precheck runs zero bcrypt`);
    timing[n] = await avgMs(invalidPrecheck, 20);
  }
  // Valid code path and finalize consume path: also zero bcrypt.
  await q(`update public.davet_kodlari set aktif=false where aktif;
    select public.admin_davet_kodu_olustur('FEEDFACEFEEDFACEFEEDFACEFEEDFACE','student',3::smallint,'lookup valid',null,5);`);
  assert.strictEqual(await cryptCalls(`select public.kayit_on_kontrol('lookup.valid', 'feedfacefeedfacefeedfacefeedface')`), 0, 'valid (case-insensitive) code: zero bcrypt');
  assert.strictEqual(await q(`select public.kayit_on_kontrol('lookup.valid', '  feedfacefeedfacefeedfacefeedface ');`, 'service_role'), 't');
  const fuid = await newAuthUser();
  assert.strictEqual(await cryptCalls(`select public.kullanici_kaydi_tamamla(${lit(fuid)}::uuid,'lookup.final','FEEDFACEFEEDFACEFEEDFACEFEEDFACE',null)`), 0, 'finalize consume: zero bcrypt');
  assert.strictEqual(await q(`select kullanim_sayisi from public.davet_kodlari where etiket='lookup valid';`), '1');

  // Cost must not scale with the number of active codes (bcrypt loop was ~linear).
  console.log(`INFO T52 invalid precheck avg ms: 1 code=${timing[1].toFixed(2)} 5 codes=${timing[5].toFixed(2)} 25 codes=${timing[25].toFixed(2)}`);
  assert.ok(timing[25] < timing[1] * 3 + 2, `cost grows with active codes: ${JSON.stringify(timing)}`);

  // Query plan uses the unique digest index (with a realistically large table).
  await q(`insert into public.davet_kodlari (kod_ozeti, kod_arama_ozeti, aktif, audience_type, etiket)
    select (select extensions.crypt('x', extensions.gen_salt('bf',4))), extensions.gen_random_bytes(32), false, 'legacy', 'plan fixture'
      from generate_series(1,3000);
    analyze public.davet_kodlari;`);
  // plpgsql passes the digest as a value (custom plan), so plan with a constant.
  const digest = await q(`select encode(public.davet_arama_ozeti('0000'),'hex');`);
  const plan = await q(`explain (format json) select d.audience_type from public.davet_kodlari d
    where d.kod_arama_ozeti = '\\x${digest}'::bytea and d.aktif and d.audience_type in ('student','teacher')
      and (d.gecerlilik_sonu is null or d.gecerlilik_sonu > now())
      and (d.azami_kullanim is null or d.kullanim_sayisi < d.azami_kullanim);`);
  assert.ok(!plan.includes('Seq Scan') && plan.includes('Index'), 'full lookup query is index-driven, never a table scan: ' + plan.replace(/\s+/g, ' ').slice(0, 300));
  const planOzet = await q(`explain (format json) select 1 from public.davet_kodlari d where d.kod_arama_ozeti = '\\x${digest}'::bytea;`);
  assert.ok(planOzet.includes('davet_kodlari_arama_ozeti_unique'), 'digest equality uses the unique digest index: ' + planOzet.replace(/\s+/g, ' ').slice(0, 300));
  await q(`delete from public.davet_kodlari where etiket='plan fixture'; analyze public.davet_kodlari;`);

  // Storage contract: digest is a keyed 32-byte HMAC, unique, required for active
  // student/teacher codes; plaintext and unkeyed hashes never match it.
  assert.strictEqual(await q(`select count(*) from public.davet_kodlari
    where audience_type in ('student','teacher') and (kod_arama_ozeti is null or octet_length(kod_arama_ozeti)<>32);`), '0');
  assert.strictEqual(await q(`select count(*) from public.davet_kodlari where etiket='lookup valid' and (
      kod_arama_ozeti = convert_to('FEEDFACEFEEDFACEFEEDFACEFEEDFACE','UTF8')
      or kod_arama_ozeti = extensions.digest('FEEDFACEFEEDFACEFEEDFACEFEEDFACE','sha256')
      or kod_arama_ozeti = extensions.digest('davet:v1:FEEDFACEFEEDFACEFEEDFACEFEEDFACE','sha256')
      or kod_arama_ozeti = extensions.hmac('davet:v1:FEEDFACEFEEDFACEFEEDFACEFEEDFACE','','sha256'));`), '0', 'digest is keyed (not plaintext/unkeyed hash)');
  await q(`select runtime_test.denied($q$insert into public.davet_kodlari (kod_ozeti, aktif, audience_type, class_year)
      values ((select kod_ozeti from public.davet_kodlari limit 1), true, 'student', 1)$q$,'23514');
    select runtime_test.denied($q$select public.admin_davet_kodu_olustur('FEEDFACEFEEDFACEFEEDFACEFEEDFACE','teacher',null)$q$,'23505');`);

  // Mutation: restore the old bcrypt-loop precheck -> the zero-bcrypt contract FAILS.
  const orig = await q(`select pg_get_functiondef('public.kayit_on_kontrol(text,text,text)'::regprocedure);`);
  const mutant = orig.replace(/v_ozet := public\.davet_arama_ozeti\(v_kod\);\s*select d\.audience_type\s*into v_audience\s*from public\.davet_kodlari d\s*where d\.kod_arama_ozeti = v_ozet/,
    `select d.audience_type into v_audience from public.davet_kodlari d where d.kod_ozeti = extensions.crypt(v_kod, d.kod_ozeti)`);
  assert.notStrictEqual(mutant, orig, 'bcrypt-loop mutant applied');
  await aktifKodlar(5);
  await q(mutant);
  const mutantCalls = await cryptCalls(invalidPrecheck);
  const mutantMs = await avgMs(invalidPrecheck, 2);
  await q(orig);
  assert.ok(mutantCalls >= 5, `bcrypt-loop mutant detected (${mutantCalls} crypt calls)`);
  assert.strictEqual(await cryptCalls(invalidPrecheck), 0, 'restored function: zero bcrypt');
  console.log(`INFO T52 bcrypt-loop mutant, 5 active codes: ${mutantCalls} crypt calls, avg ${mutantMs.toFixed(0)} ms`);
  console.log('PASS T52 (invite lookup: 0 bcrypt per precheck/finalize, cost flat over 1/5/25 codes, digest index in plan, keyed digest, bcrypt-loop mutant detected)');
  await q(`update public.davet_kodlari set aktif=false where etiket in ('lookup perf','lookup valid');`);
};
