-- Real SQL/RLS runtime; assertions are SECURITY INVOKER. T17 runs in JS
-- using two simultaneous sessions blocked on the same final-slot row.
create function runtime_test.material(course text, file text) returns void
language sql security invoker as $$
  insert into public.materials(course_id,uploader_id,title,file_path,file_name)
  values(course,auth.uid(),'Synthetic runtime fixture',auth.uid()::text||'/'||file,file);
$$;
select public.admin_davet_kodu_olustur(repeat('1',32),'student',2::smallint,'synthetic student',null,20);
select public.admin_davet_kodu_olustur(repeat('2',32),'teacher',null,'synthetic teacher',null,20);
select public.admin_davet_kodu_olustur(repeat('3',32),'student',1::smallint,'synthetic final slot',null,1);
select runtime_test.denied($q$select public.admin_davet_kodu_olustur('SHORT','student',1::smallint)$q$,
  'P0001','32 hex');
select runtime_test.assert_true((select audience_type='legacy' from public.davet_kodlari
  where etiket='synthetic legacy'),'legacy audience migrated');

set role anon;
select runtime_test.denied($q$insert into public.profiles(id) values(runtime_test.identity(4))$q$,'42501');
select 'PASS T01';
reset role;
set role authenticated;
select runtime_test.login(4);
select runtime_test.denied($q$insert into public.profiles(id,username) values(auth.uid(),'squat.name')$q$,'42501');
select 'PASS T02';
reset role;

-- Nonempty approved archive so orphan SELECT cannot pass vacuously.
set role authenticated;
select runtime_test.login(1);
select runtime_test.material('sos101','archive.pdf');
update public.materials set status='approved' where file_name='archive.pdf';
reset role;
set role authenticated;
select runtime_test.login(4);
select runtime_test.assert_true((select count(*)=0 from public.materials),'orphan SELECT');
select 'PASS T03';
select runtime_test.denied($q$select runtime_test.material('sos101','orphan.pdf')$q$,'42501');
select 'PASS T04';
select runtime_test.denied($q$insert into storage.objects(bucket_id,name) values('materyaller',auth.uid()::text||'/orphan.pdf')$q$,'42501');
select 'PASS T05';

select runtime_test.login(16);
select runtime_test.denied($q$select public.kullanici_kaydi_tamamla('invalid.user','SYNTHETIC-WRONG')$q$,
  'P0001','Davet kodu geçersiz');
select runtime_test.assert_true(not public.uye_profili_var_mi() and not public.davet_dogrulandi_mi(),'invalid no membership');
reset role;
select runtime_test.assert_true(not exists(select 1 from public.davet_dogrulamalari where user_id=runtime_test.identity(16)), 'invalid no stamp');
select 'PASS T06';

set role authenticated;
select runtime_test.login(10);
select public.kullanici_kaydi_tamamla('student.user',repeat('1',32));
select runtime_test.assert_true((select role='user' and class_year=2 and teacher_status is null
  from public.profiles where id=auth.uid()),'student classification');
select 'PASS T07';
select runtime_test.login(11);
select public.kullanici_kaydi_tamamla('pending.teacher',repeat('2',32),'Synthetic Pending');
select runtime_test.assert_true((select role='user' and class_year is null and teacher_status='pending'
  from public.profiles where id=auth.uid()),'teacher pending classification');
select 'PASS T08';
select runtime_test.assert_true(not public.is_teacher(),'pending is_teacher false');
select 'PASS T09';
select runtime_test.denied($q$select public.ogretmen_basvurusunu_karara_bagla(auth.uid(),'approve')$q$,
  'P0001','yalnızca yöneticiye');
select 'PASS T10';
select runtime_test.login(4);
select runtime_test.denied($q$insert into public.profiles(id,username) values(auth.uid(),'student.user')$q$,'42501');
select runtime_test.assert_true(not public.uye_profili_var_mi(),'squatter no profile');
select 'PASS T11';
select runtime_test.login(14);
select runtime_test.denied($q$select public.kullanici_kaydi_tamamla(' Student.User ',repeat('1',32))$q$,'23505');
select runtime_test.assert_true(not public.uye_profili_var_mi(),'collision no membership');
select 'PASS T12';
select runtime_test.login(15);
select runtime_test.denied($q$select public.kullanici_kaydi_tamamla('admin',repeat('1',32))$q$,'P0001','kullanılamaz');
select 'PASS T13';

-- Admin cannot create/update canonical sos401 assignments, even with valid teacher.
select runtime_test.login(1);
select runtime_test.denied($q$insert into public.teacher_courses values(runtime_test.identity(2),'sos401',now())$q$,'P0001','sos401');
select runtime_test.denied($q$insert into public.teacher_courses values(runtime_test.identity(2),'SOS401',now())$q$,'P0001','sos401');
select runtime_test.denied($q$insert into public.teacher_courses values(runtime_test.identity(2),' sOs401 ',now())$q$,'P0001','sos401');
insert into public.teacher_courses(teacher_id,course_id) values(runtime_test.identity(2),'sos102');
select runtime_test.denied($q$update public.teacher_courses set course_id=' SOS401 ' where course_id='sos102'$q$,'42501');
reset role;
select runtime_test.denied($q$update public.teacher_courses set course_id=' SOS401 ' where course_id='sos102'$q$,'P0001','sos401');
begin;
alter table public.teacher_courses disable trigger teacher_courses_teacher_koru_trg;
select runtime_test.denied($q$insert into public.teacher_courses(teacher_id,course_id) values(runtime_test.identity(2),' SOS401 ')$q$,'23514','teacher_courses_sos401_yasak');
rollback;
select 'PASS T14';

set role authenticated;
select runtime_test.login(1);
select runtime_test.material('sos401','admin401.pdf');
update public.materials set status='approved' where file_name='admin401.pdf';
select runtime_test.assert_true((select status='approved' and reviewed_by=auth.uid()
  from public.materials where file_name='admin401.pdf'),'admin sos401 management');
reset role;
select 'PASS T15';

select runtime_test.assert_true(not exists(select 1 from public.teacher_courses where lower(btrim(course_id))='sos401'),'legacy cleaned');
-- Force corrupt legacy row only inside rolled-back disposable transaction:
-- prove helper defense independently of CHECK/trigger.
begin;
alter table public.teacher_courses drop constraint teacher_courses_sos401_yasak;
alter table public.teacher_courses disable trigger teacher_courses_teacher_koru_trg;
insert into public.teacher_courses(teacher_id,course_id) values(runtime_test.identity(2),'sos401'),(runtime_test.identity(2),' SOS401 ');
set local role authenticated;
select runtime_test.login(2);
select runtime_test.assert_true(not public.teacher_has_course('sos401') and not public.teacher_has_course(' SOS401 '),'corrupt legacy ineffective');
select runtime_test.denied($q$select runtime_test.material('sos401','legacy401.pdf')$q$,'P0001','yetkisine sahip değil');
rollback;
select 'PASS T16';

-- Repeat completed registration is rejected without a second consumption.
create temp table counts_before as select id,kullanim_sayisi from public.davet_kodlari;
set role authenticated;
select runtime_test.login(10);
select runtime_test.denied($q$select public.kullanici_kaydi_tamamla('student.user',repeat('1',32))$q$,'P0001','zaten tamamlanmış');
select runtime_test.denied($q$select public.kullanici_kaydi_tamamla('student.user',repeat('2',32))$q$,'P0001','zaten tamamlanmış');
reset role;
select runtime_test.assert_true(not exists(select 1 from public.davet_kodlari k join counts_before b using(id) where k.kullanim_sayisi<>b.kullanim_sayisi),'retry counts stable');
drop table counts_before;

-- Existing stamp + different code must never complete registration.
insert into public.davet_dogrulamalari(user_id,davet_id)
select runtime_test.identity(17),id from public.davet_kodlari where etiket='synthetic teacher';
update public.davet_kodlari set kullanim_sayisi=kullanim_sayisi+1 where etiket='synthetic teacher';
set role authenticated;
select runtime_test.login(17);
select runtime_test.denied($q$select public.kullanici_kaydi_tamamla('stamped.teacher','SYNTHETIC-WRONG','Synthetic stamped')$q$,'P0001','damgasıyla eşleşmiyor');
select runtime_test.denied($q$select public.kullanici_kaydi_tamamla('stamped.teacher',repeat('1',32),'Synthetic stamped')$q$,'P0001','damgasıyla eşleşmiyor');
select runtime_test.assert_true(not public.uye_profili_var_mi(),'wrong stamp cannot register');
select public.kullanici_kaydi_tamamla('stamped.teacher',repeat('2',32),'Synthetic stamped');
select runtime_test.assert_true((select teacher_status='pending' from public.profiles where id=auth.uid()),'same stamp classified');
reset role;
select runtime_test.assert_true((select kullanim_sayisi=2 from public.davet_kodlari where etiket='synthetic teacher'),'stamp retry no double count');
select 'PASS T18';

set role authenticated;
select runtime_test.login(10);
select runtime_test.assert_true(public.uye_profili_var_mi() and public.davet_dogrulandi_mi(),'registered membership');
select runtime_test.assert_true((select count(*)>=2 from public.materials where status='approved'),'registered archive access');
insert into storage.objects(bucket_id,name) values('materyaller',auth.uid()::text||'/student.pdf');
select runtime_test.material('sos101','student.pdf');
select runtime_test.assert_true((select status='pending' from public.materials where file_name='student.pdf'),'student moderation');
select runtime_test.assert_true((select count(*)=1 from storage.objects where name=auth.uid()::text||'/student.pdf'),'student own storage access');
select 'PASS T19';

select runtime_test.login(13);
select public.kullanici_kaydi_tamamla('approved.teacher',repeat('2',32),'Synthetic Approved');
select runtime_test.login(1);
select public.ogretmen_basvurusunu_karara_bagla(runtime_test.identity(13),'approve');
insert into public.teacher_courses(teacher_id,course_id) values(runtime_test.identity(13),'sos101');
select runtime_test.login(13);
select runtime_test.assert_true(public.is_teacher() and not public.is_admin(),'approved teacher role');
insert into storage.objects(bucket_id,name) values('materyaller',auth.uid()::text||'/teacher.pdf');
select runtime_test.material('sos101','teacher.pdf');
select runtime_test.assert_true((select status='approved' and reviewed_by=auth.uid() and reviewed_at is not null
  from public.materials where file_name='teacher.pdf'),'teacher direct publish');
select 'PASS T20';
select runtime_test.denied($q$select runtime_test.material('sos103','unassigned.pdf')$q$,'P0001','yetkisine sahip değil');
select runtime_test.denied($q$select runtime_test.material(' SOS401 ','teacher401.pdf')$q$,'P0001','yetkisine sahip değil');
select 'PASS T21';

select runtime_test.login(4);
select runtime_test.denied($q$select public.davet_kullan(repeat('1',32))$q$,'42501');
select runtime_test.denied($q$select public.davet_kullan(repeat('2',32))$q$,'42501');
reset role;
select runtime_test.assert_true(not exists(select 1 from public.davet_dogrulamalari where user_id=runtime_test.identity(4)),'legacy helper no stamp');
select runtime_test.assert_true((select kullanim_sayisi=1 from public.davet_kodlari where etiket='synthetic student'),'legacy helper no student consumption');
select runtime_test.assert_true((select kullanim_sayisi=3 from public.davet_kodlari where etiket='synthetic teacher'),'legacy helper no teacher consumption');
select 'PASS T22';

set role authenticated;
select runtime_test.login(11);
select runtime_test.assert_true(public.davet_dogrulandi_mi() and (select count(*)>0 from public.materials where status='approved'),'pending retains reading');
select runtime_test.denied($q$select runtime_test.material('sos101','pending.pdf')$q$,'42501');
select runtime_test.denied($q$insert into storage.objects(bucket_id,name) values('materyaller',auth.uid()::text||'/pending.pdf')$q$,'42501');
select 'PASS T24';
select runtime_test.login(12);
select public.kullanici_kaydi_tamamla('rejected.teacher',repeat('2',32),'Synthetic Rejected');
select runtime_test.login(1);
select public.ogretmen_basvurusunu_karara_bagla(runtime_test.identity(12),'reject','Synthetic reason');
select runtime_test.login(12);
select runtime_test.assert_true(not public.is_teacher() and (select teacher_status='rejected' from public.profiles where id=auth.uid()),'rejected status retained');
select runtime_test.assert_true((select count(*)>0 from public.materials where status='approved'),'rejected retains reading');
select runtime_test.denied($q$select runtime_test.material('sos101','rejected.pdf')$q$,'42501');
select runtime_test.denied($q$insert into storage.objects(bucket_id,name) values('materyaller',auth.uid()::text||'/rejected.pdf')$q$,'42501');
select 'PASS T25';
reset role;

-- Login RPC exposes only internal emails; personal legacy Auth email stays private.
set role anon;
select runtime_test.assert_true(public.kullanici_email_bul('no.such.user') like '%@auth.sosyolab.local'
  and public.kullanici_email_bul('student.user') like '%@auth.sosyolab.local','login internal email only');
reset role;
