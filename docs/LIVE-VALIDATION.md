# 006 doğrulama: yerel runtime ve production smoke

Release sırası [DEPLOYMENT-SECURITY.md](DEPLOYMENT-SECURITY.md) bölüm 11'dir:
snapshot → PRE-006 inventory → legacy kararları → blocker varsa DUR → 006 →
explicit POST-006 legacy backfill → POST inventory → SQL runtime/contract →
registration smoke → teacher pending smoke → admin approval smoke → frontend
deploy → smoke.sh → 4 student + 1 teacher production invite → final UI.
**Frontend DB 006'dan önce deploy edilmez.**

Bu belge bir operatör prosedürüdür; bu remediation çalışması production'a
bağlanmaz ve gerçek kullanıcı/davet oluşturmaz. Production smoke verileri
ayrıca yetkilendirilmiş operatör tarafından güvenli ortamda yönetilir.

## Tekrarlanabilir yerel SQL/RLS kanıtı

```powershell
pwsh -NoProfile -File scripts/runtime_006_security_test.ps1
```

Gerekenler: Node, Docker Engine ve yerelde `postgres:16` imajı. Harness imaj
indirmez, `--network none` kullanır, port açmaz. `schema.sql` → 001 → 002 →
003 → 004 → 005 → 006 sırasını uygular. Her hata non-zero exit; konteyner
başarıda ve hatada finally ile silinir. Test kimlikleri ve kodları sabit,
**synthetic ve yalnız disposable test DB'si içindir**.

`runtime_006_bootstrap.sql` stubları: anon/authenticated NOLOGIN roller,
`auth.users`, JWT GUC üzerinden `auth.uid()`/`auth.jwt()`, `storage.objects`,
`storage.buckets` ve `storage.foldername()`. Hosted kurulumdaki app/storage
grant'leri açıkça eklenir. Assertions SECURITY INVOKER çalışır; client
testleri `SET ROLE anon/authenticated` ile gerçek RLS/ACL üzerinden geçer.
Owner yalnız setup ve açıkça belirtilen corruption fixture testlerinde
kullanılır. Stub gerçek Supabase Auth signup/JWT doğrulamasını, HTTP rate
limit veya Storage HTTP/signing davranışını kanıtlamaz.

PRE sorgusu 006 kolonları henüz yokken hem teacher=0 hem legacy teacher=1,
admin=1, anonymous user=1, canonical sos401=2 fixture durumunda çalışır.
POST inventory A–G/G2/K/L bulguları sıfır olmalıdır; PRE modu reddedilir.
Node `includes()` regressionları statik kanıttır; runtime sonucu diye sunulmaz.

| Test | Gerçek SQL/RLS beklenen davranış |
|---|---|
| T01 | anon direct profile INSERT denied |
| T02 | authenticated orphan profile INSERT denied |
| T03 | orphan SELECT onaylı, dolu arşivde sıfır satır |
| T04 | orphan materials INSERT denied |
| T05 | orphan storage upload denied |
| T06 | invalid invite profile/membership/stamp vermez |
| T07 | student invite → user/class_year |
| T08 | teacher invite → user/pending |
| T09 | pending is_teacher FALSE |
| T10 | non-admin approve denied |
| T11 | username squat denied |
| T12 | canonical collision denied; üyelik vermez |
| T13 | reserved username denied |
| T14 | sos401 case/space INSERT/UPDATE denied; trigger kapalıyken CHECK de reddeder |
| T15 | admin sos401 materyal oluşturur ve approve eder |
| T16 | legacy atama cleanup; zorla eklenen hatalı satırda helper FALSE/direct publish denied |
| T17 | aynı son slotta iki eşzamanlı session; tam bir başarı, bir profil/damga, sayaç=1 |
| T18 | tamamlanmış kayıt retry consume etmez; mevcut damga yanlış/different code ile tamamlanmaz |
| T19 | student archive/own storage/upload erişimi; materyal pending |
| T20 | approved teacher assigned course direct publish |
| T21 | unassigned course ve sos401 teacher publish denied |
| T22 | davet_kullan student/teacher kodlarını consume edemez; sayaç/damga değişmez |
| T23 | fresh session NULL context internal helper owner çağrısı reddi; client ACL reddi |
| T24 | pending materials ve storage INSERT denied; okuma korunur |
| T25 | rejected materials ve storage INSERT denied; okuma korunur |

T17 harness iki oturumu aynı davet satırı kilidinde beklettiğini
`pg_stat_activity` ile doğrular; kilidi bırakınca sadece biri başarılı olur.
T18 tamamlanmış kayıt retry'sinin mevcut sözleşme gereği reddedildiğini ve
ikinci tüketim yapmadığını doğrular. Ek olarak registration için mevcut
student/teacher damgası yalnız aynı bcrypt koduyla yeniden kullanılabilir.

## PRE ve POST operatör gate

```text
psql <baglanti> -v ON_ERROR_STOP=1 -f supabase/pre_006_inventory.sql
-- yalnız 005 ve öncesi; hiçbir 006 kolonuna başvurmaz
psql <baglanti> -v ON_ERROR_STOP=1 -v mod=POST -f supabase/inventory.sql
-- yalnız 006 SONRASI; A–G/G2/K/L sıfır satır
```

Admin satırı otomatik FAIL değildir. Teacher count=0: Auth migration N/A.
Teacher count>0: açık migration planı production apply öncesi blocker;
plan uygulanıp doğrulanmadan frontend deploy edilmez. Legacy user için
preserve/re-onboard/test hesabı silme planı kararı kaydedilir.
Detaylar [TEACHER-SETUP.md](TEACHER-SETUP.md). sos401=0 olsa da cleanup uygulanır.

POST inventory self INSERT policy **beklemez**; profiles INSERT privilege
yokluğu, gerekli SELECT/UPDATE, membership policies, fonksiyon/ACL ve teacher
korumalarını denetler. Ham gövdeler ayrıca incelenir. Inventory sorgusu
bulguları raporlar; operatör sıfır satır gate'ini açıkça uygular.

## Registration / pending / admin approval smoke

DB 006 hazırken frontend adayını önce yerel/staging ortamda sınayın;
production frontend deploy bölüm 11 adım 12'de yapılır.
Gerçek parola/kod/UID'yi repoya veya paylaşılmış loglara yazmayın.

- Student: yeni username/password ve student sınıf koduyla kayıt; profile
  user/class_year, yeniden login başarılı. Yanlış kodda üyelik yok, gerçek
  public API ile orphan materyal/storage yükleme reddedilir. Öğrenci materyali
  pending kalır; başka kullanıcının pending materyaline erişilemez.
- Teacher: teacher kodu + ad soyad → user/pending. Login ve yenileme başvuru
  durumunu gösterir. Normal öğrenci upload/publish yok; public API materials
  ve storage INSERT reddedilir. Mevcut okuma erişimini kontrol edin.
- Admin: pending başvuruyu approve → teacher/approved. Atama yap → yalnız
  atanmış derste approved yayın. Atanmamış ders ve canonical sos401 reddi.
  Admin kendi sos401 materyalini yönetebilir. Teacher admin moderation
  kullanamaz. Ayrı pending başvuruyu reject → rejected, upload hâlâ kapalı.
- Login negatif: yanlış username ve yanlış parola aynı
  `Kullanıcı adı veya parola hatalı.` mesajını verir. Login resolver anonim
  çağrıda kişisel email döndürmez; yalnız internal domain döner.
- Dosyalar: yetkili öğrenci approved materyali açabilir; başka UID klasörüne
  upload reddedilir; pending dosya yalnız sahibi/admin tarafından okunur.
  Gerçek Storage signed URL davranışı ayrıca doğrulanır.

## Yayın sonrası final UI

`scripts/smoke.sh` sonrasında production kodlarını yalnız
`admin_davet_kodu_olustur` ile oluşturun: student class_year=1,2,3,4 için
dört ayrı kod ve class_year=NULL teacher için bir kod. Kodlar CSPRNG 32 hex /
128-bit kapasitelidir; doğrudan hash INSERT kullanmayın. Hash üzerinden CHECK
entropiyi kanıtlayamaz.

Temiz tarayıcıda admin/student/teacher login, başvuru bekleme/ret ekranı,
ders atamaları, materyal/dosya erişimi, F5, yeni sekme, çıkış ve ikinci sekmede
oturum kapanışını doğrulayın. Sahte localStorage admin rolü admin erişimi
vermemelidir. Console/CSP hataları olmamalı; frontendte server secret olmamalı.

## Residual risk

Username enumeration **P2 / production blocker değil**: bilinen username'in
internal email'i ile deterministik fallback karşılaştırılabilir. UI hata
eşitliği bunu kapatmaz. Kişisel email anon'a dönmez; server secret/HMAC
tarayıcıya veya SQL'e gömülmez. Privileged DB owner helper dışında hash
ekleyebilir; entropy/format hash üzerinden CHECK ile ispatlanamaz. Yerel
SQL harness production Auth/Storage/platform smoke'un yerine geçmez.
