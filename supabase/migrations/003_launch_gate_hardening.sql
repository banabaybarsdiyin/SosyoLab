-- ============================================================================
-- SosyoLab — 003: davet doğrulamasını okuma/yükleme tarafına taşı,
--                 dosya sahipliğini gönderimde zorunlu kıl
-- ============================================================================
--
-- SORUN 1 — davet kodu bir erişim kontrolü değildi (denetim bulgusu SL-01)
-- ------------------------------------------------------------------------
-- Göç 001 daveti YALNIZCA materials INSERT politikasına bağladı. Okuma ve
-- depo yazma tarafı "authenticated" olan herkese açık kaldı. Anonim giriş
-- üretimde açık olduğu için (öğrenci gönderimleri buna dayanıyor) bu iki
-- gerçek birleştiğinde ortaya çıkan sonuç şudur:
--
--   Siteyi açan herkes, config.js içindeki (tasarım gereği herkese açık)
--   anon anahtarla signInAnonymously() çağırıp "authenticated" rolüne
--   geçebilir. Davet kodunu hiç bilmeden:
--     * tüm onaylı materyal kayıtlarını okuyabilir,
--     * onaylı dosyalar için imzalı bağlantı üretip indirebilir,
--     * kendi uid klasörüne 25 MB'lık nesneler yükleyebilir. (SL-03)
--
-- Yani "tüm kimlikli kullanıcılar" pratikte "herkes" demekti.
--
-- SORUN 2 — gönderim, başkasının dosyasını gösterebiliyordu (SL-09 / R-02)
-- -----------------------------------------------------------------------
-- materials_gonderim "uploader_id = auth.uid()" diyordu ama file_path'in
-- gönderenin kendi klasöründe olmasını İSTEMİYORDU. Bağımsız inceleme bu
-- zinciri uçtan uca çalıştırdı ve doğruladı:
--
--   1. Davetli A, file_path olarak B'nin depo nesnesini gösteren bir kayıt
--      ekler (uploader_id yine A'dır, politika bunu kabul eder).
--   2. Yan etki: B artık kendi yetim dosyasını silemez — çünkü artık ona
--      "bağlı" bir materials kaydı vardır (4. maddedeki yetim silme).
--   3. Yönetici A'nın kaydını onaylar.
--   4. B'nin ONAYLANMAMIŞ, ÖZEL dosyası bütün davetli kullanıcılara okunur
--      hâle gelir.
--
-- Bu zincir 003 öncesinde de vardı ve daha geniş etkiliydi (davetsiz anonim
-- kullanıcılar da okuyabiliyordu). Aşağıdaki 2. madde zinciri ilk halkada,
-- yani INSERT sınırında kırar.
--
-- SORUN 3 — başarısız gönderim yetim dosya bırakıyordu (SL-04)
-- -----------------------------------------------------------
-- 5. maddede.
--
-- NE YAPAR
-- --------
--   1. materials SELECT: onaylı içerik yalnızca daveti doğrulanmış kullanıcıya.
--   2. materials INSERT: file_path gönderenin kendi uid klasöründe olmalı.
--   3. storage.objects SELECT: aynı davet koşulu.
--   4. storage.objects INSERT: yükleme de davet damgası ister.
--   5. storage.objects DELETE: sahibine YALNIZCA hiçbir materials kaydının
--      göstermediği (yetim) kendi nesnesini silme hakkı verir.
--
-- NE YAPMAZ — bilinçli
-- --------------------
--   * Hiçbir mevcut sınırı gevşetmez. Beş politikanın hepsi ya aynı kalır
--     ya DARALIR; tek genişleme 5. maddedeki yetim silme hakkıdır ve o da
--     "kendi klasörü + hiçbir kayda bağlı değil" ile üç kez sınırlıdır.
--   * Onaylı içeriği herkese açık yapmaz; kova public=false kalır.
--   * İstemciye hiçbir yetki taşımaz. Karar noktaları yine RLS içindedir.
--   * Admin sağlama, rol koruma, inceleme damgası, denetim kaydı ve davet
--     doğrulama mantığına DOKUNMAZ.
--
-- İŞLEM GÜVENLİĞİ — bu dosya TEK BİR TRANSACTION'dır
-- --------------------------------------------------
-- Tüm gövde BEGIN/COMMIT arasındadır. Gerekçe: politika değişimi
-- "drop policy" + "create policy" çiftleriyle yapılıyor ve arada bir hata
-- oluşursa (yazım hatası, kilit zaman aşımı, eksik izin) politika DÜŞMÜŞ
-- ama YENİSİ KURULMAMIŞ hâlde kalırdı. O durumda materials üzerinde hiçbir
-- SELECT politikası olmadığı için arşiv YÖNETİCİ DAHİL herkese kapanır —
-- veri sızdırmaz ama tam erişilebilirlik kaybıdır. Transaction bu ara
-- durumu imkânsız kılar: ya hepsi uygulanır ya hiçbiri.
--
-- NOT — Supabase SQL Editor: betiği tek parça çalıştırdığınızda editör
-- zaten bir transaction açmış olabilir. O hâlde aşağıdaki BEGIN "there is
-- already a transaction in progress" uyarısı verir; bu zararsızdır, COMMIT
-- yine tüm bloğu kapatır. psql ile çalıştırırsanız uyarı da çıkmaz.
--
-- ÖN KOŞUL
-- --------
-- schema.sql → 001 → 002 sırası uygulanmış olmalı. Ön koşul kontrolü
-- aşağıda; eksikse göç en başta anlaşılır hata verip HİÇBİR ŞEY değiştirmez.
--
-- GÖÇ SIRASI — ÖNEMLİ
-- -------------------
-- Bu dosya 001'deki materials_gonderim politikasını YENİDEN KURAR. 003'ten
-- sonra 001'i tekrar çalıştırırsanız 2. maddedeki dosya sahipliği koşulu
-- GERİ ALINIR ve SL-09 yeniden açılır. 001 yalnızca 003'ten ÖNCE çalıştırılır.
-- supabase/inventory.sql B bloğu bu durumu yakalar.
--
-- UYGULAMA: Supabase → SQL Editor. Tekrarı güvenlidir (idempotent).
-- DOĞRULAMA: supabase/inventory.sql -v mod=POST — A–G blokları 0 satır dönmeli.
--            (göçten ÖNCE ise -v mod=PRE; mod zorunludur, bkz. inventory.sql)
-- GERİ ALMA: en alttaki yorumlu blok.
--
-- SINIRLAR (bu göç bunları ÇÖZMEZ)
-- --------------------------------
--   * Davet kodunun kendisi hâlâ paylaşılabilir bir sırdır. Gerçek çözüm
--     öğrenci başına tek kullanımlık koddur (001 bölüm 6'daki ikinci örnek).
--   * Öğrenci numarası beyanı hâlâ doğrulanmamıştır (bkz. 001 SINIRLAR).
--   * Bu göçten ÖNCE oluşmuş yetim dosyalar kendiliğinden silinmez; 5. madde
--     yalnızca silinebilmelerini sağlar. Listeleme sorgusu en altta.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 0. ÖN KOŞUL KONTROLÜ
-- ----------------------------------------------------------------------------
--
-- Eksik bir bağımlılıkla devam etmek sessizce yanlış politika üretirdi:
-- "create policy" başarılı olur, içindeki fonksiyon çağrısı çalışma anında
-- patlar ve arşiv tamamen okunamaz hâle gelir. Bu yüzden önce doğruluyoruz.
--
-- Bu göçün yapısal ön kabulleri de zorunludur: public.materials ve
-- storage.objects tabloları var olmalı ve ikisinde de RLS açık olmalıdır.
-- Beklenen durum bozuksa göç politikalara dokunmadan EN BAŞTA durur.
--
-- storage.foldername(text) 2. maddede public.materials politikası içinden
-- çağrılıyor: şema sınırı aşan yeni bir bağımlılık, açıkça denetlenmeli.

do $$
begin
  if to_regclass('public.materials') is null then
    raise exception
      'public.materials bulunamadı. Önce supabase/schema.sql uygulanmalı.';
  end if;
  if to_regclass('storage.objects') is null then
    raise exception
      'storage.objects bulunamadı. Supabase Storage etkin değil ya da şema farklı.';
  end if;

  if not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'materials'
       and c.relkind = 'r'
       and c.relrowsecurity
  ) then
    raise exception
      'public.materials için RLS kapalı. Önce: alter table public.materials enable row level security;';
  end if;
  if not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'storage'
       and c.relname = 'objects'
       and c.relkind = 'r'
       and c.relrowsecurity
  ) then
    raise exception
      'storage.objects için RLS kapalı. Önce: alter table storage.objects enable row level security;';
  end if;

  if to_regprocedure('public.davet_dogrulandi_mi()') is null then
    raise exception
      'public.davet_dogrulandi_mi() bulunamadı. Önce supabase/migrations/001_davet_kodlari.sql uygulanmalı.';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception
      'public.is_admin() bulunamadı. Önce supabase/schema.sql uygulanmalı.';
  end if;
  if to_regprocedure('storage.foldername(text)') is null then
    raise exception
      'storage.foldername(text) bulunamadı. Supabase Storage etkin değil ya da şema farklı.';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1. materials SELECT — onaylı içerik davet damgası ister   (SL-01)
-- ----------------------------------------------------------------------------
--
-- ÖNCE:  status = 'approved' or uploader_id = auth.uid() or is_admin()
-- SONRA: uploader_id = auth.uid() or is_admin()
--        or (status = 'approved' and davet_dogrulandi_mi())
--
-- Sahip koşulu bilinçli olarak damgadan BAĞIMSIZ bırakıldı: kendi bekleyen
-- ya da reddedilen gönderisini görmek için davet damgası gerekmez. Damgası
-- düşmüş bir kullanıcı kendi geçmişine erişimini kaybetmemeli.

drop policy if exists materials_okuma on public.materials;
create policy materials_okuma on public.materials
  for select to authenticated
  using (
    uploader_id = auth.uid()
    or public.is_admin()
    or (status = 'approved' and public.davet_dogrulandi_mi())
  );

-- ----------------------------------------------------------------------------
-- 2. materials INSERT — dosya yolu gönderenin klasöründe olmalı  (SL-09)
-- ----------------------------------------------------------------------------
--
-- 001'deki tüm koşullar korunuyor, tek bir koşul EKLENİYOR:
--
--   (storage.foldername(file_path))[1] = auth.uid()::text
--
-- Böylece bir kullanıcı yalnızca KENDİ depo klasöründeki bir nesneyi
-- gösteren gönderi açabilir. Yukarıdaki SORUN 2 zinciri burada, ilk
-- halkada kırılır.
--
-- ADMIN İÇİN MUAFİYET YOK — bilinçli:
--   * Uygulamanın gönderim akışı yolu her zaman sunucu tarafında üretilmiş
--     gibi kurar: app.js depoYolu() = <kendi uid>/<randomUUID>.<uzantı>.
--     Yönetici de bu akışı kullanır, dolayısıyla koşul onun için de sağlanır.
--   * Muafiyet vermek yöneticiye YENİ bir yetenek kazandırmazdı: yönetici
--     başkasının bekleyen dosyasını zaten materyal_okuma politikasındaki
--     is_admin() dalıyla okuyabiliyor. Muafiyet yalnızca saldırı yüzeyini
--     geri açardı.
--
-- storage.foldername() davranışı (Supabase'in kendi uygulaması):
--   'uid/x.pdf'      -> ['uid']        -> [1] = 'uid'     ✓
--   'uid/alt/x.pdf'  -> ['uid','alt']  -> [1] = 'uid'     ✓ (alt klasör serbest)
--   'x.pdf'          -> []             -> [1] = NULL      ✗ reddedilir
--   '/uid/x.pdf'     -> ['','uid']     -> [1] = ''        ✗ reddedilir
-- NULL karşılaştırması NULL döner, NULL da WITH CHECK'i geçmez: kapalı fail.

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
    and (storage.foldername(file_path))[1] = auth.uid()::text
  );

-- ----------------------------------------------------------------------------
-- 3. storage.objects SELECT — onaylı dosya da davet damgası ister  (SL-01)
-- ----------------------------------------------------------------------------
--
-- Kova özeldir; erişim yalnızca imzalı bağlantıyla olur ve imzalı bağlantı
-- ancak bu politikadan geçen çağrı için üretilir. Üç kapı:
--   1) kendi klasörü        → damga gerekmez (bekleyen dosyasını görebilmeli)
--   2) admin                → damga gerekmez
--   3) onaylı materyalin dosyası → damga GEREKİR (yeni koşul)
--
-- İÇ İÇE RLS — bilinmesi gereken bağımlılık (bağımsız incelemede SINANDI):
-- Aşağıdaki alt sorgu public.materials'a bakıyor ve o tablo üzerindeki RLS
-- alt sorguya da uygulanır. 1. maddedeki materials_okuma daraltılırsa bu
-- politika da daralır — yön güvenli taraftır (kapalı fail). Doğrulama:
-- materials_okuma sahip-only yapıldığında davetli kullanıcı, damgası olduğu
-- hâlde onaylı nesneyi artık okuyamadı. davet_dogrulandi_mi() koşulu buna
-- rağmen AÇIKÇA yazıldı: politikanın ne demek istediği iç içe RLS'in yan
-- etkisine bırakılmamalı.

drop policy if exists materyal_okuma on storage.objects;
create policy materyal_okuma on storage.objects
  for select to authenticated
  using (
    bucket_id = 'materyaller'
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

-- ----------------------------------------------------------------------------
-- 4. storage.objects INSERT — yükleme davet damgası ister  (SL-03)
-- ----------------------------------------------------------------------------
--
-- Göç 001 materials INSERT'ini daveti doğrulanmış kullanıcıya bağladı ama
-- depo yazmayı açık bıraktı. Sonuç: davetsiz bir anonim oturum materials
-- kaydı açamıyordu ama kovaya 25 MB'lık nesneler yazabiliyordu — kota ve
-- maliyet tüketimine açık bir yüzey. Klasör kısıtı aynen korunuyor.

drop policy if exists materyal_yukleme on storage.objects;
create policy materyal_yukleme on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'materyaller'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (public.is_admin() or public.davet_dogrulandi_mi())
  );

-- ----------------------------------------------------------------------------
-- 5. storage.objects DELETE — sahibine yalnızca YETİM nesne silme hakkı (SL-04)
-- ----------------------------------------------------------------------------
--
-- SORUN: gonderiOlustur() önce dosyayı yükleyip sonra materials satırını
-- ekliyor. Satır reddedilirse istemci storage.remove() ile temizlemeye
-- çalışıyor, ama silme yalnızca admine açık olduğu için temizlik sessizce
-- başarısız oluyor ve dosya sahipsiz kalıyordu.
--
-- NEDEN SECURITY DEFINER YARDIMCI — bu maddenin en kritik ayrıntısı:
-- "Bu yola bağlı bir materials kaydı var mı?" sorusunu politikanın içinde
-- düz bir alt sorguyla sorsaydık, o alt sorgu materials üzerindeki RLS'e
-- takılırdı ve çağırıcının GÖREMEDİĞİ bir kayıt "yok" sayılırdı. Yayınlanmış
-- bir materyalin dosyası bu yüzden silinebilir hâle gelebilirdi. Kontrol bu
-- yüzden RLS'i aşan ve tek bir boolean döndüren bir fonksiyona alındı.
--
-- ORACLE SERTLEŞTİRMESİ:
-- Fonksiyon yalnızca çağıranın KENDİ klasör yolunda anlamlı sonuç verir.
-- Başkasının yolu, köksüz/bozuk yol ve auth.uid() NULL durumunda false döner.
-- Böylece "rastgele yol bağlı mı" sorusu metadata sızıntısına dönüşmez.
--
-- Bağımsız inceleme bunu doğruladı: sahibi superuser OLMAYAN bir rol olan
-- kurulumda, fonksiyon çağırıcının RLS ile göremediği kaydı gördü; ve
-- kullanıcı "göremediğim kayıt yok sayılır" istismarını yapamadı.

create or replace function public.dosya_materyale_bagli_mi(p_ad text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then false
    when p_ad is null or btrim(p_ad) = '' then false
    when (storage.foldername(p_ad))[1] is distinct from auth.uid()::text then false
    else exists (
      select 1 from public.materials m where m.file_path = p_ad
    )
  end;
$$;

revoke all on function public.dosya_materyale_bagli_mi(text) from public, anon;
grant execute on function public.dosya_materyale_bagli_mi(text) to authenticated;

comment on function public.dosya_materyale_bagli_mi(text) is
  'Verilen depo yolunun herhangi bir materials kaydına bağlı olup olmadığını '
  'söyler. Yalnızca çağıranın kendi uid klasörü için anlamlıdır; başkasının '
  'yolu, köksüz yol veya auth.uid() NULL ise false döner. Storage yetim silme '
  'politikası bunu kullanır: RLS''i aşar, çünkü çağırıcının görmediği bir kayıt '
  '"yok" sayılmamalıdır.';

-- Admin silme politikası OLDUĞU GİBİ kalır (schema.sql bölüm 5). Aynı komut
-- için birden fazla politika OR ile birleşir; bu yüzden admin politikasına
-- dokunmadan ikinci bir politika ekliyoruz. Böylece admin yetkisi bu göçün
-- doğruluğuna bağlı olmaz.
drop policy if exists materyal_yetim_silme on storage.objects;
create policy materyal_yetim_silme on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'materyaller'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not public.dosya_materyale_bagli_mi(name)
  );

-- Bu politika BİLİNÇLİ olarak şunları vermez (hepsi testle doğrulandı):
--   * başkasının nesnesini silme       → klasör = auth.uid() koşulu
--   * bekleyen/onaylı/reddedilen bir materyale bağlı dosyayı silme
--                                      → dosya_materyale_bagli_mi() koşulu
--   * dosyayı değiştirme / üzerine yazma → storage.objects'te UPDATE
--                                         politikası hâlâ YOK, upsert kapalı
--   * moderasyonu atlama               → materials UPDATE/DELETE değişmedi

commit;

-- ============================================================================
-- DOĞRULAMA (uygulamadan sonra, SQL Editor'de — salt okuma)
-- ============================================================================
--
--   supabase/inventory.sql -v mod=POST  →  A–G bloklarının HEPSİ 0 satır dönmeli.
--   Blok F beş sertleştirmenin hepsinin uygulandığını ayrıca doğrular.
--
-- Beklenen politika kümesi (inventory.sql A bloğu bunu birebir denetler):
--   materials → materials_gonderim (INSERT), materials_inceleme (UPDATE),
--               materials_okuma (SELECT), materials_silme (DELETE)
--   objects   → materyal_okuma (SELECT), materyal_silme (DELETE),
--               materyal_yetim_silme (DELETE), materyal_yukleme (INSERT)
--
-- Bu göçten ÖNCE birikmiş yetim dosyaları görmek (silmez, yalnızca listeler):
--   select o.name, o.created_at, round(((o.metadata->>'size')::bigint)/1024.0) as kb
--     from storage.objects o
--    where o.bucket_id = 'materyaller'
--      and not exists (select 1 from public.materials m where m.file_path = o.name)
--    order by o.created_at;
--
-- ============================================================================
-- GERİ ALMA
-- ============================================================================
--
-- begin;
--   drop policy if exists materyal_yetim_silme on storage.objects;
--   drop function if exists public.dosya_materyale_bagli_mi(text);
--
--   drop policy if exists materyal_yukleme on storage.objects;
--   create policy materyal_yukleme on storage.objects
--     for insert to authenticated
--     with check (
--       bucket_id = 'materyaller'
--       and (storage.foldername(name))[1] = auth.uid()::text
--     );
--
--   drop policy if exists materyal_okuma on storage.objects;
--   create policy materyal_okuma on storage.objects
--     for select to authenticated
--     using (
--       bucket_id = 'materyaller'
--       and (
--         (storage.foldername(name))[1] = auth.uid()::text
--         or public.is_admin()
--         or exists (
--           select 1 from public.materials m
--           where m.file_path = storage.objects.name
--             and m.status = 'approved'
--         )
--       )
--     );
--
--   drop policy if exists materials_gonderim on public.materials;
--   create policy materials_gonderim on public.materials
--     for insert to authenticated
--     with check (
--       uploader_id = auth.uid()
--       and status = 'pending'
--       and reviewed_at is null
--       and reviewed_by is null
--       and rejection_reason is null
--       and (public.is_admin() or public.davet_dogrulandi_mi())
--     );
--
--   drop policy if exists materials_okuma on public.materials;
--   create policy materials_okuma on public.materials
--     for select to authenticated
--     using (
--       status = 'approved'
--       or uploader_id = auth.uid()
--       or public.is_admin()
--     );
-- commit;
--
-- Geri alma SL-01, SL-03 ve SL-09'u yeniden açar: arşiv davet kodu olmadan
-- okunabilir hâle döner ve gönderim başkasının dosyasını gösterebilir.
-- Yalnızca bilinçli bir karar olarak yapın.
-- ============================================================================
