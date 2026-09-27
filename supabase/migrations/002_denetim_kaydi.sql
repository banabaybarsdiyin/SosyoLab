-- ============================================================================
-- SosyoLab — 002: yönetici işlemleri için denetim kaydı (audit trail)
-- ============================================================================
--
-- SORUN
-- -----
-- Materyal onaylama, reddetme, silme ve rol değişikliği geri alınamaz
-- sonuçlar doğurur ama hiçbir yerde iz bırakmıyordu. "Bu materyali kim
-- sildi?" sorusunun yanıtı yoktu.
--
-- NE YAPAR
-- --------
-- Her kritik yönetici işlemi için kim / ne / hangi nesne / ne zaman / sonuç
-- bilgisini tutan, uygulama kullanıcısı tarafından değiştirilemeyen bir
-- tablo oluşturur. Kayıtları veritabanı trigger'ları yazar; istemcinin
-- yazdığı hiçbir değere güvenilmez.
--
-- KAYDEDİLMEYENLER (bilinçli)
-- ---------------------------
-- Parola, jeton, davet kodu, oturum bilgisi ve IP adresi kaydedilmez.
-- IP zaten veritabanı katmanında güvenilir biçimde elde edilemez; veri
-- minimizasyonu (KVKK md. 4) gereği de toplanmaz.
--
-- BAŞARISIZ DENEMELER KAYDEDİLMEZ — bilinen sınır
-- ----------------------------------------------
-- İz, işlemi yapan trigger ile AYNI transaction içinde yazılır. RLS bir
-- işlemi reddettiğinde transaction geri alınır ve iz satırı da geri alınır;
-- yani "yetkisiz onay denemesi" buraya düşmez. Bu yüzden sonuc sütunu
-- pratikte her zaman 'basarili' olur ve öyle olmalıdır: burada bir satır
-- görmek, işlemin gerçekten gerçekleştiği anlamına gelir.
-- Reddedilen denemeleri görmek isterseniz kaynak Supabase PostgREST/Auth
-- loglarıdır, bu tablo değil.
--
-- KİMİN DEĞİŞTİREBİLDİĞİ
-- ----------------------
-- anon ve authenticated rolleri yazamaz, güncelleyemez, silemez (politika
-- yok + revoke). Admin de kendi izini değiştiremez. service_role ve tablo
-- sahibi RLS'i aşar — bu Postgres'te kaçınılmazdır; service_role anahtarının
-- yalnızca sunucu tarafında kalması bu yüzden kritiktir.
--
-- SAKLAMA
-- -------
-- Bölüm 5'te iki yıllık saklama için hazır temizlik fonksiyonu vardır.
-- Zamanlanmış çalıştırma pg_cron gerektirir (Supabase'te elle etkinleştirilir).
--
-- UYGULAMA: Supabase → SQL Editor. Önce 001, sonra bu dosya.
-- GERİ ALMA: en alttaki yorumlu blok.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TABLO
-- ----------------------------------------------------------------------------

create table if not exists public.denetim_kaydi (
  id          bigint generated always as identity primary key,
  olusma      timestamptz not null default now(),
  aktor_id    uuid,                 -- auth.users'a FK YOK: kullanıcı silinse de iz kalır
  aktor_rol   text,
  eylem       text not null,
  nesne_turu  text not null,
  nesne_id    text,
  sonuc       text not null default 'basarili',
  ayrinti     jsonb not null default '{}'::jsonb,

  constraint denetim_eylem_gecerli check (
    eylem in ('materyal_onay', 'materyal_ret', 'materyal_silme',
              'rol_degisikligi', 'davet_damgasi')
  ),
  constraint denetim_sonuc_gecerli check (sonuc in ('basarili', 'basarisiz'))
);

create index if not exists denetim_olusma_idx    on public.denetim_kaydi (olusma desc);
create index if not exists denetim_aktor_idx     on public.denetim_kaydi (aktor_id, olusma desc);
create index if not exists denetim_nesne_idx     on public.denetim_kaydi (nesne_turu, nesne_id);

comment on table public.denetim_kaydi is
  'Yönetici işlemlerinin değiştirilemez izi. Yalnızca trigger''lar yazar, '
  'yalnızca admin okur. Parola, jeton ve IP kaydedilmez.';

-- ----------------------------------------------------------------------------
-- 2. ERİŞİM
-- ----------------------------------------------------------------------------

alter table public.denetim_kaydi enable row level security;

-- Okuma: yalnızca admin.
drop policy if exists denetim_okuma on public.denetim_kaydi;
create policy denetim_okuma on public.denetim_kaydi
  for select to authenticated
  using (public.is_admin());

-- Yazma / güncelleme / silme için politika YOK: RLS açıkken politika
-- bulunmaması o işlemi tüm istemci rollerine kapatır. Admin bile kendi
-- izini silemez ya da değiştiremez. Kayıtları aşağıdaki SECURITY DEFINER
-- trigger'lar RLS'i aşarak yazar.
revoke insert, update, delete on table public.denetim_kaydi from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. YAZICI
-- ----------------------------------------------------------------------------

create or replace function public.denetim_yaz(
  p_eylem      text,
  p_nesne_turu text,
  p_nesne_id   text,
  p_ayrinti    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.denetim_kaydi (aktor_id, aktor_rol, eylem, nesne_turu, nesne_id, ayrinti)
  values (
    auth.uid(),
    case when public.is_admin() then 'admin' else 'user' end,
    p_eylem, p_nesne_turu, p_nesne_id, coalesce(p_ayrinti, '{}'::jsonb)
  );
end;
$$;

-- İstemci doğrudan çağıramaz; yalnızca trigger'lar kullanır.
revoke all on function public.denetim_yaz(text, text, text, jsonb) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. TRIGGER'LAR
-- ----------------------------------------------------------------------------

-- 4a. Materyal onay / ret
create or replace function public.materials_denetim_guncelle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    perform public.denetim_yaz(
      case new.status when 'approved' then 'materyal_onay'
                      when 'rejected' then 'materyal_ret'
                      else 'materyal_onay' end,
      'material',
      new.id::text,
      jsonb_build_object(
        'onceki_durum', old.status,
        'yeni_durum',   new.status,
        'baslik',       left(coalesce(new.title, ''), 200),
        'ders',         new.course_id,
        'yukleyen',     new.uploader_id,
        -- Ret gerekçesi serbest metindir; izde kısaltılarak tutulur.
        'ret_gerekcesi', left(coalesce(new.rejection_reason, ''), 300)
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists materials_denetim_guncelle_trg on public.materials;
create trigger materials_denetim_guncelle_trg
  after update on public.materials
  for each row execute function public.materials_denetim_guncelle();

-- 4b. Materyal silme
create or replace function public.materials_denetim_sil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.denetim_yaz(
    'materyal_silme', 'material', old.id::text,
    jsonb_build_object(
      'baslik',    left(coalesce(old.title, ''), 200),
      'ders',      old.course_id,
      'durum',     old.status,
      'yukleyen',  old.uploader_id,
      'dosya_yolu', old.file_path
    )
  );
  return old;
end;
$$;

-- AFTER DELETE kullanılır: iz yalnızca gerçekten silinmiş bir satır için
-- yazılır. BEFORE DELETE ile yazmak, sonradan başarısız olan bir silmede
-- yanıltıcı olurdu.
drop trigger if exists materials_denetim_sil_trg on public.materials;
create trigger materials_denetim_sil_trg
  after delete on public.materials
  for each row execute function public.materials_denetim_sil();

-- 4c. Rol değişikliği
create or replace function public.profiles_denetim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role then
    perform public.denetim_yaz(
      'rol_degisikligi', 'profile', new.id::text,
      jsonb_build_object('onceki_rol', old.role, 'yeni_rol', new.role)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_denetim_trg on public.profiles;
create trigger profiles_denetim_trg
  after update on public.profiles
  for each row execute function public.profiles_denetim();

-- 4d. Davet damgası — YALNIZCA göç 001 uygulanmışsa
--
-- Bu dosya 001'den bağımsız çalışabilsin diye koşullu kuruluyor: 001
-- uygulanmamışken sabit bir "create trigger" bütün göçü patlatırdı.
-- 001'i sonradan uygularsanız bu dosyayı tekrar çalıştırın (idempotenttir).
create or replace function public.davet_dogrulama_denetim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.denetim_yaz(
    'davet_damgasi', 'profile', new.user_id::text,
    -- Kodun kendisi ya da özeti ASLA kaydedilmez; yalnızca hangi davet
    -- kaydının kullanıldığı ve bağlı öğrenci numarası tutulur.
    jsonb_build_object('davet_id', new.davet_id, 'ogrenci_no', new.ogrenci_no)
  );
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.davet_dogrulamalari') is not null then
    execute 'drop trigger if exists davet_dogrulama_denetim_trg on public.davet_dogrulamalari';
    execute 'create trigger davet_dogrulama_denetim_trg
               after insert on public.davet_dogrulamalari
               for each row execute function public.davet_dogrulama_denetim()';
    raise notice 'Davet damgası denetim trigger''ı kuruldu.';
  else
    raise notice 'public.davet_dogrulamalari yok (göç 001 uygulanmamış): davet damgası denetimi ATLANDI. 001''i uyguladıktan sonra bu dosyayı tekrar çalıştırın.';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. SAKLAMA SÜRESİ
-- ----------------------------------------------------------------------------
--
-- Veri minimizasyonu gereği iz sonsuza kadar tutulmaz. Varsayılan 24 ay.
-- Otomatik çalıştırmak için Supabase'te pg_cron etkinleştirilmelidir:
--
--   select cron.schedule('denetim-temizlik', '0 4 1 * *',
--                        $cron$ select public.denetim_temizle(24) $cron$);

create or replace function public.denetim_temizle(p_ay integer default 24)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_silinen integer;
begin
  delete from public.denetim_kaydi
   where olusma < now() - make_interval(months => greatest(p_ay, 1));
  get diagnostics v_silinen = row_count;
  return v_silinen;
end;
$$;

revoke all on function public.denetim_temizle(integer) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- GERİ ALMA
-- ----------------------------------------------------------------------------
--
--   drop trigger if exists davet_dogrulama_denetim_trg on public.davet_dogrulamalari;
--   drop trigger if exists profiles_denetim_trg on public.profiles;
--   drop trigger if exists materials_denetim_sil_trg on public.materials;
--   drop trigger if exists materials_denetim_guncelle_trg on public.materials;
--   drop function if exists public.davet_dogrulama_denetim();
--   drop function if exists public.profiles_denetim();
--   drop function if exists public.materials_denetim_sil();
--   drop function if exists public.materials_denetim_guncelle();
--   drop function if exists public.denetim_temizle(integer);
--   drop function if exists public.denetim_yaz(text, text, text, jsonb);
--   drop table if exists public.denetim_kaydi;
-- ============================================================================
