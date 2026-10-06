-- PRE-006 / schema -> 001..005. SALT OKUMA; 006 kolonları kullanılmaz.
-- Admin varlığı FAIL değildir. Teacher=0: Auth migration N/A.
-- Teacher>0: açık migration planı olmadan production apply/frontend DUR.
-- Legacy user: preserve / re-onboard / test hesabı silme planı kararı kaydedilir.
-- sos401=0 olsa da 006 cleanup ve korumaları uygulanır.
begin transaction read only;

select count(*) as profiles_total from public.profiles;
select r.role, count(p.id) as profile_count
from (values ('admin'), ('teacher'), ('user')) r(role)
left join public.profiles p on p.role = r.role
group by r.role order by r.role;

select p.id, p.display_name, u.email as auth_email
from public.profiles p left join auth.users u on u.id = p.id
where p.role = 'teacher' order by p.created_at, p.id;

select p.id, p.display_name, u.email as auth_email
from public.profiles p left join auth.users u on u.id = p.id
where p.role = 'admin' order by p.created_at, p.id;

select teacher_id, course_id, created_at
from public.teacher_courses where lower(btrim(course_id)) = 'sos401';
select count(*) as legacy_sos401_assignment_count
from public.teacher_courses where lower(btrim(course_id)) = 'sos401';

-- 005'teki tüm davetler 006 tarafından legacy sınıfına alınır.
select count(*) as active_legacy_invite_count
from public.davet_kodlari where aktif;

-- Auth sürümlerinde opsiyonel metadata için row JSON: olmayan alan NULL'dır.
-- Parola/token veya tüm metadata dökülmez; yalnız ayırt edici alanlar seçilir.
select p.id, p.display_name, p.student_number, p.created_at,
       u.email as auth_email,
       to_jsonb(u)->>'is_anonymous' as is_anonymous,
       to_jsonb(u)->'raw_app_meta_data'->>'provider' as auth_provider,
       to_jsonb(u)->'raw_app_meta_data'->'providers' as auth_providers,
       to_jsonb(u)->'raw_user_meta_data'->>'is_anonymous' as metadata_is_anonymous,
       exists (select 1 from public.davet_dogrulamalari d where d.user_id=p.id) as invite_stamp,
       (select count(*) from public.materials m where m.uploader_id=p.id) as material_count
from public.profiles p left join auth.users u on u.id=p.id
where p.role='user' order by p.created_at, p.id;

select count(*) as auth_without_profile_count
from auth.users u where not exists (select 1 from public.profiles p where p.id=u.id);
commit;
