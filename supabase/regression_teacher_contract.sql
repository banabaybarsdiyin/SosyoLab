-- ============================================================================
-- SosyoLab Teacher Regression Contract Tests (T-01 ... T-15)
-- ----------------------------------------------------------------------------
-- Amaç:
--   Teacher rolü için eklenen RLS/policy/fonksiyon sözleşmesini doğrulamak.
--
-- Kullanım:
--   psql "<baglanti>" -f supabase/regression_teacher_contract.sql
--
-- Beklenen:
--   1) Sonuç tablosunda tüm satırlar PASS
--   2) En sondaki DO bloğu hata vermeden tamamlanmalı
-- ============================================================================

with
pol as (
  select
    p.schemaname,
    p.tablename,
    p.policyname,
    p.cmd,
    lower(coalesce(p.qual, '')) as qual,
    lower(coalesce(p.with_check, '')) as with_check
  from pg_policies p
  where p.schemaname in ('public', 'storage')
),
fn as (
  select
    p.proname,
    lower(pg_get_functiondef(p.oid)) as def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
),
trg as (
  select
    c.relname as tablo,
    t.tgname as ad,
    t.tgtype,
    p.proname as fonksiyon
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_proc p on p.oid = t.tgfoid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and not t.tgisinternal
),
checks as (
  select 'T-01'::text as test_id,
         'user role teacher/admina yükselemez'::text as aciklama,
         (
           exists (select 1 from fn where proname = 'profiles_rol_koru' and def like '%new.role := old.role%')
           and exists (select 1 from fn where proname = 'profiles_rol_varsayilan' and def like '%new.role := ''user''%')
         ) as passed

  union all
  select 'T-02', 'teacher kendi ders atamasını okuyabilir',
         exists (
           select 1 from pol
           where schemaname = 'public' and tablename = 'teacher_courses'
             and policyname = 'teacher_courses_okuma' and cmd = 'SELECT'
             and qual like '%teacher_id = auth.uid()%'
         )

  union all
  select 'T-03', 'teacher başka teacher atamasını okuyamaz',
         exists (
           select 1 from pol
           where schemaname = 'public' and tablename = 'teacher_courses'
             and policyname = 'teacher_courses_okuma' and cmd = 'SELECT'
             and qual like '%teacher_id = auth.uid()%'
             and qual not regexp '^\s*\(?\s*true\s*\)?\s*$'
         )

  union all
  select 'T-04', 'teacher kendine ders atayamaz (insert admin-only)',
         exists (
           select 1 from pol
           where schemaname = 'public' and tablename = 'teacher_courses'
             and policyname = 'teacher_courses_admin_ekleme' and cmd = 'INSERT'
             and with_check like '%is_admin()%'
             and with_check not like '%auth.uid()%'
         )

  union all
  select 'T-05', 'teacher atanmış derse upload -> approved (server-side)',
         (
           exists (
             select 1 from fn
             where proname = 'materials_gonderim_durumunu_ata'
               and def like '%if public.is_teacher()%'
               and def like '%new.status := ''approved''%'
               and def like '%new.reviewed_at := now()%'
               and def like '%new.reviewed_by := auth.uid()%'
           )
           and exists (
             select 1 from trg
             where tablo = 'materials'
               and ad = 'materials_gonderim_durumunu_ata_trg'
               and fonksiyon = 'materials_gonderim_durumunu_ata'
               and (tgtype & 4) = 4   -- BEFORE
               and (tgtype & 1) = 1   -- ROW
           )
         )

  union all
  select 'T-06', 'teacher başka derse upload -> RLS reject',
         (
           exists (
             select 1 from pol
             where schemaname = 'public' and tablename = 'materials'
               and policyname = 'materials_gonderim' and cmd = 'INSERT'
               and with_check like '%teacher_has_course(course_id)%'
           )
           and exists (
             select 1 from fn
             where proname = 'materials_gonderim_durumunu_ata'
               and def like '%if not public.teacher_has_course(new.course_id) then%'
               and def like '%raise exception%'
           )
         )

  union all
  select 'T-07', 'normal user upload -> pending',
         (
           exists (
             select 1 from fn
             where proname = 'materials_gonderim_durumunu_ata'
               and def like '%else%'
               and def like '%new.status := ''pending''%'
           )
           and exists (
             select 1 from pol
             where schemaname = 'public' and tablename = 'materials'
               and policyname = 'materials_gonderim' and cmd = 'INSERT'
               and with_check like '%not public.is_teacher()%'
               and with_check like '%status = ''pending''%'
           )
         )

  union all
  select 'T-08', 'normal user status=approved gönderse bile approved olamaz',
         (
           exists (
             select 1 from fn
             where proname = 'materials_gonderim_durumunu_ata'
               and def like '%new.status := ''pending''%'
               and def like '%new.reviewed_at := null%'
               and def like '%new.reviewed_by := null%'
           )
           and exists (
             select 1 from pol
             where schemaname = 'public' and tablename = 'materials'
               and policyname = 'materials_gonderim' and cmd = 'INSERT'
               and with_check like '%status = ''pending''%'
               and with_check like '%reviewed_at is null%'
               and with_check like '%reviewed_by is null%'
           )
         )

  union all
  select 'T-09', 'teacher admin değildir',
         exists (
           select 1 from fn
           where proname = 'is_admin'
             and def like '%p.role = ''admin''%'
             and def not like '%teacher%'
         )

  union all
  select 'T-10', 'teacher admin moderation yapamaz',
         exists (
           select 1 from pol
           where schemaname = 'public' and tablename = 'materials'
             and policyname = 'materials_inceleme' and cmd = 'UPDATE'
             and qual like '%is_admin()%'
             and with_check like '%is_admin()%'
         )

  union all
  select 'T-11', 'admin mevcut moderation işlemlerini yapabilir',
         exists (
           select 1 from pol
           where schemaname = 'public' and tablename = 'materials'
             and policyname = 'materials_inceleme' and cmd = 'UPDATE'
             and qual like '%status = ''pending''%'
             and with_check like '%status in (''approved'', ''rejected'')%'
         )

  union all
  select 'T-12', 'teacher_courses admin tarafından yönetilebilir',
         (
           exists (
             select 1 from pol
             where schemaname = 'public' and tablename = 'teacher_courses'
               and policyname = 'teacher_courses_admin_ekleme' and cmd = 'INSERT'
               and with_check like '%is_admin()%'
           )
           and exists (
             select 1 from pol
             where schemaname = 'public' and tablename = 'teacher_courses'
               and policyname = 'teacher_courses_admin_silme' and cmd = 'DELETE'
               and qual like '%is_admin()%'
           )
         )

  union all
  select 'T-13', 'teacher Storage\'a yalnız kendi UID klasörüne yükler',
         exists (
           select 1 from pol
           where schemaname = 'storage' and tablename = 'objects'
             and policyname = 'materyal_yukleme' and cmd = 'INSERT'
             and with_check like '%(storage.foldername(name))[1] = auth.uid()::text%'
         )

  union all
  select 'T-14', 'doğrudan yayımlanan dosya authenticated kullanıcıya okunur',
         exists (
           select 1 from pol
           where schemaname = 'storage' and tablename = 'objects'
             and policyname = 'materyal_okuma' and cmd = 'SELECT'
             and qual like '%exists (%'
             and qual like '%from public.materials m%'
             and qual like '%m.status = ''approved''%'
         )

  union all
  select 'T-15', 'invite/RLS hardening regress etmez',
         (
           exists (
             select 1 from pol
             where schemaname = 'public' and tablename = 'materials'
               and policyname = 'materials_gonderim' and cmd = 'INSERT'
               and with_check like '%davet_dogrulandi_mi()%'
           )
           and exists (
             select 1 from pol
             where schemaname = 'storage' and tablename = 'objects'
               and policyname = 'materyal_yukleme' and cmd = 'INSERT'
               and with_check like '%davet_dogrulandi_mi()%'
           )
         )
)
select
  test_id,
  case when passed then 'PASS' else 'FAIL' end as sonuc,
  aciklama
from checks
order by test_id;

-- FAIL varsa script'i kır.
do $$
declare
  v_fail integer;
begin
  with
  pol as (
    select p.schemaname, p.tablename, p.policyname, p.cmd,
           lower(coalesce(p.qual, '')) as qual,
           lower(coalesce(p.with_check, '')) as with_check
    from pg_policies p
    where p.schemaname in ('public', 'storage')
  ),
  fn as (
    select p.proname, lower(pg_get_functiondef(p.oid)) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  ),
  trg as (
    select c.relname as tablo, t.tgname as ad, t.tgtype, p.proname as fonksiyon
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal
  ),
  checks as (
    select 'T-01'::text as test_id,
           (
             exists (select 1 from fn where proname = 'profiles_rol_koru' and def like '%new.role := old.role%')
             and exists (select 1 from fn where proname = 'profiles_rol_varsayilan' and def like '%new.role := ''user''%')
           ) as passed
    union all select 'T-02', exists (select 1 from pol where schemaname='public' and tablename='teacher_courses' and policyname='teacher_courses_okuma' and cmd='SELECT' and qual like '%teacher_id = auth.uid()%')
    union all select 'T-03', exists (select 1 from pol where schemaname='public' and tablename='teacher_courses' and policyname='teacher_courses_okuma' and cmd='SELECT' and qual like '%teacher_id = auth.uid()%' and qual not regexp '^\s*\(?\s*true\s*\)?\s*$')
    union all select 'T-04', exists (select 1 from pol where schemaname='public' and tablename='teacher_courses' and policyname='teacher_courses_admin_ekleme' and cmd='INSERT' and with_check like '%is_admin()%' and with_check not like '%auth.uid()%')
    union all select 'T-05', (exists (select 1 from fn where proname='materials_gonderim_durumunu_ata' and def like '%if public.is_teacher()%' and def like '%new.status := ''approved''%' and def like '%new.reviewed_by := auth.uid()%') and exists (select 1 from trg where tablo='materials' and ad='materials_gonderim_durumunu_ata_trg' and fonksiyon='materials_gonderim_durumunu_ata' and (tgtype & 4)=4 and (tgtype & 1)=1))
    union all select 'T-06', (exists (select 1 from pol where schemaname='public' and tablename='materials' and policyname='materials_gonderim' and cmd='INSERT' and with_check like '%teacher_has_course(course_id)%') and exists (select 1 from fn where proname='materials_gonderim_durumunu_ata' and def like '%if not public.teacher_has_course(new.course_id) then%' and def like '%raise exception%'))
    union all select 'T-07', (exists (select 1 from fn where proname='materials_gonderim_durumunu_ata' and def like '%new.status := ''pending''%') and exists (select 1 from pol where schemaname='public' and tablename='materials' and policyname='materials_gonderim' and cmd='INSERT' and with_check like '%not public.is_teacher()%' and with_check like '%status = ''pending''%'))
    union all select 'T-08', (exists (select 1 from fn where proname='materials_gonderim_durumunu_ata' and def like '%new.status := ''pending''%' and def like '%new.reviewed_at := null%' and def like '%new.reviewed_by := null%') and exists (select 1 from pol where schemaname='public' and tablename='materials' and policyname='materials_gonderim' and cmd='INSERT' and with_check like '%status = ''pending''%' and with_check like '%reviewed_at is null%' and with_check like '%reviewed_by is null%'))
    union all select 'T-09', exists (select 1 from fn where proname='is_admin' and def like '%p.role = ''admin''%' and def not like '%teacher%')
    union all select 'T-10', exists (select 1 from pol where schemaname='public' and tablename='materials' and policyname='materials_inceleme' and cmd='UPDATE' and qual like '%is_admin()%' and with_check like '%is_admin()%')
    union all select 'T-11', exists (select 1 from pol where schemaname='public' and tablename='materials' and policyname='materials_inceleme' and cmd='UPDATE' and qual like '%status = ''pending''%' and with_check like '%status in (''approved'', ''rejected'')%')
    union all select 'T-12', (exists (select 1 from pol where schemaname='public' and tablename='teacher_courses' and policyname='teacher_courses_admin_ekleme' and cmd='INSERT' and with_check like '%is_admin()%') and exists (select 1 from pol where schemaname='public' and tablename='teacher_courses' and policyname='teacher_courses_admin_silme' and cmd='DELETE' and qual like '%is_admin()%'))
    union all select 'T-13', exists (select 1 from pol where schemaname='storage' and tablename='objects' and policyname='materyal_yukleme' and cmd='INSERT' and with_check like '%(storage.foldername(name))[1] = auth.uid()::text%')
    union all select 'T-14', exists (select 1 from pol where schemaname='storage' and tablename='objects' and policyname='materyal_okuma' and cmd='SELECT' and qual like '%from public.materials m%' and qual like '%m.status = ''approved''%')
    union all select 'T-15', (exists (select 1 from pol where schemaname='public' and tablename='materials' and policyname='materials_gonderim' and cmd='INSERT' and with_check like '%davet_dogrulandi_mi()%') and exists (select 1 from pol where schemaname='storage' and tablename='objects' and policyname='materyal_yukleme' and cmd='INSERT' and with_check like '%davet_dogrulandi_mi()%'))
  )
  select count(*) into v_fail from checks where not passed;

  if v_fail > 0 then
    raise exception 'Teacher regression contract FAILED: % test başarısız', v_fail;
  end if;
end;
$$;
