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
- **Giriş Yap** — kullanıcı adı + parola ile yapılır. İstemci, kullanıcı adını
   `public.kullanici_email_bul()` ile iç kimliğe çözümler; parola doğrulaması
   Supabase Auth'ta yapılır.
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

### PRE-006 geçiş kontrolü (legacy hesap uyumluluğu)

`006` öncesi açılmış hesaplar için `username` ve `auth_login_email` alanları
boş olabilir. 006 frontend'i yayımlanmadan önce bu hesaplar tespit edilip
backfill planı uygulanmalıdır.

1. **Legacy adaylarını listele:**
   ```sql
   select p.id,
          p.role,
          p.display_name,
          u.email as auth_email,
          p.username,
          p.auth_login_email
     from public.profiles p
     left join auth.users u on u.id = p.id
    where p.username is null
       or p.auth_login_email is null
    order by p.created_at;
   ```
2. **Otomatik tahmini username üret (öneri çıktısı):**
   ```sql
   with aday as (
     select p.id,
            lower(regexp_replace(
              coalesce(nullif(btrim(p.display_name), ''), 'kullanici'),
              '[^a-z0-9._]+', '', 'gi'
            )) as taban
       from public.profiles p
      where p.username is null
   )
   select id,
          case
            when length(taban) between 4 and 24 then taban
            else 'user.' || substr(md5(id::text), 1, 12)
          end as onerilen_username
     from aday;
   ```
3. **Backfill'i açıkça uygula:** önerilen username'leri çakışma kontrolüyle
   `profiles.username` alanına yaz; `auth_login_email` için yalnızca iç
   (`@auth.sosyolab.local`) eşlemeler kullan.
4. **Deploy sırası:** önce SQL zinciri (`001→...→006`) + backfill doğrulaması,
   sonra 006 frontend yayını. Frontend 006, DB 006'dan önce yayımlanmamalı.

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
   `signUp` akışının çalışması için Email provider açık olmalı.
   Uygulama kendi iç alan adı (`@auth.sosyolab.local`) ile kayıt açtığı için
   üretimde e-posta doğrulama gereksinimi kapatılmalı (aksi durumda
   `kullanici_kaydi_tamamla` akışı tamamlanamaz).

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

   > **Önemli:** `role` sonucu `admin` değil `user` çıkıyorsa, `schema.sql`
   > dosyasının güncel sürümünü henüz uygulamamışsınız. Rol koruma
   > trigger'ları eski hâlinde bu insert'i sessizce geri alıyordu: trigger
   > SECURITY DEFINER olduğu için her çağrıda çalışıyor ve içindeki
   > `is_admin()` SQL Editor'de `auth.uid()` NULL olduğundan false dönüyordu.
   > Düzeltilmiş sürüm, istek bağlamı olmayan (yani güvenilir sunucu
   > tarafından gelen) yazmayı serbest bırakır; tarayıcıdan gelen yazma ise
   > RLS'i geçemediği için trigger'a hiç ulaşamaz. `schema.sql`'i yeniden
   > çalıştırıp insert'i yineleyin.

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

   Önerilen uygulama sırası: `001` → `002` → `003` → `004_revoke_public_table_ddl_privs` → `005_teacher_role` → `006_self_registration_invites`.

   Öğretim elemanı hesabı ve ders ataması için: `docs/TEACHER-SETUP.md`.

   > 003 olmadan davet kodu yalnızca bir gönderim kontrolüdür: anonim giriş
   > açık olduğu için kodu bilmeyen biri de oturum açıp onaylı arşivin
   > tamamını okuyabilir. Üretimde 003 zorunludur.
   >
   > 003, 001'deki `materials_gonderim` politikasını yeniden kurar. **001'i
   > 003'ten sonra tekrar çalıştırmayın** — dosya sahipliği koşulu geri alınır.

   **Göçten önce ve sonra** `supabase/inventory.sql` çalıştırılır — **mod
   zorunludur**:

   ```
   psql "<baglanti>" -v mod=PRE  -f supabase/inventory.sql   # 003'ten önce
   psql "<baglanti>" -v mod=POST -f supabase/inventory.sql   # 003'ten sonra
   ```

   **A–G bloklarının hepsi 0 satır döndürmelidir.** Politika adları doğru
   olduğu hâlde gövdeleri değiştirilmiş olabilir; bunu yalnızca B bloğu
   yakalar. Blok F moda göre SL-01/03/09'un kapalı ya da açık olmasını
   doğrular. Blok K bilgi amaçlıdır ama okunmalıdır: `TRUNCATE` ayrıcalığı
   RLS'i aşar ve 003 `POST` gate geçildikten sonra 004 ile kapatılmalıdır.
   K.2 kararı Seçenek B'dir: `denetim_kaydi` için authenticated'a doğrudan
   `SELECT` grant tasarlanmamıştır.
   Adım adım sıra: `docs/DEPLOYMENT-SECURITY.md` bölüm 11, FAZ 2.

   Sıra ve doğrulama adımları: `docs/DEPLOYMENT-SECURITY.md` bölüm 11.

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
