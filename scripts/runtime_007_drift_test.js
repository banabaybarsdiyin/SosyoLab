#!/usr/bin/env node
'use strict';
// 007 production-drift harness. Disposable Docker PostgreSQL only
// (--network none, no ports, synthetic data); never connects to Supabase.
//
// Reconstructs the OBSERVED old production state: HEAD schema + 001..005
// (unchanged since) + the historical 006 of git c1f3068 / a0e4931, seeded
// with production-SHAPED synthetic data (16 Auth users, 15 profiles with
// username NULL, 1 profile-less Auth user, admin=1, user=14, 1 inactive
// legacy invite). Applies 007 and proves:
//   * old-006 -> 007 converges to the catalog of a clean 005 -> final 006
//     install (functions+ACL, columns, column ACL, constraints, indexes,
//     policies, triggers, schema ACL), with all rows preserved,
//   * 007 twice / clean final 006 -> 007: idempotent, peppers preserved,
//   * unexpected drift: precondition RAISE, full rollback (catalog + data),
//   * postcondition mutants (ACL / privilege / data loss) are caught,
//   * security contract 5..16 and the operator backfill template.
// Runs for every privilege mode below and for postgres:16 and postgres:17
// (images must already exist locally; this harness never pulls).
// Historical 006 versions are read from git objects; a shallow clone fails.
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const read = f => require('fs').readFileSync(path.join(root, f), 'utf8');
const git = args => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 << 20 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed (shallow clone?): ${r.stderr}`);
  return r.stdout;
};
const OLD_006 = { c1f3068: git(['show', 'c1f3068:supabase/migrations/006_self_registration_invites.sql']),
                  a0e4931: git(['show', 'a0e4931:supabase/migrations/006_self_registration_invites.sql']) };
const M006 = read('supabase/migrations/006_self_registration_invites.sql');
const M007 = read('supabase/migrations/007_production_006_reconciliation.sql');
const BASE = ['001_davet_kodlari', '002_denetim_kaydi', '003_launch_gate_hardening',
  '004_revoke_public_table_ddl_privs', '005_teacher_role'].map(f => read(`supabase/migrations/${f}.sql`));

// production: tables get hosted-style default grants, functions get none
//             (observed: service_role EXECUTE=false on old-006 functions).
// hosted-defaults: functions ALSO default-granted to anon/authenticated/service_role.
const MODES = {
  production: `alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`,
  'hosted-defaults': `alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`
};

function harness(image) {
  const name = `sosyolab-007-drift-${process.pid}-${Date.now()}`;
  const docker = (args, input, allowFailure = false) => {
    const r = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 120000, maxBuffer: 16 << 20 });
    if (!allowFailure && (r.error || r.status !== 0)) throw new Error(`docker ${args.slice(0, 3).join(' ')} failed: ${r.error || r.stderr || r.stdout}`);
    return r;
  };
  const psql = (db, source, { allowFailure = false, vars = {} } = {}) => {
    const v = Object.entries(vars).flatMap(([k, val]) => ['-v', `${k}=${val}`]);
    return docker(['exec', '-i', name, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', db,
      '-v', 'ON_ERROR_STOP=1', ...v], `set statement_timeout='60s';\n${source}`, allowFailure);
  };
  const q = (db, source) => psql(db, source).stdout.trim();
  const copy = (from, to) => psql('postgres', `create database "${to}" template "${from}";`);

  const CATALOG = `
select string_agg(x, E'\\n' order by x) from (
  select 'F ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') '
      || md5(p.prosrc) || ' sd=' || p.prosecdef || ' vol=' || p.provolatile::text
      || ' cfg=' || coalesce(array_to_string(p.proconfig, ','), '') || ' ret=' || pg_get_function_result(p.oid)
      || ' owner=' || pg_get_userbyid(p.proowner) || ' acl=' || coalesce((select string_agg(g, ',' order by g) from (
           select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || ':' || a.privilege_type g
             from aclexplode(p.proacl) a) z), 'DEFAULT')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'sosyolab_private')
  union all
  select 'C ' || table_schema || '.' || table_name || '.' || column_name || ' #' || ordinal_position || ' ' || data_type
      || ' ' || is_nullable || ' ' || coalesce(column_default, '')
    from information_schema.columns where table_schema in ('public', 'sosyolab_private')
  union all
  select 'R ' || n.nspname || '.' || c.relname || ' k=' || c.relkind::text || ' rls=' || c.relrowsecurity || ' acl='
      || coalesce((select string_agg(g, ',' order by g) from (
           select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || ':' || a.privilege_type g
             from aclexplode(c.relacl) a) z), 'DEFAULT')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'sosyolab_private') and c.relkind in ('r', 'v', 'm', 'S', 'p')
  union all
  select 'CA ' || n.nspname || '.' || c.relname || '.' || at.attname || ' ' || (select string_agg(g, ',' order by g) from (
           select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || ':' || a.privilege_type g
             from aclexplode(at.attacl) a) z)
    from pg_attribute at join pg_class c on c.oid = at.attrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'sosyolab_private') and at.attnum > 0 and not at.attisdropped and at.attacl is not null
  union all
  select 'K ' || conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace in (select oid from pg_namespace where nspname in ('public', 'sosyolab_private'))
  union all
  select 'I ' || schemaname || '.' || indexname || ' ' || indexdef from pg_indexes where schemaname in ('public', 'sosyolab_private')
  union all
  select 'P ' || schemaname || '.' || tablename || '.' || policyname || ' ' || permissive || ' ' || array_to_string(roles, ',')
      || ' ' || cmd || ' ' || coalesce(qual, '') || ' | ' || coalesce(with_check, '')
    from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'T ' || tgrelid::regclass || ' ' || tgname || ' ' || pg_get_triggerdef(oid) || ' en=' || tgenabled::text
    from pg_trigger where not tgisinternal
  union all
  select 'N ' || nspname || ' acl=' || coalesce(nspacl::text, '') from pg_namespace
   where nspname in ('public', 'sosyolab_private', 'auth', 'storage', 'extensions')
) s(x);`;
  const DATA = `
select string_agg(x, E'\\n' order by x) from (
  select 'profiles ' || md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.profiles t
  union all select 'auth.users ' || md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from auth.users t
  union all select 'davet_kodlari ' || md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from (
    select (to_jsonb(k) - 'kod_arama_ozeti')::text as t from public.davet_kodlari k) t
  union all select 'davet_dogrulamalari ' || md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.davet_dogrulamalari t
  union all select 'materials ' || md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.materials t
  union all select 'teacher_courses ' || md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.teacher_courses t
  union all select 'storage.objects ' || md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from storage.objects t
  union all select 'counts ' || (select count(*) from auth.users) || '/' || (select count(*) from public.profiles)
      || '/' || (select count(*) from public.profiles t where to_jsonb(t)->>'username' is null)
      || '/' || (select count(*) from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id))
) s(x);`;
  const PEPPER = `select md5(string_agg(encode(x, 'hex'), ',' order by k)) from (
    select 'login' k, pepper x from sosyolab_private.login_pepper
    union all select ad, deger from sosyolab_private.sunucu_pepperlari) s;`;
  // Production-SHAPED synthetic data; no real value anywhere.
  const SEED = `
insert into auth.users(id, email, is_anonymous, raw_app_meta_data)
select runtime_test.identity(n),
       case when n = 16 then null when n = 1 then 'synthetic-admin@example.invalid'
            else 'synthetic-legacy-' || n || '@example.invalid' end,
       n = 16, jsonb_build_object('provider', case when n = 16 then 'anonymous' else 'email' end)
  from generate_series(1, 16) n;
insert into public.profiles(id, role, display_name)
select runtime_test.identity(n), case when n = 1 then 'admin' else 'user' end, 'Synthetic ' || n
  from generate_series(1, 15) n;
insert into public.davet_kodlari(kod_ozeti, etiket, azami_kullanim, aktif)
values (extensions.crypt('SYNTHETIC-LEGACY', extensions.gen_salt('bf', 4)), 'synthetic legacy', 1, false);
insert into public.davet_dogrulamalari(user_id, davet_id, ogrenci_no)
select runtime_test.identity(n), (select id from public.davet_kodlari where etiket = 'synthetic legacy'), null
  from generate_series(2, 6) n;
insert into storage.buckets(id, name, public) values ('materyaller', 'materyaller', false) on conflict do nothing;
-- Admin submits and approves one archive item (non-empty archive, so the
-- orphan "reads nothing" assertion cannot pass vacuously).
select runtime_test.login(1);
insert into public.materials(course_id, uploader_id, title, file_path, file_name)
values ('sos101', runtime_test.identity(1), 'Synthetic approved archive', runtime_test.identity(1) || '/arsiv.pdf', 'arsiv.pdf');
update public.materials set status = 'approved', reviewed_at = now(), reviewed_by = runtime_test.identity(1)
 where file_name = 'arsiv.pdf';
select set_config('request.jwt.claims', '', false);
select runtime_test.assert_true((select count(*) = 16 from auth.users) and (select count(*) = 15 from public.profiles)
  and (select count(*) = 15 from public.profiles where username is null)
  and (select count(*) = 1 from public.profiles where role = 'admin') and (select count(*) = 14 from public.profiles where role = 'user')
  and (select count(*) = 1 from public.davet_kodlari where audience_type = 'legacy' and not aktif)
  and (select count(*) = 1 from public.materials where status = 'approved'), 'production-shaped fixture');`;
  const apply007 = (db, source = M007) => psql(db, source, { allowFailure: true });
  const fingerprint = db => {
    const out = q(db, read('supabase/pre_007_fingerprint.sql'));
    return (out.split('\n').find(l => l.startsWith('durum|')) || '').split('|')[1];
  };

  let created = false;
  try {
    docker(['image', 'inspect', image]);
    docker(['run', '--detach', '--rm', '--name', name, '--network', 'none', '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', image]);
    created = true;
    const until = (pred, label) => {
      const end = Date.now() + 60000;
      while (Date.now() < end) { if (pred()) return; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300); }
      throw new Error('Timed out: ' + label);
    };
    until(() => /PostgreSQL init process complete/.test(docker(['logs', name], undefined, true).stdout), 'init');
    until(() => docker(['exec', name, 'pg_isready', '-U', 'postgres'], undefined, true).status === 0, 'ready');
    const version = q('postgres', 'show server_version;');
    console.log(`== ${image} (PostgreSQL ${version}) / network=none / synthetic fixtures`);

    const bootstrap = read('scripts/runtime_006_bootstrap.sql');
    let rolesCreated = false;
    for (const [mode, defaults] of Object.entries(MODES)) {
      const p = s => `${mode === 'production' ? 'p' : 'h'}_${s}`;
      psql('postgres', `create database "${p('base005')}";`);
      // Roles are cluster-wide: create them once.
      psql(p('base005'), rolesCreated ? bootstrap.replace(/^create role .*$/gm, '') : bootstrap);
      rolesCreated = true;
      psql(p('base005'), defaults);
      psql(p('base005'), read('supabase/schema.sql'));
      for (const m of BASE) psql(p('base005'), m);
      for (const [c, src] of Object.entries(OLD_006)) {
        copy(p('base005'), p('old_' + c));
        psql(p('old_' + c), src);
        psql(p('old_' + c), SEED);
      }
      copy(p('base005'), p('fresh'));
      psql(p('fresh'), M006);
      psql(p('fresh'), SEED);

      // Observed production fingerprint is reproduced by the old-006 fixture.
      for (const c of Object.keys(OLD_006)) {
        const db = p('old_' + c);
        const acl = q(db, `select has_function_privilege('anon','public.kullanici_email_bul(text)','execute')
          || '/' || has_function_privilege('authenticated','public.kullanici_email_bul(text)','execute')
          || '/' || has_function_privilege('authenticated','public.kullanici_kaydi_tamamla(text,text,text)','execute')
          || '/' || has_function_privilege('authenticated','public.kayit_icin_davet_kodu_kullan(text)','execute')
          || '/' || has_column_privilege('authenticated','public.profiles','auth_login_email','select')
          || '/' || has_column_privilege('authenticated','public.profiles','auth_login_email','update')
          || '/' || (select count(*) from information_schema.columns where table_name='davet_kodlari' and column_name='kod_arama_ozeti');`);
        assert.strictEqual(acl, 'true/true/true/false/true/true/0', `${mode}/${c}: observed old-production ACL/column shape`);
        if (mode === 'production') {
          assert.strictEqual(q(db, `select has_function_privilege('service_role','public.kullanici_email_bul(text)','execute')
            || '/' || has_function_privilege('service_role','public.kullanici_kaydi_tamamla(text,text,text)','execute');`),
          'false/false', `${c}: observed service_role EXECUTE=false`);
        }
        assert.strictEqual(fingerprint(db), 'eski_006', `${mode}/${c}: PRE-007 fingerprint`);
      }
      assert.strictEqual(fingerprint(p('fresh')), 'final_006', `${mode}: fresh fingerprint`);
      console.log(`PASS [${mode}] observed old-production shape reproduced (c1f3068, a0e4931); PRE-007 fingerprint eski_006 / final_006`);

      const catFresh = q(p('fresh'), CATALOG);
      const dataFresh = q(p('fresh'), DATA);
      const pepperFresh = q(p('fresh'), PEPPER);

      // (3) clean final 006 -> 007: nothing changes.
      copy(p('fresh'), p('fresh7'));
      let r = apply007(p('fresh7'));
      assert.strictEqual(r.status, 0, r.stderr);
      assert.match(r.stderr, /007 başlangıç durumu: final_006/);
      assert.strictEqual(q(p('fresh7'), CATALOG), catFresh, `${mode}: 007 on clean final 006 changed the catalog`);
      assert.strictEqual(q(p('fresh7'), DATA), dataFresh, `${mode}: 007 on clean final 006 changed data`);
      assert.strictEqual(q(p('fresh7'), PEPPER), pepperFresh, `${mode}: pepper rotated`);
      console.log(`PASS [${mode}] (3) clean final 006 -> 007: catalog, data and peppers unchanged`);

      for (const c of Object.keys(OLD_006)) {
        const db = p('t_' + c);
        copy(p('old_' + c), db);
        const dataBefore = q(db, DATA);
        assert.notStrictEqual(q(db, CATALOG), catFresh, `${mode}/${c}: old catalog must differ before 007 (non-vacuous equivalence)`);
        const legacyBefore = q(db, `select id || kod_ozeti || aktif || audience_type || kullanim_sayisi from public.davet_kodlari;`);
        // (1) observed old 006 -> 007
        r = apply007(db);
        assert.strictEqual(r.status, 0, `${mode}/${c}: 007 failed: ${r.stderr}`);
        assert.match(r.stderr, /007 başlangıç durumu: eski_006/);
        assert.match(r.stderr, /007 tamam/);
        const catAfter = q(db, CATALOG);
        if (catAfter !== catFresh) {
          const a = new Set(catAfter.split('\n')), b = new Set(catFresh.split('\n'));
          const extra = [...a].filter(x => !b.has(x)).slice(0, 8), missing = [...b].filter(x => !a.has(x)).slice(0, 8);
          assert.fail(`${mode}/${c}: converged catalog != clean 006\n+ ${extra.join('\n+ ')}\n- ${missing.join('\n- ')}`);
        }
        // (14)(16)(17)(18)(19) data preserved exactly.
        assert.strictEqual(q(db, DATA), dataBefore, `${mode}/${c}: rows changed`);
        assert.strictEqual(q(db, `select id || kod_ozeti || aktif || audience_type || kullanim_sayisi from public.davet_kodlari;`), legacyBefore);
        assert.strictEqual(fingerprint(db), 'final_006');
        console.log(`PASS [${mode}] (1) old 006 ${c} -> 007: catalog == clean 001..006 install; all rows preserved`);

        // (5)..(16) security contract on the converged DB.
        psql(db, `
select runtime_test.assert_true(not has_function_privilege('anon','public.kullanici_email_bul(text)','execute'), '5 anon resolver');
select runtime_test.assert_true(not has_function_privilege('authenticated','public.kullanici_email_bul(text)','execute'), '6 authenticated resolver');
set role anon;
select runtime_test.denied($q$select public.kullanici_email_bul('legacy.user')$q$, '42501');
reset role;
set role authenticated;
select runtime_test.login(3);
select runtime_test.denied($q$select public.kullanici_email_bul('legacy.user')$q$, '42501');
select runtime_test.denied($q$select public.kayit_on_kontrol('a.b.c.d', repeat('1',32), null)$q$, '42501');
select runtime_test.denied($q$select public.istek_siniri_tuket('[]'::jsonb)$q$, '42501');
reset role;
set role service_role;
select runtime_test.assert_true(public.kullanici_email_bul('nobody.here') ~ '^u\\.[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}@auth\\.sosyolab\\.local$', '7 service_role resolver');
select runtime_test.assert_true(public.istek_siniri_tuket('[{"anahtar":"drift|probe","limit":5,"pencere":60}]'::jsonb), '12 limiter');
select runtime_test.assert_true(public.kayit_on_kontrol('free.name', repeat('9',32), null) = false, '7 precheck callable');
reset role;
select runtime_test.assert_true(to_regprocedure('public.kullanici_kaydi_tamamla(text,text,text)') is null
  and to_regprocedure('public.kayit_icin_davet_kodu_kullan(text)') is null, '8 old overloads removed');
select runtime_test.assert_true((select count(*) = 0 from (select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' group by p.proname having count(*) > 1) o), '8 no overloaded public function');
set role authenticated;
select runtime_test.login(3);
select runtime_test.denied($q$select auth_login_email from public.profiles$q$, '42501');
select runtime_test.denied($q$select * from public.profiles$q$, '42501');
select runtime_test.assert_true((select count(*) = 1 from (select id, role, display_name, username, class_year, teacher_status, created_at
  from public.profiles where id = auth.uid()) s), '10 own profile columns readable');
select runtime_test.assert_true((select count(*) = 1 from public.materials), '10 legacy member still reads approved archive');
reset role;
set role anon;
select runtime_test.denied($q$select count(*) from sosyolab_private.login_pepper$q$, '42501');
reset role;
set role authenticated;
select runtime_test.denied($q$select count(*) from sosyolab_private.sunucu_pepperlari$q$, '42501');
reset role;
set role service_role;
select runtime_test.denied($q$select count(*) from sosyolab_private.login_pepper$q$, '42501');
select runtime_test.denied($q$select count(*) from sosyolab_private.sunucu_pepperlari$q$, '42501');
reset role;
select runtime_test.assert_true(to_regclass('public.davet_kodlari_arama_ozeti_unique') is not null, '13 digest index');
select runtime_test.assert_true((select count(*) = 1 from public.davet_kodlari where audience_type = 'legacy' and not aktif
  and etiket = 'synthetic legacy' and kod_arama_ozeti is null), '14 inactive legacy invite preserved');
select runtime_test.assert_true(exists (select 1 from auth.users where id = runtime_test.identity(16))
  and not exists (select 1 from public.profiles where id = runtime_test.identity(16)), '15 orphan preserved');
set role authenticated;
select runtime_test.login(16);
select runtime_test.assert_true(not public.uye_profili_var_mi() and not public.davet_dogrulandi_mi(), '15 orphan not a member');
select runtime_test.assert_true((select count(*) = 0 from public.materials), '15 orphan reads no archive');
select runtime_test.assert_true((select count(*) = 0 from public.profiles), '15 orphan reads no profile');
select runtime_test.denied($q$insert into public.profiles(id, username) values (auth.uid(), 'orphan.squat')$q$, '42501');
select runtime_test.denied($q$insert into public.materials(course_id, uploader_id, title, file_path, file_name)
  values ('sos101', auth.uid(), 'x', auth.uid() || '/x.pdf', 'x.pdf')$q$, '42501');
select runtime_test.denied($q$insert into storage.objects(bucket_id, name) values ('materyaller', auth.uid() || '/x.pdf')$q$, '42501');
reset role;
select runtime_test.assert_true((select count(*) = 15 from public.profiles where username is null), '16 username-null profiles kept');
`);
        // (13) functional HMAC lookup on a scratch copy (keeps the data proof clean).
        copy(db, db + '_h');
        psql(db + '_h', `
select public.admin_davet_kodu_olustur('ABCDEF0123456789ABCDEF0123456789', 'student', 1::smallint, 'drift probe', null, 5);
set role service_role;
select runtime_test.assert_true(public.kayit_on_kontrol('probe.user', 'abcdef0123456789abcdef0123456789', null), '13 HMAC lookup (case-insensitive)');
reset role;`);
        console.log(`PASS [${mode}] (5)-(16) ${c}: resolver/precheck/limiter server-only, old overloads gone, auth_login_email closed, own columns + archive readable, peppers closed, HMAC lookup, legacy invite + orphan + username-null profiles preserved, orphan unauthorized`);

        // (2) 007 again on the converged DB.
        const pepper = q(db, PEPPER);
        const data2 = q(db, DATA);
        r = apply007(db);
        assert.strictEqual(r.status, 0, r.stderr);
        assert.match(r.stderr, /007 başlangıç durumu: final_006/);
        assert.strictEqual(q(db, CATALOG), catFresh);
        assert.strictEqual(q(db, DATA), data2);
        assert.strictEqual(q(db, PEPPER), pepper, 'second 007 rotated a pepper');
        console.log(`PASS [${mode}] (2) ${c}: 007 twice -> idempotent (catalog, data, peppers unchanged)`);
      }

      // (4) unexpected drift: precondition RAISE + full rollback.
      const drift = {
        '005 baseline (no 006)': [p('base005'), null, /006 kolonları yok/],
        'partial final object': [p('old_c1f3068'), `create function public.istek_siniri_tuket(jsonb) returns boolean language sql as 'select true';`, /desteklenmeyen şema durumu/],
        'half-created private schema': [p('old_c1f3068'), `create schema sosyolab_private;`, /desteklenmeyen şema durumu/],
        'auth.users trigger': [p('old_c1f3068'), `create function public.yeni_kullanici_profili() returns trigger language plpgsql as $$begin return new; end$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.yeni_kullanici_profili();`, /auth\.users üzerinde 1 internal olmayan trigger/],
        'non-canonical auth_login_email': [p('old_c1f3068'), `update public.profiles set auth_login_email = 'legacy.name@auth.sosyolab.local' where id = runtime_test.identity(2);`, /canonical olmayan 1 auth_login_email/],
        'unexpected overload': [p('old_c1f3068'), `create function public.kullanici_email_bul(text, text) returns text language sql as 'select null::text';`, /beklenmeyen overload: public\.kullanici_email_bul/],
        'old signature missing': [p('old_c1f3068'), `drop function public.kayit_icin_davet_kodu_kullan(text);`, /desteklenmeyen şema durumu/]
      };
      let i = 0;
      for (const [label, [from, mutate, expected]] of Object.entries(drift)) {
        const db = p('drift' + (i++));
        copy(from, db);
        if (mutate) psql(db, mutate);
        const cat = q(db, CATALOG), data = q(db, DATA);
        r = apply007(db);
        assert.notStrictEqual(r.status, 0, `${mode}: drift "${label}" must fail`);
        assert.match(r.stderr, expected, `${mode}: drift "${label}" message`);
        assert.strictEqual(q(db, CATALOG), cat, `${mode}: drift "${label}" left catalog changes`);
        assert.strictEqual(q(db, DATA), data, `${mode}: drift "${label}" left data changes`);
      }
      console.log(`PASS [${mode}] (4) ${i} unexpected-drift states: precondition RAISE, catalog and data fully rolled back`);

      // Postconditions are not vacuous: mutated 007 bodies must be rejected.
      const mutants = {
        'resolver re-opened to anon': [`grant execute on function public.kullanici_email_bul(text) to service_role;`,
          `grant execute on function public.kullanici_email_bul(text) to service_role, anon;`, /kullanici_email_bul\(text\) EXECUTE anon/],
        'table-level profiles SELECT kept': [`  revoke select on table public.profiles from anon, authenticated;\n`, `  perform 1;\n`, /profiles istemci yetkileri/],
        'archive rows deleted': [`-- <<< 006 FINAL GÖVDESİ <<<`, `delete from public.materials;\n-- <<< 006 FINAL GÖVDESİ <<<`, /veri koruma ihlali/]
      };
      for (const [label, [from, to, expected]] of Object.entries(mutants)) {
        assert.ok(M007.includes(from), 'mutant anchor present: ' + label);
        const db = p('mut' + (i++));
        copy(p('old_c1f3068'), db);
        const cat = q(db, CATALOG);
        r = apply007(db, M007.split(from).join(to));
        assert.notStrictEqual(r.status, 0, `${mode}: mutant "${label}" must fail`);
        assert.match(r.stderr, expected, `${mode}: mutant "${label}"`);
        assert.strictEqual(q(db, CATALOG), cat, `${mode}: mutant "${label}" rolled back`);
      }
      console.log(`PASS [${mode}] postcondition mutants rejected + rolled back (${Object.keys(mutants).join('; ')})`);

      // Operator backfill template + PII-free inventories (converged old c1f3068).
      const bf = p('t_c1f3068');
      const ident = n => q(bf, `select runtime_test.identity(${n});`);
      const email = n => q(bf, `select runtime_test.email(${n});`);
      // Fixture-only stand-in for the Admin API email change (never done in SQL in production).
      const adminApi = n => psql(bf, `update auth.users set email = runtime_test.email(${n}) where id = runtime_test.identity(${n});`);
      const backfill = (n, ad, kimlik) => psql(bf, read('supabase/legacy_user_backfill.sql'),
        { allowFailure: true, vars: { profil_id: ident(n), kullanici_adi: ad, giris_kimligi: kimlik } });
      const inv = q(bf, read('supabase/legacy_identity_inventory.sql'));
      assert.ok(!/@|example\.invalid|Synthetic/.test(inv), 'inventory prints no email / display name');
      assert.match(inv, /karar gerekli: preserve/);
      assert.match(inv, /anonim oturum kalıntısı/);
      adminApi(5);
      r = backfill(5, 'legacy.five', email(5));
      assert.strictEqual(r.status, 0, r.stderr);
      assert.ok(!/@/.test(r.stdout + r.stderr), 'backfill output carries no identity');
      assert.strictEqual(q(bf, `set role service_role; select public.kullanici_email_bul('legacy.five') = runtime_test.email(5);`), 't');
      const rejects = [
        [5, 'legacy.five2', () => email(5), /zaten kimlik taşıyor/],
        [6, 'legacy.six', () => email(6), /Auth email henüz bu kimliğe çekilmemiş/],
        [7, 'legacy.five', () => (adminApi(7), email(7)), /kullanıcı adı alınmış/],
        [7, 'Legacy Seven', () => email(7), /canonical değil, biçim dışı veya rezerve/],
        [7, 'sosyolog35', () => email(7), /canonical değil, biçim dışı veya rezerve/],
        [7, 'legacy.seven', () => 'legacy.seven@auth.sosyolab.local', /giriş kimliği canonical değil/],
        [7, 'legacy.seven', () => email(5), /başka profilde kullanılıyor/],
        [16, 'orphan.user', () => email(16), /profil yok/]
      ];
      for (const [n, ad, kimlik, expected] of rejects) {
        r = backfill(n, ad, kimlik());
        assert.notStrictEqual(r.status, 0, `backfill must reject ${ad}`);
        assert.match(r.stderr, expected);
      }
      // Rejected runs changed nothing except the fixture's simulated Admin API email change (user 7).
      assert.strictEqual(q(bf, `select count(*) from public.profiles where username is not null;`), '1');
      assert.strictEqual(q(bf, `select count(*) from public.profiles where auth_login_email is not null;`), '1');
      console.log(`PASS [${mode}] legacy backfill template: 1 explicit success, ${rejects.length} unsafe inputs rejected; inventories PII-free`);
    }
  } finally {
    if (created) { docker(['rm', '--force', name], undefined, true); console.log('Disposable container removed'); }
  }
}

function main() {
  const images = (process.env.PG_IMAGES || 'postgres:16,postgres:17').split(',').map(s => s.trim()).filter(Boolean);
  const available = images.filter(img => spawnSync('docker', ['image', 'inspect', img]).status === 0);
  assert.ok(available.includes('postgres:16'), 'postgres:16 image required locally (harness never pulls)');
  for (const img of images) if (!available.includes(img)) console.log(`SKIP ${img}: image not present locally`);
  for (const img of available) harness(img);
  console.log(`PASS runtime_007_drift_test (${available.join(', ')})`);
}

try { main(); } catch (err) {
  console.error('FAIL runtime_007_drift_test');
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
}
