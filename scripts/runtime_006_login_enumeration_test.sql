-- F-05 contract: an anonymous caller cannot determine username/account
-- existence from the username-to-login-resolution mechanism.
-- The resolver is server-only (Edge Function `giris`, service_role): every
-- client role gets one uniform denial; the server caller gets an answer whose
-- shape/stability/timing does not depend on account existence.
-- Disposable PostgreSQL only; runs after runtime_006_security_test.sql, which
-- registered student.user, pending.teacher, approved.teacher, rejected.teacher.
-- Every probe runs as the client role it claims (anon/authenticated).

-- Errors become an observable value instead of aborting the probe, so the
-- SQLSTATE channel is compared like any other response field.
create function runtime_test.resolve(u text) returns text
language plpgsql security invoker as $$
begin
  return public.kullanici_email_bul(u);
exception when others then
  return 'SQLSTATE:'||sqlstate;
end;
$$;
create function runtime_test.canonical(e text) returns boolean language sql immutable as $$
  select coalesce(e ~ '^u\.[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}@auth\.sosyolab\.local$',false);
$$;
create function runtime_test.timing_ratio(a text, b text, rounds integer, per integer) returns numeric
language plpgsql security invoker as $$
declare ta interval := '0'; tb interval := '0'; t0 timestamptz; x text;
begin
  for i in 1..per loop x := public.kullanici_email_bul(a); x := public.kullanici_email_bul(b); end loop;
  for r in 1..rounds loop
    t0 := clock_timestamp();
    for i in 1..per loop x := public.kullanici_email_bul(a); end loop;
    ta := ta + (clock_timestamp()-t0);
    t0 := clock_timestamp();
    for i in 1..per loop x := public.kullanici_email_bul(b); end loop;
    tb := tb + (clock_timestamp()-t0);
  end loop;
  return round((extract(epoch from ta)/nullif(extract(epoch from tb),0))::numeric,3);
end;
$$;

select set_config('request.jwt.claims','',false);

-- Legacy teacher (personal Auth email) after the documented POST-006 backfill:
-- canonical internal identity only. Non-canonical identities are rejected.
select runtime_test.denied($q$update public.profiles set username='legacy.teacher',
  auth_login_email='u.legacy.teacher@auth.sosyolab.local' where id=runtime_test.identity(2)$q$,'23514');
select runtime_test.denied($q$update public.profiles set username='legacy.teacher',
  auth_login_email='u.test2@auth.sosyolab.local' where id=runtime_test.identity(2)$q$,'23514');
select runtime_test.denied($q$update public.profiles set username='legacy.teacher',
  auth_login_email='u.'||md5('x')||'@auth.sosyolab.local' where id=runtime_test.identity(2)$q$,'23514');
update public.profiles
   set username='legacy.teacher',
       auth_login_email='u.'||replace(gen_random_uuid()::text,'-','')||'@auth.sosyolab.local'
 where id=runtime_test.identity(2);
-- Backfilled username without login identity (incomplete profile).
update public.profiles set username='legacy.anon' where id=runtime_test.identity(3);

create table runtime_test.enum_inputs(kategori text not null, girdi text);
insert into runtime_test.enum_inputs values
  ('mevcut','student.user'),('mevcut','pending.teacher'),('mevcut','approved.teacher'),
  ('mevcut','rejected.teacher'),('mevcut','stamped.teacher'),('mevcut','legacy.teacher'),
  ('yok','no.such.user'),('yok','ghost.user'),('yok','legacy.anon'),('yok','admin'),('yok','sosyolog35'),
  ('yok',''),('yok',null),('yok','   '),('yok','çğüş.user'),('yok',$x$x' or 1=1--$x$),
  ('yok',repeat('a',10000));
-- 200 random valid-format (4..24) and 64 random 32+ character usernames.
insert into runtime_test.enum_inputs
select 'yok', substr(md5('nx'||g),1,4+g%21) from generate_series(1,200) g;
insert into runtime_test.enum_inputs
select 'yok', case when g%2=0 then upper(repeat(md5('long'||g),2)) else md5('l'||g)||'.'||md5('m'||g) end
  from generate_series(1,64) g;
grant select on runtime_test.enum_inputs to anon, authenticated, service_role;
create table runtime_test.enum_out(rol text, kategori text, girdi text, cikti text);
grant insert, select on runtime_test.enum_out to anon, authenticated, service_role;

set role anon;
insert into runtime_test.enum_out select 'anon',kategori,girdi,runtime_test.resolve(girdi) from runtime_test.enum_inputs;
reset role;
set role authenticated;
select runtime_test.login(10);   -- registered member
insert into runtime_test.enum_out select 'member',kategori,girdi,runtime_test.resolve(girdi) from runtime_test.enum_inputs;
select runtime_test.login(4);    -- orphan Auth user, no profile
insert into runtime_test.enum_out select 'orphan',kategori,girdi,runtime_test.resolve(girdi) from runtime_test.enum_inputs;
reset role;
select set_config('request.jwt.claims','',false);
set role service_role;           -- Edge Function
insert into runtime_test.enum_out select 'servis',kategori,girdi,runtime_test.resolve(girdi) from runtime_test.enum_inputs;
reset role;

-- T26: no false positive — existing accounts (student, pending/rejected/approved
-- teacher, backfilled legacy) still resolve to their real login identity.
select runtime_test.assert_true((select count(*)=6 from runtime_test.enum_out o
  join public.profiles p on p.username=o.girdi
  where o.rol='servis' and o.kategori='mevcut' and o.cikti=p.auth_login_email),'existing accounts resolve to real identity');
select runtime_test.assert_true((select count(*)=5 from runtime_test.enum_out o
  join public.profiles p on p.username=o.girdi
  where o.rol='servis' and o.kategori='mevcut' and o.cikti=runtime_test.email(
    (right(p.id::text,12))::integer)),'self-registered identities match JWT email');
select 'PASS T26';

-- T27: identical response channel for every category and caller:
-- never an error/SQLSTATE, never NULL, always the same canonical shape.
select runtime_test.assert_true((select count(*)=4*(select count(*) from runtime_test.enum_inputs)
  from runtime_test.enum_out),'all probes recorded');
-- Clients (anon, member, orphan): one identical denial for every input.
select runtime_test.assert_true(not exists(select 1 from runtime_test.enum_out
  where rol in ('anon','member','orphan') and cikti is distinct from 'SQLSTATE:42501'),
  'client roles uniformly denied (42501) for existing and missing names');
-- Server caller: never an error/NULL, always the same canonical shape.
select runtime_test.assert_true(not exists(select 1 from runtime_test.enum_out
  where rol='servis' and (cikti is null or cikti like 'SQLSTATE:%' or not runtime_test.canonical(cikti))),
  'no error/NULL/shape difference for any input');
select runtime_test.assert_true((select count(distinct substr(cikti,19,1))=4 from runtime_test.enum_out
  where rol='servis' and kategori='yok'),'fallback variant nibble varies like UUIDv4');
select 'PASS T27';

-- T28: canonicalisation and determinism are the same for existing and
-- non-existing names (case, leading/trailing/inner whitespace, repetition).
set role service_role;
select runtime_test.assert_true(
  runtime_test.resolve(' Student.User ')=runtime_test.resolve('student.user')
  and runtime_test.resolve(E'\tSTUDENT.USER\n')=runtime_test.resolve('student.user')
  and runtime_test.resolve(' Ghost.User ')=runtime_test.resolve('ghost.user')
  and runtime_test.resolve(E'\tGHOST.USER\n')=runtime_test.resolve('ghost.user')
  and runtime_test.resolve('ghost.user')=runtime_test.resolve('ghost.user')
  and runtime_test.resolve('Pending.Teacher')=runtime_test.resolve('pending.teacher'),
  'case/whitespace/repeat handled identically');
reset role;
select runtime_test.assert_true(not exists(select 1 from runtime_test.enum_out o
  where o.rol='servis' and o.kategori='yok' and o.girdi is not null
    and o.cikti<>(select runtime_test.resolve(o.girdi))),'non-existing answers stable');
-- Non-existing answers are distinct per name and never collide with any account.
select runtime_test.assert_true((select count(distinct cikti)=count(distinct public.normalize_username(coalesce(girdi,'')))
  from runtime_test.enum_out where rol='servis' and kategori='yok'),'fallback distinct per canonical name');
select runtime_test.assert_true(not exists(select 1 from runtime_test.enum_out o
  where o.rol='servis' and o.kategori='yok' and (o.cikti in (select auth_login_email from public.profiles where auth_login_email is not null)
    or o.cikti in (select email from auth.users where email is not null))),'fallback never names a real account');
select 'PASS T28';

-- T29: the attacker cannot compute the non-existing answer offline.
-- The previous oracle (md5 v2 formula) and unkeyed hashes — raw or shaped
-- like the resolver shapes its HMAC — match nothing; the answer is
-- reproducible only with the private pepper.
create function runtime_test.shape(h text) returns text language sql immutable as $$
  select 'u.'||substr(h,1,12)||'4'||substr(h,14,3)
    ||substr('89ab',(strpos('0123456789abcdef',substr(h,33,1))-1)%4+1,1)||substr(h,18,15)||'@auth.sosyolab.local';
$$;
select runtime_test.assert_true(not exists(select 1 from runtime_test.enum_out o,
  lateral (select public.normalize_username(coalesce(o.girdi,'')) n) c,
  lateral (values
    (md5('login:'||coalesce(nullif(c.n,''),'missing')||':v2')||md5('pad')),
    (md5(c.n)||md5('pad')),
    (encode(extensions.hmac(convert_to('login:v3:'||c.n,'UTF8'),''::bytea,'sha256'),'hex')),
    (encode(extensions.hmac(convert_to('login:v3:'||c.n,'UTF8'),'login'::bytea,'sha256'),'hex')),
    (encode(extensions.digest('login:v3:'||c.n,'sha256'),'hex')),
    (encode(extensions.digest(c.n,'sha256'),'hex'))) f(h)
  where o.cikti in ('u.'||substr(f.h,1,32)||'@auth.sosyolab.local', runtime_test.shape(f.h))),
  'no offline-computable formula reproduces any answer');
select runtime_test.assert_true(not exists(select 1 from runtime_test.enum_out o,
  lateral (select encode(extensions.hmac(convert_to('login:v3:'||public.normalize_username(coalesce(o.girdi,'')),'UTF8'),
    (select pepper from sosyolab_private.login_pepper),'sha256'),'hex') h) k
  where o.rol='servis' and o.kategori='yok' and o.cikti<>runtime_test.shape(k.h)),
  'non-existing answer is a pepper-keyed HMAC');
select runtime_test.assert_true((select octet_length(pepper)=32 and pepper<>decode(repeat('00',32),'hex')
  from sosyolab_private.login_pepper),'pepper is 32 random bytes');
select runtime_test.assert_true(not has_schema_privilege('anon','sosyolab_private','USAGE')
  and not has_schema_privilege('authenticated','sosyolab_private','USAGE')
  and not has_table_privilege('anon','sosyolab_private.login_pepper','SELECT')
  and not has_table_privilege('authenticated','sosyolab_private.login_pepper','SELECT'),'pepper ACL closed');
select runtime_test.assert_true(not exists(select 1 from pg_namespace n,
  aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
  where n.nspname='sosyolab_private' and a.grantee=0),'pepper schema no PUBLIC grant');
set role anon;
select runtime_test.denied($q$select pepper from sosyolab_private.login_pepper$q$,'42501');
reset role;
set role authenticated;
select runtime_test.login(10);
select runtime_test.denied($q$select pepper from sosyolab_private.login_pepper$q$,'42501');
reset role;
select 'PASS T29';

-- T30: no gross structural timing difference between an existing and a
-- non-existing valid username (same statements on both paths).
set role service_role;
select 'INFO T30 timing ratio existing/missing='||runtime_test.timing_ratio('student.user','ghost.user1',20,150);
select runtime_test.assert_true(runtime_test.timing_ratio('student.user','ghost.user1',20,150) between 0.67 and 1.5,
  'timing ratio within noise band');
reset role;
select 'PASS T30';

-- T31: server registration only accepts a canonical, non-anonymous Auth
-- identity read from auth.users (never from a client JWT claim), so no account
-- can get a shape that the resolver's fallback cannot imitate.
insert into auth.users(id,email,is_anonymous) values
  (runtime_test.identity(25),'u.test25@auth.sosyolab.local',false),
  (runtime_test.identity(26),'u.'||md5('shape')||'@auth.sosyolab.local',false),
  (runtime_test.identity(27),runtime_test.email(27),true);
create temp table counts_t31 as select id,kullanim_sayisi from public.davet_kodlari;
set role service_role;
select runtime_test.denied($q$select public.kullanici_kaydi_tamamla(runtime_test.identity(25),'shape.user',repeat('1',32))$q$,'P0001','Kayıt kimliği geçersiz');
select runtime_test.denied($q$select public.kullanici_kaydi_tamamla(runtime_test.identity(26),'shape.user',repeat('1',32))$q$,'P0001','Kayıt kimliği geçersiz');
select runtime_test.denied($q$select public.kullanici_kaydi_tamamla(runtime_test.identity(27),'shape.user',repeat('1',32))$q$,'P0001','Kayıt kimliği geçersiz');
select runtime_test.denied($q$select public.kullanici_kaydi_tamamla(gen_random_uuid(),'shape.user',repeat('1',32))$q$,'P0001','Kayıt kimliği geçersiz');
reset role;
select runtime_test.assert_true(not exists(select 1 from public.profiles where id in
  (runtime_test.identity(25),runtime_test.identity(26),runtime_test.identity(27))),'non-canonical identity no profile');
select runtime_test.assert_true(not exists(select 1 from public.davet_kodlari k join counts_t31 c using(id)
  where k.kullanim_sayisi<>c.kullanim_sayisi),'non-canonical identity consumes no invite');
drop table counts_t31;
delete from auth.users where id in (runtime_test.identity(25),runtime_test.identity(26),runtime_test.identity(27));
select 'PASS T31';

select set_config('request.jwt.claims','',false);
drop table runtime_test.enum_out, runtime_test.enum_inputs;
