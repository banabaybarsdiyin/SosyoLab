-- ============================================================================
-- SosyoLab — canlı yetkilendirme envanteri (SALT OKUMA, İKİ MODLU)
-- ============================================================================
--
-- NE İÇİN
-- -------
-- Denetim bulgusu SL-02: depo dosyalarındaki RLS politikaları doğru yazılmış
-- olabilir ama bu, ÜRETİMDEKİ projenin gerçekten o politikalarla
-- yapılandırıldığını kanıtlamaz. PostgreSQL'de aynı komut için tanımlı
-- politikalar OR ile birleşir; dashboard'dan elle eklenmiş tek bir izin verici
-- politika erişimi sessizce genişletir ve dışarıdan sonda atarak görülemez.
--
-- ############################################################################
-- KULLANIM — MOD ZORUNLUDUR
-- ############################################################################
--
--   psql ... -v mod=PRE   -f supabase/inventory.sql     # 003'ten ÖNCE
--   psql ... -v mod=POST  -f supabase/inventory.sql     # 003'ten SONRA
--
-- mod verilmezse psql "syntax error at or near :" ile DURUR. Bu bilinçli:
-- sessizce yanlış moda düşmek, yanlış güvenin ta kendisi olurdu.
--
-- ############################################################################
-- NEDEN İKİ MOD (canlı preflight bulgusu)
-- ############################################################################
--
-- İlk sürüm tek moddu ve 003 SONRASI durumu zorunlu kılıyordu; runbook ise
-- onu 003'ten ÖNCE çalıştırıp "hepsi 0 satır" bekliyordu. Bu mantıksal olarak
-- imkânsızdı: 003 uygulanmadan önce SL-01/03/09 zaten açıktır, dolayısıyla
-- kapı her zaman kırmızı yanardı. Canlı koşum bunu doğruladı (A'da 1, B'de 4
-- bulgu). Operatörün öğreneceği ders "kırmızıyı yok say" olurdu — tam olarak
-- kaçınmak istediğimiz şey.
--
-- Çözüm: hangi koşulun hangi modda zorunlu olduğunu AÇIKÇA ayırmak.
--
--   MOD-BAĞIMSIZ (her iki modda zorunlu):
--     * hiçbir politika tamamen açık (true) olamaz
--     * sahiplik / admin / status=pending koşulları yerinde olmalı
--     * politika adları, komutları, rol kümesi, PERMISSIVE olması
--     * RLS açık olmalı (storage.buckets dahil)
--     * beklenmeyen tablo izni olmamalı VE zorunlu tablo izni eksik olmamalı
--       (blok D iki yönlüdür — bkz. o bloğun başındaki not)
--     * yetkilendirme fonksiyonlarının EXECUTE/search_path durumu
--
--   MODA BAĞLI (blok F):
--     PRE  → SL-01/03/09 sertleştirmelerinin HİÇBİRİ uygulanmamış olmalı
--     POST → SL-01/03/09 sertleştirmelerinin HEPSİ uygulanmış olmalı
--
--   Blok F simetriktir: PRE'de "kısmen uygulanmış" durumu da yakalar
--   (birisi 003'ün parçasını elle çalıştırmışsa), POST'ta ise eksik kalanı.
--
-- ############################################################################
-- GEÇME ÖLÇÜTÜ:  A, B, C, D, E, F bloklarının HEPSİ 0 SATIR döndürmeli.
-- G–J blokları bilgi amaçlıdır, geçme ölçütü değildir.
-- ############################################################################
--
-- SALT OKUMA: yalnızca SELECT ve WITH. Hiçbir şey yazmaz, silmez, değiştirmez.
-- Kullanıcı verisi okumaz; parola, jeton, anahtar ya da davet kodu döndürmez.
--
-- UYARI — bu dosya neyi KANITLAMAZ:
-- Envanter, yapılandırmanın beklenen olduğunu gösterir. Politikaların gerçek
-- DAVRANIŞINI göstermez; davranış kanıtı docs/LIVE-VALIDATION.md'dir.
-- Ayrıca blok B "gerekli koşul" denetimi yapar, tam gövde eşitliği DEĞİL:
-- gerekli alt dizeyi içerip üstüne fazladan gevşetme eklenmiş bir gövdeyi
-- (ör. "... or 1=1") yakalamaz. Bunun için blok G'deki ham dökümü depo
-- dosyalarıyla gözle karşılaştırın.
-- ============================================================================


-- ############################################################################
-- 0. MOD ONAYI (bilgi — hangi modda çalıştığını çıktıya yazar)
-- ############################################################################

select :'mod' as calisma_modu,
       case upper(:'mod')
         when 'PRE'  then '003 ONCESI: SL-01/03/09 acik OLMALI (blok F bunu dogrular)'
         when 'POST' then '003 SONRASI: SL-01/03/09 kapali OLMALI (blok F bunu dogrular)'
         else 'GECERSIZ MOD — yalnizca PRE ya da POST'
       end as anlami;


-- ############################################################################
-- A. POLİTİKA ENVANTERİ — FAZLA / EKSİK / ROL / KOMUT
-- ############################################################################
--
-- FULL OUTER JOIN iki yönü birlikte denetler:
--   * canlıda olup listede olmayan  → BEKLENMEYEN POLİTİKA (elle eklenmiş)
--   * listede olup canlıda olmayan  → EKSİK POLİTİKA
-- Ayrıca komut, PERMISSIVE olması ve rol kümesi denetlenir: mevcut bir
-- politikaya "alter policy ... to authenticated, anon" ile anon eklenmesi
-- yalnızca rol denetimiyle yakalanır.
--
-- materyal_yetim_silme YALNIZCA POST modunda beklenir (003 onu yaratır).
--
-- 0 satır beklenir.

with beklenen_tum(schemaname, tablename, policyname, cmd, mod) as (
  values
    ('public',  'profiles',            'profiles_kendi_okur',      'SELECT', 'HER'),
    ('public',  'profiles',            'profiles_kendi_olusturur', 'INSERT', 'HER'),
    ('public',  'profiles',            'profiles_kendi_gunceller', 'UPDATE', 'HER'),
    ('public',  'materials',           'materials_okuma',          'SELECT', 'HER'),
    ('public',  'materials',           'materials_gonderim',       'INSERT', 'HER'),
    ('public',  'materials',           'materials_inceleme',       'UPDATE', 'HER'),
    ('public',  'materials',           'materials_silme',          'DELETE', 'HER'),
    ('storage', 'objects',             'materyal_yukleme',         'INSERT', 'HER'),
    ('storage', 'objects',             'materyal_okuma',           'SELECT', 'HER'),
    ('storage', 'objects',             'materyal_silme',           'DELETE', 'HER'),
    ('storage', 'objects',             'materyal_yetim_silme',     'DELETE', 'POST'),
    ('public',  'davet_dogrulamalari', 'davet_dogrulama_okuma',    'SELECT', 'HER'),
    ('public',  'denetim_kaydi',       'denetim_okuma',            'SELECT', 'HER')
),
beklenen as (
  select schemaname, tablename, policyname, cmd
    from beklenen_tum
   where mod = 'HER' or mod = upper(:'mod')
),
mevcut as (
  select p.schemaname, p.tablename, p.policyname, p.cmd, p.roles::text as roller,
         p.permissive
    from pg_policies p
   where p.schemaname in ('public', 'storage')
)
select
  coalesce(b.schemaname, m.schemaname) as sema,
  coalesce(b.tablename,  m.tablename)  as tablo,
  coalesce(b.policyname, m.policyname) as politika,
  coalesce(b.cmd,        m.cmd)        as komut,
  m.roller,
  case
    when m.policyname is null then 'EKSİK POLİTİKA'
    when b.policyname is null then 'BEKLENMEYEN POLİTİKA'
    when b.cmd is distinct from m.cmd then 'KOMUT DEĞİŞMİŞ (beklenen: ' || b.cmd || ')'
    when m.permissive <> 'PERMISSIVE' then 'PERMISSIVE DEĞİL'
    when m.roller <> '{authenticated}' then 'ROL KÜMESİ BEKLENMEYEN (yalnızca authenticated olmalı)'
  end as bulgu
  from beklenen b
  full outer join mevcut m
    on  m.schemaname = b.schemaname
    and m.tablename  = b.tablename
    and m.policyname = b.policyname
 where b.policyname is null
    or m.policyname is null
    or b.cmd is distinct from m.cmd
    or m.permissive <> 'PERMISSIVE'
    or m.roller <> '{authenticated}'
 order by 1, 2, 3;


-- ############################################################################
-- B. POLİTİKA GÖVDESİ — MOD-BAĞIMSIZ ZORUNLU KOŞULLAR
-- ############################################################################
--
-- Buradaki koşullar 003'ten ÖNCE de SONRA da geçerli olmak ZORUNDADIR.
-- SL-01/03/09 sertleştirmeleri burada DEĞİL, blok F'de denetlenir.
--
-- Bağımsız incelemenin kırdığı boşluk: adı doğru, gövdesi "using (true)".
-- Alt dize araması kullanılıyor; pg_get_expr şema nitelemesini arama yoluna
-- göre farklı basabilir (is_admin() ya da public.is_admin()).
--
-- 0 satır beklenir — HER İKİ MODDA.

select tablo, politika, komut, bulgu, left(ifade, 120) as ifade_basi
from (
  select
    p.schemaname || '.' || p.tablename as tablo,
    p.policyname as politika,
    p.cmd as komut,
    coalesce(p.qual, '') || case when p.with_check is not null
                                 then ' | WITH CHECK: ' || p.with_check else '' end as ifade,
    case
      -- tamamen açık politika — her iki modda kabul edilemez
      when coalesce(p.qual, '')       ~ '^\s*\(?\s*true\s*\)?\s*$' then 'POLİTİKA TAMAMEN AÇIK (qual = true)'
      when coalesce(p.with_check, '') ~ '^\s*\(?\s*true\s*\)?\s*$' then 'POLİTİKA TAMAMEN AÇIK (with_check = true)'

      -- materials: moderasyon ve admin sınırı her zaman yerinde olmalı
      when p.tablename = 'materials' and p.cmd = 'SELECT'
        and coalesce(p.qual, '') not like '%is_admin%'
        then 'materials SELECT: admin dalı YOK'
      when p.tablename = 'materials' and p.cmd = 'SELECT'
        and coalesce(p.qual, '') not like '%uploader_id%'
        then 'materials SELECT: sahiplik dalı YOK'
      when p.tablename = 'materials' and p.cmd = 'INSERT'
        and coalesce(p.with_check, '') not like '%pending%'
        then 'materials INSERT: status=pending koşulu YOK (moderasyon atlanabilir)'
      when p.tablename = 'materials' and p.cmd = 'INSERT'
        and coalesce(p.with_check, '') not like '%uploader_id%'
        then 'materials INSERT: uploader_id sahiplik koşulu YOK'
      when p.tablename = 'materials' and p.cmd = 'INSERT'
        and coalesce(p.with_check, '') not like '%davet_dogrulandi_mi%'
        then 'materials INSERT: davet koşulu YOK (göç 001 geri alınmış)'
      when p.tablename = 'materials' and p.cmd in ('UPDATE', 'DELETE')
        and coalesce(p.qual, '') not like '%is_admin%'
        then 'materials ' || p.cmd || ': admin koşulu YOK'

      -- storage: klasör (sahiplik) kısıtı her zaman yerinde olmalı
      when p.tablename = 'objects' and p.cmd in ('SELECT', 'INSERT')
        and coalesce(p.qual, p.with_check, '') not like '%foldername%'
        then 'storage ' || p.cmd || ': klasör (sahiplik) koşulu YOK'
      when p.tablename = 'objects' and p.cmd in ('SELECT', 'INSERT')
        and coalesce(p.qual, p.with_check, '') not like '%materyaller%'
        then 'storage ' || p.cmd || ': kova kısıtı YOK'
      when p.tablename = 'objects' and p.policyname = 'materyal_silme'
        and coalesce(p.qual, '') not like '%is_admin%'
        then 'storage DELETE (admin): admin koşulu YOK'
      when p.tablename = 'objects' and p.policyname = 'materyal_yetim_silme'
        and coalesce(p.qual, '') not like '%dosya_materyale_bagli_mi%'
        then 'yetim silme: bağlılık koşulu YOK (yayınlanmış dosya silinebilir)'
      when p.tablename = 'objects' and p.policyname = 'materyal_yetim_silme'
        and coalesce(p.qual, '') not like '%foldername%'
        then 'yetim silme: klasör koşulu YOK (başkasının dosyası silinebilir)'

      -- diğer tablolar
      when p.tablename = 'denetim_kaydi'
        and coalesce(p.qual, '') not like '%is_admin%'
        then 'denetim okuma: admin koşulu YOK'
      when p.tablename = 'davet_dogrulamalari'
        and coalesce(p.qual, '') not like '%auth.uid%'
        then 'davet damgası okuma: sahiplik koşulu YOK'
      when p.tablename = 'profiles'
        and coalesce(p.qual, p.with_check, '') not like '%auth.uid%'
        then 'profiles: sahiplik koşulu YOK'
      else null
    end as bulgu
    from pg_policies p
   where (p.schemaname = 'public'
          and p.tablename in ('materials', 'profiles', 'denetim_kaydi', 'davet_dogrulamalari'))
      or (p.schemaname = 'storage' and p.tablename = 'objects')
) t
where bulgu is not null
order by tablo, komut, politika;


-- ############################################################################
-- C. RLS DURUMU — storage.buckets DAHİL
-- ############################################################################
--
-- Politika doğru olsa bile RLS kapalıysa hiçbiri uygulanmaz.
--
-- 0 satır beklenir.

select n.nspname as sema, c.relname as tablo,
       c.relrowsecurity as rls_acik, c.relforcerowsecurity as rls_zorunlu,
       'RLS KAPALI' as bulgu
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where c.relkind = 'r'
   and (
        (n.nspname = 'public' and c.relname in (
           'profiles', 'materials', 'davet_kodlari',
           'davet_dogrulamalari', 'davet_denemeleri', 'denetim_kaydi'))
     or (n.nspname = 'storage' and c.relname in ('objects', 'buckets'))
   )
   and c.relrowsecurity = false
 order by 1, 2;


-- ############################################################################
-- D. TABLO İZİNLERİ — public (KATI)
-- ############################################################################
--
-- Kapsam BİLİNÇLİ olarak public şeması ve bizim yönettiğimiz tablolardır.
-- storage şeması ayrı ele alınır (blok E): orada izinler Supabase tarafından
-- yönetilir, biz değiştirmeyiz ve erişim kontrolü tamamen RLS'tedir.
--
-- ÖNEMLİ — TRUNCATE neden burada:
-- PostgreSQL'de RLS politikaları SELECT/INSERT/UPDATE/DELETE/MERGE'e uygulanır;
-- TRUNCATE'e UYGULANMAZ. TRUNCATE ayrıcalığı olan bir rol, RLS ne derse desin
-- tabloyu boşaltabilir. Yerel testte doğrulandı: authenticated rolü
-- denetim_kaydi üzerinde DELETE denediğinde 42501 aldı ama TRUNCATE ile
-- tabloyu 2 satırdan 0 satıra indirdi. Bu yüzden TRUNCATE beklenen izin
-- listesinde YOKTUR ve raporlanır.
--
-- İKİ YÖNLÜ DENETİM — neden (canlı B bölümü koşumunun bulgusu):
-- Bu bloğun ilk sürümü yalnızca "sözleşmede olmayan ama canlıda olan"
-- grant'leri raporluyordu. Ters yön — sözleşmede olan ama canlıda OLMAYAN
-- grant — sessizce 0 satır döndürüyordu. INVITE-05 tam bu kör noktaya düştü:
-- üretimde authenticated'ın davet_dogrulamalari üzerindeki SELECT ayrıcalığı
-- yoktu, sözleşme onu "tasarlanmış" saydığı hâlde envanter yeşil yanıyordu.
-- Artık iki yön birlikte denetlenir:
--   * sözleşmede ZORUNLU, etkin olarak yok  → EKSİK BEKLENEN GRANT
--   * sözleşmede YOK, etkin olarak var      → BEKLENMEYEN ETKİN AYRICALIK
-- Otoritatif kaynak her iki yön için de has_table_privilege'dır; PUBLIC grant,
-- role membership ve kalıtım dahil ETKİN ayrıcalık denetlenir.
-- information_schema.role_table_grants yalnızca tanısal amaçla kullanılır.
--
-- Beklenen:
--   anon          → HİÇBİR tabloda hiçbir izin
--   authenticated → profiles: SELECT, INSERT, UPDATE
--                   materials: SELECT, INSERT, UPDATE, DELETE
--                   davet_dogrulamalari: HİÇBİRİ (RPC mimarisi — aşağıdaki not)
--                   denetim_kaydi: HİÇBİRİ (doğrudan istemci SELECT tasarlanmamıştır)
--                   davet_kodlari / davet_denemeleri: HİÇBİRİ
--
-- 0 satır beklenir.

with sozlesme(table_name, grantee, privilege_type, durum) as (
  values
    -- ----------------------------------------------------------------------
    -- ZORUNLU — uygulama bu izin olmadan çalışmaz. Eksikse bulgu verir.
    -- ----------------------------------------------------------------------
    ('profiles',            'authenticated', 'SELECT',     'ZORUNLU'),
    ('profiles',            'authenticated', 'INSERT',     'ZORUNLU'),
    ('profiles',            'authenticated', 'UPDATE',     'ZORUNLU'),
    ('materials',           'authenticated', 'SELECT',     'ZORUNLU'),
    ('materials',           'authenticated', 'INSERT',     'ZORUNLU'),
    ('materials',           'authenticated', 'UPDATE',     'ZORUNLU'),
    ('materials',           'authenticated', 'DELETE',     'ZORUNLU')
    -- ----------------------------------------------------------------------
    -- davet_dogrulamalari — İSTEMCİ SELECT'İ BİLİNÇLİ OLARAK LİSTEDE YOK.
    -- Damga durumunu istemci tablodan değil public.davet_dogrulandi_mi()
    -- (SECURITY DEFINER) RPC'sinden öğrenir; app.js başka bir yol kullanmıyor
    -- ve gerekçesi kodda yazılı. Dolayısıyla SELECT burada tasarlanmış izin
    -- DEĞİLDİR: listeye girmediği için canlıda BELİRİRSE "BEKLENMEYEN GRANT"
    -- olarak raporlanır. En az ayrıcalık yönünde bilinçli bir seçimdir.
    -- İlgili RLS politikası (davet_dogrulama_okuma) BİLEREK KORUNUR: grant
    -- ileride kazara geri verilirse satırları sahibi + admin ile sınırlayan
    -- ikinci savunma katmanıdır. Bu yüzden blok A'da beklenen politikalar
    -- arasında KALIR. Ayrıntı: blok K.
    -- ----------------------------------------------------------------------
    -- denetim_kaydi — K.2 kararı KAPANDI (SEÇENEK B): doğrudan istemci
    -- SELECT tasarlanmış değildir. denetim_okuma politikası savunma-in-depth
    -- olarak korunur; authenticated SELECT sözleşmede BEKLENMEZ. İleride grant
    -- ortaya çıkarsa bu blokta BEKLENMEYEN ETKİN AYRICALIK olarak raporlanır.
),
hedef_tablolar(table_name) as (
  values
    ('profiles'), ('materials'), ('davet_kodlari'),
    ('davet_dogrulamalari'), ('davet_denemeleri'), ('denetim_kaydi')
),
hedef_roller(grantee) as (
  values ('anon'), ('authenticated')
),
hedef_ayricaliklar(privilege_type) as (
  values
    ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
    ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
),
-- Otoritatif matris: rol x tablo x ayrıcalık için ETKİN durum.
etkin as (
  select t.table_name,
         r.grantee,
         a.privilege_type,
         has_table_privilege(r.grantee, format('public.%I', t.table_name), a.privilege_type) as etkin_mi
    from hedef_tablolar t
    cross join hedef_roller r
    cross join hedef_ayricaliklar a
   where to_regclass('public.' || t.table_name) is not null
),
-- Tanısal: ayrıcalık doğrudan role mi verilmiş, yoksa PUBLIC/kalıtım mı?
tani_dogrudan as (
  select g.table_name::text as table_name,
         g.grantee::text as grantee,
         g.privilege_type::text as privilege_type
    from information_schema.role_table_grants g
   where g.table_schema = 'public'
     and g.table_name in (select table_name from hedef_tablolar)
     and g.grantee in ('anon', 'authenticated')
),
-- YÖN 1 — sözleşmede YOK, etkin olarak VAR.
fazla as (
  select e.table_name as tablo,
         e.grantee as rol,
         e.privilege_type as ayricalik,
         case
           when e.privilege_type = 'TRUNCATE'
             then 'TRUNCATE — RLS''i AŞAR, tabloyu boşaltır'
           when e.privilege_type in ('REFERENCES', 'TRIGGER')
             then 'gereksiz ayrıcalık (' || e.privilege_type || ')'
           when exists (
                  select 1
                    from tani_dogrudan d
                   where d.table_name = e.table_name
                     and d.grantee = e.grantee
                     and d.privilege_type = e.privilege_type
                )
             then 'BEKLENMEYEN ETKİN AYRICALIK'
           else 'BEKLENMEYEN ETKİN AYRICALIK (doğrudan grant yok; PUBLIC/kalıtım olabilir)'
         end as bulgu
    from etkin e
    left join sozlesme b
      on b.table_name = e.table_name
     and b.grantee = e.grantee
     and b.privilege_type = e.privilege_type
   where e.etkin_mi
     and b.table_name is null
),
-- YÖN 2 — sözleşmede ZORUNLU, etkin olarak YOK.
eksik as (
  select b.table_name as tablo,
         b.grantee as rol,
         b.privilege_type as ayricalik,
         'EKSİK BEKLENEN GRANT — sözleşme ZORUNLU diyor, '
         || 'has_table_privilege false dönüyor' as bulgu
    from sozlesme b
    join etkin e
      on e.table_name = b.table_name
     and e.grantee = b.grantee
     and e.privilege_type = b.privilege_type
   where b.durum = 'ZORUNLU'
     and not e.etkin_mi
)
select 'public' as sema, tablo, rol, ayricalik, bulgu
  from (select * from fazla union all select * from eksik) d
 order by 2, 3, 4;


-- ############################################################################
-- E. TABLO İZİNLERİ — storage (Supabase yönetiminde, DAR denetim)
-- ############################################################################
--
-- Supabase, storage şemasındaki tablolara anon ve authenticated rollerine
-- geniş izinler verir ve erişim kontrolünü TAMAMEN RLS'e bırakır. Bu izinleri
-- "beklenmeyen" saymak üretimde garanti yanlış alarm üretir (canlı koşumda
-- 34 satır böyle geldi) ve operatöre "kırmızıyı yok say" öğretir.
--
-- Bu yüzden burada yalnızca Supabase'in KENDİ tablo kümesi dışına çıkan
-- izinler raporlanır. Bizim kovamızın güvenliği bu blokta değil, blok A/B
-- (politikalar) ve blok C (RLS) ile sağlanır — ve testle kanıtlandı: anon'a
-- tam izin verildiği hâlde politika olmadığı için 0 satır okudu.
--
-- 0 satır beklenir.

select g.table_schema, g.table_name, g.grantee, g.privilege_type,
       'storage şemasında TANINMAYAN tablo üzerinde izin' as bulgu
  from information_schema.role_table_grants g
 where g.table_schema = 'storage'
   and g.grantee in ('anon', 'authenticated')
   and g.table_name not in (
       -- Supabase Storage'ın kendi tabloları (sürümle birlikte artabilir)
       'objects', 'buckets', 'migrations', 'buckets_analytics', 'buckets_vectors',
       'vector_indexes', 's3_multipart_uploads', 's3_multipart_uploads_parts',
       'prefixes', 'iceberg_namespaces', 'iceberg_tables'
   )
 order by 2, 3, 4;


-- ############################################################################
-- F. SERTLEŞTİRME DURUMU — MODA BAĞLI (003'ün beş koşulu)
-- ############################################################################
--
-- Simetrik kapı:
--   PRE  → beş koşulun HİÇBİRİ uygulanmamış olmalı. Uygulanmış olan varsa
--          003 kısmen çalışmış demektir; bu beklenmeyen bir durumdur ve
--          göçü tekrar çalıştırmak öncesinde açıklanmalıdır.
--   POST → beş koşulun HEPSİ uygulanmış olmalı. Eksik kalan varsa göç
--          tutmamıştır.
--
-- 0 satır beklenir — HER İKİ MODDA (anlamı moda göre değişir).

with kosul(id, aciklama, uygulandi) as (
  values
    ('SL-01a', 'materials SELECT davet koşulu',
      exists (select 1 from pg_policies where schemaname='public' and tablename='materials'
                and cmd='SELECT' and coalesce(qual,'') like '%davet_dogrulandi_mi%')),
    ('SL-01b', 'storage SELECT davet koşulu',
      exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
                and cmd='SELECT' and coalesce(qual,'') like '%davet_dogrulandi_mi%')),
    ('SL-03',  'storage INSERT davet koşulu',
      exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
                and cmd='INSERT' and coalesce(with_check,'') like '%davet_dogrulandi_mi%')),
    ('SL-09',  'materials INSERT dosya sahipliği koşulu',
      exists (select 1 from pg_policies where schemaname='public' and tablename='materials'
                and cmd='INSERT' and coalesce(with_check,'') like '%foldername%')),
    ('SL-04',  'yetim silme politikası + yardımcı fonksiyon',
      exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
                and policyname='materyal_yetim_silme')
      and to_regprocedure('public.dosya_materyale_bagli_mi(text)') is not null)
)
select k.id, k.aciklama, k.uygulandi as su_an_uygulanmis,
       case upper(:'mod')
         when 'PRE'  then 'PRE modunda uygulanmamış olmalıydı — 003 KISMEN UYGULANMIŞ'
         when 'POST' then 'POST modunda uygulanmış olmalıydı — 003 TUTMAMIŞ'
         else 'GEÇERSİZ MOD'
       end as bulgu
  from kosul k
 where (upper(:'mod') = 'PRE'  and k.uygulandi)
    or (upper(:'mod') = 'POST' and not k.uygulandi)
    or upper(:'mod') not in ('PRE', 'POST')
 order by 1;


-- ############################################################################
-- G. YETKİLENDİRME FONKSİYONLARI — EXECUTE / search_path / VARLIK
-- ############################################################################
--
-- SECURITY DEFINER yardımcılarında kime EXECUTE verildiği ve search_path'in
-- sabit olması politikalar kadar önemlidir. Eksik fonksiyon da yakalanır:
-- ilk sürüm INNER JOIN kullandığı için var olmayan fonksiyon sessizce
-- denetlenmeden geçiyordu.
--
-- dosya_materyale_bagli_mi yalnızca POST modunda beklenir.
--
-- TRIGGER FONKSİYONLARI KAPSAM DIŞI: profiles_rol_koru, profiles_no_koru,
-- profiles_rol_varsayilan ve materials_inceleme_damgala üzerinde PUBLIC
-- EXECUTE bulunur. Sömürülebilir değildir — plpgsql trigger fonksiyonu
-- doğrudan çağrıldığında 0A000 ile reddedilir (testle doğrulandı). Yanlış
-- alarmla kapıyı kirletmemek için denetlenmiyor; blok H'de görünürler.
--
-- 0 satır beklenir.

with hedef(ad, imza, tip, mod) as (
  values
    ('is_admin',                 'public.is_admin()',                      'politika', 'HER'),
    ('davet_dogrulandi_mi',      'public.davet_dogrulandi_mi()',           'politika', 'HER'),
    ('davet_kullan',             'public.davet_kullan(text)',              'rpc',      'HER'),
    ('denetim_yaz',              'public.denetim_yaz(text,text,text,jsonb)','ic',      'HER'),
    ('denetim_temizle',          'public.denetim_temizle(integer)',        'ic',       'HER'),
    ('dosya_materyale_bagli_mi', 'public.dosya_materyale_bagli_mi(text)',  'politika', 'POST')
),
h as (
  select * from hedef where mod = 'HER' or mod = upper(:'mod')
),
fn as (
  select p.oid, p.proname, p.prosecdef, p.proconfig,
         p.proname || '_' || p.oid::text as specific_name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
),
izin as (
  select r.specific_name::text as specific_name, r.grantee::text as grantee
    from information_schema.role_routine_grants r
   where r.specific_schema = 'public'
     and r.privilege_type = 'EXECUTE'
)
select h.ad as fonksiyon, h.tip,
  case
    when to_regprocedure(h.imza) is null
      then 'FONKSİYON YOK (' || h.imza || ')'
    when f.proconfig is null
      then 'search_path AYARLANMAMIŞ (arama yolu enjeksiyonuna açık)'
    when not f.prosecdef
      then 'SECURITY DEFINER DEĞİL'
    when exists (select 1 from izin i where i.specific_name = f.specific_name
                   and i.grantee in ('anon', 'PUBLIC'))
      then 'anon ya da PUBLIC EXECUTE var'
    when h.tip = 'ic' and exists (select 1 from izin i where i.specific_name = f.specific_name
                                    and i.grantee = 'authenticated')
      then 'istemciye kapalı olmalıydı ama authenticated EXECUTE var'
    when h.tip in ('politika', 'rpc')
         and not exists (select 1 from izin i where i.specific_name = f.specific_name
                           and i.grantee = 'authenticated')
      then 'authenticated EXECUTE YOK — ilgili politika/RPC çalışmaz'
  end as bulgu
  from h
  left join fn f on f.proname = h.ad
 where to_regprocedure(h.imza) is null
    or f.proconfig is null
    or not f.prosecdef
    or exists (select 1 from izin i where i.specific_name = f.specific_name
                 and i.grantee in ('anon', 'PUBLIC'))
    or (h.tip = 'ic' and exists (select 1 from izin i where i.specific_name = f.specific_name
                                   and i.grantee = 'authenticated'))
    or (h.tip in ('politika', 'rpc')
        and not exists (select 1 from izin i where i.specific_name = f.specific_name
                          and i.grantee = 'authenticated'))
 order by 1;


-- ----------------------------------------------------------------------------
-- G2. public şemasında TANINMAYAN SECURITY DEFINER fonksiyon
-- ----------------------------------------------------------------------------
--
-- Yukarıdaki denetim sabit bir isim listesi üzerinden çalışır; listede
-- OLMAYAN bir fonksiyonu hiç görmez. Canlı PRE koşumunda tam olarak bu oldu:
-- üretimde `rls_auto_enable` adlı, depoda HİÇ TANIMLI OLMAYAN bir SECURITY
-- DEFINER fonksiyon bulundu (PUBLIC:EXECUTE, search_path=pg_catalog) ve
-- envanter onu sessizce geçti.
--
-- SECURITY DEFINER + PUBLIC EXECUTE + sürüm kontrolünde olmayan gövde,
-- denetlenmesi gereken bir birleşimdir: fonksiyon sahibinin yetkisiyle
-- çalışır ve her rol çağırabilir.
--
-- Beklenen liste = schema.sql + 001 + 002 + 003'ün tanımladığı fonksiyonlar.
-- Listede olmayan her SECURITY DEFINER fonksiyon raporlanır; gövdesini
-- görmek için:
--
--   select pg_get_functiondef(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = '<ad>';
--
-- 0 satır beklenir.

-- ----------------------------------------------------------------------------
-- rls_auto_enable İÇİN DAR SÖZLEŞME İSTİSNASI — İSİM BAZLI ALLOWLIST DEĞİL
-- ----------------------------------------------------------------------------
--
-- `public.rls_auto_enable` üretimde vardır, depoda tanımlı DEĞİLDİR ve
-- bağımsız incelemede **mevcut hâliyle** PASS almıştır. Kanıt özeti:
--   * RETURNS event_trigger  → doğrudan çağrılamaz. anon, authenticated ve
--     hatta superuser denemesi 0A000 "trigger functions can only be called
--     as triggers" ile reddedildi. PUBLIC:EXECUTE bu yüzden işlevsel olarak
--     ölü bir izindir.
--   * Gövdedeki tek dinamik ifade `enable row level security`; DISABLE,
--     FORCE/NO FORCE, DROP/ALTER POLICY, GRANT/REVOKE sayısı SIFIR. Yani
--     RLS'i yalnızca SIKILAŞTIRABİLİR, gevşetemez.
--   * format('%s', cmd.object_identity) enjekte edilemez: düşmanca tablo adı
--     testinde public.materials RLS'i `true` kaldı.
--   * anon/authenticated'ın schema public üzerinde CREATE yetkisi yok
--     (42501), yani tetikleme yoluna hiç giremezler.
--
-- İstisna BU YÜZDEN isme değil, AŞAĞIDAKİ ON BİR ÖZELLİĞİN TAMAMINA bağlıdır.
-- Özelliklerden biri bile değişirse fonksiyon yeniden RAPORLANIR ve hangi
-- özelliğin bozulduğu bulgu metninde yazar. Yani "güvenli tanım" sabitlenmiş
-- bir sözleşmedir; fonksiyon sessizce değiştirilip kapıdan geçemez.
--
-- 0 satır beklenir.

with repo_fonksiyonlari(ad) as (
  values
    -- schema.sql
    ('is_admin'), ('profiles_rol_koru'), ('profiles_rol_varsayilan'),
    ('materials_inceleme_damgala'),
    -- göç 001
    ('davet_aktif_kod_siniri'), ('davet_dogrulandi_mi'), ('davet_kullan'),
    ('profiles_no_koru'),
    -- göç 002
    ('denetim_yaz'), ('denetim_temizle'), ('materials_denetim_guncelle'),
    ('materials_denetim_sil'), ('profiles_denetim'), ('davet_dogrulama_denetim'),
    -- göç 003
    ('dosya_materyale_bagli_mi')
),
sd as (
  -- Genel tarama: public şemasındaki TÜM SECURITY DEFINER fonksiyonlar.
  -- AYRICA rls_auto_enable, prosecdef'ten BAĞIMSIZ olarak her zaman dahil
  -- edilir: sözleşmesinde "SECURITY DEFINER olmalı" maddesi var ve fonksiyon
  -- SECURITY INVOKER'a çevrilirse yalnızca prosecdef filtresine güvenmek onu
  -- taramanın tamamen dışına çıkarırdı (sessiz kaçış).
  select p.oid, p.proname, p.prosecdef, p.pronargs, p.proconfig, p.proowner,
         pg_get_function_result(p.oid) as doner,
         pg_get_functiondef(p.oid)     as tanim
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.prosecdef or p.proname = 'rls_auto_enable')
),
-- rls_auto_enable sözleşmesi: her madde ayrı ayrı doğrulanır
sozlesme as (
  select s.oid,
         case when s.pronargs <> 0                        then 'arguman sayisi 0 degil; ' else '' end ||
         case when s.doner <> 'event_trigger'             then 'RETURNS event_trigger degil ('||s.doner||'); ' else '' end ||
         case when not s.prosecdef                        then 'SECURITY DEFINER degil; ' else '' end ||
         case when coalesce(array_to_string(s.proconfig, ','), '') !~ '^search_path="?pg_catalog"?$'
                                                          then 'search_path pg_catalog degil ('||coalesce(array_to_string(s.proconfig,','),'AYARSIZ')||'); ' else '' end ||
         case when pg_get_userbyid(s.proowner) <> 'postgres'
                                                          then 'sahip postgres degil ('||pg_get_userbyid(s.proowner)||'); ' else '' end ||
         case when not exists (
                select 1 from pg_event_trigger e
                 where e.evtfoid = s.oid
                   and e.evtname  = 'ensure_rls'
                   and e.evtevent = 'ddl_command_end'
                   and e.evttags @> array['CREATE TABLE','CREATE TABLE AS','SELECT INTO']
                   and e.evttags <@ array['CREATE TABLE','CREATE TABLE AS','SELECT INTO'])
                                                          then 'ensure_rls/ddl_command_end/uc-etiket baglantisi bozuk; ' else '' end ||
         case when s.tanim ~* 'disable\s+row\s+level\s+security'
                                                          then 'GOVDEDE disable row level security VAR; ' else '' end ||
         case when s.tanim ~* '\mforce\s+row\s+level\s+security'
                                                          then 'GOVDEDE force/no force row level security VAR; ' else '' end ||
         case when s.tanim ~* '(drop|alter)\s+policy'      then 'GOVDEDE drop/alter policy VAR; ' else '' end ||
         case when s.tanim ~* '\m(grant|revoke)\M'         then 'GOVDEDE grant/revoke VAR; ' else '' end
         as ihlal
    from sd s
   where s.proname = 'rls_auto_enable'
)
select s.proname as fonksiyon,
       coalesce(array_to_string(s.proconfig, ', '), '(search_path AYARSIZ)') as ayar,
       coalesce(
         (select string_agg(a.grantee || ':' || a.privilege_type, ', ' order by a.grantee)
            from information_schema.role_routine_grants a
           where a.specific_name = s.proname || '_' || s.oid::text),
         '(EXECUTE izni yok)') as izinler,
       case
         when s.proname = 'rls_auto_enable'
           then 'rls_auto_enable SOZLESMESI BOZULDU -> ' || coalesce(c.ihlal, '?')
         else 'DEPODA TANIMLI OLMAYAN SECURITY DEFINER fonksiyon'
       end as bulgu
  from sd s
  left join sozlesme c on c.oid = s.oid
 where s.proname not in (select ad from repo_fonksiyonlari)
   and (
     -- rls_auto_enable: yalnızca sözleşmenin TAMAMI sağlanıyorsa muaf
     s.proname <> 'rls_auto_enable'
     or coalesce(c.ihlal, 'sozlesme hesaplanamadi') <> ''
   )
 order by 1;


-- ############################################################################
-- H. HAM DÖKÜM — bilgi amaçlı (geçme ölçütü DEĞİL)
-- ############################################################################
--
-- qual / with_check sütunları politikaların gerçek gövdesini gösterir ve depo
-- dosyalarıyla GÖZLE karşılaştırılmalıdır. Blok B "gerekli koşul" denetimi
-- yapar, tam gövde eşitliği değil — fazladan gevşetme ancak burada görülür.

select schemaname, tablename, policyname, cmd, roles, qual, with_check
  from pg_policies
 where schemaname in ('public', 'storage')
 order by schemaname, tablename, policyname;

select n.nspname as schema_name, c.relname,
       c.relrowsecurity, c.relforcerowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'storage') and c.relkind = 'r'
 order by 1, 2;

select table_schema, table_name, grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema in ('public', 'storage')
   and grantee in ('anon', 'authenticated')
 order by 1, 2, 3, 4;

select p.proname as fonksiyon,
       p.prosecdef as security_definer,
       coalesce(array_to_string(p.proconfig, ', '), '(search_path AYARSIZ)') as ayar,
       coalesce(
         (select string_agg(a.grantee || ':' || a.privilege_type, ', ' order by a.grantee)
            from information_schema.role_routine_grants a
           where a.specific_name = p.proname || '_' || p.oid::text),
         '(EXECUTE izni yok)'
       ) as izinler
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
 order by p.proname;


-- ############################################################################
-- I. KOVA YAPILANDIRMASI (bilgi amaçlı)
-- ############################################################################
--
-- Beklenen: public = false, file_size_limit = 26214400, 5 MIME türü.
-- public = true görürseniz kova herkese açıktır ve RLS'in bir önemi kalmaz.

select id, name, public, file_size_limit, allowed_mime_types
  from storage.buckets
 where id = 'materyaller';


-- ############################################################################
-- J. YETİM DOSYA SAYIMI (yalnızca sayar, silmez — bilgi amaçlı)
-- ############################################################################
--
-- SL-04'ün üretimde ne kadar biriktirdiğini gösterir. Dosya adı ya da sahibi
-- dökülmez; yalnızca toplam.

select count(*) as yetim_dosya_sayisi,
       coalesce(sum((o.metadata->>'size')::bigint), 0) as toplam_bayt
  from storage.objects o
 where o.bucket_id = 'materyaller'
   and not exists (
         select 1 from public.materials m where m.file_path = o.name
       );


-- ############################################################################
-- K. KALINTI AYRICALIK KONTROLÜ — 004 SONRASI 0 SATIR BEKLENİR
-- ############################################################################
--
-- Bu blok kapıyı bloklamaz ama HER KOŞUMDA okunmalıdır.
--
-- SORUN: PostgreSQL'de RLS politikaları SELECT/INSERT/UPDATE/DELETE/MERGE'e
-- uygulanır, TRUNCATE'e UYGULANMAZ. TRUNCATE ayrıcalığı olan bir rol, RLS ne
-- derse desin tabloyu tamamen boşaltabilir.
--
-- Yerel PostgreSQL 16 testinde doğrulandı:
--   authenticated → delete from public.denetim_kaydi   → ERR 42501 (engellendi)
--   authenticated → truncate public.denetim_kaydi      → BAŞARILI, 2 satır → 0
--
-- Bu, göç 002'nin belgelediği "iz değiştirilemez / admin bile silemez"
-- güvencesiyle çelişir. Aynı durum davet_dogrulamalari için de geçerli:
-- boşaltılırsa tüm kullanıcılar davet damgasını kaybeder (003 sonrası bu,
-- arşivi ve gönderimi herkese kapatan bir hizmet kesintisi demektir).
--
-- NEDEN ACİL DEĞİL: anon ve authenticated Supabase'te NOLOGIN rollerdir,
-- doğrudan bağlanılamaz; PostgREST hiçbir zaman TRUNCATE üretmez ve hiçbir
-- RPC truncate çağırmaz. Yani genel API yüzeyinden ulaşılamaz. Gizli bir
-- derinlik boşluğudur: ileride dinamik SQL kullanan bir SECURITY INVOKER
-- fonksiyon ya da yeni bir RPC eklenirse doğrudan sömürülebilir hâle gelir.
--
-- DÜZELTME (forward-only göç 004; bu dosya salt okumadır, burada çalışmaz):
--
--   revoke truncate, references, trigger
--     on table public.denetim_kaydi, public.davet_dogrulamalari
--     from anon, authenticated;
--
-- Satır dönerse boşluk hâlâ açıktır.
--
-- ############################################################################
-- K.2 — KARAR KAPANDI (SEÇENEK B)
-- ############################################################################
--
-- Karar: public.denetim_kaydi için authenticated role doğrudan SELECT grant
-- BEKLENMEZ. Uygulama doğrudan bu tabloyu okumaz; denetim_okuma RLS politikası
-- savunma-in-depth olarak korunur.
--
-- Sözleşme etkisi:
--   * denetim_kaydi / authenticated / SELECT sözleşmede YOKTUR.
--   * Grant ileride verilirse blok D bunu BEKLENMEYEN ETKİN AYRICALIK olarak
--     raporlar.
--
-- Not: davet_dogrulamalari / authenticated / SELECT zaten bilinçli olarak
-- sözleşme dışındadır (RPC yolu). INVITE-05 / INVITE-05b ile doğrulanır.

select g.table_name, g.grantee, g.privilege_type,
       'RLS''i aşar — yukarıdaki revoke ile kapatılmalı' as not
  from information_schema.role_table_grants g
 where g.table_schema = 'public'
   and g.grantee in ('anon', 'authenticated')
   and g.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
   and g.table_name in ('profiles', 'materials', 'davet_kodlari',
                        'davet_dogrulamalari', 'davet_denemeleri', 'denetim_kaydi')
 order by 1, 2, 3;


-- ============================================================================
-- Bu dosya hiçbir sır içermez, hiçbir kullanıcı verisi dökmez ve hiçbir şey
-- değiştirmez. Yalnızca SELECT ve WITH kullanır.
-- ============================================================================
