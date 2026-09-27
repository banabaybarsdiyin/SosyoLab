-- ============================================================================
-- SosyoLab — 001: sunucu tarafında davet kodu doğrulaması
-- ============================================================================
--
-- SORUN
-- -----
-- Statik bir sitede tarayıcıya ulaşan her değer herkese açıktır. Davet kodu
-- istemci kaynağında düz metin durduğu sürece erişim kontrolü sağlamaz;
-- üstelik anonim giriş açık olduğundan kodu hiç bilmeyen biri de oturum
-- açıp materyal gönderebilir. Bu göç kodu sunucuya taşır ve gönderim iznini
-- doğrulanmış davete bağlar.
--
-- NE YAPAR
-- --------
--   1. Hash'lenmiş, süreli ve kullanım sayaçlı davet kodu tablosu oluşturur.
--   2. Doğrulama damgasını, hiçbir istemci rolünün yazamadığı ayrı bir
--      tabloda tutar (public.davet_dogrulamalari).
--   3. public.davet_kullan(p_kod) RPC'sini tanımlar: kodu sunucuda doğrular,
--      damgayı basar, kodun kendisini asla istemciye sızdırmaz.
--   4. materials INSERT politikasını "yalnızca daveti doğrulanmış kullanıcı"
--      olacak şekilde daraltır.
--   5. Davet kodu bir öğrenci numarasına bağlıysa numarayı sunucu yazar ve
--      sonrasında değiştirilemez hâle getirir.
--
-- TASARIM NOTU — damga neden profiles'ta DEĞİL
-- --------------------------------------------
-- Damga ilk taslakta profiles.invite_verified sütunundaydı. Bu çalışmaz:
-- profiles üzerindeki BEFORE UPDATE trigger'ı (profiles_davet_koru) davet
-- damgasını admin olmayan çağırıcı için eski değerine sabitliyordu ve
-- davet_kullan() SECURITY DEFINER olsa bile trigger içindeki is_admin()
-- çağrısı auth.uid()'ye baktığı için sıradan öğrencide false dönüyordu.
-- Sonuç: RPC true dönerken damga sessizce geri alınıyor, kodun kullanım
-- hakkı tükeniyor ve kullanıcı hiçbir zaman gönderim yapamıyordu.
--
-- Damga artık yazma politikası HİÇ OLMAYAN ayrı bir tabloda. Böylece
-- "kullanıcı kendi damgasını basamaz" güvencesi bir trigger'ın doğru
-- yazılmasına değil, RLS'in yapısına dayanıyor.
--
-- UYGULAMA SIRASI — ÖNEMLİ
-- ------------------------
-- Bu dosya ÇALIŞTIRILMADAN config.js içinde INVITE_MODE "server" YAPILMAMALIDIR.
-- Aksi hâlde davet_kullan RPC'si bulunamaz ve öğrenci girişi tamamen durur.
-- Adım adım geçiş: docs/DEPLOYMENT-SECURITY.md bölüm 11.
--
-- GERİ ALMA: bu dosyanın en altındaki yorumlu blok.
--
-- SINIRLAR (bu göç bunları ÇÖZMEZ)
-- --------------------------------
--   * Gerçek hız sınırlama / bot koruması kenar katmanında (Cloudflare, WAF)
--     ya da Supabase Auth ayarlarında yapılır. Aşağıdaki deneme sayacı
--     yalnızca bir yavaşlatmadır: saldırgan her denemede yeni bir anonim
--     oturum açarak sayacı sıfırlayabilir.
--   * Öğrenci numarasının gerçekten o kişiye ait olduğunu ancak kurumsal
--     kimlik doğrulaması (SSO) ya da öğrenci başına tekil davet kodu kanıtlar.
--     Dönem geneli tek kod kullanırsanız numara beyanı doğrulanmamış kalır.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. ÖN KOŞUL: pgcrypto
-- ----------------------------------------------------------------------------
--
-- Supabase'te pgcrypto "extensions" şemasında hazır gelir. Zaten başka bir
-- şemada kuruluysa "create extension if not exists" onu TAŞIMAZ; bu durumda
-- aşağıdaki fonksiyon çalışma anında patlar. Bu yüzden kurulum anında
-- açıkça doğruluyoruz: sessiz başarısızlık yerine anlaşılır hata.

create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if to_regprocedure('extensions.crypt(text, text)') is null
     or to_regprocedure('extensions.gen_salt(text, integer)') is null then
    raise exception
      'pgcrypto "extensions" şemasında bulunamadı. Mevcut konumu için: '
      'select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = ''pgcrypto''; '
      'Ardından bu dosyadaki extensions.crypt / extensions.gen_salt çağrılarını o şemaya göre güncelleyin.';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1. DAVET KODU TABLOSU
-- ----------------------------------------------------------------------------
--
-- Kod düz metin saklanmaz. bcrypt (extensions.crypt) ile satır başına tuzlu
-- özet tutulur; tablo sızsa bile kodlar doğrudan okunamaz.
--
-- bcrypt girdiyi 72 bayttan sonra keser. Bu yüzden kod uzunluğu 64 karakterle
-- sınırlanmıştır: aksi hâlde yalnızca 72. bayttan sonra farklılaşan iki kod
-- aynı sayılırdı.

create table if not exists public.davet_kodlari (
  id              uuid primary key default gen_random_uuid(),
  kod_ozeti       text not null,
  etiket          text,
  ogrenci_no      text,
  gecerlilik_sonu timestamptz,
  azami_kullanim  integer,
  kullanim_sayisi integer not null default 0,
  aktif           boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles (id) on delete set null,

  constraint davet_ogrenci_no_bicim
    check (ogrenci_no is null or ogrenci_no ~ '^[0-9]{10}$'),
  constraint davet_azami_pozitif
    check (azami_kullanim is null or azami_kullanim > 0),
  constraint davet_kullanim_negatif_degil
    check (kullanim_sayisi >= 0),
  -- bcrypt özeti dışında bir şey yazılmasın (düz metin kod kazası engellenir).
  constraint davet_ozet_bcrypt
    check (kod_ozeti ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$')
);

comment on table public.davet_kodlari is
  'Davet kodlarının bcrypt özetleri. Hiçbir istemci rolü bu tabloyu okuyamaz.';

alter table public.davet_kodlari enable row level security;

-- Bilinçli olarak HİÇBİR politika tanımlanmıyor: RLS açık + politika yok
-- demek, anon ve authenticated rolleri için tam kapalı demektir. Tabloya
-- yalnızca SECURITY DEFINER fonksiyonlar ve service_role erişir.
revoke all on table public.davet_kodlari from anon, authenticated;

-- Aktif kod sayısını sınırla: doğrulama bcrypt ile satır satır tarama yapar
-- (özet indekslenemez) ve her karşılaştırma bilerek yavaştır. Çok sayıda
-- aktif kod, RPC'yi hem yavaşlatır hem bir kaynak tüketim yüzeyi açar.
create or replace function public.davet_aktif_kod_siniri()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aktif integer;
begin
  select count(*) into v_aktif from public.davet_kodlari where aktif;
  if v_aktif > 25 then
    raise exception 'En fazla 25 aktif davet kodu olabilir (şu an %). Kullanılmayanları aktif = false yapın.', v_aktif;
  end if;
  return null;
end;
$$;

drop trigger if exists davet_aktif_kod_siniri_trg on public.davet_kodlari;
create trigger davet_aktif_kod_siniri_trg
  after insert or update on public.davet_kodlari
  for each statement execute function public.davet_aktif_kod_siniri();

-- ----------------------------------------------------------------------------
-- 2. DOĞRULAMA DAMGASI
-- ----------------------------------------------------------------------------
--
-- Bu tabloya yazma politikası YOKTUR. Satırı yalnızca aşağıdaki SECURITY
-- DEFINER fonksiyon ekler. Kullanıcı kendi damgasını basamaz, silemez,
-- başkasının damgasını göremez.

create table if not exists public.davet_dogrulamalari (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  dogrulandi  timestamptz not null default now(),
  davet_id    uuid references public.davet_kodlari (id) on delete set null,
  ogrenci_no  text
);

comment on table public.davet_dogrulamalari is
  'Davet kodunu başarıyla kullanmış kullanıcılar. Yalnızca public.davet_kullan() yazar.';

alter table public.davet_dogrulamalari enable row level security;

-- Okuma: kullanıcı kendi damgasını görebilir (arayüz gönderim düğmesini buna
-- göre açar), admin hepsini görebilir. Yazma politikası bilinçli olarak yok.
drop policy if exists davet_dogrulama_okuma on public.davet_dogrulamalari;
create policy davet_dogrulama_okuma on public.davet_dogrulamalari
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke insert, update, delete on table public.davet_dogrulamalari from anon, authenticated;

-- RLS politikalarının ve trigger'ların kullandığı yardımcı. is_admin() ile
-- aynı desen: SECURITY DEFINER + kapalı search_path + dar EXECUTE izni.
create or replace function public.davet_dogrulandi_mi()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.davet_dogrulamalari d where d.user_id = auth.uid()
  );
$$;

revoke all on function public.davet_dogrulandi_mi() from public, anon;
grant execute on function public.davet_dogrulandi_mi() to authenticated;

-- ----------------------------------------------------------------------------
-- 3. DENEME SAYACI (yavaşlatma — hız sınırlamanın yerini TUTMAZ)
-- ----------------------------------------------------------------------------

create table if not exists public.davet_denemeleri (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  deneme      integer not null default 0,
  ilk_deneme  timestamptz not null default now(),
  son_deneme  timestamptz not null default now()
);

alter table public.davet_denemeleri enable row level security;
revoke all on table public.davet_denemeleri from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. DOĞRULAMA FONKSİYONU
-- ----------------------------------------------------------------------------
--
-- search_path = '' ile yazıldı ve her nesne tam nitelenmiş adıyla çağrıldı:
-- böylece arama yolunu değiştirerek fonksiyonu kandırmak (public şema
-- enjeksiyonu) mümkün olmaz.
--
-- Dönüş değeri BİLİNÇLİ olarak tek bir boolean'dır. Yanlış kod, süresi
-- dolmuş kod, hakkı tükenmiş kod ve deneme sınırı aşımı hepsi aynı "false"
-- ile yanıtlanır: saldırgana hangi kodun var olduğunu söyleyen bir hata
-- oracle'ı oluşmaz.

create or replace function public.davet_kullan(p_kod text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_kod     text := upper(btrim(coalesce(p_kod, '')));
  v_satir   public.davet_kodlari%rowtype;
  v_deneme  integer;
  v_tuketildi boolean;
begin
  if v_uid is null then
    return false;
  end if;

  -- 64 karakter sınırı bcrypt'in 72 baytlık kesme davranışı yüzünden.
  if v_kod = '' or length(v_kod) > 64 then
    return false;
  end if;

  -- Zaten doğrulanmışsa tekrar kod harcanmaz.
  if exists (select 1 from public.davet_dogrulamalari d where d.user_id = v_uid) then
    return true;
  end if;

  -- Deneme sayacı. 15 dakika sessizlikten sonra sıfırlanır: yanlış yazan
  -- öğrenci kalıcı olarak kilitlenmez.
  insert into public.davet_denemeleri (user_id, deneme)
  values (v_uid, 1)
  on conflict (user_id) do update
    set deneme = case
          when public.davet_denemeleri.son_deneme < now() - interval '15 minutes' then 1
          else public.davet_denemeleri.deneme + 1
        end,
        ilk_deneme = case
          when public.davet_denemeleri.son_deneme < now() - interval '15 minutes' then now()
          else public.davet_denemeleri.ilk_deneme
        end,
        son_deneme = now()
  returning deneme into v_deneme;

  if v_deneme > 8 then
    return false;
  end if;

  -- bcrypt özeti indekslenemez, bu yüzden aktif satırlar taranır. Aktif kod
  -- sayısı 25 ile sınırlı (bölüm 1'deki trigger) ve her çağrı en fazla 8
  -- denemeye kadar sayılır; böylece tarama maliyeti sınırlı kalır.
  for v_satir in
    select * from public.davet_kodlari
     where aktif
       and (gecerlilik_sonu is null or gecerlilik_sonu > now())
       and (azami_kullanim is null or kullanim_sayisi < azami_kullanim)
     order by created_at desc
     limit 25
  loop
    if v_satir.kod_ozeti = extensions.crypt(v_kod, v_satir.kod_ozeti) then

      -- Sayaç ATOMİK artırılır: sınır koşulu UPDATE'in kendi WHERE'ında
      -- yeniden değerlendirilir ve satır kilitlenir. İki eşzamanlı çağrı
      -- tek kullanımlık bir kodu iki kez tüketemez.
      update public.davet_kodlari
         set kullanim_sayisi = kullanim_sayisi + 1
       where id = v_satir.id
         and aktif
         and (gecerlilik_sonu is null or gecerlilik_sonu > now())
         and (azami_kullanim is null or kullanim_sayisi < azami_kullanim);

      v_tuketildi := found;
      if not v_tuketildi then
        -- Yarış kaybedildi: kodun hakkı bu arada doldu. Doğru kod olsa bile
        -- damga basılmaz ve çağrı başarısız sayılır.
        return false;
      end if;

      -- ÖNEMLİ — sıra: önce öğrenci numarası, sonra damga.
      -- profiles üzerindeki pinleme trigger'ı "damga varsa numara sabittir"
      -- kuralını uygular; damgayı önce basarsak kendi yazımımız engellenir.
      if v_satir.ogrenci_no is not null then
        update public.profiles
           set student_number = v_satir.ogrenci_no
         where id = v_uid;
      end if;

      insert into public.davet_dogrulamalari (user_id, davet_id, ogrenci_no)
      values (v_uid, v_satir.id, v_satir.ogrenci_no)
      on conflict (user_id) do nothing;

      delete from public.davet_denemeleri where user_id = v_uid;
      return true;
    end if;
  end loop;

  return false;
end;
$$;

revoke all on function public.davet_kullan(text) from public, anon;
grant execute on function public.davet_kullan(text) to authenticated;

comment on function public.davet_kullan(text) is
  'Davet kodunu sunucuda doğrular ve public.davet_dogrulamalari damgasını basar. '
  'Kod istemciye hiçbir zaman gönderilmez; tüm başarısızlıklar aynı false ile döner.';

-- ----------------------------------------------------------------------------
-- 5. POLİTİKALARIN DARALTILMASI
-- ----------------------------------------------------------------------------

-- Gönderim artık yalnızca daveti doğrulanmış kullanıcıya (ya da admine) açık.
drop policy if exists materials_gonderim on public.materials;
create policy materials_gonderim on public.materials
  for insert to authenticated
  with check (
    uploader_id = auth.uid()
    and status = 'pending'
    and reviewed_at is null
    and reviewed_by is null
    and rejection_reason is null
    and (public.is_admin() or public.davet_dogrulandi_mi())
  );

-- Doğrulanmış öğrenci numarası sonradan değiştirilemez. (Rol koruması
-- schema.sql içindeki profiles_rol_koru_trg'de; davet damgası ise ayrı
-- tabloda olduğu için burada korunmasına gerek yok.)
create or replace function public.profiles_no_koru()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- auth.uid() is null → istek bağlamı yok (SQL Editor / service_role / göç).
  -- Böyle bir yazma RLS'i aşan güvenilir bağlantıdan gelir ve kilitlenmez;
  -- gerekçe schema.sql bölüm 3'teki nottadır. Bu koşul olmadan yöneticinin
  -- hatalı bir numarayı dashboard'dan düzeltmesi imkânsız olurdu.
  if auth.uid() is not null
     and not public.is_admin()
     and exists (select 1 from public.davet_dogrulamalari d
                 where d.user_id = new.id and d.ogrenci_no is not null)
     and old.student_number is not null then
    new.student_number := old.student_number;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_no_koru_trg on public.profiles;
create trigger profiles_no_koru_trg
  before update on public.profiles
  for each row execute function public.profiles_no_koru();

-- İlk taslakta profiles.invite_verified sütunu vardı; artık kullanılmıyor.
-- O taslağı çalıştırdıysanız aşağıdaki iki satırı elle uygulayın:
--   alter table public.profiles drop column if exists invite_verified;
--   alter table public.profiles drop column if exists invite_verified_at;
--   drop trigger if exists profiles_davet_koru_trg on public.profiles;
--   drop trigger if exists profiles_davet_varsayilan_trg on public.profiles;
--   drop function if exists public.profiles_davet_koru();
--   drop function if exists public.profiles_davet_varsayilan();

-- ----------------------------------------------------------------------------
-- 6. DAVET KODU TANIMLAMA (elle, SQL Editor'den)
-- ----------------------------------------------------------------------------
--
-- Kodun kendisi BU DOSYAYA YAZILMAZ ve Git geçmişine girmez.
-- Aşağıdaki komutu SQL Editor'e yapıştırıp <KOD> yerine gerçek kodu koyun,
-- çalıştırın ve editör geçmişini temizleyin.
--
-- KOD ÜRETİMİ: tahmin edilemez olmalı. Sözlük kelimesi ya da "SOSYO2026"
-- gibi bir dizge kullanmayın; bcrypt yavaşlığı düşük entropiyi kurtarmaz.
-- Öneri (16 karakter, karışık):
--
--   select upper(encode(extensions.gen_random_bytes(10), 'hex'));
--
-- Çıkan değeri öğrencilere iletin ve AŞAĞIDAKİ komutta <KOD> yerine koyun.
--
--   -- Dönem geneli, 300 kullanım hakkı, 1 Şubat'ta biten kod:
--   insert into public.davet_kodlari (kod_ozeti, etiket, gecerlilik_sonu, azami_kullanim)
--   values (extensions.crypt(upper('<KOD>'), extensions.gen_salt('bf', 10)),
--           '2026-2027 Güz', '2027-02-01', 300);
--
--   -- Tek öğrenciye bağlı, tek kullanımlık kod (kimlik doğruluğu için TERCİH EDİN:
--   -- yalnızca bu biçim öğrenci numarası beyanını gerçekten doğrular):
--   insert into public.davet_kodlari (kod_ozeti, etiket, ogrenci_no, azami_kullanim)
--   values (extensions.crypt(upper('<KOD>'), extensions.gen_salt('bf', 10)),
--           'Öğrenci daveti', '1000000001', 1);
--
--   -- Kodu iptal etmek:
--   update public.davet_kodlari set aktif = false where etiket = '2026-2027 Güz';
--
--   -- Kullanım durumu (kodun kendisi görünmez):
--   select etiket, ogrenci_no, kullanim_sayisi, azami_kullanim, gecerlilik_sonu, aktif
--     from public.davet_kodlari order by created_at desc;
--
--   -- Bir kodun gerçekten doğrulandığını sınamak (service_role ile, SQL Editor):
--   select (extensions.crypt(upper('<KOD>'), kod_ozeti) = kod_ozeti) as eslesti, etiket
--     from public.davet_kodlari where aktif;
--
-- ----------------------------------------------------------------------------
-- 7. MEVCUT KULLANICILARIN GEÇİŞİ
-- ----------------------------------------------------------------------------
--
-- Bu göç uygulandığı anda daveti doğrulanmamış herkesin gönderim izni
-- kalkar. Şu ana kadar gönderim yapmış kullanıcıları elle geçirmek
-- isterseniz (yalnızca bilinçli bir karar olarak):
--
--   insert into public.davet_dogrulamalari (user_id)
--   select distinct uploader_id from public.materials
--    where uploader_id is not null
--   on conflict (user_id) do nothing;
--
-- ----------------------------------------------------------------------------
-- GERİ ALMA
-- ----------------------------------------------------------------------------
--
--   drop trigger if exists profiles_no_koru_trg on public.profiles;
--   drop function if exists public.profiles_no_koru();
--   drop function if exists public.davet_kullan(text);
--   drop function if exists public.davet_dogrulandi_mi();
--   drop trigger if exists davet_aktif_kod_siniri_trg on public.davet_kodlari;
--   drop function if exists public.davet_aktif_kod_siniri();
--   drop table if exists public.davet_denemeleri;
--   drop table if exists public.davet_dogrulamalari;
--   drop table if exists public.davet_kodlari;
--   -- ve schema.sql içindeki özgün materials_gonderim politikasını geri kurun:
--   --   drop policy if exists materials_gonderim on public.materials;
--   --   create policy materials_gonderim on public.materials
--   --     for insert to authenticated
--   --     with check (uploader_id = auth.uid() and status = 'pending'
--   --                 and reviewed_at is null and reviewed_by is null
--   --                 and rejection_reason is null);
--   -- config.js içinde INVITE_MODE tekrar "local" yapılmalıdır.
-- ============================================================================
