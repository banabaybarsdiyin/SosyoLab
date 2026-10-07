-- ============================================================================
-- SosyoLab — legacy kimlik ve profilsiz Auth envanteri (SALT OKUMA)
-- ============================================================================
-- 006/007 SONRASI, backfill kararları için. Hiçbir email, ad soyad, öğrenci
-- numarası veya tam UUID yazdırılmaz: kimlik yalnız 8 hane kısa önekle,
-- email yalnız sınıfıyla raporlanır. Tam UUID'yi operatör güvenli ortamda
-- (Dashboard) kısa önekle eşler. Çıktı paylaşılmadan önce yine gözden geçirilir.
--
--   psql <baglanti> -v ON_ERROR_STOP=1 -f supabase/legacy_identity_inventory.sql
-- ============================================================================

begin transaction read only;

-- A) Özet sayılar.
select 'auth_users' as olcu, count(*)::text as deger from auth.users
union all select 'profiles', count(*)::text from public.profiles
union all select 'profilsiz_auth', count(*)::text from auth.users u
  where not exists (select 1 from public.profiles p where p.id = u.id)
union all select 'authsuz_profil', count(*)::text from public.profiles p
  where not exists (select 1 from auth.users u where u.id = p.id)
union all select 'username_null_profil', count(*)::text from public.profiles where username is null
union all select 'backfill_tamam_profil', count(*)::text from public.profiles
  where username is not null and auth_login_email is not null
union all select 'role_' || role, count(*)::text from public.profiles group by role
union all select 'davet_' || audience_type || '_' || case when aktif then 'aktif' else 'pasif' end, count(*)::text
  from public.davet_kodlari group by audience_type, aktif
order by 1;

-- B) Profil başına backfill adayı (PII yok).
--    email_sinifi: canonical_ic = u.<UUIDv4 hex>@auth.sosyolab.local
--                  diger_ic     = @auth.sosyolab.local ama canonical değil
--                  harici       = gerçek/kurumsal email (değeri yazdırılmaz)
select left(p.id::text, 8) as kisa_id,
       p.role,
       p.teacher_status,
       p.created_at::date as olusturma,
       p.username is not null as username_var,
       case when p.auth_login_email is null then 'yok'
            when p.auth_login_email ~ '^u\.[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}@auth\.sosyolab\.local$' then 'canonical'
            else 'canonical_degil' end as auth_login_email_durumu,
       case when u.email is null then 'yok'
            when lower(u.email) ~ '^u\.[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}@auth\.sosyolab\.local$' then 'canonical_ic'
            when lower(u.email) like '%@auth.sosyolab.local' then 'diger_ic'
            else 'harici' end as email_sinifi,
       p.auth_login_email is not null and lower(coalesce(u.email, '')) = p.auth_login_email as auth_ile_eslesik,
       coalesce((to_jsonb(u)->>'is_anonymous')::boolean, false) as anonim,
       to_jsonb(u)->'raw_app_meta_data'->>'provider' as provider,
       (to_jsonb(u)->>'last_sign_in_at') is not null as hic_giris_yapmis,
       exists (select 1 from public.davet_dogrulamalari d where d.user_id = p.id) as davet_damgasi,
       (select count(*) from public.materials m where m.uploader_id = p.id) as materyal_sayisi,
       case when p.role = 'admin' then 'admin: ADMIN_LOGIN_EMAIL takma adı; backfill opsiyonel'
            when p.username is not null and p.auth_login_email is not null then 'tamam'
            else 'karar gerekli: preserve(backfill) / re-onboard / test hesabı silme' end as aksiyon
  from public.profiles p
  left join auth.users u on u.id = p.id
 order by p.created_at, p.id;

-- C) Profilsiz Auth hesabı sınıflandırması (orphan). Otomatik silinmez.
--    Final RLS profil üyeliği ister: bu hesaplar giriş/okuma/yükleme yapamaz.
select left(u.id::text, 8) as kisa_id,
       u.created_at::date as olusturma,
       coalesce((to_jsonb(u)->>'is_anonymous')::boolean, false) as anonim,
       to_jsonb(u)->'raw_app_meta_data'->>'provider' as provider,
       case when u.email is null then 'yok'
            when lower(u.email) ~ '^u\.[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}@auth\.sosyolab\.local$' then 'canonical_ic'
            when lower(u.email) like '%@auth.sosyolab.local' then 'diger_ic'
            else 'harici' end as email_sinifi,
       (to_jsonb(u)->>'last_sign_in_at') is not null as hic_giris_yapmis,
       (to_jsonb(u)->>'banned_until') is not null as yasakli,
       exists (select 1 from public.davet_dogrulamalari d where d.user_id = u.id) as davet_damgasi,
       case when coalesce((to_jsonb(u)->>'is_anonymous')::boolean, false)
              then 'anonim oturum kalıntısı: anonymous sign-in kapatıldıktan sonra Admin API ile silme adayı'
            when lower(coalesce(u.email, '')) ~ '^u\.[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}@auth\.sosyolab\.local$'
              then 'yarım kalmış kayıt: 1 saatten eskiyse Admin API ile silme adayı (DEPLOYMENT-SECURITY 11)'
            else 'karar gerekli: gerçek kullanıcıysa kayit ile re-onboard; değilse Admin API ile silme' end as aksiyon
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id)
 order by u.created_at, u.id;

-- D) Çakışma ön kontrolü: zaten kullanılan kanonik iç kimlik/username sayısı.
select count(*) filter (where username is not null) as alinmis_username,
       count(*) filter (where auth_login_email is not null) as atanmis_ic_kimlik
  from public.profiles;

commit;
