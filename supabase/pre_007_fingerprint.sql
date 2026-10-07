-- ============================================================================
-- SosyoLab — PRE-007 production parmak izi (SALT OKUMA, PII yok)
-- ============================================================================
-- 007 uygulanmadan hemen önce, bakım penceresinde çalıştırılır. 007'nin
-- bölüm 0 ön koşullarını değişiklik yapmadan raporlar. Son satır:
--   durum = eski_006           -> 007 uygulanabilir
--   durum = final_006          -> 007 idempotent tekrar (zaten final)
--   durum = DESTEKLENMIYOR     -> DUR; 007 uygulanmaz
-- engel_* satırlarından biri 0 değilse 007 de RAISE ile duracaktır.
--
--   psql <baglanti> -v ON_ERROR_STOP=1 -f supabase/pre_007_fingerprint.sql
-- ============================================================================

begin transaction read only;

with f as (
  select
    to_regprocedure('public.kullanici_email_bul(text)') is not null as resolver,
    (to_regprocedure('public.kullanici_kaydi_tamamla(text,text,text)') is not null)::int
      + (to_regprocedure('public.kayit_icin_davet_kodu_kullan(text)') is not null)::int as eski_imza,
    (to_regprocedure('public.istek_siniri_tuket(jsonb)') is not null)::int
      + (to_regprocedure('public.kayit_on_kontrol(text,text,text)') is not null)::int
      + (to_regprocedure('public.kayit_sonucunu_kesinlestir(uuid)') is not null)::int
      + (to_regprocedure('public.davet_arama_ozeti(text)') is not null)::int
      + (to_regprocedure('public.kullanici_kaydi_tamamla(uuid,text,text,text)') is not null)::int
      + (to_regprocedure('public.kayit_icin_davet_kodu_kullan(uuid,text)') is not null)::int
      + (exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'davet_kodlari' and column_name = 'kod_arama_ozeti'))::int
      + (exists (select 1 from pg_namespace where nspname = 'sosyolab_private'))::int
      + (to_regclass('sosyolab_private.login_pepper') is not null)::int
      + (to_regclass('sosyolab_private.sunucu_pepperlari') is not null)::int
      + (to_regclass('sosyolab_private.istek_sayaclari') is not null)::int
      + (to_regclass('sosyolab_private.kayit_iptalleri') is not null)::int as final_isaret,
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'profiles'
      and column_name in ('username', 'class_year', 'teacher_status', 'auth_login_email',
                          'teacher_reviewed_at', 'teacher_reviewed_by', 'teacher_rejection_reason')) as kolon_006,
    (select count(*) from (
       select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in (
          'kullanici_email_bul', 'kullanici_kaydi_tamamla', 'kayit_icin_davet_kodu_kullan',
          'kayit_on_kontrol', 'kayit_sonucunu_kesinlestir', 'istek_siniri_tuket', 'davet_arama_ozeti',
          'admin_davet_kodu_olustur', 'ogretmen_basvurusunu_karara_bagla', 'normalize_username',
          'uye_profili_var_mi', 'davet_dogrulandi_mi', 'teacher_has_course', 'davet_kullan')
        group by p.proname having count(*) > 1) o) as engel_overload,
    (select count(*) from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal) as engel_auth_trigger,
    (select count(*) from public.profiles p where not exists (select 1 from auth.users u where u.id = p.id)) as engel_authsuz_profil,
    (select count(*) from public.profiles p where p.auth_login_email is not null
      and p.auth_login_email !~ '^u\.[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}@auth\.sosyolab\.local$') as engel_canonical_olmayan_ic_kimlik,
    (select count(*) from public.profiles p where p.username is not null
      and (p.username <> lower(p.username) or p.username !~ '^[a-z0-9._]{4,24}$'
           or p.username in ('admin', 'administrator', 'root', 'system', 'supabase', 'sosyolab', 'sosyolog35', 'sosyolog.35'))) as engel_gecersiz_username,
    (select count(*) from public.profiles p where not (
       (p.role = 'teacher' and coalesce(p.teacher_status, 'approved') = 'approved' and p.class_year is null)
       or (p.role = 'user' and (p.teacher_status is null or p.teacher_status in ('pending', 'rejected')))
       or (p.role = 'admin' and p.teacher_status is null and p.class_year is null))) as engel_rol_tutarsiz,
    (select count(*) from public.davet_kodlari k where k.audience_type is null
      or k.audience_type not in ('legacy', 'student', 'teacher')
      or (k.audience_type = 'student' and (k.class_year is null or k.class_year not between 1 and 4))
      or (k.audience_type = 'teacher' and k.class_year is not null)) as engel_davet_yapisi
)
select 'resolver_var' as kontrol, resolver::text as deger from f
union all select 'eski_kayit_imzasi(0..2)', eski_imza::text from f
union all select 'final_isaret(0..12)', final_isaret::text from f
union all select 'kolon_006(7)', kolon_006::text from f
union all select 'engel_overload', engel_overload::text from f
union all select 'engel_auth_trigger', engel_auth_trigger::text from f
union all select 'engel_authsuz_profil', engel_authsuz_profil::text from f
union all select 'engel_canonical_olmayan_ic_kimlik', engel_canonical_olmayan_ic_kimlik::text from f
union all select 'engel_gecersiz_username', engel_gecersiz_username::text from f
union all select 'engel_rol_tutarsiz', engel_rol_tutarsiz::text from f
union all select 'engel_davet_yapisi', engel_davet_yapisi::text from f
union all select 'resolver_anon_execute',
  coalesce(has_function_privilege('anon', to_regprocedure('public.kullanici_email_bul(text)'), 'execute')::text, 'yok')
union all select 'resolver_authenticated_execute',
  coalesce(has_function_privilege('authenticated', to_regprocedure('public.kullanici_email_bul(text)'), 'execute')::text, 'yok')
union all select 'authenticated_select_auth_login_email',
  has_column_privilege('authenticated', 'public.profiles', 'auth_login_email', 'select')::text
union all select 'durum', case
    when kolon_006 = 7 and resolver and eski_imza = 2 and final_isaret = 0
         and engel_overload + engel_auth_trigger + engel_authsuz_profil + engel_canonical_olmayan_ic_kimlik
             + engel_gecersiz_username + engel_rol_tutarsiz + engel_davet_yapisi = 0 then 'eski_006'
    when kolon_006 = 7 and resolver and eski_imza = 0 and final_isaret = 12
         and engel_overload + engel_auth_trigger + engel_authsuz_profil + engel_canonical_olmayan_ic_kimlik
             + engel_gecersiz_username + engel_rol_tutarsiz + engel_davet_yapisi = 0 then 'final_006'
    else 'DESTEKLENMIYOR' end from f;

commit;
