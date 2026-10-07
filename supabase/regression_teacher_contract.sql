-- ============================================================================
-- SosyoLab Teacher Regression Contract Tests (T-01 ... T-17)
-- ----------------------------------------------------------------------------
-- Amaç:
--   Teacher rolü için eklenen RLS/policy/fonksiyon sözleşmesini doğrulamak.
--   005 + 006 SONRASI son şemaya karşı çalışır.
--
-- Kullanım:
--   psql "<baglanti>" -v ON_ERROR_STOP=1 -f supabase/regression_teacher_contract.sql
--   (Aşağıdaki \set ON_ERROR_STOP on, -v unutulsa da hatayı non-zero yapar.)
--
-- Beklenen:
--   1) Her test için "PASS T-xx" NOTICE satırı
--   2) Herhangi bir FAIL veya SQL hatası -> exception -> psql exit != 0
--
-- Desenler PostgreSQL'in pg_policies deparse çıktısına göre yazılır.
-- search_path boş tutulur: deparse şema-nitelikli ve deterministik olur
-- (ör. public.is_admin(), 'pending'::text, = ANY (ARRAY[...])).
-- Salt okunur transaction: hiçbir şey yazmaz, temp nesne de oluşturmaz.
-- ============================================================================

\set ON_ERROR_STOP on

begin transaction read only;
set local search_path = '';

do $$
declare
  v_satir record;
  v_fail integer := 0;
  v_toplam integer := 0;
begin
  for v_satir in
    with
    pol as (
      select p.schemaname, p.tablename, p.policyname, p.cmd,
             lower(coalesce(p.qual, '')) as qual,
             lower(coalesce(p.with_check, '')) as with_check
        from pg_catalog.pg_policies p
       where p.schemaname in ('public', 'storage')
    ),
    fn as (
      select p.proname, lower(pg_catalog.pg_get_functiondef(p.oid)) as def
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
    ),
    trg as (
      -- tgtype bitleri: 1=ROW, 2=BEFORE, 4=INSERT, 8=DELETE, 16=UPDATE
      select c.relname as tablo, t.tgname as ad, t.tgtype, t.tgenabled, p.proname as fonksiyon
        from pg_catalog.pg_trigger t
        join pg_catalog.pg_class c on c.oid = t.tgrelid
        join pg_catalog.pg_proc p on p.oid = t.tgfoid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and not t.tgisinternal
    ),
    checks(test_id, aciklama, passed) as (
      select 'T-01', 'user role teacher/admina yükselemez',
             (
               exists (select 1 from fn where proname = 'profiles_rol_koru' and def like '%new.role := old.role%')
               and exists (select 1 from fn where proname = 'profiles_rol_varsayilan' and def like '%new.role := ''user''%')
             )

      union all
      select 'T-02', 'teacher kendi ders atamasını okuyabilir',
             exists (
               select 1 from pol
                where schemaname = 'public' and tablename = 'teacher_courses'
                  and policyname = 'teacher_courses_okuma' and cmd = 'SELECT'
                  and qual like '%(teacher_id = auth.uid())%'
             )

      union all
      -- Tam eşleşme: OR ile genişletilmiş (ör. "or true") ifade FAIL olur.
      -- Ek permissive SELECT/ALL policy de kapsamı genişleteceği için FAIL.
      select 'T-03', 'teacher başka teacher atamasını okuyamaz',
             (
               exists (
                 select 1 from pol
                  where schemaname = 'public' and tablename = 'teacher_courses'
                    and policyname = 'teacher_courses_okuma' and cmd = 'SELECT'
                    and qual = '((teacher_id = auth.uid()) or public.is_admin())'
               )
               and not exists (
                 select 1 from pol
                  where schemaname = 'public' and tablename = 'teacher_courses'
                    and cmd in ('SELECT', 'ALL') and policyname <> 'teacher_courses_okuma'
               )
             )

      union all
      select 'T-04', 'teacher kendine ders atayamaz (insert admin-only)',
             (
               exists (
                 select 1 from pol
                  where schemaname = 'public' and tablename = 'teacher_courses'
                    and policyname = 'teacher_courses_admin_ekleme' and cmd = 'INSERT'
                    and with_check = 'public.is_admin()'
               )
               and not exists (
                 select 1 from pol
                  where schemaname = 'public' and tablename = 'teacher_courses'
                    and cmd in ('INSERT', 'UPDATE', 'ALL') and policyname <> 'teacher_courses_admin_ekleme'
               )
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
                    and tgenabled = 'O'
                    and (tgtype & 1) = 1   -- ROW
                    and (tgtype & 2) = 2   -- BEFORE
                    and (tgtype & 4) = 4   -- INSERT
               )
             )

      union all
      select 'T-06', 'teacher başka derse upload -> RLS reject',
             (
               exists (
                 select 1 from pol
                  where schemaname = 'public' and tablename = 'materials'
                    and policyname = 'materials_gonderim' and cmd = 'INSERT'
                    and with_check like '%public.is_teacher() and public.teacher_has_course(course_id)%'
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
                    and with_check like '%(not public.is_teacher())%'
                    and with_check like '%(status = ''pending''::text)%'
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
                    and with_check like '%(status = ''pending''::text)%'
                    and with_check like '%(reviewed_at is null)%'
                    and with_check like '%(reviewed_by is null)%'
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
                  and qual like '%public.is_admin()%'
                  and with_check like '%public.is_admin()%'
             )

      union all
      select 'T-11', 'admin mevcut moderation işlemlerini yapabilir',
             exists (
               select 1 from pol
                where schemaname = 'public' and tablename = 'materials'
                  and policyname = 'materials_inceleme' and cmd = 'UPDATE'
                  and qual like '%(status = ''pending''::text)%'
                  and with_check like '%(status = any (array[''approved''::text, ''rejected''::text]))%'
             )

      union all
      select 'T-12', 'teacher_courses admin tarafından yönetilebilir',
             (
               exists (
                 select 1 from pol
                  where schemaname = 'public' and tablename = 'teacher_courses'
                    and policyname = 'teacher_courses_admin_ekleme' and cmd = 'INSERT'
                    and with_check like '%public.is_admin()%'
               )
               and exists (
                 select 1 from pol
                  where schemaname = 'public' and tablename = 'teacher_courses'
                    and policyname = 'teacher_courses_admin_silme' and cmd = 'DELETE'
                    and qual like '%public.is_admin()%'
               )
             )

      union all
      select 'T-13', 'teacher Storage''a yalnız kendi UID klasörüne yükler',
             exists (
               select 1 from pol
                where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'materyal_yukleme' and cmd = 'INSERT'
                  and with_check like '%((storage.foldername(name))[1] = (auth.uid())::text)%'
             )

      union all
      select 'T-14', 'doğrudan yayımlanan dosya authenticated kullanıcıya okunur',
             exists (
               select 1 from pol
                where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'materyal_okuma' and cmd = 'SELECT'
                  and qual like '%exists (%'
                  and qual like '%from public.materials m%'
                  and qual like '%(m.status = ''approved''::text)%'
             )

      union all
      select 'T-15', 'invite/RLS hardening regress etmez',
             (
               exists (
                 select 1 from pol
                  where schemaname = 'public' and tablename = 'materials'
                    and policyname = 'materials_gonderim' and cmd = 'INSERT'
                    and with_check like '%public.davet_dogrulandi_mi()%'
               )
               and exists (
                 select 1 from pol
                  where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'materyal_yukleme' and cmd = 'INSERT'
                    and with_check like '%public.davet_dogrulandi_mi()%'
               )
             )

      union all
      select 'T-16', 'sos401 teacher ataması/yayını canonical olarak dışlanır',
             (
               exists (
                 select 1 from pg_catalog.pg_constraint c
                  where c.conrelid = 'public.teacher_courses'::pg_catalog.regclass
                    and c.conname = 'teacher_courses_sos401_yasak' and c.contype = 'c' and c.convalidated
                    and lower(pg_catalog.pg_get_constraintdef(c.oid)) = 'check ((lower(btrim(course_id)) <> ''sos401''::text))'
               )
               and exists (
                 select 1 from fn
                  where proname = 'teacher_has_course'
                    and def like '%lower(btrim(p_course_id)) <> ''sos401''%'
               )
               and exists (
                 select 1 from fn
                  where proname = 'teacher_courses_teacher_koru'
                    and def like '%if lower(btrim(new.course_id)) = ''sos401'' then%'
               )
             )

      union all
      select 'T-17', 'ders ataması yalnız onaylı teacher profiline, trigger ile zorunlu',
             (
               exists (
                 select 1 from fn
                  where proname = 'teacher_courses_teacher_koru'
                    and def like '%p.role = ''teacher''%'
                    and def like '%p.teacher_status = ''approved''%'
                    and def like '%raise exception%'
               )
               and exists (
                 select 1 from trg
                  where tablo = 'teacher_courses'
                    and ad = 'teacher_courses_teacher_koru_trg'
                    and fonksiyon = 'teacher_courses_teacher_koru'
                    and tgenabled = 'O'
                    and (tgtype & 1) = 1    -- ROW
                    and (tgtype & 2) = 2    -- BEFORE
                    and (tgtype & 4) = 4    -- INSERT
                    and (tgtype & 16) = 16  -- UPDATE
               )
               and exists (
                 select 1 from pg_catalog.pg_class c
                  where c.oid = 'public.teacher_courses'::pg_catalog.regclass
                    and c.relrowsecurity
               )
             )
    )
    select test_id, aciklama, passed from checks order by test_id
  loop
    v_toplam := v_toplam + 1;
    if v_satir.passed then
      raise notice 'PASS % %', v_satir.test_id, v_satir.aciklama;
    else
      v_fail := v_fail + 1;
      raise warning 'FAIL % %', v_satir.test_id, v_satir.aciklama;
    end if;
  end loop;

  if v_fail > 0 or v_toplam <> 17 then
    raise exception 'Teacher regression contract FAILED: % başarısız, % / 17 test çalıştı', v_fail, v_toplam;
  end if;
  raise notice 'PASS teacher regression contract (T-01..T-17)';
end;
$$;

commit;
