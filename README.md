# SosyoLab

Erciyes Üniversitesi Edebiyat Fakültesi Sosyoloji Bölümü ders materyali arşivi.
2026–2027 Güz dönemi ders programı üzerine kurulu statik web uygulaması.
Derleme adımı ve paket yöneticisi yoktur; vanilla HTML/CSS/JS.

## Yapı

| Dosya | Ne yapar |
|---|---|
| `index.html` | Sayfa kabuğu, CSP politikası, meta veriler |
| `styles.css` | Tüm biçimler + gömülü `@font-face` tanımları |
| `app.js` | Tüm uygulama mantığı (depolama köprüsü, Supabase katmanı, arayüz) |
| `config.js` | Supabase adresleri ve davet kodu modu — **herkese açıktır** |
| `404.html` / `404.css` | Hatalı adresler |
| `vendor/` | Depoya alınmış `supabase-js` (CDN'e bağımlılık yok) |
| `assets/fonts/` | Depoya alınmış Inter ve Newsreader alt kümeleri |
| `supabase/schema.sql` | Tablolar, kısıtlar, RLS politikaları, depolama kovası |
| `supabase/migrations/` | Sonradan uygulanacak göçler (aşağıya bakın) |
| `docs/DEPLOYMENT-SECURITY.md` | Barındırma ve DNS tarafındaki güvenlik adımları |
| `.github/workflows/deploy.yml` | `main` dalına her push'ta yayın + güvenlik denetimleri |
| `.nojekyll` | GitHub Pages'in Jekyll işlemesini atlaması için |

### Neden tek dosya değil

Proje daha önce tek bir `index.html` içindeydi. Katı bir Content-Security-Policy
(`script-src 'self'`, `style-src 'self'`, `unsafe-inline` yok) satır içi
`<script>` ve `<style>` bloklarına izin vermediği için bunlar ayrı dosyalara
alındı. Aynı nedenle kodda hiçbir `onclick=""` ya da `style=""` niteliği
kullanılmaz: olaylar `addEventListener`, biçimler CSS sınıflarıyla verilir.
Bu kural yayın akışında otomatik denetlenir.

### Üçüncü taraf bağımlılık yok

`supabase-js` ve yazı tipleri depoda barındırılır. Tarayıcı `cdn.jsdelivr.net`
ya da `fonts.googleapis.com` gibi hiçbir dış kaynağa istek atmaz. Bu hem
tedarik zinciri riskini kaldırır hem de ziyaretçi IP'sinin üçüncü taraflara
gitmesini engeller (KVKK).

Karşılığı: güvenlik yamaları otomatik gelmez. `supabase-js` sürüm takibi elle
yapılır — bkz. `docs/DEPLOYMENT-SECURITY.md` bölüm 10.

## Geliştirme

Kurulum gerekmez, ancak `file://` üzerinden açmayın (CSP ve `localStorage`
davranışı farklı olur). Bir yerel sunucu kullanın:

```bash
python -m http.server 8000
```

## Giriş modeli

Giriş ekranı iki sekmelidir: `Giriş Yap` ve `Kayıt Ol`.

- **Kayıt Ol** — kullanıcı adı + parola + davet kodu ile hesap açılır.
   Davet kodu türüne göre hesap sınıflandırılır:
   - `student` daveti: hesap `user` olarak açılır, `class_year` atanır.
   - `teacher` daveti: hesap `user` olarak açılır, `teacher_status = pending` olur.
- **Giriş Yap** — kullanıcı adı + parola ile yapılır. İstek `giris` Edge
   Function'ına gider; kullanıcı adı iç kimliğe sunucuda çözülür, parola
   doğrulaması Supabase Auth'ta yapılır ve tarayıcıya yalnız oturum döner.
   Tarayıcı iç login kimliğini hiç görmez.
- **Kayıt** de `kayit` Edge Function'ı üzerinden yapılır; public Auth signup
   kapalıdır, Auth hesabı yalnız geçerli davet ön kontrolünden sonra sunucuda
   oluşturulur.
- **Yönetici** — `sosyolog35` kullanıcı adı + parola ile giriş yapar.
   Ek olarak gönderi inceleme ve öğretim elemanı başvurusu onay/reddi yapar.

Öğretim elemanı yetkisi otomatik verilmez. `teacher` davet koduyla açılan
hesaplar yönetici onayıyla `public.ogretmen_basvurusunu_karara_bagla()`
üzerinden `role = 'teacher'` seviyesine yükselir.

Yönetici girişinde parola tarayıcıda hiçbir şeyle karşılaştırılmaz. Takma ad
`sosyolog.35@sosyolab.local` adresine eşlenir, doğrulama Supabase Auth'ta
yapılır ve yetki **yalnızca** `public.profiles.role = 'admin'` satırından gelir.
Zincirin herhangi bir halkası kopuyorsa giriş reddedilir.

Öğretim elemanı görünümü yalnızca `public.profiles.role = 'teacher'` ve
`teacher_status = 'approved'` olan hesaplar için açılır.

`sosyolog35` bir **takma addır, yetki kaynağı değildir.** `localStorage`,
`sessionStorage`, DOM ya da herhangi bir JavaScript değişkeni yönetici yetkisi
üretemez; yerel depoya elle yazılmış `rol: "admin"` kaydı yok sayılır.

Sunucu bağlı değilken yönetici girişi tamamen kapalıdır: parolayı doğrulayacak
güvenilir bir taraf olmadığından akış baştan reddedilir.

### Davet kodu — `config.js` → `INVITE_MODE`

| Mod | Davranış |
|---|---|
| `"server"` | Üretim modu. Kayıt sırasında kod yalnızca Supabase'e gider; `public.kayit_icin_davet_kodu_kullan()` tüketimi sunucuda yapar. |
| `"local"` | Sadece geçiş/demolar içindir. Kayıt ve davet damgası davranışı sunucu moduna göre eksik kalabilir. |

`"server"` modu en az `001` ve `006` göçlerini gerektirir.
**Göç uygulanmadan bu modu açmayın** — self-registration akışı çalışmaz.
Üretimde hedeflenen mod budur; sıralama için
`docs/DEPLOYMENT-SECURITY.md` bölüm 11.

### PRE-006 ve POST-006 geçiş kontrolü

PRE-006 için [supabase/pre_006_inventory.sql](supabase/pre_006_inventory.sql)
005 şemasında read-only çalıştırılır. Toplam ve role sayıları, mevcut
teacher/admin Auth email, canonical sos401 atamaları, aktif legacy davetler
ve ayırt edici anonymous/provider metadata raporlanır. 006 ile gelen
kolonlara başvurmaz. Admin satırı bulunması otomatik FAIL değildir.

Teacher count=0: Auth migration N/A. Teacher count>0: production apply
öncesinde açık migration planı blocker'dır; plan uygulanıp doğrulanmadan
frontend deploy edilmez. Legacy user için preserve / re-onboard / test
hesabıysa silme planı kararı gerekir. sos401=0 olsa da 006 cleanup uygulanır.

006 apply sonrasında kararlaştırılan explicit legacy backfill yapılır;
username ve internal Auth login kimliği hesabın Auth sözleşmesiyle hizalanır.
Auth email değişikliği gerekiyorsa güvenli operator-side Auth Admin API
kullanılır. Browser/service_role yöntemi kullanılmaz. Ayrıntı:
[TEACHER-SETUP.md](docs/TEACHER-SETUP.md).

POST-006 için `supabase/inventory.sql` (`-v mod=POST`) kullanılır. A–G/G2/K/L
0 satır olmalı; self profile INSERT policy/yetkisi olmaması güvenli beklentidir.
Frontend DB 006'dan önce deploy edilmez. Tam sıra bölüm 11'dedir.

## Güvenlik sınırı nerede

Tarayıcıdaki hiçbir kontrol güvenlik sınırı değildir. `app.js` içindeki
`yetkili()` çağrıları yalnızca arayüzü düzenler — düğmeyi gizler, yanlış
tıklamayı önler. Gerçek yetkilendirme **veritabanındaki RLS politikalarıdır**
(`supabase/schema.sql`). Tarayıcı konsolundan istek atan biri için geçerli olan
tek kural budur.

| Kontrol | Nerede uygulanıyor | Gerçek sınır mı |
|---|---|---|
| Yönetici arayüzünün görünmesi | `app.js` → `yetkili()` | Hayır |
| Materyal okuma | `materials_okuma` RLS politikası | **Evet** |
| Gönderi oluşturma | `materials_gonderim` RLS politikası | **Evet** |
| Onay / ret | `materials_inceleme` RLS politikası | **Evet** |
| Silme | `materials_silme` + `materyal_silme` politikaları | **Evet** |
| Dosya okuma | `materyal_okuma` storage politikası | **Evet** |
| Rol yükseltme engeli | `profiles_rol_koru_trg` trigger'ı | **Evet** |
| Dosya türü / boyutu | `app.js` → `dosyaDogrula` | Hayır — bkz. aşağıdaki not |
| Dosya türü / boyutu (sunucu) | Storage kovası `allowed_mime_types`, `file_size_limit` | Kısmen |

**Dosya doğrulaması hakkında dürüst not:** istemcideki uzantı/MIME/boyut
kontrolü bir kullanılabilirlik kontrolüdür; Storage API'si doğrudan çağrılarak
atlanabilir. Kova düzeyindeki `allowed_mime_types` sunucu tarafındadır ama
istemcinin bildirdiği `Content-Type` değerine bakar, **dosyanın içeriğine
bakmaz** (magic byte doğrulaması yoktur). Zararlı yazılım taraması hiç yoktur.
Önerilen Edge Function mimarisi: `docs/DEPLOYMENT-SECURITY.md` bölüm 4.

### Materyal bağlantıları ve XSS

Kullanıcıdan gelen tüm metinler DOM'a yazılmadan önce kaçışlanır. Materyal
bağlantısı olarak yalnızca `http` ve `https` kabul edilir; `javascript:`,
`data:`, `blob:`, `file:` gibi şemalar boş değere düşürülür. Dış bağlantılar
`rel="noopener noreferrer"` ile açılır. Depodaki dosya yolları düzenli ifadeyle
sınırlanır, böylece dizin geçişi (`../`) denemesi taşıyan bir kayıt çizilmez.

### `noindex` bir güvenlik önlemi değildir

`robots: noindex, nofollow` yalnızca arama motorlarında listelenmeyi engeller.
Sayfa herkese açıktır; adresi bilen herkes açabilir. Görünürlük ayarıdır,
erişim denetimi değildir. Gerçek erişim denetimi giriş + RLS'tir.

### Bilinen mimari sınır — HttpOnly oturum çerezi

`supabase-js` oturum jetonlarını `localStorage` içinde tutar. Statik bir sitede
bunu HttpOnly çereze çevirmenin yolu yoktur; HttpOnly yalnızca bir sunucunun
`Set-Cookie` ile verebileceği bir şeydir. Bu bir açık değil, mimari bir
sınırdır. Riski azaltan asıl önlem katı CSP'dir. Gerçekten gerekiyorsa çözüm
bir BFF katmanıdır — `docs/DEPLOYMENT-SECURITY.md` bölüm 3.

Mevcut model **bearer token** modelidir; tarayıcı yetkiyi otomatik
göndermediği için klasik CSRF riski yoktur.

## Gömülü veri kurgusaldır

Uygulamadaki örnek materyallerin ve öğrenci kayıtlarının tamamı kurgusaldır.
Öğretim elemanı adları bu herkese açık sürümde nötr etiketlerle (Öğretim
Elemanı A, B, C …) değiştirilmiştir; ders kodları ve adları gerçektir.

**Gerçek öğrenci numarası, gerçek ad veya bölümün gerçek davet kodu bu depoya
yazılmamalıdır.**

Supabase bağlıyken örnek veriler **tamamen devre dışı kalır**: arşiv yalnızca
sunucudan gelen onaylı materyalleri gösterir ve `KAYITLI` demo listesi
kullanılmaz.

## Supabase kurulumu

`config.js` boşken uygulama **demo modunda** çalışır: örnek materyaller görünür,
gönderim ve onay akışı kapalıdır. Paylaşımlı arşivi açmak için:

1. **Proje oluştur** — supabase.com → New project. Frankfurt (`eu-central-1`)
   hem gecikme hem KVKK açısından tercih edilir.

2. **Şemayı kur** — SQL Editor → `supabase/schema.sql` dosyasının tamamını
   yapıştırıp çalıştır.

3. **E-posta ile kayıt/girişi hazırla** — Authentication → Providers → Email.
   Email provider açık olmalı (parola girişi için). **"Allow new users to
   sign up" KAPALI** ve **Anonymous sign-ins KAPALI** olmalı: kayıtlar `kayit`
   Edge Function'ında Admin API ile `email_confirm: true` oluşturulur, bu
   yüzden "Confirm email" açık kalabilir (önerilen). Edge Function deploy ve
   secrets: [DEPLOYMENT-SECURITY.md](docs/DEPLOYMENT-SECURITY.md) bölüm 11.

4. **Yönetici hesabı aç** — Authentication → Users → Add user:
   - E-posta: `sosyolog.35@sosyolab.local`
   - Parola: güçlü bir parola üret, **yalnızca parola yöneticinde sakla**
   - "Auto confirm user" işaretli olsun

   Sonra SQL Editor'de, oluşan kullanıcının UUID'si ile:

   ```sql
   insert into public.profiles (id, display_name, role)
   values ('BURAYA_UUID', 'Bölüm Yöneticisi', 'admin')
   on conflict (id) do update set role = 'admin';

   -- Mutlaka DOĞRULA — sessizce 'user'a düşmüş olabilir:
   select id, role from public.profiles where id = 'BURAYA_UUID';
   ```

   > Admin rolü doğrulanmadan devam etmeyin; güvenli operatör kurulumunu
   > inceleyin. 006 uygulanmış projede `schema.sql` veya eski migration'ları
   > tekrar çalıştırmayın: kaldırılan self INSERT policy'si ve eski ACL'ler
   > yeniden açılabilir. Düzeltme açıkça planlanmış forward fix olmalıdır.

5. **Genel anahtarları gir** — Project Settings → API:

   | Değer | Nereye |
   |---|---|
   | Project URL | `config.js` → `SUPABASE_URL` |
   | anon / publishable key | `config.js` → `SUPABASE_ANON_KEY` |

   Bu iki değer tarayıcıya gider ve herkes tarafından görülebilir; öyle
   tasarlanmışlardır. **`service_role` anahtarı, veritabanı parolası ve
   yönetici parolası bu depoya asla yazılmaz.** Yayın akışı her push'ta bu
   desenleri tarar ve bulursa yayını durdurur.

6. **Göçleri uygula** (üretim için zorunlu):

   | Dosya | Ne getirir |
   |---|---|
   | `supabase/migrations/001_davet_kodlari.sql` | Sunucu tarafında davet kodu doğrulaması; gönderim iznini doğrulanmış davete bağlar |
   | `supabase/migrations/002_denetim_kaydi.sql` | Yönetici işlemleri için değiştirilemez denetim kaydı |
   | `supabase/migrations/003_launch_gate_hardening.sql` | Arşiv **okumasını** ve depo yüklemesini de davete bağlar; gönderimde dosya sahipliğini zorunlu kılar; başarısız gönderimin bıraktığı yetim dosyanın silinmesine izin verir |
   | `supabase/migrations/004_revoke_public_table_ddl_privs.sql` | Residual hardening: `denetim_kaydi` ve `davet_dogrulamalari` üzerinde `anon/authenticated` için `TRUNCATE`, `REFERENCES`, `TRIGGER` ayrıcalıklarını kaldırır |
   | `supabase/migrations/005_teacher_role.sql` | `teacher` rolü, `teacher_courses` tablosu, öğretim elemanı için ders-sahipliği kontrollü doğrudan yayın akışı |
   | `supabase/migrations/006_self_registration_invites.sql` | Kullanıcı adı+parola self-registration, sınıf bazlı davet tipleri, teacher pending + admin approval |
   | `supabase/migrations/007_production_006_reconciliation.sql` | Eski 006 sürümü uygulanmış production'ı final 006 güvenlik durumuna ileri yönlü taşır; final 006 üzerinde idempotent no-op |

   Önerilen uygulama sırası: `001` → `002` → `003` → `004_revoke_public_table_ddl_privs` → `005_teacher_role` → `006_self_registration_invites` → `007_production_006_reconciliation`.

   **İki yol:** 005 durumundaki (veya boş) kurulum `006` (+ no-op `007`)
   uygular — `docs/DEPLOYMENT-SECURITY.md` bölüm 11. 006'nın eski bir sürümü
   uygulanmış **mevcut SosyoLab production'ı** yalnız `007` uygular —
   bölüm 12 (OLD-006 PRODUCTION RECONCILIATION). Production'da 006 yeniden
   çalıştırılmaz.

   Öğretim elemanı hesabı ve ders ataması için: `docs/TEACHER-SETUP.md`.

   > 003 olmadan davet kodu yalnızca bir gönderim kontrolüdür: anonim giriş
   > açık olduğu için kodu bilmeyen biri de oturum açıp onaylı arşivin
   > tamamını okuyabilir. Üretimde 003 zorunludur.
   >
   > 003, 001'deki `materials_gonderim` politikasını yeniden kurar. **001'i
   > 003'ten sonra tekrar çalıştırmayın** — dosya sahipliği koşulu geri alınır.

   **006 gate ayrımı:** DB snapshot → `supabase/pre_006_inventory.sql`
   (005 şeması, read-only) → legacy teacher/user/sos401 kararları → blocker
   varsa DUR → 006 apply → explicit POST-006 legacy backfill →
   `supabase/inventory.sql` (`-v mod=POST`, A–G/G2/K/L 0 satır) → SQL
   runtime/contract verification → registration/teacher pending/admin approval
   smoke → frontend deploy → `scripts/smoke.sh` → 4 student + 1 teacher
   production invite → final UI verification.

   **Frontend DB 006'dan önce deploy edilmez.** Admin satırı otomatik FAIL
   değildir. Teacher count=0 ise Auth migration N/A; >0 ise açık migration
   planı production apply öncesi, uygulaması ve doğrulaması frontend öncesi
   zorunludur. Legacy user için preserve/re-onboard/test hesabı silme planı
   kararı kaydedilir. sos401=0 olsa da cleanup defense uygulanır.

   Davet kodları yalnız `admin_davet_kodu_olustur` ile CSPRNG 32 hex/128-bit
   formatında üretilir; tabloda hash olduğu için CHECK entropiyi kanıtlayamaz.
   `davet_kullan` istemci erişimi 006 ile kapanır. Pending/rejected teacher
   okuma davranışını korur; materyal/storage upload RLS ile kapalıdır.
   Username enumeration (F-05) server-side Auth sınırıyla kapatılır.
   Sözleşme: oturum açmamış istemci hiçbir hesabın varlığını veya iç Auth
   kimliğini öğrenemez; giriş/kayıt yanıtlarında email yoktur, public signup
   kapalıdır, başarısızlıklar tek tip ve süre tabanlıdır. (Giriş yapan
   kullanıcı yalnız KENDİ iç email'ini kendi JWT'sinde görür; Supabase Auth
   doğası gereğidir. `profiles.auth_login_email` istemci SELECT'ine kapalıdır.)
   `giris`/`kayit` istemci IP'si + kullanıcı adı boyutlarında atomik DB hız
   sınırı uygular ve Auth'a gerçek IP'yi `Sb-Forwarded-For` ile iletir
   (secret key + Dashboard "IP Address Forwarding" gerekir). Davet araması
   pepper'lı HMAC + indeksle yapılır (istek başına bcrypt yok).
   `supabase/config.toml` `verify_jwt=false`'u sabitler. Ayrıntı:
   DEPLOYMENT-SECURITY bölüm 8 ve 11.

   Yerel runtime kanıtı: `pwsh -NoProfile -File scripts/runtime_006_security_test.ps1`
   (`postgres:16` yerelde bulunmalı; ağ kapalı, geçici konteyner, T01–T53 +
   teacher SQL contract T-01..T-17; T32–T40 Edge Function sınırı, T41–T51
   hız sınırı, T52 davet araması, T53 kayıt kesinleştirme). Statik deploy
   sözleşmesi: `node scripts/regression_edge_config_test.js`.
   Release sırası: [DEPLOYMENT-SECURITY.md](docs/DEPLOYMENT-SECURITY.md) bölüm 11.

7. **Barındırma güvenliği** — GitHub Pages HTTP başlığı ayarlayamaz.
   HSTS, `frame-ancestors`, `nosniff`, `Permissions-Policy` ve hız sınırlama
   için `docs/DEPLOYMENT-SECURITY.md` izlenmelidir. Bu adım tamamlanmadan
   platform üretime hazır sayılmaz.

### Materyal akışı

```
Öğrenci dosya yükler       → status = pending  → yönetici inceler
                                                  ├─ Onayla  → approved → arşivde görünür
                                                  └─ Reddet  → rejected → gerekçe gönderene görünür

Öğretim elemanı (atanmış ders) → status = approved (sunucuda trigger ile)
                                → arşivde doğrudan görünür
```

Bekleyen ve reddedilen materyaller ders arşivinde görünmez. Dosyalar özel
(public olmayan) bir kovada durur; erişim 5 dakikalık imzalı bağlantıyla ve
yalnızca storage politikasından geçen kullanıcıya verilir.

Yönetici bir materyali arşivden kaldırdığında kayıt **sunucudan** silinir ve
depodaki dosyası da kaldırılır; işlem `denetim_kaydi` tablosuna iz bırakır
(göç 002 uygulanmışsa).

### Ne nerede saklanıyor

| Veri | Yer |
|---|---|
| Materyaller, gönderiler, roller, davet damgası | Supabase PostgreSQL (RLS ile) |
| Yüklenen dosyalar | Supabase Storage (özel kova) |
| Yönetici işlem izi | Supabase PostgreSQL (`denetim_kaydi`, göç 002) |
| Oturum jetonu | tarayıcı `localStorage` (supabase-js yönetir) |
| Görünen ad, sınıf, favoriler, son görüntülenenler | tarayıcı `localStorage` |

Paylaşılan materyal verisi `localStorage`'da tutulmaz. Sunucu bağlıyken
uygulama açılışta yerel materyal önbelleğini siler.

## Bilinen eksikler

Bunlar bilinçli olarak açık bırakıldı ve üretim öncesi ele alınmalıdır:

- Sunucu tarafında zararlı yazılım / magic byte taraması yok
- Yönetici hesabında MFA yok
- Kimlik doğrulama için gerçek hız sınırlama / bot koruması yok
- KVKK aydınlatma metni ve veri silme talebi akışı yok
- Yedekten geri yükme hiç denenmedi

Her biri için somut plan: `docs/DEPLOYMENT-SECURITY.md`.
