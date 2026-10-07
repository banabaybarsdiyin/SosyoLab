#!/usr/bin/env node
'use strict';
// Local Docker only; no URL, password, Supabase SDK or production configuration.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const name = `sosyolab-runtime-006-${process.pid}-${Date.now()}`;
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function docker(args, input, allowFailure = false) {
  const r = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60000, maxBuffer: 8*1024*1024 });
  if (!allowFailure && (r.error || r.status !== 0)) {
    throw new Error(`docker ${args[0]} failed: ${r.error || r.stderr || r.stdout}`);
  }
  return r;
}
const sqlArgs = () => ['exec', '-i', name, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'mod=POST'];
function sql(source, allowFailure = false) {
  return docker(sqlArgs(), `set statement_timeout='20s';\n${source}`, allowFailure);
}
function sqlFile(file) { return sql(read(file)); }
function session(source, keepOpen = false) {
  const child = spawn('docker', sqlArgs(), { stdio: ['pipe','pipe','pipe'] });
  let out = '', err = '';
  child.stdout.setEncoding('utf8').on('data', data => { out += data; });
  child.stderr.setEncoding('utf8').on('data', data => { err += data; });
  const done = new Promise((resolve,reject) => {
    child.on('error',reject);
    child.on('close',status => resolve({status,stdout:out,stderr:err}));
  });
  child.stdin.write(`set statement_timeout='20s';\n${source}\n`);
  if (!keepOpen) child.stdin.end();
  return { child, done, output: () => out };
}
async function until(predicate,label) {
  const deadline=Date.now()+15000;
  while (Date.now()<deadline) {
    if (predicate()) return;
    await pause(100);
  }
  throw new Error(`Timed out: ${label}`);
}
function inventory() {
  const source = read('supabase/inventory.sql');
  // Gate blocks A..G/G2 + K/L; H/I/J are explicitly informational.
  const gates = source.slice(source.indexOf('-- A. POL'),source.indexOf('-- H.'))
    + source.slice(source.indexOf('-- K.'));
  const result=sql(`begin transaction read only;\n${gates}\ncommit;`);
  assert.strictEqual(result.stdout.trim(),'','POST-006 inventory gate must return no findings');
  // Also execute the complete operator file, including its mode guard/raw dumps.
  sql(`begin transaction read only;\n${source}\ncommit;`);
  const wrongMode=sql(source.replaceAll(":'mod'", "'PRE'"),true);
  assert.notStrictEqual(wrongMode.status,0,'POST inventory must reject PRE mode');
  console.log('PASS POST-006 inventory (A..G/G2/K/L zero findings; PRE rejected)');
}
function contract() {
  const file='supabase/regression_teacher_contract.sql';
  const ok=sqlFile(file);
  const ids=[...ok.stderr.matchAll(/PASS (T-\d+) /g)].map(m=>m[1]);
  assert.strictEqual(new Set(ids).size,17,'teacher contract must report T-01..T-17 PASS');
  assert.match(ok.stderr,/PASS teacher regression contract \(T-01\.\.T-17\)/);
  // A real regression must exit non-zero even when the caller omits
  // -v ON_ERROR_STOP=1 (the file sets it itself).
  const plain=src=>docker(['exec','-i',name,'psql','-X','-q','-U','postgres'],src,true);
  sql('alter policy teacher_courses_okuma on public.teacher_courses using (true);');
  try {
    const widened=plain(read(file));
    assert.notStrictEqual(widened.status,0,'widened teacher policy must fail the contract');
    assert.match(widened.stderr,/FAIL T-03/);
  } finally {
    sql('alter policy teacher_courses_okuma on public.teacher_courses using ((teacher_id = auth.uid()) or public.is_admin());');
  }
  const broken=plain(read(file).replace(/^do \$\$/m,()=>'do $$ syntax_error_injected'));
  assert.notStrictEqual(broken.status,0,'SQL error in contract must exit non-zero');
  assert.strictEqual(plain(read(file)).status,0,'restored policy passes contract');
  console.log('PASS teacher SQL contract T-01..T-17 (PG16; widened policy and SQL error exit non-zero)');
}
async function concurrency() {
  const locker=session(`begin;
    select id from public.davet_kodlari where etiket='synthetic final slot' for update;
    select 'LOCKED';`,true);
  await until(()=>locker.output().includes('LOCKED'),'final slot row locked');
  const workers=[18,19].map(n => session(`
    set application_name='runtime006_contender_${n}';
    set role authenticated;
    select runtime_test.login(${n});
    select runtime_test.kayit('race.user${n}',repeat('3',32));`));
  try {
    await until(()=>sql(`select count(*) from pg_stat_activity
      where application_name like 'runtime006_contender_%' and wait_event_type='Lock';`).stdout.trim()==='2',
      'both contenders waiting on locked final invite slot');
  } finally {
    locker.child.stdin.end('commit;\n');
  }
  const lockResult=await locker.done;
  assert.strictEqual(lockResult.status,0,lockResult.stderr);
  const results=await Promise.all(workers.map(w=>w.done));
  assert.strictEqual(results.filter(r=>r.status===0).length,1,'exactly one concurrent registration succeeds');
  const loser=results.find(r=>r.status!==0);
  assert.match(loser.stderr,/Davet kodu geçersiz ya da süresi dolmuş/,'loser rejected by atomic quota');
  sql(`select runtime_test.assert_true((select kullanim_sayisi=1 from public.davet_kodlari
    where etiket='synthetic final slot'),'final slot consumed once');
    select runtime_test.assert_true((select count(*)=1 from public.profiles
    where id in(runtime_test.identity(18),runtime_test.identity(19))),'one race profile');
    select runtime_test.assert_true((select count(*)=1 from public.davet_dogrulamalari
    where user_id in(runtime_test.identity(18),runtime_test.identity(19))),'one race stamp');`);
  console.log('PASS T17 (two overlapping sessions; exactly one success)');
}
async function main() {
  let created=false;
  try {
    docker(['image','inspect','postgres:16']); // Deliberately never pulls/network-connects.
    docker(['run','--detach','--rm','--name',name,'--network','none',
      '--env','POSTGRES_HOST_AUTH_METHOD=trust','postgres:16']);
    created=true;
    // pg_isready also succeeds on the image's temporary init server, which then
    // restarts; wait for init completion first so the first psql cannot race it.
    await until(()=>/PostgreSQL init process complete/.test(docker(['logs',name],undefined,true).stdout),'PostgreSQL init');
    await until(()=>docker(['exec',name,'pg_isready','-U','postgres'],undefined,true).status===0,'PostgreSQL readiness');
    console.log('Docker postgres:16 / network=none / no exposed ports / synthetic fixtures');
    sqlFile('scripts/runtime_006_bootstrap.sql');
    sqlFile('supabase/schema.sql');
    // App table grants normally supplied by hosted setup, explicit in this stub.
    sql('grant select,insert,update on public.profiles to authenticated; grant select,insert,update,delete on public.materials to authenticated;');
    for(const file of fs.readdirSync(path.join(root,'supabase/migrations')).filter(f=>/^00[1-5]_/.test(f)).sort()) {
      sqlFile(`supabase/migrations/${file}`);
    }
    sql('grant select,insert,delete on public.teacher_courses to authenticated;');
    // PRE inventory runs BEFORE 006, both empty and legacy-populated scenarios.
    sql(`select runtime_test.assert_true(not exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='profiles' and column_name in('username','auth_login_email')),
      '005 lacks 006 columns');`);
    sqlFile('supabase/pre_006_inventory.sql');
    console.log('PASS PRE-006 inventory on real 005 schema (teacher=0)');
    sqlFile('scripts/runtime_006_pre_seed.sql');
    const pre=sqlFile('supabase/pre_006_inventory.sql');
    assert.match(pre.stdout,/legacy-teacher@example.invalid/);
    assert.match(pre.stdout,/anonymous/);
    sql(`select runtime_test.assert_true((select count(*)=1 from public.profiles where role='teacher'),'legacy teacher fixture');
      select runtime_test.assert_true((select count(*)=2 from public.teacher_courses
      where lower(btrim(course_id))='sos401'),'legacy sos401 fixtures');`);
    console.log('PASS PRE-006 inventory on real 005 schema (teacher=1, admin=1, anonymous user=1, sos401=2)');
    sqlFile('supabase/migrations/006_self_registration_invites.sql');
    inventory();
    // Fresh-install path is 001..007: 007 on a final 006 DB is an idempotent
    // no-op (old-006 production drift is runtime_007_drift_test.js).
    const m007=sqlFile('supabase/migrations/007_production_006_reconciliation.sql');
    assert.match(m007.stderr,/007 başlangıç durumu: final_006/);
    console.log('PASS 007 on clean final 006 (final_006 state, idempotent)');
    inventory();
    const results=sqlFile('scripts/runtime_006_security_test.sql');
    const ids=[...results.stdout.matchAll(/^PASS (T\d+)$/gm)].map(m=>m[1]);
    for(const n of [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,18,19,20,21,22,24,25]) {
      assert(ids.includes(`T${String(n).padStart(2,'0')}`),`missing test T${n}`);
    }
    console.log(ids.map(id=>`PASS ${id}`).join('\n'));
    const enumeration=sqlFile('scripts/runtime_006_login_enumeration_test.sql');
    const enumIds=[...enumeration.stdout.matchAll(/^PASS (T\d+)$/gm)].map(m=>m[1]);
    for(const n of [26,27,28,29,30,31]) assert(enumIds.includes(`T${n}`),`missing test T${n}`);
    console.log((enumeration.stdout.match(/^INFO .*$/m)||['INFO T30 missing'])[0]);
    console.log(enumIds.map(id=>`PASS ${id}`).join('\n'));
    contract();
    // Separate fresh psql connection proves NULL GUC check, independent of ACL.
    sql(`select runtime_test.login(4);
      select runtime_test.assert_true(current_setting('sosyolab.registration_context',true) is null,'fresh NULL context');
      select runtime_test.denied($q$select * from public.kayit_icin_davet_kodu_kullan(auth.uid(),repeat('1',32))$q$,
        'P0001','yalnızca kayıt tamamlama');
      set role authenticated;
      select runtime_test.denied($q$select * from public.kayit_icin_davet_kodu_kullan(auth.uid(),repeat('1',32))$q$,'42501');`);
    console.log('PASS T23 (fresh NULL context as owner rejected; client ACL denied)');
    await concurrency();
    inventory();
    // T32-T40: Edge Function auth boundary end-to-end (real core + real DB).
    await require('./runtime_006_auth_boundary_test.js')({ name });
    inventory();
    // T41-T51: F-01 rate limiting (real core + real DB limiter + mutants).
    await require('./runtime_006_rate_limit_test.js')({ name });
    // T52-T53: F-02 HMAC invite lookup, F-06 registration reconciliation.
    await require('./runtime_006_invite_lookup_test.js')({ name });
    inventory();
    console.log('PASS runtime_006_security_test: T01-T53 + teacher contract');
  } finally {
    if(created) {
      docker(['rm','--force',name]);
      console.log('Disposable container removed');
    }
  }
}
main().catch(err=>{console.error(`FAIL runtime_006_security_test\n${err.stack}`);process.exitCode=1;});
