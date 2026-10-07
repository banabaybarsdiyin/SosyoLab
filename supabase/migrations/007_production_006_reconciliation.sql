-- ============================================================================
-- SosyoLab — 007: eski 006 production durumunu final 006 güvenlik durumuna taşı
-- ============================================================================
-- AMAÇ
--   Production'a 006'nın eski bir sürümü (git c1f3068 / a0e4931: istemcinin
--   çağırdığı kayıt RPC'leri, anon'a açık login resolver, pepper/hız sınırı/
--   HMAC davet araması yok) uygulanmıştır. Bu migration o durumu, 006'yı
--   değiştirmeden, final 006 (860b278) DB durumuna ileri yönlü taşır.
--
-- SÖZLEŞME
--   * Yalnız iki başlangıç durumu desteklenir (bölüm 0'da sınıflandırılır):
--       eski_006  : eski imzalar var, final nesnelerin hiçbiri yok
--       final_006 : final nesnelerin tamamı var, eski imzalar yok
--                   (temiz kurulum 001..007 veya 007'nin tekrar çalıştırılması;
--                    gövde idempotenttir, pepper'lar korunur)
--     Diğer her durum (005, kısmi/karışık 006, beklenmeyen overload, auth.users
--     trigger'ı, final CHECK'lerini bozacak veri) -> RAISE, tüm transaction
--     geri alınır, hiçbir şey değişmez.
--   * Veri silmez: profiles, auth.users, davet_kodlari, davet_dogrulamalari,
--     materials satır sayıları bölüm 9'da korunmuş olarak doğrulanır. (Final
--     006'nın kanonik sos401 teacher_courses temizliği aynen geçerlidir.)
--   * Legacy kullanıcı kimlik backfill'i (username / auth_login_email) burada
--     YAPILMAZ: hesap başına operatör kararıdır (DEPLOYMENT-SECURITY bölüm 12,
--     supabase/legacy_user_backfill.sql). Profilsiz Auth hesabı silinmez.
--   * Bölüm 1-7 final 006'nın birebir kopyasıdır (paralel tasarım yok);
--     scripts/regression_007_reconciliation_test.js eşitliği denetler.
--   * Fonksiyon yetkileri hiçbir default privilege'a dayanmaz; bölüm 9 ACL
--     matrisini açıkça doğrular (production'da service_role'e otomatik
--     fonksiyon grant'i yoktur).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 0) Ön koşullar ve başlangıç durumu sınıflandırması (fail-closed)
-- ----------------------------------------------------------------------------

do $$
declare
  v_resolver boolean;
  v_eski integer;
  v_final integer;
  v_final_toplam constant integer := 12;
  v_durum text;
  v_ad text;
  v_sayi bigint;
begin
  -- Ortak yapı: 001..005 + 006 kolonları.
  if to_regclass('public.profiles') is null or to_regclass('public.davet_kodlari') is null
     or to_regclass('public.davet_dogrulamalari') is null or to_regclass('public.davet_denemeleri') is null
     or to_regclass('public.materials') is null or to_regclass('public.teacher_courses') is null
     or to_regclass('auth.users') is null then
    raise exception '007: beklenen tablolar eksik (001..005 + 006 gerekli)';
  end if;
  if to_regprocedure('public.is_admin()') is null or to_regprocedure('public.is_teacher()') is null then
    raise exception '007: is_admin()/is_teacher() bulunamadı (005 gerekli)';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles'
         and column_name in ('username', 'class_year', 'teacher_status', 'auth_login_email',
                             'teacher_reviewed_at', 'teacher_reviewed_by', 'teacher_rejection_reason')) <> 7
     or (select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'davet_kodlari'
            and column_name in ('audience_type', 'class_year')) <> 2 then
    raise exception '007: 006 kolonları yok. 005 durumundaki kurulumda 006 uygulanır, 007 değil.';
  end if;
  if to_regprocedure('extensions.crypt(text,text)') is null
     or to_regprocedure('extensions.gen_salt(text,integer)') is null
     or to_regprocedure('extensions.hmac(bytea,bytea,text)') is null
     or to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception '007: pgcrypto (crypt, gen_salt, hmac, gen_random_bytes) gerekli';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception '007: service_role rolü bulunamadı';
  end if;

  -- Eski 006 imzaları (istemci oturumuyla çalışan kayıt). Resolver
  -- kullanici_email_bul(text) her iki durumda vardır (eski: anon'a açık).
  v_resolver := to_regprocedure('public.kullanici_email_bul(text)') is not null;
  v_eski := (to_regprocedure('public.kullanici_kaydi_tamamla(text,text,text)') is not null)::integer
          + (to_regprocedure('public.kayit_icin_davet_kodu_kullan(text)') is not null)::integer;

  -- Final 006 işaretleri (eski 006'da hiçbiri yoktur).
  v_final := (to_regprocedure('public.istek_siniri_tuket(jsonb)') is not null)::integer
           + (to_regprocedure('public.kayit_on_kontrol(text,text,text)') is not null)::integer
           + (to_regprocedure('public.kayit_sonucunu_kesinlestir(uuid)') is not null)::integer
           + (to_regprocedure('public.davet_arama_ozeti(text)') is not null)::integer
           + (to_regprocedure('public.kullanici_kaydi_tamamla(uuid,text,text,text)') is not null)::integer
           + (to_regprocedure('public.kayit_icin_davet_kodu_kullan(uuid,text)') is not null)::integer
           + (exists (select 1 from information_schema.columns where table_schema = 'public'
                       and table_name = 'davet_kodlari' and column_name = 'kod_arama_ozeti'))::integer
           + (exists (select 1 from pg_namespace where nspname = 'sosyolab_private'))::integer
           + (to_regclass('sosyolab_private.login_pepper') is not null)::integer
           + (to_regclass('sosyolab_private.sunucu_pepperlari') is not null)::integer
           + (to_regclass('sosyolab_private.istek_sayaclari') is not null)::integer
           + (to_regclass('sosyolab_private.kayit_iptalleri') is not null)::integer;

  if v_resolver and v_eski = 2 and v_final = 0 then
    v_durum := 'eski_006';
  elsif v_resolver and v_eski = 0 and v_final = v_final_toplam then
    v_durum := 'final_006';
  else
    raise exception '007: desteklenmeyen şema durumu (resolver=%, eski kayıt imzası %/2, final işaret %/%). DUR: yalnız eski 006 veya final 006 desteklenir.',
      v_resolver, v_eski, v_final, v_final_toplam;
  end if;

  -- Beklenmeyen overload: bu adların her biri public'te en fazla bir kez.
  for v_ad in select unnest(array[
      'kullanici_email_bul', 'kullanici_kaydi_tamamla', 'kayit_icin_davet_kodu_kullan',
      'kayit_on_kontrol', 'kayit_sonucunu_kesinlestir', 'istek_siniri_tuket', 'davet_arama_ozeti',
      'admin_davet_kodu_olustur', 'ogretmen_basvurusunu_karara_bagla', 'normalize_username',
      'uye_profili_var_mi', 'davet_dogrulandi_mi', 'teacher_has_course', 'davet_kullan']) loop
    select count(*) into v_sayi
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_ad;
    if v_sayi > 1 then
      raise exception '007: beklenmeyen overload: public.% (% imza)', v_ad, v_sayi;
    end if;
  end loop;

  -- kayit_sonucunu_kesinlestir "profil var = kayıt tamam" varsayar: Auth
  -- kullanıcısından otomatik profil üreten trigger kabul edilmez.
  select count(*) into v_sayi
    from pg_trigger t
   where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal;
  if v_sayi > 0 then
    raise exception '007: auth.users üzerinde % internal olmayan trigger var', v_sayi;
  end if;

  -- Veri invariant'ları: final CHECK/index'leri ihlal edecek satır varsa,
  -- yarıda bırakmak yerine önceden ve açık mesajla dur.
  select count(*) into v_sayi from public.profiles p
   where not exists (select 1 from auth.users u where u.id = p.id);
  if v_sayi > 0 then
    raise exception '007: Auth kullanıcısı olmayan % profil var', v_sayi;
  end if;

  select count(*) into v_sayi from public.profiles p
   where p.auth_login_email is not null
     and p.auth_login_email !~ '^u\.[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}@auth\.sosyolab\.local$';
  if v_sayi > 0 then
    raise exception '007: canonical olmayan % auth_login_email var (eski 006 biçimi). Operatör önce hesap bazında uzlaştırır.', v_sayi;
  end if;

  select count(*) into v_sayi from public.profiles p
   where p.username is not null
     and (p.username <> lower(p.username)
          or p.username !~ '^[a-z0-9._]{4,24}$'
          or p.username in ('admin', 'administrator', 'root', 'system', 'supabase', 'sosyolab', 'sosyolog35', 'sosyolog.35'));
  if v_sayi > 0 then
    raise exception '007: geçersiz/rezerve % username var', v_sayi;
  end if;

  select count(*) into v_sayi from public.profiles p
   where not (
     (p.role = 'teacher' and coalesce(p.teacher_status, 'approved') = 'approved' and p.class_year is null)
     or (p.role = 'user' and (p.teacher_status is null or p.teacher_status in ('pending', 'rejected')))
     or (p.role = 'admin' and p.teacher_status is null and p.class_year is null));
  if v_sayi > 0 then
    raise exception '007: role/teacher_status/class_year tutarsız % profil var', v_sayi;
  end if;

  select count(*) into v_sayi from public.davet_kodlari k
   where k.audience_type is null
      or k.audience_type not in ('legacy', 'student', 'teacher')
      or (k.audience_type = 'student' and (k.class_year is null or k.class_year not between 1 and 4))
      or (k.audience_type = 'teacher' and k.class_year is not null);
  if v_sayi > 0 then
    raise exception '007: beklenmeyen davet yapısı (% satır)', v_sayi;
  end if;

  if v_durum = 'final_006' then
    if (select count(*) from sosyolab_private.login_pepper) <> 1
       or (select count(*) from sosyolab_private.sunucu_pepperlari) <> 2 then
      raise exception '007: final durumda pepper satırları eksik/fazla (yeniden üretilmez; DUR)';
    end if;
  end if;

  perform set_config('sosyolab.m007_durum', v_durum, true);
  raise notice '007 başlangıç durumu: %', v_durum;
end;
$$;

-- Veri koruma sözleşmesi için başlangıç sayımları (transaction sonunda düşer).
create temp table m007_baslangic on commit drop as
select (select count(*) from public.profiles) as profiles,
       (select count(*) from auth.users) as auth_users,
       (select count(*) from public.davet_kodlari) as davetler,
       (select count(*) from public.davet_dogrulamalari) as damgalar,
       (select count(*) from public.materials) as materyaller,
       (select count(*) from public.teacher_courses where lower(btrim(course_id)) <> 'sos401') as atamalar,
       (select count(*) from public.profiles where username is null) as adsiz_profiller,
       (select count(*) from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)) as profilsiz_auth;

-- Final durumda pepper'lar yeniden üretilmemeli: özetleri karşılaştırılır.
create temp table m007_pepper (ozet text) on commit drop;
do $$
begin
  if current_setting('sosyolab.m007_durum') = 'final_006' then
    execute $q$insert into pg_temp.m007_pepper
      select md5(string_agg(encode(x, 'hex'), ',' order by k)) from (
        select 'login' as k, lp.pepper as x from sosyolab_private.login_pepper lp
        union all select sp.ad, sp.deger from sosyolab_private.sunucu_pepperlari sp) s$q$;
  end if;
end;
$$;

-- >>> 006 FINAL GÖVDESİ (bölüm 1-7, birebir) >>>
-- ----------------------------------------------------------------------------
-- 1) Şema genişletmeleri
-- ----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists username text,
  add column if not exists class_year smallint,
  add column if not exists teacher_status text,
  add column if not exists auth_login_email text,
  add column if not exists teacher_reviewed_at timestamptz,
  add column if not exists teacher_reviewed_by uuid references public.profiles (id) on delete set null,
  add column if not exists teacher_rejection_reason text;

alter table public.davet_kodlari
  add column if not exists audience_type text,
  add column if not exists class_year smallint,
  -- Kayıt araması için server-side pepper'lı HMAC (bölüm 3a). bcrypt
  -- kod_ozeti 001 uyumluluğu için kalır; kayıt yolunda hiç hesaplanmaz.
  add column if not exists kod_arama_ozeti bytea;

-- 005'ten önce teacher olan satırları yeni duruma hizala.
update public.profiles
   set teacher_status = 'approved'
 where role = 'teacher'
   and teacher_status is null;

-- Mevcut davet kayıtları migration kırmaması için legacy olarak işaretlenir.
update public.davet_kodlari
   set audience_type = 'legacy'
 where audience_type is null;

alter table public.davet_kodlari
  alter column audience_type set default 'legacy',
  alter column audience_type set not null;

-- ----------------------------------------------------------------------------
-- 2) Constraint ve index'ler
-- ----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_username_bicim') then
    alter table public.profiles drop constraint profiles_username_bicim;
  end if;
  alter table public.profiles
    add constraint profiles_username_bicim
    check (
      username is null
      or (
        username = lower(username)
        and username ~ '^[a-z0-9._]{4,24}$'
      )
    );
exception when duplicate_object then null;
end;
$$;

do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_username_rezerve') then
    alter table public.profiles drop constraint profiles_username_rezerve;
  end if;
  alter table public.profiles
    add constraint profiles_username_rezerve
    check (
      username is null
      or username not in ('admin', 'administrator', 'root', 'system', 'supabase', 'sosyolab', 'sosyolog35', 'sosyolog.35')
    );
exception when duplicate_object then null;
end;
$$;

do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_class_year_gecerli') then
    alter table public.profiles drop constraint profiles_class_year_gecerli;
  end if;
  alter table public.profiles
    add constraint profiles_class_year_gecerli
    check (class_year is null or class_year between 1 and 4);
exception when duplicate_object then null;
end;
$$;

do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_teacher_status_gecerli') then
    alter table public.profiles drop constraint profiles_teacher_status_gecerli;
  end if;
  alter table public.profiles
    add constraint profiles_teacher_status_gecerli
    check (teacher_status is null or teacher_status in ('pending', 'approved', 'rejected'));
exception when duplicate_object then null;
end;
$$;

do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_auth_login_email_bicim') then
    alter table public.profiles drop constraint profiles_auth_login_email_bicim;
  end if;
  -- Tek canonical biçim: u.<UUIDv4 hex>@auth.sosyolab.local. Login çözümlemesi
  -- bilinmeyen username için aynı biçimde sahte adres döndürdüğünden, biçimi
  -- farklı tek bir hesap bile varlığını yanıt şeklinden ele verirdi.
  alter table public.profiles
    add constraint profiles_auth_login_email_bicim
    check (
      auth_login_email is null
      or auth_login_email ~ '^u\.[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}@auth\.sosyolab\.local$'
    );
exception when duplicate_object then null;
end;
$$;

do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_teacher_status_tutarli') then
    alter table public.profiles drop constraint profiles_teacher_status_tutarli;
  end if;
  alter table public.profiles
    add constraint profiles_teacher_status_tutarli
    check (
      (role = 'teacher' and teacher_status = 'approved' and class_year is null)
      or (role = 'user' and (teacher_status is null or teacher_status in ('pending', 'rejected')))
      or (role = 'admin' and teacher_status is null and class_year is null)
    );
exception when duplicate_object then null;
end;
$$;

create unique index if not exists profiles_username_unique
  on public.profiles (username)
  where username is not null;

create unique index if not exists profiles_auth_login_email_unique
  on public.profiles (auth_login_email)
  where auth_login_email is not null;

create index if not exists profiles_teacher_status_idx
  on public.profiles (teacher_status, created_at desc)
  where teacher_status is not null;

do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.davet_kodlari'::regclass and conname = 'davet_audience_turu_gecerli') then
    alter table public.davet_kodlari drop constraint davet_audience_turu_gecerli;
  end if;
  alter table public.davet_kodlari
    add constraint davet_audience_turu_gecerli
    check (audience_type in ('legacy', 'student', 'teacher'));
exception when duplicate_object then null;
end;
$$;

do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.davet_kodlari'::regclass and conname = 'davet_audience_class_tutarli') then
    alter table public.davet_kodlari drop constraint davet_audience_class_tutarli;
  end if;
  alter table public.davet_kodlari
    add constraint davet_audience_class_tutarli
    check (
      (audience_type = 'student' and class_year between 1 and 4)
      or (audience_type = 'teacher' and class_year is null)
      or (audience_type = 'legacy')
    );
exception when duplicate_object then null;
end;
$$;

create index if not exists davet_kodlari_audience_idx
  on public.davet_kodlari (aktif, audience_type, class_year, created_at desc);

-- ----------------------------------------------------------------------------
-- 3) Kayıt/teacher helper fonksiyonları
-- ----------------------------------------------------------------------------

create or replace function public.normalize_username(p_username text)
returns text
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select lower(regexp_replace(btrim(p_username), '\s+', '', 'g'));
$$;

revoke all on function public.normalize_username(text) from public, anon, authenticated;

create or replace function public.uye_profili_var_mi()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = auth.uid()
  );
$$;

revoke all on function public.uye_profili_var_mi() from public, anon;
grant execute on function public.uye_profili_var_mi() to authenticated;

-- Login çözümlemesi için DB içinde üretilen, istemciye hiç dönmeyen pepper.
-- Operatör yönetimli secret değildir; kaynakta/tarayıcıda yer almaz.
-- PostgREST'e açık olmayan ayrı şemada, anon/authenticated erişimi yoktur.
-- ROTATE EDİLMEZ: değişirse yalnız var olmayan username'lerin yanıtı değişir
-- ve önce/sonra karşılaştırması hesap varlığını ele verir.
create schema if not exists sosyolab_private;
revoke all on schema sosyolab_private from public, anon, authenticated, service_role;

create table if not exists sosyolab_private.login_pepper (
  tek boolean primary key default true check (tek),
  pepper bytea not null check (octet_length(pepper) >= 32)
);
alter table sosyolab_private.login_pepper enable row level security;
revoke all on table sosyolab_private.login_pepper from public, anon, authenticated, service_role;

insert into sosyolab_private.login_pepper (tek, pepper)
values (true, extensions.gen_random_bytes(32))
on conflict (tek) do nothing;

-- ----------------------------------------------------------------------------
-- 3a) Server-side anahtarlar: davet araması ve istek hız sınırı
-- ----------------------------------------------------------------------------
-- Ayrı amaçlar için ayrı, DB içinde üretilen pepper'lar (login_pepper'dan
-- bağımsız). İstemciye ve service_role'e doğrudan okuma yoktur; yalnız
-- aşağıdaki SECURITY DEFINER fonksiyonlar kullanır.
--   davet_arama  : rotate edilirse TÜM aktif kodlar geçersizleşir; yeni kod
--                  üretimi gerekir (EK B).
--   istek_siniri : rotate edilirse yalnız açık sayaç pencereleri sıfırlanır.
create table if not exists sosyolab_private.sunucu_pepperlari (
  ad text primary key check (ad in ('davet_arama', 'istek_siniri')),
  deger bytea not null check (octet_length(deger) >= 32)
);
alter table sosyolab_private.sunucu_pepperlari enable row level security;
revoke all on table sosyolab_private.sunucu_pepperlari from public, anon, authenticated, service_role;

insert into sosyolab_private.sunucu_pepperlari (ad, deger)
values ('davet_arama', extensions.gen_random_bytes(32)),
       ('istek_siniri', extensions.gen_random_bytes(32))
on conflict (ad) do nothing;

-- Davet kodu -> tek HMAC-SHA256 (indeksli eşitlik araması). Kodlar 128-bit
-- CSPRNG olduğundan yavaş hash gerekmez; pepper bilinmeden özet hesaplanamaz.
-- Kayıt yolunda istek başına bcrypt döngüsünü (F-02 DoS amplifikasyonu)
-- kaldırır. İstemcilere kapalı iç helper.
create or replace function public.davet_arama_ozeti(p_kod text)
returns bytea
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pepper bytea;
begin
  select sp.deger into v_pepper from sosyolab_private.sunucu_pepperlari sp where sp.ad = 'davet_arama';
  if v_pepper is null then
    raise exception 'Davet arama yapılandırması eksik';
  end if;
  return extensions.hmac(convert_to('davet:v1:' || upper(btrim(coalesce(p_kod, ''))), 'UTF8'), v_pepper, 'sha256');
end;
$$;

revoke all on function public.davet_arama_ozeti(text) from public, anon, authenticated;

create unique index if not exists davet_kodlari_arama_ozeti_unique
  on public.davet_kodlari (kod_arama_ozeti)
  where kod_arama_ozeti is not null;

-- Arama özeti olmayan aktif student/teacher kodu kayıtta hiç bulunamaz.
-- Hash'ten düz metin üretilemeyeceği için dönüştürülmez; pasife alınır ve
-- operatör EK B ile yeni kod üretir. (006 öncesi production'da bu sınıflar
-- yoktur: audience_type bu migration'la gelir; satır yalnız eski bir 006
-- denemesinin uygulandığı staging DB'lerinde bulunabilir.)
do $$
declare
  v_adet integer;
begin
  update public.davet_kodlari k
     set aktif = false
   where k.aktif
     and k.audience_type in ('student', 'teacher')
     and k.kod_arama_ozeti is null;
  get diagnostics v_adet = row_count;
  if v_adet > 0 then
    raise notice '% aktif davet kodu arama özeti olmadığı için pasife alındı; yeni kod üretin (EK B).', v_adet;
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.davet_kodlari'::regclass and conname = 'davet_kayit_arama_ozeti_zorunlu') then
    alter table public.davet_kodlari drop constraint davet_kayit_arama_ozeti_zorunlu;
  end if;
  alter table public.davet_kodlari
    add constraint davet_kayit_arama_ozeti_zorunlu
    check (not aktif or audience_type = 'legacy' or kod_arama_ozeti is not null);
end;
$$;

-- İstek hız sınırı sayaçları. Ham IP/kullanıcı adı SAKLANMAZ: anahtar,
-- pepper'lı HMAC(kova tanımı) olarak tutulur. Sabit pencere; süresi dolan
-- satırlar her çağrıda sınırlı partiyle silinir (TTL).
create table if not exists sosyolab_private.istek_sayaclari (
  anahtar bytea not null,
  baslangic timestamptz not null,
  bitis timestamptz not null,
  sayac integer not null check (sayac >= 1),
  primary key (anahtar, baslangic)
);
create index if not exists istek_sayaclari_bitis_idx on sosyolab_private.istek_sayaclari (bitis);
alter table sosyolab_private.istek_sayaclari enable row level security;
revoke all on table sosyolab_private.istek_sayaclari from public, anon, authenticated, service_role;

-- Edge Function `giris`/`kayit` hız sınırı. YALNIZ service_role çağırır.
-- p_kovalar: [{anahtar, limit, pencere}] sıralı. Her kova atomik upsert ile
-- artırılır (yarışta kayıp sayım yok); ilk aşılan kovada false döner ve
-- SONRAKİ kovalar artırılmaz: tek IP'den reddedilen denemeler bir kullanıcı
-- adının küresel kovasını şişiremez. Karar hesap varlığına hiç bakmaz.
create or replace function public.istek_siniri_tuket(p_kovalar jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_pepper bytea;
  v_kova jsonb;
  v_limit integer;
  v_pencere integer;
  v_baslangic timestamptz;
  v_sayac integer;
begin
  if jsonb_typeof(p_kovalar) is distinct from 'array'
     or jsonb_array_length(p_kovalar) not between 1 and 8 then
    raise exception 'Geçersiz hız sınırı isteği';
  end if;

  select sp.deger into v_pepper from sosyolab_private.sunucu_pepperlari sp where sp.ad = 'istek_siniri';
  if v_pepper is null then
    raise exception 'Hız sınırı yapılandırması eksik';
  end if;

  delete from sosyolab_private.istek_sayaclari s
   where s.ctid in (select x.ctid from sosyolab_private.istek_sayaclari x
                     where x.bitis < now() limit 500);

  for v_kova in select e.value from jsonb_array_elements(p_kovalar) e loop
    if jsonb_typeof(v_kova) is distinct from 'object'
       or jsonb_typeof(v_kova->'limit') is distinct from 'number'
       or jsonb_typeof(v_kova->'pencere') is distinct from 'number'
       or jsonb_typeof(v_kova->'anahtar') is distinct from 'string'
       or length(v_kova->>'anahtar') not between 1 and 512 then
      raise exception 'Geçersiz hız sınırı kovası';
    end if;
    v_limit := (v_kova->>'limit')::integer;
    v_pencere := (v_kova->>'pencere')::integer;
    if v_limit not between 1 and 100000 or v_pencere not between 1 and 86400 then
      raise exception 'Geçersiz hız sınırı kovası';
    end if;

    v_baslangic := to_timestamp(floor(extract(epoch from now()) / v_pencere) * v_pencere);
    insert into sosyolab_private.istek_sayaclari as s (anahtar, baslangic, bitis, sayac)
    values (
      extensions.hmac(convert_to('istek:v1:' || v_pencere::text || ':' || (v_kova->>'anahtar'), 'UTF8'), v_pepper, 'sha256'),
      v_baslangic,
      v_baslangic + make_interval(secs => v_pencere),
      1
    )
    on conflict (anahtar, baslangic) do update set sayac = s.sayac + 1
    returning s.sayac into v_sayac;

    if v_sayac > v_limit then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

revoke all on function public.istek_siniri_tuket(jsonb) from public, anon, authenticated;
grant execute on function public.istek_siniri_tuket(jsonb) to service_role;

-- Login: kullanıcı adı -> auth email çözümlemesi. YALNIZ service_role (Edge
-- Function `giris`) çağırabilir; tarayıcı iç login kimliğini hiç öğrenmez, bu
-- yüzden Auth uç noktalarına (signup/token/otp) verilecek bir kimliği yoktur.
-- Hesap varlığı yanıttan anlaşılamaz: mevcut hesap için gerçek adres, diğer tüm
-- durumlarda (yok, eksik profil, geçersiz biçim) pepper'lı HMAC'tan türetilen
-- aynı canonical biçimde (u.<UUIDv4 hex>) kararlı sahte adres döner. Sahte
-- adres pepper bilinmeden offline hesaplanamaz; hiçbir girdi için hata atılmaz.
create or replace function public.kullanici_email_bul(p_username text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_username text := public.normalize_username(coalesce(p_username, ''));
  v_pepper bytea;
  v_h text;
  v_fallback text;
  v_email text;
begin
  select lp.pepper into v_pepper from sosyolab_private.login_pepper lp where lp.tek;
  if v_pepper is null then
    raise exception 'Giriş çözümleme yapılandırması eksik';
  end if;

  -- Her yolda hesaplanır: mevcut/olmayan hesap aynı işi yapar.
  v_h := encode(extensions.hmac(convert_to('login:v3:' || v_username, 'UTF8'), v_pepper, 'sha256'), 'hex');
  -- UUIDv4 sabit bitleri: 13. hane '4', 17. hane 8/9/a/b. Varyant hanesi,
  -- adresin geri kalanıyla korelasyon olmasın diye kullanılmayan 33. haneden.
  v_fallback := 'u.' || substr(v_h, 1, 12) || '4' || substr(v_h, 14, 3)
             || substr('89ab', (strpos('0123456789abcdef', substr(v_h, 33, 1)) - 1) % 4 + 1, 1)
             || substr(v_h, 18, 15) || '@auth.sosyolab.local';

  if v_username ~ '^[a-z0-9._]{4,24}$' then
    select p.auth_login_email
      into v_email
      from public.profiles p
     where p.username = v_username
     limit 1;
  end if;

  -- Biçim kontrolü sorguda değil, her yolda tam bir kez: sorgu filtresi olarak
  -- olmayan kullanıcıda tüm satırlara uygulanıp ölçülebilir süre farkı yaratıyordu.
  v_email := coalesce(v_email, v_fallback);
  if v_email !~ '^u\.[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}@auth\.sosyolab\.local$' then
    v_email := v_fallback;
  end if;

  return v_email;
end;
$$;

revoke all on function public.kullanici_email_bul(text) from public, anon, authenticated;
grant execute on function public.kullanici_email_bul(text) to service_role;

-- ----------------------------------------------------------------------------
-- 3b) Server-side kayıt sınırı (Edge Function `kayit`, service_role)
-- ----------------------------------------------------------------------------
-- Public Auth signup KAPALIDIR. Auth kullanıcısını yalnız Edge Function,
-- geçerli davet ön kontrolünden sonra Admin API ile rastgele canonical
-- kimlikle oluşturur; profil + davet tüketimi aşağıdaki tek transaction'da
-- tamamlanır. Bu fonksiyonların hiçbiri anon/authenticated'a açık değildir.

-- Eski (istemci oturumuyla çalışan) imzalar kaldırılır.
drop function if exists public.kullanici_kaydi_tamamla(text, text, text);
drop function if exists public.kayit_icin_davet_kodu_kullan(text);

-- Registration akışı için davet kodu tüketimi (student/teacher sınıfları).
-- Kod tek HMAC + indeksli eşitlikle bulunur (bcrypt döngüsü yok). Brute-force
-- savunması: 128-bit kod + Edge Function IP hız sınırı (istek_siniri_tuket).
create or replace function public.kayit_icin_davet_kodu_kullan(p_user_id uuid, p_kod text)
returns table (audience_type text, class_year smallint, davet_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := p_user_id;
  v_kod text := upper(btrim(coalesce(p_kod, '')));
  v_ozet bytea;
  v_satir public.davet_kodlari%rowtype;
  v_tuketildi boolean;
begin
  if v_uid is null then
    raise exception 'Kayıt işlemi için kullanıcı kimliği gerekli';
  end if;

  if current_setting('sosyolab.registration_context', true) is distinct from 'on' then
    raise exception 'Davet kodu yalnızca kayıt tamamlama akışında kullanılabilir';
  end if;

  if v_kod = '' or length(v_kod) > 64 then
    raise exception 'Davet kodu geçersiz ya da süresi dolmuş';
  end if;

  v_ozet := public.davet_arama_ozeti(v_kod);

  -- Damga yalnızca aynı kod/audience sözleşmesi için yeniden kullanılabilir.
  return query
  select k.audience_type, k.class_year, k.id
    from public.davet_dogrulamalari d
    join public.davet_kodlari k on k.id = d.davet_id
   where d.user_id = v_uid
     and k.audience_type in ('student', 'teacher')
     and k.kod_arama_ozeti = v_ozet
   limit 1;

  if found then
    return;
  end if;

  if exists (select 1 from public.davet_dogrulamalari d where d.user_id = v_uid) then
    raise exception 'Davet kodu kayıt damgasıyla eşleşmiyor';
  end if;

  select k.* into v_satir
    from public.davet_kodlari k
   where k.kod_arama_ozeti = v_ozet
     and k.aktif
     and k.audience_type in ('student', 'teacher')
     and (k.gecerlilik_sonu is null or k.gecerlilik_sonu > now())
     and (k.azami_kullanim is null or k.kullanim_sayisi < k.azami_kullanim);

  if not found then
    raise exception 'Davet kodu geçersiz ya da süresi dolmuş';
  end if;

  -- Koşullar satır kilidinden sonra yeniden değerlendirilir: son slot yarışında
  -- yalnız bir transaction tüketir.
  update public.davet_kodlari as k
     set kullanim_sayisi = k.kullanim_sayisi + 1
   where k.id = v_satir.id
     and k.aktif
     and k.audience_type in ('student', 'teacher')
     and (k.gecerlilik_sonu is null or k.gecerlilik_sonu > now())
     and (k.azami_kullanim is null or k.kullanim_sayisi < k.azami_kullanim);

  v_tuketildi := found;
  if not v_tuketildi then
    raise exception 'Davet kodu geçersiz ya da süresi dolmuş';
  end if;

  insert into public.davet_dogrulamalari (user_id, davet_id, ogrenci_no)
  values (v_uid, v_satir.id, null)
  on conflict (user_id) do nothing;

  return query
  select v_satir.audience_type, v_satir.class_year, v_satir.id;
end;
$$;

revoke all on function public.kayit_icin_davet_kodu_kullan(uuid, text) from public, anon, authenticated;

-- 001 helper'ı audience kontrolü yapmaz. Yeni frontend yalnız kayıt RPC'sini
-- kullanır; migration penceresinde eski istemciyle kod tüketimi desteklenmez.
revoke all on function public.davet_kullan(text) from public, anon, authenticated;

-- Auth kullanıcısı oluşturulmadan önceki salt-okunur ön kontrol: davet kodu
-- şu an kullanılabilir mi, kullanıcı adı geçerli/boş mu, teacher için ad soyad
-- var mı. Hiçbir şey tüketmez. Kod geçersizken kullanıcı adının durumu sonucu
-- değiştirmez (tek boolean); böylece davetsiz istemci varlık öğrenemez ve
-- geçersiz denemeler Auth hesabı yaratmaz. Nihai karar yine tamamla'dadır.
-- Maliyet aktif kod sayısından bağımsızdır: tek HMAC + indeksli eşitlik.
create or replace function public.kayit_on_kontrol(
  p_username text,
  p_sifreli_davet_kodu text,
  p_display_name text default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_username text := public.normalize_username(coalesce(p_username, ''));
  v_kod text := upper(btrim(coalesce(p_sifreli_davet_kodu, '')));
  v_ozet bytea;
  v_audience text;
  v_ad_bos boolean;
begin
  if v_kod <> '' and length(v_kod) <= 64 then
    v_ozet := public.davet_arama_ozeti(v_kod);
    select d.audience_type
      into v_audience
      from public.davet_kodlari d
     where d.kod_arama_ozeti = v_ozet
       and d.aktif
       and d.audience_type in ('student', 'teacher')
       and (d.gecerlilik_sonu is null or d.gecerlilik_sonu > now())
       and (d.azami_kullanim is null or d.kullanim_sayisi < d.azami_kullanim);
  end if;

  -- Kullanıcı adı kontrolü her yolda yapılır; sonuç yalnız kod geçerliyse etkili.
  v_ad_bos := v_username ~ '^[a-z0-9._]{4,24}$'
    and v_username not in ('admin', 'administrator', 'root', 'system', 'supabase', 'sosyolab', 'sosyolog35', 'sosyolog.35')
    and not exists (select 1 from public.profiles p where p.username = v_username);

  return v_audience is not null
    and v_ad_bos
    and (v_audience <> 'teacher' or btrim(coalesce(p_display_name, '')) <> '');
end;
$$;

revoke all on function public.kayit_on_kontrol(text, text, text) from public, anon, authenticated;
grant execute on function public.kayit_on_kontrol(text, text, text) to service_role;

-- Kayıt sonucu kesinleştirme damgaları (F-06). Satır = "bu Auth kullanıcısı
-- için kayıt iptal edildi, tamamla artık commit edemez". Auth kullanıcısı
-- silinince cascade ile kalkar.
create table if not exists sosyolab_private.kayit_iptalleri (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table sosyolab_private.kayit_iptalleri enable row level security;
revoke all on table sosyolab_private.kayit_iptalleri from public, anon, authenticated, service_role;

-- Profil + davet tüketimi tek transaction: herhangi bir hata hepsini geri alır
-- (davet tüketildi/profil yok durumu oluşamaz). profiles.id auth.users'a
-- ON DELETE CASCADE bağlıdır (profil var/Auth yok oluşamaz). Login kimliği
-- JWT'den değil, Edge Function'ın oluşturduğu auth.users satırından okunur.
create or replace function public.kullanici_kaydi_tamamla(
  p_user_id uuid,
  p_username text,
  p_sifreli_davet_kodu text,
  p_display_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := p_user_id;
  v_username text := public.normalize_username(coalesce(p_username, ''));
  v_email text;
  v_anonim boolean;
  v_audience text;
  v_class_year smallint;
  v_davet_id uuid;
  v_mevcut public.profiles%rowtype;
  v_display_name text;
begin
  if v_uid is null then
    raise exception 'Kayıt için kullanıcı kimliği bulunamadı';
  end if;

  if v_username !~ '^[a-z0-9._]{4,24}$' then
    raise exception 'Kullanıcı adı 4-24 karakter olmalı ve yalnızca harf/rakam/._ içermeli';
  end if;

  if v_username in ('admin', 'administrator', 'root', 'system', 'supabase', 'sosyolab', 'sosyolog35', 'sosyolog.35') then
    raise exception 'Bu kullanıcı adı kullanılamaz';
  end if;

  select lower(coalesce(u.email, '')), coalesce(u.is_anonymous, false)
    into v_email, v_anonim
    from auth.users u
   where u.id = v_uid;

  if v_email is null or v_anonim
     or v_email !~ '^u\.[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}@auth\.sosyolab\.local$' then
    raise exception 'Kayıt kimliği geçersiz. Lütfen kaydı tekrar başlat.';
  end if;

  -- Henüz profile satırı olmayan aynı UID'nin eşzamanlı kayıtlarını da sırala.
  -- kayit_sonucunu_kesinlestir aynı kilidi alır (F-06).
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 006));

  -- Edge Function sonucu "iptal" olarak kesinleştirdiyse (Auth kullanıcısı
  -- silinecek) gecikmiş bir tamamla hiçbir şey tüketmez.
  if exists (select 1 from sosyolab_private.kayit_iptalleri ki where ki.user_id = v_uid) then
    raise exception 'Kayıt iptal edildi. Lütfen kaydı tekrar başlat.';
  end if;

  select *
    into v_mevcut
    from public.profiles p
   where p.id = v_uid
   for update;

  if found and (
      v_mevcut.role in ('admin', 'teacher')
      or v_mevcut.username is not null
      or v_mevcut.auth_login_email is not null
      or coalesce(v_mevcut.teacher_status, '') in ('pending', 'approved', 'rejected')
    ) then
    raise exception 'Bu hesap için kayıt zaten tamamlanmış';
  end if;

  perform set_config('sosyolab.registration_context', 'on', true);

  select k.audience_type, k.class_year, k.davet_id
    into v_audience, v_class_year, v_davet_id
    from public.kayit_icin_davet_kodu_kullan(v_uid, p_sifreli_davet_kodu) k;

  if v_audience not in ('student', 'teacher') then
    raise exception 'Bu davet kodu kayıt için uygun değil';
  end if;

  if v_audience = 'teacher' and btrim(coalesce(p_display_name, '')) = '' then
    raise exception 'Öğretim elemanı başvurusu için ad soyad zorunludur';
  end if;

  v_display_name := nullif(btrim(coalesce(p_display_name, '')), '');
  if v_display_name is null then
    v_display_name := coalesce(nullif(v_mevcut.display_name, ''), initcap(v_username));
  end if;

  insert into public.profiles (
    id, username, display_name, role, class_year, teacher_status,
    auth_login_email, student_number, teacher_reviewed_at,
    teacher_reviewed_by, teacher_rejection_reason
  ) values (
    v_uid,
    v_username,
    v_display_name,
    'user',
    case when v_audience = 'student' then v_class_year else null end,
    case when v_audience = 'teacher' then 'pending' else null end,
    v_email,
    null,
    null,
    null,
    null
  )
  on conflict (id) do update
    set username = excluded.username,
        display_name = excluded.display_name,
        role = 'user',
        class_year = excluded.class_year,
        teacher_status = excluded.teacher_status,
        auth_login_email = coalesce(public.profiles.auth_login_email, excluded.auth_login_email),
        student_number = null,
        teacher_reviewed_at = null,
        teacher_reviewed_by = null,
        teacher_rejection_reason = null
  where public.profiles.role = 'user';

  if not found then
    raise exception 'Profil kaydı güncellenemedi';
  end if;

  perform set_config('sosyolab.registration_context', 'off', true);

  return jsonb_build_object(
    'ok', true,
    'audience_type', v_audience,
    'class_year', case when v_audience = 'student' then v_class_year else null end,
    'teacher_status', case when v_audience = 'teacher' then 'pending' else null end,
    'username', v_username,
    'davet_id', v_davet_id
  );
end;
$$;

revoke all on function public.kullanici_kaydi_tamamla(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.kullanici_kaydi_tamamla(uuid, text, text, text) to service_role;

-- Tamamla çağrısının sonucu bilinmiyorsa (yanıt kayboldu / hata) Edge Function
-- telafiden ÖNCE bunu çağırır. Tamamla ile aynı advisory lock: süren bir
-- tamamla commit/rollback olana kadar bekler, böylece "commit sürerken profil
-- görünmedi -> sil -> cascade + kota sızıntısı" penceresi kapanır.
--   'tamam' : profil var; kayıt başarılı, silme YAPILMAZ.
--   'iptal' : profil yok; iptal damgası yazıldı, sonraki/gecikmiş tamamla
--             reddedilir. Auth kullanıcısını silmek artık güvenlidir.
create or replace function public.kayit_sonucunu_kesinlestir(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_teacher_status text;
begin
  if p_user_id is null then
    raise exception 'Kayıt kimliği gerekli';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 006));

  select p.teacher_status into v_teacher_status
    from public.profiles p
   where p.id = p_user_id;

  if found then
    return jsonb_build_object('durum', 'tamam', 'teacher_status', v_teacher_status);
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    -- Auth kullanıcısı yoksa tamamla zaten reddeder; damga gerekmez.
    return jsonb_build_object('durum', 'iptal');
  end if;

  insert into sosyolab_private.kayit_iptalleri (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  return jsonb_build_object('durum', 'iptal');
end;
$$;

revoke all on function public.kayit_sonucunu_kesinlestir(uuid) from public, anon, authenticated;
grant execute on function public.kayit_sonucunu_kesinlestir(uuid) to service_role;

-- Admin öğretim elemanı başvurusu kararı (role yükseltmesi sadece burada).
create or replace function public.ogretmen_basvurusunu_karara_bagla(
  p_profile_id uuid,
  p_karar text,
  p_ret_gerekcesi text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_karar text := lower(btrim(coalesce(p_karar, '')));
  v_satir public.profiles%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Bu işlem yalnızca yöneticiye açıktır';
  end if;

  if v_karar not in ('approve', 'reject') then
    raise exception 'Geçersiz karar';
  end if;

  select *
    into v_satir
    from public.profiles p
   where p.id = p_profile_id
   for update;

  if not found then
    raise exception 'Başvuru profili bulunamadı';
  end if;

  if coalesce(v_satir.teacher_status, '') <> 'pending' then
    raise exception 'Yalnızca pending başvurular değerlendirilebilir';
  end if;

  perform set_config('sosyolab.teacher_review_context', 'on', true);

  update public.profiles p
     set role = case when v_karar = 'approve' then 'teacher' else 'user' end,
         teacher_status = case when v_karar = 'approve' then 'approved' else 'rejected' end,
         class_year = case when v_karar = 'approve' then null else p.class_year end,
         teacher_reviewed_at = now(),
         teacher_reviewed_by = auth.uid(),
         teacher_rejection_reason = case
           when v_karar = 'reject' then nullif(btrim(coalesce(p_ret_gerekcesi, '')), '')
           else null
         end
   where p.id = p_profile_id;

  return jsonb_build_object(
    'ok', true,
    'profile_id', p_profile_id,
    'teacher_status', case when v_karar = 'approve' then 'approved' else 'rejected' end,
    'role', case when v_karar = 'approve' then 'teacher' else 'user' end
  );
end;
$$;

revoke all on function public.ogretmen_basvurusunu_karara_bagla(uuid, text, text) from public, anon;
grant execute on function public.ogretmen_basvurusunu_karara_bagla(uuid, text, text) to authenticated;

-- Admin yardımcı fonksiyonu: hash'li davet kodu ekleme.
create or replace function public.admin_davet_kodu_olustur(
  p_kod text,
  p_audience_type text,
  p_class_year smallint,
  p_etiket text default null,
  p_gecerlilik_sonu timestamptz default null,
  p_azami_kullanim integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kod text := upper(btrim(coalesce(p_kod, '')));
  v_audience text := lower(btrim(coalesce(p_audience_type, '')));
  v_id uuid;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Bu işlem yalnızca yöneticiye açıktır';
  end if;

  -- 32 hex karakter = 128-bit rastgelelik kapasitesi.
  if v_kod !~ '^[A-F0-9]{32}$' then
    raise exception 'Kod 32 hex karakter olmalı (en az 128-bit rastgelelik standardı)';
  end if;

  if v_audience not in ('student', 'teacher') then
    raise exception 'audience_type yalnızca student veya teacher olabilir';
  end if;

  if v_audience = 'student' and (p_class_year is null or p_class_year not between 1 and 4) then
    raise exception 'Student kodları için class_year 1..4 zorunlu';
  end if;

  if v_audience = 'teacher' and p_class_year is not null then
    raise exception 'Teacher kodları class_year içeremez';
  end if;

  -- kod_arama_ozeti: kayıt araması (HMAC, benzersiz indeks); kod_ozeti: 001
  -- uyumluluğu için bcrypt. Düz metin saklanmaz/loglanmaz.
  insert into public.davet_kodlari (
    kod_arama_ozeti, kod_ozeti, etiket, ogrenci_no, gecerlilik_sonu, azami_kullanim,
    aktif, created_by, audience_type, class_year
  )
  values (
    public.davet_arama_ozeti(v_kod),
    extensions.crypt(v_kod, extensions.gen_salt('bf', 10)),
    nullif(btrim(coalesce(p_etiket, '')), ''),
    null,
    p_gecerlilik_sonu,
    p_azami_kullanim,
    true,
    auth.uid(),
    v_audience,
    case when v_audience = 'student' then p_class_year else null end
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.admin_davet_kodu_olustur(text, text, smallint, text, timestamptz, integer) from public, anon;
grant execute on function public.admin_davet_kodu_olustur(text, text, smallint, text, timestamptz, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) Membership sınırı ve erişim politikaları
-- ----------------------------------------------------------------------------

-- Davetsiz/orphan hesapların profile satırı basarak username rezerve etmesi
-- engellenir. Profil oluşturma yalnızca SECURITY DEFINER kayıt RPC'si içinden
-- yapılır.
drop policy if exists profiles_kendi_olusturur on public.profiles;
revoke insert on table public.profiles from anon, authenticated;

-- İç Auth login kimliği (auth_login_email) istemci API'sinden okunamaz:
-- tablo düzeyi SELECT kaldırılır, auth_login_email DIŞINDAKİ kolonlara kolon
-- düzeyi SELECT verilir (RLS satır sınırı aynen geçerli). Edge Function
-- service_role ile çalışır, etkilenmez. profiles'a ileride eklenen kolonlar
-- otomatik okunamaz; gerekirse açıkça grant edilir.
do $$
declare
  v_kolonlar text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
    into v_kolonlar
    from pg_attribute a
   where a.attrelid = 'public.profiles'::regclass
     and a.attnum > 0
     and not a.attisdropped
     and a.attname <> 'auth_login_email';
  revoke select on table public.profiles from anon, authenticated;
  revoke select (auth_login_email) on table public.profiles from anon, authenticated;
  execute format('grant select (%s) on table public.profiles to authenticated', v_kolonlar);
end;
$$;

-- Davet damgası tek başına üyelik sayılmaz: aktif profile membership zorunlu.
create or replace function public.davet_dogrulandi_mi()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.uye_profili_var_mi() and exists (
    select 1 from public.davet_dogrulamalari d where d.user_id = auth.uid()
  );
$$;

revoke all on function public.davet_dogrulandi_mi() from public, anon;
grant execute on function public.davet_dogrulandi_mi() to authenticated;

drop policy if exists materials_okuma on public.materials;
create policy materials_okuma on public.materials
  for select to authenticated
  using (
    public.uye_profili_var_mi()
    and (
      uploader_id = auth.uid()
      or public.is_admin()
      or (status = 'approved' and public.davet_dogrulandi_mi())
    )
  );

drop policy if exists materials_gonderim on public.materials;
create policy materials_gonderim on public.materials
  for insert to authenticated
  with check (
    public.uye_profili_var_mi()
    and uploader_id = auth.uid()
    and (storage.foldername(file_path))[1] = auth.uid()::text
    and (
      (
        public.is_teacher()
        and public.teacher_has_course(course_id)
        and status = 'approved'
        and reviewed_at is not null
        and reviewed_by = auth.uid()
        and rejection_reason is null
      )
      or
      (
        not public.is_teacher()
        and exists (select 1 from public.profiles p
                    where p.id = auth.uid() and p.teacher_status is null)
        and status = 'pending'
        and reviewed_at is null
        and reviewed_by is null
        and rejection_reason is null
        and (public.is_admin() or public.davet_dogrulandi_mi())
      )
    )
  );

drop policy if exists materyal_okuma on storage.objects;
create policy materyal_okuma on storage.objects
  for select to authenticated
  using (
    bucket_id = 'materyaller'
    and public.uye_profili_var_mi()
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
      or (
        public.davet_dogrulandi_mi()
        and exists (
          select 1 from public.materials m
          where m.file_path = storage.objects.name
            and m.status = 'approved'
        )
      )
    )
  );

drop policy if exists materyal_yukleme on storage.objects;
create policy materyal_yukleme on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'materyaller'
    and public.uye_profili_var_mi()
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.profiles p
                where p.id = auth.uid()
                  and (p.teacher_status is null or p.teacher_status = 'approved'))
    and (
      public.is_admin()
      or public.is_teacher()
      or public.davet_dogrulandi_mi()
    )
  );

-- ----------------------------------------------------------------------------
-- 5) Profil alanlarını koruyan trigger
-- ----------------------------------------------------------------------------

create or replace function public.profiles_kayit_alanlarini_koru()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- İç güvenli işlemler (registration / admin review) trigger kısıtlarını baypas eder.
  if current_setting('sosyolab.registration_context', true) = 'on'
     or current_setting('sosyolab.teacher_review_context', true) = 'on' then
    return new;
  end if;

  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.class_year := null;
      new.teacher_status := null;
      new.auth_login_email := null;
      new.teacher_reviewed_at := null;
      new.teacher_reviewed_by := null;
      new.teacher_rejection_reason := null;
    else
      new.username := old.username;
      new.class_year := old.class_year;
      new.teacher_status := old.teacher_status;
      new.auth_login_email := old.auth_login_email;
      new.teacher_reviewed_at := old.teacher_reviewed_at;
      new.teacher_reviewed_by := old.teacher_reviewed_by;
      new.teacher_rejection_reason := old.teacher_rejection_reason;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.profiles_kayit_alanlarini_koru() from public, anon, authenticated;

drop trigger if exists profiles_kayit_alanlarini_koru_trg on public.profiles;
create trigger profiles_kayit_alanlarini_koru_trg
  before insert or update on public.profiles
  for each row execute function public.profiles_kayit_alanlarini_koru();

-- ----------------------------------------------------------------------------
-- 6) teacher_courses koruması (sos401 teacher'a atanamaz)
-- ----------------------------------------------------------------------------

-- Önce 005 döneminden kalan atamaları temizle; CHECK bundan sonra doğrulanır.
delete from public.teacher_courses
where lower(btrim(course_id)) = 'sos401';

alter table public.teacher_courses
  drop constraint if exists teacher_courses_sos401_yasak;
alter table public.teacher_courses
  add constraint teacher_courses_sos401_yasak
  check (lower(btrim(course_id)) <> 'sos401');

-- Yanlış bir satır kısıtlar atlanarak eklenmiş olsa da doğrudan yayın verme.
create or replace function public.teacher_has_course(p_course_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(btrim(p_course_id)) <> 'sos401'
    and public.is_teacher()
    and exists (
      select 1 from public.teacher_courses tc
       where tc.teacher_id = auth.uid() and tc.course_id = p_course_id
    );
$$;

revoke all on function public.teacher_has_course(text) from public, anon;
grant execute on function public.teacher_has_course(text) to authenticated;

create or replace function public.teacher_courses_teacher_koru()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(btrim(new.course_id)) = 'sos401' then
    raise exception 'sos401 yalnızca yönetici tarafından yönetilir; öğretim elemanına atanamaz';
  end if;

  if not exists (
    select 1
      from public.profiles p
     where p.id = new.teacher_id
       and p.role = 'teacher'
       and p.teacher_status = 'approved'
  ) then
    raise exception 'teacher_courses.teacher_id yalnızca onaylı role=teacher profiline atanabilir';
  end if;

  return new;
end;
$$;

revoke all on function public.teacher_courses_teacher_koru() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7) Dokümantasyon notu (SQL içinde)
-- ----------------------------------------------------------------------------
-- Kod sınıfları:
--   STUDENT_GRADE_1 -> audience_type='student', class_year=1
--   STUDENT_GRADE_2 -> audience_type='student', class_year=2
--   STUDENT_GRADE_3 -> audience_type='student', class_year=3
--   STUDENT_GRADE_4 -> audience_type='student', class_year=4
--   TEACHER         -> audience_type='teacher', class_year=null
--
-- Örnek (gerçek kodu migration'a yazmayın):
--   select public.admin_davet_kodu_olustur('<KOD>', 'student', 1, 'STUDENT_GRADE_1', now() + interval '90 days', 200);
--   select public.admin_davet_kodu_olustur('<KOD>', 'teacher', null, 'TEACHER', now() + interval '30 days', 50);
-- <<< 006 FINAL GÖVDESİ <<<

-- ----------------------------------------------------------------------------
-- 9) Son koşullar: final güvenlik durumu ve veri koruma (fail-closed)
-- ----------------------------------------------------------------------------

do $$
declare
  b record;
  v_imza text;
  v_rol text;
  v_ozet text;
begin
  select * into b from pg_temp.m007_baslangic;
  if (select count(*) from public.profiles) <> b.profiles
     or (select count(*) from auth.users) <> b.auth_users
     or (select count(*) from public.davet_kodlari) <> b.davetler
     or (select count(*) from public.davet_dogrulamalari) <> b.damgalar
     or (select count(*) from public.materials) <> b.materyaller
     or (select count(*) from public.teacher_courses where lower(btrim(course_id)) <> 'sos401') <> b.atamalar
     or (select count(*) from public.profiles where username is null) <> b.adsiz_profiller
     or (select count(*) from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)) <> b.profilsiz_auth then
    raise exception '007 son koşul: satır sayıları değişti (veri koruma ihlali)';
  end if;

  -- Eski istemci RPC imzaları kalmamalı.
  if to_regprocedure('public.kullanici_kaydi_tamamla(text,text,text)') is not null
     or to_regprocedure('public.kayit_icin_davet_kodu_kullan(text)') is not null then
    raise exception '007 son koşul: eski kayıt RPC imzası kaldı';
  end if;

  -- Yalnız service_role'e açık sunucu fonksiyonları.
  foreach v_imza in array array[
      'public.kullanici_email_bul(text)', 'public.kayit_on_kontrol(text,text,text)',
      'public.kullanici_kaydi_tamamla(uuid,text,text,text)', 'public.kayit_sonucunu_kesinlestir(uuid)',
      'public.istek_siniri_tuket(jsonb)'] loop
    if to_regprocedure(v_imza) is null then
      raise exception '007 son koşul: % yok', v_imza;
    end if;
    foreach v_rol in array array['public', 'anon', 'authenticated'] loop
      if has_function_privilege(v_rol, v_imza, 'execute') then
        raise exception '007 son koşul: % EXECUTE % rolüne açık', v_imza, v_rol;
      end if;
    end loop;
    if not has_function_privilege('service_role', v_imza, 'execute') then
      raise exception '007 son koşul: % service_role EXECUTE yok', v_imza;
    end if;
  end loop;

  -- İç helper'lar istemcilere kapalı.
  foreach v_imza in array array[
      'public.davet_arama_ozeti(text)', 'public.kayit_icin_davet_kodu_kullan(uuid,text)',
      'public.normalize_username(text)', 'public.davet_kullan(text)',
      'public.profiles_kayit_alanlarini_koru()', 'public.teacher_courses_teacher_koru()'] loop
    if to_regprocedure(v_imza) is null then
      raise exception '007 son koşul: % yok', v_imza;
    end if;
    foreach v_rol in array array['public', 'anon', 'authenticated'] loop
      if has_function_privilege(v_rol, v_imza, 'execute') then
        raise exception '007 son koşul: % EXECUTE % rolüne açık', v_imza, v_rol;
      end if;
    end loop;
  end loop;

  -- Oturumlu istemci helper'ları: anon/PUBLIC kapalı, authenticated açık.
  foreach v_imza in array array[
      'public.uye_profili_var_mi()', 'public.davet_dogrulandi_mi()', 'public.teacher_has_course(text)',
      'public.ogretmen_basvurusunu_karara_bagla(uuid,text,text)',
      'public.admin_davet_kodu_olustur(text,text,smallint,text,timestamptz,integer)'] loop
    if has_function_privilege('public', v_imza, 'execute') or has_function_privilege('anon', v_imza, 'execute')
       or not has_function_privilege('authenticated', v_imza, 'execute') then
      raise exception '007 son koşul: % ACL beklenen değil', v_imza;
    end if;
  end loop;

  -- İç Auth kimliği istemciye kapalı; uygulamanın okuduğu kolonlar açık.
  if has_column_privilege('authenticated', 'public.profiles', 'auth_login_email', 'select')
     or has_table_privilege('authenticated', 'public.profiles', 'select')
     or has_any_column_privilege('anon', 'public.profiles', 'select')
     or has_table_privilege('authenticated', 'public.profiles', 'insert')
     or has_table_privilege('anon', 'public.profiles', 'insert') then
    raise exception '007 son koşul: profiles istemci yetkileri final sözleşmeyle uyumsuz';
  end if;
  foreach v_rol in array array['id', 'role', 'display_name', 'username', 'class_year', 'teacher_status', 'created_at'] loop
    if not has_column_privilege('authenticated', 'public.profiles', v_rol, 'select') then
      raise exception '007 son koşul: authenticated profiles.% okuyamıyor', v_rol;
    end if;
  end loop;

  -- Özel şema hiçbir API rolüne açık değil.
  foreach v_rol in array array['anon', 'authenticated', 'service_role'] loop
    if has_schema_privilege(v_rol, 'sosyolab_private', 'usage') then
      raise exception '007 son koşul: sosyolab_private % rolüne açık', v_rol;
    end if;
  end loop;
  if (select count(*) from sosyolab_private.login_pepper) <> 1
     or (select count(*) from sosyolab_private.sunucu_pepperlari) <> 2 then
    raise exception '007 son koşul: pepper satırları beklenen değil';
  end if;

  -- HMAC davet araması.
  if to_regclass('public.davet_kodlari_arama_ozeti_unique') is null
     or not exists (select 1 from pg_constraint where conrelid = 'public.davet_kodlari'::regclass
                     and conname = 'davet_kayit_arama_ozeti_zorunlu')
     or exists (select 1 from public.davet_kodlari k
                 where k.aktif and k.audience_type in ('student', 'teacher') and k.kod_arama_ozeti is null) then
    raise exception '007 son koşul: davet arama özeti yapısı eksik';
  end if;

  -- Üyelik sınırı politikaları.
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles'
              and policyname = 'profiles_kendi_olusturur')
     or (select count(*) from pg_policies
          where (schemaname, tablename, policyname) in (
                ('public', 'materials', 'materials_okuma'), ('public', 'materials', 'materials_gonderim'),
                ('storage', 'objects', 'materyal_okuma'), ('storage', 'objects', 'materyal_yukleme'))
            and coalesce(qual, with_check) like '%uye_profili_var_mi()%') <> 4 then
    raise exception '007 son koşul: üyelik politikaları beklenen değil';
  end if;

  -- Final durumda pepper'lar korunmuş olmalı (rotate edilmez).
  select ozet into v_ozet from pg_temp.m007_pepper;
  if v_ozet is not null and v_ozet is distinct from (
       select md5(string_agg(encode(x, 'hex'), ',' order by k)) from (
         select 'login' as k, lp.pepper as x from sosyolab_private.login_pepper lp
         union all select sp.ad, sp.deger from sosyolab_private.sunucu_pepperlari sp) s) then
    raise exception '007 son koşul: mevcut pepper değişti';
  end if;

  raise notice '007 tamam (başlangıç: %)', current_setting('sosyolab.m007_durum');
end;
$$;

commit;
