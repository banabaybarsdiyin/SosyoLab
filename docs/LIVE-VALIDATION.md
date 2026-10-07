# 006 doğrulama: yerel runtime ve production smoke

Release sırası [DEPLOYMENT-SECURITY.md](DEPLOYMENT-SECURITY.md) bölüm 11'dir:
snapshot → PRE-006 inventory → legacy kararları → blocker varsa DUR → 006 →
Edge Functions (config.toml) + Auth ayarları → explicit POST-006 legacy
backfill → POST inventory → SQL runtime/contract → **canlı G1–G10 PASS** →
registration smoke → teacher pending smoke → admin approval smoke → frontend
deploy → smoke.sh → 4 student + 1 teacher production invite → final UI.
**Frontend DB 006'dan önce deploy edilmez.**

**Mevcut SosyoLab production'ı** eski bir 006 sürümündedir; onun sırası
DEPLOYMENT-SECURITY **bölüm 12**'dir: bakım penceresi → snapshot →
`pre_007_fingerprint.sql` (`eski_006`) → 007 → POST inventory → hesap başına
legacy backfill → orphan incelemesi → Edge Functions → Auth ayarları →
**G1–G10** → frontend → migration geçmişi uzlaştırması. Production'da 006
çalıştırılmaz.

Bu belge bir operatör prosedürüdür; bu remediation çalışması production'a
bağlanmaz ve gerçek kullanıcı/davet oluşturmaz. Production smoke verileri
ayrıca yetkilendirilmiş operatör tarafından güvenli ortamda yönetilir.

## Tekrarlanabilir yerel SQL/RLS kanıtı

```powershell
pwsh -NoProfile -File scripts/runtime_006_security_test.ps1
node scripts/runtime_007_drift_test.js          # eski 006 production drift -> 007
node scripts/regression_007_reconciliation_test.js
```

Ana harness temiz kurulum yolunu 001→007 olarak uygular (006'dan sonra 007
`final_006` durumunda idempotent no-op). `runtime_007_drift_test.js` gözlenen
eski production durumunu kurar ve 007'yi onun üzerinde dener:

- **Kurulum:** HEAD schema + 001–005, git `c1f3068` / `a0e4931` 006'sı ve
  production şekilli sentetik veri (16 Auth, 15 username'siz profil,
  1 orphan, admin=1/user=14, 1 pasif legacy davet).
- **Sonuçta beklenen katalog:** temiz 001→006 kurulumuyla birebir aynı
  (fonksiyon+ACL, kolon, kolon ACL, constraint, index, policy, trigger).
  Tüm satırlar korunur.
- **Tekrar ve temiz kurulum:** 007 iki kez çalışınca ve temiz 006 üzerinde
  çalışınca hiçbir şey değişmez.
- **Drift:** 7 beklenmeyen drift durumu RAISE ile tam geri alınır.
- **Mutantlar:** 3 son koşul mutantı yakalanır.
- **Backfill:** backfill şablonu (1 başarı, 8 güvensiz girdi reddi) ve
  PII'siz envanterler doğrulanır.

Harness hem `production` modunda (fonksiyonlarda default grant yok, gözlenen)
hem `hosted-defaults` modunda, yerelde mevcut `postgres:16` ve `postgres:17`
imajlarıyla koşar. Bu yerel/model kanıtıdır; production PRE-007 parmak izi
yine operatörce alınır.

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
| T26 | login çözümlemesi (service_role): student, pending/approved/rejected teacher ve canonical backfill legacy hesap gerçek kimliğe çözülür (false-positive yok); canonical olmayan backfill CHECK ile reddedilir |
| T27 | anon / üye / orphan çağıran: mevcut, olmayan, eksik profil, rezerve, boş/NULL, 200 rastgele geçerli ve 64 rastgele 32+ karakter username için tek tip 42501 (resolver yalnız service_role); service_role çağıranında hata/NULL yok, tek canonical biçim |
| T28 | büyük/küçük harf ve baş/son/iç boşluk varyantları, tekrarlanan çağrılar mevcut ve olmayan için aynı biçimde kararlı; sahte adresler benzersiz ve hiçbir gerçek hesabı adlandırmaz |
| T29 | eski md5 v2 ve anahtarsız hash formülleri (ham ve canonical şekilli) hiçbir yanıtı üretemez; yanıt yalnız private pepper'lı HMAC ile üretilebilir; pepper anon/authenticated'a kapalı (42501) |
| T30 | mevcut/olmayan username arasında yapısal süre farkı yok (oran 0.67–1.5 bandında; değer `INFO` satırında) |
| T31 | canonical olmayan / anonim / var olmayan Auth kimliğiyle server kaydı reddedilir, davet tüketilmez |
| T32 | 65 Edge Function yanıtının hiçbiri iç kimlik içermez; resolver/ön kontrol anon/authenticated için 42501; **yetki katmanında** authenticated (admin dahil) ve anon `profiles.auth_login_email` / `select *` için 42501, kendi satırının diğer kolonları okunur; tarayıcı profil select'leri iç kimlik istemez; tarayıcı kodunda signUp/signInWithPassword/OTP/resolver/iç alan adı yok |
| T33 | public signup kapalı (**yalnız model**; ürün kodunu değil Auth modelini sınar, hosted kanıt G2): var olan, olmayan ve offline-hesaplanmış kimlikler için aynı `signup_disabled`; hiç Auth hesabı oluşmaz |
| T34 | signup yanlışlıkla açık olsa bile (model): 58 offline/tahmin kimlikten hiçbiri mevcut hesaba denk gelmez (0 sinyal) |
| T35 | doğru parola: student, case/boşluk varyantı, pending, approved, backfill legacy, admin takma adı → yalnız oturum token'ları, email yok |
| T36 | var olan+yanlış parola ve olmayan/rastgele/varyant kullanıcı adı → bayt bayt aynı 401 (status, başlık, gövde); taban süre sonrası medyan farkı ≈ birkaç ms (tabansız model farkı INFO satırında) |
| T37 | `kayit`: geçerli student/teacher kaydı; geçersiz/dolmuş/tükenmiş kod, adsız teacher → aynı 422, Auth hesabı oluşmaz, davet tüketilmez; geçersiz kodda var olan/olmayan ad aynı yanıt |
| T38 | davet replay (aynı ad, aynı tek kullanımlık kod, başka kod) reddi; eşzamanlı son slot ve aynı ad yarışı: tek kazanan, kaybedenin Auth hesabı telafi ile silinir |
| T39 | Auth oluştu/profil başarısız → Auth silinir, davet geri alınır; telafi başarısız veya durum belirsiz → erişimsiz hesap temizlik sorgusunda listelenir; yanıt kaybı → idempotent başarı, davet bir kez; Auth oluşturma hatası → değişiklik yok; Auth'suz profil oluşamaz (FK/cascade) |
| T40 | başarı sonrası retry tüketmez, başarısızlık sonrası retry başarılı; CORS/405/403/400 yalnız istek biçimine bağlı; Supabase adaptörü (`disabled` modu): parola girişi publishable key ile, Admin API `email_confirm`, telafi yalnız DB kesinleştirmesinden sonra DELETE, eksik ortamda fail-closed, service key hiçbir yanıtta yok |
| T41 | aynı IP + aynı ad seri: limit sonrası 429; var olan ve olmayan ad bayt bayt aynı 401/429 dizisi; 429'da resolver/Auth çağrılmaz; reddedilen istek küresel ad kovasını şişirmez (kısa devre) |
| T42 | aynı IP + farklı adlar: (IP,ad) kovaları ayrı, IP kovası ad taramasını durdurur |
| T43 | farklı IP + aynı ad: IP başına kovalar ayrı, küresel ad kovası dağıtık denemeyi sınırlar |
| T44 | 25 paralel istek, limit 10: tam 10 geçer (atomik sayaç) |
| T45 | pencere dolar, sonraki pencerede sıfırlanır (pencere sınırı aşılmadığı assert edilir); süresi dolan sayaçlar sonraki çağrıda silinir (TTL) |
| T46 | yalnız yapılandırılmış IP başlığı okunur (x-real-ip/cf-connecting-ip/true-client-ip rotasyonu, cf-connecting-ip yapılandırmasında XFF rotasyonu bypass etmez); geçersiz/eksik IP tek ortak kovaya düşer; IPv6 /64, IPv4-mapped IPv6 = IPv4 |
| T47 | limiter DB hatası / boolean olmayan yanıt → 503 `gecici_hata`, resolver/Auth/ön kontrol çağrılmaz (fail-closed); bozuk kova tanımı DB'de reddedilir |
| T48 | başarılı giriş sayılır, sıfırlama yok; limit sonrası doğru ve yanlış parola aynı 429 |
| T49 | `kayit` IP limiti: geçerli/geçersiz kod aynı 429; ön kontrol ve Admin API'ye ulaşılmaz |
| T50 | Auth IP yönlendirme adaptör sözleşmesi: `Sb-Forwarded-For` yalnız `sb_secret_` key ile ve geçerli istemci IP'siyle; publishable/legacy asla; `required` modunda secret key yoksa/legacy/publishable ise kurulum hatası; `SUPABASE_SECRET_KEYS` env ayrıştırma; geçersiz limit env'i güvenli varsayılana döner |
| T51 | limiter mutasyonları (always-allow, kısa devresiz, ad yok sayan) DB'de uygulanınca T41 sözleşmesi FAIL; geri yüklenince PASS |
| T52 | davet araması: geçersiz/geçerli ön kontrol ve tamamla 0 `crypt()` çağrısı (track_functions sayacı, pozitif kontrol); 1/5/25 aktif kodda maliyet düz; tam sorgu index-driven, özet eşitliği benzersiz özet indeksini kullanır; özet anahtarlı (düz/anahtarsız hash değil); aktif kodda özet zorunlu, aynı kod ikinci kez üretilemez; bcrypt-döngü mutantı yakalanır |
| T53 | kayıt kesinleştirme: süren tamamla commit → bekler ve `tamam`; rollback → `iptal`; önce iptal → gecikmiş tamamla reddedilir, davet tüketilmez; damga Auth silinince kalkar; helper'lar ve özel tablolar istemcilere/service_role'e kapalı |

T32–T51 gerçek Edge Function kodunu (`supabase/functions/_shared/kimlik_siniri.mjs`)
gerçek PG16 şemasına karşı çalıştırır. Supabase Auth yerine `auth.users`
üzerinde açık bir davranış **modeli** kullanılır (signup kapalıyken aramadan
önce red; bcrypt yalnız var olan email'de). Model platform kanıtı değildir;
gerçek ayar aşağıdaki canlı G1–G10 kapılarıyla doğrulanır. T41–T51 limiter'ı gerçek DB fonksiyonu üzerinden çalıştırır; hosted gateway IP başlığı ve Auth `Sb-Forwarded-For` davranışı yalnız G6–G8 ile kanıtlanır. Statik deploy sözleşmesi: `node scripts/regression_edge_config_test.js` (config.toml verify_jwt=false + 7 mutant).

Harness ayrıca `supabase/regression_teacher_contract.sql` dosyasını (T-01..T-17)
PG16 üzerinde çalıştırır; teacher policy'si genişletildiğinde ve dosyada SQL
hatası olduğunda `-v ON_ERROR_STOP=1` verilmeden de non-zero döndüğünü doğrular.

T17 harness iki oturumu aynı davet satırı kilidinde beklettiğini
`pg_stat_activity` ile doğrular; kilidi bırakınca sadece biri başarılı olur.
T18 tamamlanmış kayıt retry'sinin mevcut sözleşme gereği reddedildiğini ve
ikinci tüketim yapmadığını doğrular. Ek olarak registration için mevcut
student/teacher damgası yalnız aynı kodla (arama özeti eşleşmesi) yeniden kullanılabilir.

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
  `Kullanıcı adı veya parola hatalı.` mesajını verir. Login resolver
  (`kullanici_email_bul`) publishable key ile çağrılamaz (permission denied);
  ayrıntı G4/G9.
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

## Server-side Auth sınırı — canlı PASS/FAIL kapıları (önce staging)

Kural: her kapı **PASS** ya da **FAIL** verir; "gözlemlendi" sonuç değildir.
Tek bir FAIL, frontend deploy'unu (DEPLOYMENT-SECURITY bölüm 11 adım 14)
durdurur. Sıra: G1 Auth ayarlarından (adım 7) sonra; G2–G10 Edge Functions
deploy edildikten sonra ve frontend'den ÖNCE. Önce staging projede, sonra
production'da yalnız synthetic hesap/kodlarla.

Gizlilik: anahtar/token/parola komut satırına veya geçmişe yazılmaz; ortam
değişkeninden okunur (`read -s`), çıktılar loglanmaz/paylaşılmaz. Aşağıda
`$URL` proje URL'si, `$PUB` publishable key, `$PAT` Management API kişisel
erişim token'ı, `$REF` proje ref'idir. Yanıt gövdesinde token geçen
komutlarda yalnız alan adları/uzunluk yazdırılır.

**G1 — Auth yapılandırması (Management API, salt-okunur).**

```bash
curl -s -H "Authorization: Bearer $PAT" \
  "https://api.supabase.com/v1/projects/$REF/config/auth" \
  | jq '{disable_signup, external_anonymous_users_enabled, external_email_enabled,
         security_captcha_enabled, mailer_autoconfirm, rate_limit_otp,
         forwarding: (to_entries | map(select(.key | test("forward"; "i"))) | from_entries)}'
```

PASS: `disable_signup == true`, `external_anonymous_users_enabled == false`,
`security_captcha_enabled == false`; telefon/OAuth provider'ları kapalı;
Dashboard → Authentication → Rate Limits → **IP Address Forwarding AÇIK**
(API yanıtında bir `forward` alanı varsa o da `true`). Herhangi biri farklı
→ FAIL. (Alan adı belgelenmemişse Dashboard kaydı ekran görüntüsüyle
kanıtlanır; G6 davranışsal kanıttır.)

**G2 — Doğrudan public signup kullanıcı oluşturamaz (negatif + pozitif kontrol).**
`select count(*) from auth.users` (salt-okunur SQL) → `N0`.
1. `POST $URL/auth/v1/signup` (apikey `$PUB`) rastgele
   `u.<uuid hex>@auth.sosyolab.local` + parola → 4xx `signup_disabled`.
2. Aynısı, operatörün bildiği synthetic hesabın iç kimliğiyle → **aynı**
   status ve gövde.
3. Gövdesiz `POST $URL/auth/v1/signup` (anonim) → 4xx; oturum dönmez.
4. Sayım tekrar `N0` olmalı.
5. Pozitif kontrol: G5'teki geçerli synthetic `kayit` sonrası sayım
   `N0 + 1` olmalı (sayım ve Admin API yolu gerçekten çalışıyor).
PASS: 1–2 aynı, 3 reddedildi, 4'te sayı değişmedi, 5'te tam +1.

**G3 — `giris` oturumsuz erişilebilir (pozitif kontrol ÖNCE).**
Authorization başlığı olmadan, yalnız `apikey: $PUB`,
`Origin: https://arsiv.sosyolab.tr`: synthetic **doğru** kullanıcı adı +
parola → `200`, gövdede `ok:true` ve `oturum.access_token` /
`oturum.refresh_token` var, `@` yok. Gateway'in genel 401'i
(`{"code":401,...}` / "Missing authorization header") **FAIL**'dir:
verify_jwt açık kalmış demektir (config.toml deploy edilmemiş). Aynı
kontrol `kayit` için: geçersiz kodla gövde tam olarak
`{"ok":false,"hata":"kayit_basarisiz"}` olmalı.

**G4 — Enumeration eşitliği (G3 PASS olmadan başlanmaz).**
Var olan synthetic ad + yanlış parola ve olmayan ad + rastgele parola,
**farklı** kullanıcı adlarıyla (hız sınırına takılmadan) her biri ≥10 kez:
- gövde **bayt bayt** `{"ok":false,"hata":"giris_basarisiz"}` (gateway 401'i FAIL),
- status `401`, başlık kümesi aynı (`date`/istek kimliği başlıkları hariç),
- süre dağılımları `LOGIN_FLOOR_MS` civarında örtüşür,
- fonksiyon loglarında `giris_taban_asildi` yok.
`rest/v1/rpc/kullanici_email_bul` publishable key ile → 401/403/404
(permission denied), iç kimlik dönmez.

**G5 — Kayıt.** Geçersiz kod + var olan ad ve geçersiz kod + olmayan ad →
aynı `422 kayit_basarisiz`; Auth kullanıcı sayısı değişmez. Synthetic geçerli
kodla kayıt → 200, giriş çalışır, davet sayacı +1. Profilsiz Auth hesabı
temizlik sorgusu (DEPLOYMENT-SECURITY bölüm 11) boş.

**G6 — Auth IP atfı (`Sb-Forwarded-For`).** İki farklı gerçek ağ (IP-A,
IP-B; ör. kablolu + mobil hotspot).
1. IP-A'dan synthetic başarılı giriş; Dashboard → Logs → Auth'ta bu token
   isteğinin IP'si **IP-A** olmalı (Supabase/Edge çıkış IP'si değil).
2. IP-A'dan, Auth'un sign-in limitini aşacak kadar (Dashboard'daki değer +
   birkaç) yanlış parola isteği, **farklı** kullanıcı adlarıyla (Edge
   `RL_GIRIS_IP_AD`'e takılmadan). Staging'de geçici olarak `RL_GIRIS_IP`
   yükseltilebilir; sonra geri alınır.
3. Hemen ardından IP-B'den synthetic doğru giriş → **200** olmalı.
PASS: 1'de IP-A görünür ve 3 başarılı. 3 başarısızsa Auth limiti küresel
birleşiyor demektir → FAIL (secret key / IP Address Forwarding ayarı).

**G7 — Edge istemci IP başlığı sahtelenemez.** IP-A'dan tek bir synthetic
kullanıcı adına `RL_GIRIS_IP_AD + 2` (varsayılan 12) yanlış parola isteği;
her istekte farklı sahte `X-Forwarded-For: 203.0.113.<n>` ve
`X-Real-IP`/`CF-Connecting-IP` başlıkları.
PASS: istek `RL_GIRIS_IP_AD + 1`'de (varsayılan 11.) `429`. Hiç 429 gelmezse
başlık sahtelenebilir → FAIL: `CLIENT_IP_HEADER` gateway'in ezdiği başlığa
çevrilir (ör. `cf-connecting-ip`) ve G7 tekrarlanır. Ayrıca G6.1'de Auth
loglarındaki IP sahte değer olmamalı.

**G8 — Edge hız sınırı davranışı.**
- Aynı IP + aynı ad: `RL_GIRIS_IP_AD + 1`. istekte 429, gövde tam
  `{"ok":false,"hata":"cok_fazla_istek"}`, gövde/başlıkta sayaç/süre yok.
- Aynı IP'den var olan ve olmayan ad için 401/429 dizisi aynı.
- IP-B'den aynı ad → 401 (IP-A'nın kovası IP-B'yi etkilemez; `RL_GIRIS_AD`
  aşılana kadar).
- Limit sonrası doğru parola da 429 (doğru parola sızmaz).
- `kayit`: staging'de `RL_KAYIT_IP=3/600` → 4. istek 429 (geçerli kodla da);
  sonra varsayılana geri alınır.
- Fonksiyon loglarında `istek_siniri_hatasi` yok.
PASS: hepsi beklendiği gibi.

**G9 — İç kimlik sızmaz (oturum öncesi ve kolon yetkisi).** Tarayıcı
DevTools Network: `giris`/`kayit` istek ve yanıtlarında
`@auth.sosyolab.local` yok; giriş sonrası `rest/v1/profiles` isteğinde
`auth_login_email` istenmez/dönmez. Giriş yapmış synthetic kullanıcının
JWT'siyle `GET $URL/rest/v1/profiles?select=auth_login_email` → 401/403
(permission denied for table/column). (Kullanıcının KENDİ JWT'sindeki
`email` claim'i kapsam dışıdır; bkz. DEPLOYMENT-SECURITY F-05 sözleşmesi.)

**G10 — Secret sınırı.** Yayınlanan sitede (`index.html`, `app.js`,
`config.js`, `vendor/`) `sb_secret_`, `service_role` JWT'si yok (grep);
`supabase secrets list` yalnız ad/özet gösterir, değer yazdırılmaz;
fonksiyon loglarında anahtar, parola, ham istek gövdesi yok.

Kapı sonuçları (PASS/FAIL, tarih, ortam, operatör) bakım kaydına yazılır;
gerçek değerler yazılmaz.

## Residual risk

Privileged DB owner helper dışında hash ekleyebilir; entropy/format hash
üzerinden CHECK ile ispatlanamaz. Yerel SQL harness production
Auth/Storage/platform smoke'un yerine geçmez. Hız sınırı ödünleşimleri ve
istemci IP başlığı güveni için DEPLOYMENT-SECURITY "Residual" bölümü.
