#!/usr/bin/env node
'use strict';
// 008 privilege cleanup. Disposable Docker PostgreSQL only (--network none,
// synthetic data, never pulls, never connects to Supabase).
// Applies schema -> 001..006 -> 007 -> 008 in two grant modes:
//   narrow           : explicit app grants (as the main runtime harness)
//   hosted-defaults  : Supabase-style default ALL grants on new public tables
//                      (the observed production shape: TRUNCATE/REFERENCES/
//                      TRIGGER present for anon/authenticated/service_role)
// Proves: only TRUNCATE/REFERENCES/TRIGGER disappear; every other table and
// column privilege, function ACL, policy, RLS flag and row is unchanged;
// TRUNCATE works before 008 (non-vacuous) and is denied after; second run is
// a no-op; 008 refuses to run before final 006/007.
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const read = f => require('fs').readFileSync(path.join(root, f), 'utf8');
const MIG = ['001_davet_kodlari', '002_denetim_kaydi', '003_launch_gate_hardening', '004_revoke_public_table_ddl_privs',
  '005_teacher_role', '006_self_registration_invites', '007_production_006_reconciliation'];
const M008 = read('supabase/migrations/008_runtime_privilege_hardening.sql');
const TABLES = ['profiles', 'materials', 'teacher_courses', 'davet_kodlari', 'davet_dogrulamalari', 'davet_denemeleri', 'denetim_kaydi'];
const DDL = ['TRUNCATE', 'REFERENCES', 'TRIGGER'];

function harness(image) {
  const name = `sosyolab-008-${process.pid}-${Date.now()}`;
  const docker = (args, input, allowFailure = false) => {
    const r = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 120000, maxBuffer: 16 << 20 });
    if (!allowFailure && (r.error || r.status !== 0)) throw new Error(`docker ${args.slice(0, 3).join(' ')} failed: ${r.error || r.stderr || r.stdout}`);
    return r;
  };
  const psql = (db, source, allowFailure = false) => docker(['exec', '-i', name, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres',
    '-d', db, '-v', 'ON_ERROR_STOP=1'], `set statement_timeout='60s';\n${source}`, allowFailure);
  const q = (db, source) => psql(db, source).stdout.trim();
  const wait = (pred, label) => {
    const end = Date.now() + 60000;
    while (Date.now() < end) { if (pred()) return; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300); }
    throw new Error('Timed out: ' + label);
  };
  const inList = TABLES.map(t => `'${t}'`).join(',');
  // Every privilege EXCEPT the three being removed, plus function ACL, policies, RLS, data.
  const SNAPSHOT = `
select string_agg(x, E'\\n' order by x) from (
  select 'T ' || t || ' ' || r || ' ' || pr || '=' || has_table_privilege(r, 'public.' || t, pr)
    from unnest(array[${inList}]) t, unnest(array['anon','authenticated','service_role']) r,
         unnest(array['SELECT','INSERT','UPDATE','DELETE']) pr
  union all
  select 'C ' || c.relname || '.' || a.attname || ' ' || r || ' ' || pr || '=' || has_column_privilege(r, c.oid, a.attnum, pr)
    from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped,
         unnest(array['anon','authenticated','service_role']) r, unnest(array['SELECT','INSERT','UPDATE']) pr
   where c.relnamespace = 'public'::regnamespace and c.relname in (${inList})
  union all
  select 'F ' || p.oid::regprocedure::text || ' ' || coalesce(p.proacl::text, 'DEFAULT')
    from pg_proc p where p.pronamespace in ('public'::regnamespace)
  union all
  select 'P ' || schemaname || '.' || tablename || '.' || policyname || ' ' || cmd || ' ' || array_to_string(roles, ',')
      || ' ' || coalesce(qual, '') || '|' || coalesce(with_check, '') from pg_policies
  union all
  select 'R ' || relname || ' rls=' || relrowsecurity::text || ' force=' || relforcerowsecurity::text
    from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
  union all
  select 'D ' || t || ' ' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t), false, true, '')))[1]::text
    from unnest(array[${inList}]) t
) s(x);`;
  const ddlState = db => q(db, `select string_agg(t || ':' || r || ':' || pr, ',' order by t, r, pr)
    from unnest(array[${inList}]) t, unnest(array['anon','authenticated','service_role']) r, unnest(array['${DDL.join("','")}']) pr
   where has_table_privilege(r, 'public.' || t, pr);`);

  let created = false;
  try {
    docker(['run', '--detach', '--rm', '--name', name, '--network', 'none', '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', image]);
    created = true;
    wait(() => /PostgreSQL init process complete/.test(docker(['logs', name], undefined, true).stdout), 'init');
    wait(() => docker(['exec', name, 'pg_isready', '-U', 'postgres'], undefined, true).status === 0, 'ready');
    console.log(`== ${image} (PostgreSQL ${q('postgres', 'show server_version;')}) / network=none / synthetic`);
    const bootstrap = read('scripts/runtime_006_bootstrap.sql');
    let roles = false;
    for (const mode of ['narrow', 'hosted-defaults']) {
      const db = mode === 'narrow' ? 'n' : 'h';
      psql('postgres', `create database ${db};`);
      psql(db, roles ? bootstrap.replace(/^create role .*$/gm, '') : bootstrap);
      roles = true;
      if (mode === 'hosted-defaults') {
        psql(db, `alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
          alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`);
      }
      psql(db, read('supabase/schema.sql'));
      if (mode === 'narrow') psql(db, 'grant select,insert,update on public.profiles to authenticated; grant select,insert,update,delete on public.materials to authenticated;');
      // 008 before final 006/007 must refuse and change nothing.
      for (const m of MIG.slice(0, 5)) psql(db, read(`supabase/migrations/${m}.sql`));
      if (mode === 'narrow') psql(db, 'grant select,insert,delete on public.teacher_courses to authenticated;');
      const early = psql(db, M008, true);
      assert.notStrictEqual(early.status, 0, `${mode}: 008 must refuse on 005`);
      assert.match(early.stderr, /final 006\/007 durumu bulunamadı/);
      for (const m of MIG.slice(5)) psql(db, read(`supabase/migrations/${m}.sql`));
      // Synthetic rows: admin, student member, teacher with a course, approved archive.
      psql(db, `
insert into auth.users(id, email) select runtime_test.identity(n), runtime_test.email(n) from generate_series(1, 4) n;
insert into public.profiles(id, role, display_name) values (runtime_test.identity(1), 'admin', 'A');
select public.admin_davet_kodu_olustur(repeat('1',32), 'student', 2::smallint, 'synthetic student', null, 20);
set role service_role;
select public.kullanici_kaydi_tamamla(runtime_test.identity(2), 'synthetic.student', repeat('1',32), null);
reset role;
select runtime_test.login(1);
insert into public.materials(course_id, uploader_id, title, file_path, file_name)
values ('sos101', runtime_test.identity(1), 'Synthetic', runtime_test.identity(1) || '/a.pdf', 'a.pdf');
update public.materials set status = 'approved', reviewed_at = now(), reviewed_by = runtime_test.identity(1);
select set_config('request.jwt.claims', '', false);
create function runtime_test.material(course text, file text) returns void language sql security invoker as $f$
  insert into public.materials(course_id, uploader_id, title, file_path, file_name)
  values (course, auth.uid(), 'Synthetic runtime fixture', auth.uid()::text || '/' || file, file);
$f$;`);

      const before = q(db, SNAPSHOT);
      const ddlBefore = ddlState(db);
      if (mode === 'hosted-defaults') {
        assert.match(ddlBefore, /teacher_courses:anon:TRUNCATE/, 'fixture reproduces observed production grants');
        assert.match(ddlBefore, /teacher_courses:authenticated:TRUNCATE/);
        assert.match(ddlBefore, /service_role/);
        // Non-vacuous: TRUNCATE bypasses RLS before 008 (inside a rolled-back txn).
        assert.match(q(db, `begin; set local role authenticated; truncate public.teacher_courses; select 'truncated'; rollback;`), /truncated/);
      }

      // (1) 008 PASS
      let r = psql(db, M008, true);
      assert.strictEqual(r.status, 0, `${mode}: 008 failed: ${r.stderr}`);
      // (3)(4)(5) no TRUNCATE/REFERENCES/TRIGGER for anon/authenticated/service_role.
      assert.strictEqual(ddlState(db), '', `${mode}: DDL privileges remain`);
      // (6)(7)(9) + function ACL/policies/data: everything else identical.
      assert.strictEqual(q(db, SNAPSHOT), before, `${mode}: 008 changed something other than TRUNCATE/REFERENCES/TRIGGER`);
      // (2) second run: no-op.
      r = psql(db, M008, true);
      assert.strictEqual(r.status, 0, `${mode}: 008 rerun failed: ${r.stderr}`);
      assert.strictEqual(q(db, SNAPSHOT), before);
      // Behaviour under real roles.
      psql(db, `
set role authenticated;
select runtime_test.denied($q$truncate public.teacher_courses$q$, '42501');
select runtime_test.denied($q$truncate public.materials$q$, '42501');
select runtime_test.login(2);
select runtime_test.assert_true((select count(*) = 1 from (select id, role, display_name, username, class_year, teacher_status, created_at
  from public.profiles where id = auth.uid()) s), '7 own profile columns readable');
select runtime_test.denied($q$select auth_login_email from public.profiles$q$, '42501');
select runtime_test.assert_true((select count(*) = 1 from public.materials where status = 'approved'), '6 member reads archive');
select runtime_test.material('sos101', 'student.pdf');
select runtime_test.assert_true((select count(*) = 1 from public.materials where uploader_id = auth.uid() and status = 'pending'), '6 member INSERT');
update public.materials set title = 'Synthetic edited' where uploader_id = auth.uid();
delete from public.materials where uploader_id = auth.uid() and status = 'pending';
reset role;
set role anon;
select runtime_test.denied($q$truncate public.profiles$q$, '42501');
reset role;
set role service_role;
select runtime_test.denied($q$truncate public.davet_kodlari$q$, '42501');
select runtime_test.assert_true(public.kullanici_email_bul('synthetic.student') = runtime_test.email(2), 'service_role RPC still works');
reset role;`);
      // Hosted service_role has table grants (the bootstrap stub does not):
      // its CRUD must survive 008 (also covered by the snapshot above).
      if (mode === 'hosted-defaults') {
        psql(db, `set role service_role;
select runtime_test.assert_true((select count(*) >= 1 from public.profiles), 'service_role table read still works');
update public.davet_kodlari set etiket = etiket where etiket = 'synthetic student';
reset role;`);
      }
      console.log(`PASS [${mode}] 008: only TRUNCATE/REFERENCES/TRIGGER removed (before: ${ddlBefore ? ddlBefore.split(',').length : 0} grants, after: 0); other table/column privileges, function ACL, policies, RLS, rows unchanged; rerun no-op; refuses before final 006/007; member CRUD + own columns OK, auth_login_email denied, TRUNCATE denied`);
    }
  } finally {
    if (created) { docker(['rm', '--force', name], undefined, true); console.log('Disposable container removed'); }
  }
}

function main() {
  const images = (process.env.PG_IMAGES || 'postgres:16,postgres:17').split(',').map(s => s.trim()).filter(Boolean);
  const available = images.filter(img => spawnSync('docker', ['image', 'inspect', img]).status === 0);
  assert.ok(available.length > 0, `none of ${images.join(', ')} present locally (harness never pulls)`);
  for (const img of images) if (!available.includes(img)) console.log(`SKIP ${img}: image not present locally`);
  for (const img of available) harness(img);
  console.log(`PASS runtime_008_privilege_test (${available.join(', ')})`);
}

try { main(); } catch (err) {
  console.error('FAIL runtime_008_privilege_test');
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
}
