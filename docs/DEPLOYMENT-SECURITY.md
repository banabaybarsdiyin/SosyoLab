# Dağıtım güvenliği — arsiv.sosyolab.tr

Bu belge, **depo kodundan yapılamayan** güvenlik ayarlarını listeler. Her madde
için "neden gerekli", "şu an ne durumda" ve "tam olarak ne yapılacak" ayrı ayrı
yazılmıştır.

Kod tarafında yapılabilecek her şey uygulandı. Aşağıdakiler barındırma ve DNS
katmanında yapılır; bu adımlar tamamlanmadan platform **üretime hazır sayılmaz**.

---

## 0. Önce şunu bilin: GitHub Pages HTTP başlığı ayarlayamaz

GitHub Pages statik dosya sunar ve depo içinden **hiçbir yanıt başlığı**
tanımlanamaz. `_headers`, `netlify.toml`, `.htaccess` gibi dosyalar GitHub
Pages'te **hiçbir işe yaramaz** — sessizce yok sayılırlar.

Bu yüzden `index.html` ve `404.html` içindeki Content-Security-Policy
`<meta http-equiv>` ile verilmiştir. `<meta>` CSP gerçek bir korumadır, **ancak**
şu yönergeler `<meta>` ile verildiğinde **tarayıcı tarafından yok sayılır**:

| Yönerge | `<meta>` ile çalışır mı |
|---|---|
| `script-src`, `style-src`, `connect-src`, `img-src`, `font-src`, `object-src`, `base-uri`, `form-action` | ✅ Evet — bunlar şu an aktif |
| `frame-ancestors` | ❌ Hayır |
| `report-uri` / `report-to` | ❌ Hayır |
| `sandbox` | ❌ Hayır |

Ayrıca şu başlıklar zaten yalnızca başlık olarak var olabilir:
`Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`,
`Permissions-Policy`, `X-Frame-Options`, `Cross-Origin-Opener-Policy`.

**Sonuç:** tam başlık kümesi için siteyi bir kenar katmanının (Cloudflare)
arkasına almak gerekir. İki seçenek aşağıda.

---

## 1. SEÇENEK A — Cloudflare (önerilen)

`sosyolab.tr` alan adı zaten var; `arsiv` alt alanını Cloudflare üzerinden
proxy'leyip başlıkları orada eklemek en az iş gerektiren yoldur.

### 1.1 DNS

Cloudflare → DNS:

```
Tür    Ad      İçerik                          Proxy
CNAME  arsiv   <kullanıcı>.github.io           Proxied (turuncu bulut)
```

GitHub tarafında: Settings → Pages → Custom domain = `arsiv.sosyolab.tr`,
**Enforce HTTPS** işaretli. Depo köküne `CNAME` dosyası GitHub arayüzünden
eklenir (bu depoda yoktur; workflow yalnızca listelenen dosyaları yayınlar,
CNAME eklerseniz `deploy.yml` içindeki kopyalama ve doğrulama listesine de
eklemeniz gerekir).

> **Uyarı — subdomain takeover:** GitHub Pages sitesini silerseniz ya da depo
> adını değiştirirseniz `arsiv` CNAME kaydını **aynı anda** silin. Hedefi
> kaybolmuş bir CNAME kaydı ("dangling CNAME") üçüncü bir kişinin o adı
> `github.io` üzerinde alarak `arsiv.sosyolab.tr` adresini ele geçirmesine
> izin verir.

### 1.2 SSL/TLS

Cloudflare → SSL/TLS:

- Encryption mode: **Full (strict)** — *Flexible kesinlikle kullanılmayacak;
  Flexible, Cloudflare ile GitHub arasını şifresiz bırakır.*
- Edge Certificates → **Always Use HTTPS**: açık
- Minimum TLS Version: **TLS 1.2**
- TLS 1.3: **açık**
- Opportunistic Encryption: açık
- Automatic HTTPS Rewrites: açık
- HSTS (Enable HSTS): açık
  - Max-Age: **12 ay** (`31536000`)
  - Include subdomains: *önce kapalı test edin;* `sosyolab.tr` altındaki tüm
    alt alanların HTTPS olduğundan emin olmadan açmayın
  - Preload: **en sona bırakın** — preload listesine girmek geri alması zor
    bir taahhüttür

### 1.3 Güvenlik başlıkları (Transform Rule)

Cloudflare → Rules → **Transform Rules** → *Modify Response Header* → Create.

Filtre: `Hostname equals arsiv.sosyolab.tr`

Eklenecek başlıklar (*Set static*):

| Başlık | Değer |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Frame-Options` | `DENY` |
| `Permissions-Policy` | `accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), screen-wake-lock=(), usb=(), xr-spatial-tracking=()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Content-Security-Policy` | aşağıdaki tek satır |

`Content-Security-Policy` (başlık sürümü — `<meta>` sürümünden farkı
`frame-ancestors` içermesidir; başlık gelince `<meta>` ile birlikte **ikisi de**
uygulanır, ikisinin kesişimi geçerli olur, bu yüzden değerleri aynı tutun):

```
default-src 'none'; base-uri 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://ulwgkfulxqfeicjftqeb.supabase.co wss://ulwgkfulxqfeicjftqeb.supabase.co; form-action 'none'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests
```

> Supabase projesini değiştirirseniz `connect-src` içindeki alan adını hem
> burada hem `index.html` içindeki `<meta>` CSP'de güncelleyin.

### 1.4 Önbellek

Cloudflare → Caching → Cache Rules. Kimliği doğrulanmış içerik bu sitede
sunucudan HTML olarak gelmez (her şey Supabase'ten XHR ile alınır), bu yüzden
HTML'in kenarda önbelleğe alınması bir veri sızıntısı yaratmaz. Yine de:

| Yol | Kural |
|---|---|
| `/config.js`, `/index.html`, `/404.html` | Cache: **Bypass** ya da Edge TTL ≤ 5 dk (yapılandırma değişikliği hızlı yayılsın) |
| `/assets/fonts/*`, `/vendor/*` | Edge TTL 1 yıl, Browser TTL 1 yıl (dosya adları sürümlü) |
| `/app.js`, `/styles.css` | Edge TTL ≤ 1 saat (sürümsüz dosya adları) |

Supabase'e giden istekler Cloudflare'den geçmez; onların önbellek davranışı
Supabase tarafındadır ve imzalı bağlantılar `private` olarak döner.

### 1.5 Hız sınırlama ve bot koruması

Cloudflare → Security → WAF → Rate limiting rules:

```
Kural 1 — kimlik doğrulama
  Eşleşme: (http.host eq "arsiv.sosyolab.tr")
  Not: Supabase Auth farklı bir alan adındadır; bu kural yalnızca siteyi korur.
```

**Önemli sınır:** giriş ve davet doğrulama istekleri tarayıcıdan doğrudan
`*.supabase.co` adresine gider; Cloudflare'in `sosyolab.tr` kuralları bu
istekleri **görmez**. Gerçek kimlik doğrulama hız sınırı için:

- Supabase → Authentication → Rate Limits: `Sign in / Sign up`, `Anonymous
  sign-ins` ve `Token refresh` limitlerini bölümün gerçek kullanıcı sayısına
  göre düşürün (varsayılanlar bir bölüm için fazla cömerttir).
- Supabase → Authentication → Attack Protection: **Captcha** (hCaptcha /
  Turnstile) açın. Açarsanız istemcide `signInWithPassword` /
  `signInAnonymously` çağrılarına `options.captchaToken` eklenmesi gerekir —
  bu bir kod değişikliğidir, bu depoda henüz yoktur.
- Uzun vadeli çözüm: kimlik doğrulamayı kendi alan adınız altındaki bir
  Cloudflare Worker üzerinden vekillemek. Bu aynı zamanda HttpOnly çerez
  modelini de mümkün kılar (bkz. bölüm 3).

---

## 2. SEÇENEK B — Cloudflare kullanılmayacaksa

GitHub Pages'te kalırsanız şu maddeler **karşılanamaz** ve bu bir mimari
sınırdır, bir eksiklik değil:

- `Strict-Transport-Security` — GitHub Pages custom domain'de HSTS göndermez
- `X-Frame-Options` / `frame-ancestors` — çerçeveleme koruması yalnızca
  `app.js` içindeki betik kontrolüne kalır (JavaScript kapalıysa yoktur)
- `X-Content-Type-Options: nosniff`
- `Permissions-Policy`
- `Referrer-Policy` — yalnızca `<meta name="referrer">` kadarıyla vardır
  (bu depoda tanımlı)

Bu durumda kabul kriteri **AC-04 karşılanmamış** sayılır ve raporda böyle
belirtilmelidir.

Alternatif barındırıcılar (Cloudflare Pages, Netlify, Vercel) başlıkları
doğrudan dosyayla tanımlamaya izin verir. Cloudflare Pages'e geçilirse depo
köküne şu `_headers` dosyası yeterlidir:

```
/*
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
  Permissions-Policy: accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()
  Content-Security-Policy: default-src 'none'; base-uri 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://ulwgkfulxqfeicjftqeb.supabase.co wss://ulwgkfulxqfeicjftqeb.supabase.co; form-action 'none'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests

/assets/fonts/*
  Cache-Control: public, max-age=31536000, immutable

/vendor/*
  Cache-Control: public, max-age=31536000, immutable

/config.js
  Cache-Control: no-cache
```

> Bu dosya bilinçli olarak depoya **eklenmedi**: GitHub Pages'te hiçbir etkisi
> olmadığı hâlde "başlıklar ayarlı" izlenimi verirdi.

---

## 3. HttpOnly oturum çerezi — mimari sınır

Supabase'in tarayıcı istemcisi (`supabase-js`) erişim ve yenileme jetonlarını
**`localStorage`** içinde tutar. Statik bir sitede bunu HttpOnly çereze
çevirmenin yolu yoktur: HttpOnly çerezi yalnızca bir sunucu `Set-Cookie` ile
verebilir, statik barındırma ise sunucu kodu çalıştırmaz.

**Bu şu an bir mimari sınırdır, kapatılmış bir açık değildir.**

Pratik etkisi: sayfada çalışan herhangi bir XSS jetonu okuyabilir. Bu riski
azaltan asıl önlem katı CSP'dir (`script-src 'self'`, inline betik yok, satır
içi olay niteliği yok) — bu depoda uygulanmıştır.

HttpOnly gerçekten zorunluysa tek gerçek çözüm araya bir sunucu koymaktır:

1. **Cloudflare Worker (BFF)** — `arsiv.sosyolab.tr/api/*` altında bir Worker;
   Supabase Auth'u Worker çağırır, jetonu `HttpOnly; Secure; SameSite=Lax`
   çerezde tutar, veri isteklerini vekiller. Bu modelde **CSRF koruması
   zorunlu hâle gelir** (çerez tabanlı olduğu için): `SameSite=Strict` ya da
   çift gönderim jetonu + `Origin` denetimi.
2. **Supabase SSR** (`@supabase/ssr`) ile Next.js / SvelteKit gibi sunucu
   tarafı render eden bir çatı. Bu, projenin vanilla HTML mimarisinden
   tamamen çıkması demektir.

Mevcut model **bearer token** modelidir: istek yetkisi `Authorization`
başlığıyla taşınır, tarayıcı bunu otomatik göndermediği için klasik CSRF
riski **yoktur**. Bu bir eksiklik değil, farklı bir tehdit modelidir.

---

## 4. Zararlı yazılım taraması — eksik

Yüklenen PDF / DOCX / PPTX / JPG / PNG dosyaları **hiçbir yerde zararlı yazılım
taramasından geçmiyor.**

Şu an ne var:

- İstemcide uzantı izin listesi, uzantı–MIME tutarlılığı ve boyut sınırı
  (`app.js` → `dosyaDogrula`). Bu bir **kullanılabilirlik** kontrolüdür;
  saldırgan Storage API'sini doğrudan çağırarak atlayabilir.
- Supabase Storage kovasında `allowed_mime_types` ve `file_size_limit`. Bu
  sunucu tarafındadır **ama istemcinin bildirdiği `Content-Type` değerine
  bakar, dosyanın içeriğine bakmaz** — magic byte doğrulaması yapmaz.

Yani: `.pdf` uzantılı, `application/pdf` olarak bildirilmiş ama içeriği
tamamen başka olan bir dosya yüklenebilir. İçerik yalnızca imzalı bağlantıyla
ve yalnızca yetkili kullanıcıya sunulduğu için etki sınırlıdır, ancak
**MISSING SERVER-SIDE MALWARE SCANNING** bulgusu geçerlidir.

Önerilen mimari (Supabase Edge Function):

```
Öğrenci yükler → bucket "karantina" (hiçbir okuma politikası yok)
       ↓ Storage webhook
Edge Function
   1. magic byte doğrulaması (PDF %PDF-, PNG \x89PNG, JPEG \xFF\xD8\xFF,
      DOCX/PPTX = ZIP \x50\x4B + içerik listesi denetimi)
   2. arşiv bombası kontrolü (açılmış boyut / sıkıştırılmış boyut oranı)
   3. Office belgelerinde makro (vbaProject.bin) varsa reddet
   4. ClamAV (clamd) ya da VirusTotal / Cloudmersive API taraması
   5. temizse "materyaller" kovasına taşı, materials.status = 'pending'
      değilse kaydı sil, dosyayı sil, gönderene bildir
```

Bu uygulanana kadar yönetici onay adımı **tek savunma hattıdır**: yöneticiye
"onaylamadan önce dosyayı indirip kendi antivirüsünüzle kontrol edin" denmeli.

---

## 5. Çok faktörlü kimlik doğrulama (MFA) — eksik

Yönetici hesabı (`sosyolog35`) tek faktörlüdür. Parolası ele geçen biri tüm
arşivi silebilir, istediği materyali onaylayabilir.

Supabase MFA (TOTP) **mevcut mimaride eklenebilir** — `supabase-js` içinde
`auth.mfa.*` API'si vardır ve statik sitede çalışır. Bu depoda henüz yoktur
çünkü kaydolma (enroll) akışı bir arayüz eklemeyi gerektirir.

Uygulama planı:

1. Supabase → Authentication → Providers → **Multi-Factor Authentication**
   → TOTP'yi etkinleştir.
2. `app.js` içine yönetici için kayıt akışı:
   `supabase.auth.mfa.enroll({ factorType: 'totp' })` → dönen QR'ı göster →
   `auth.mfa.challenge()` + `auth.mfa.verify({ code })`.
3. Girişte: `signInWithPassword` sonrası
   `auth.mfa.getAuthenticatorAssuranceLevel()` çağır; `currentLevel` `aal1`
   ve `nextLevel` `aal2` ise kod iste ve doğrula.
4. **Asıl adım — yetkilendirmeyi bağlama:** RLS'te `is_admin()` fonksiyonunu
   AAL2 şartına bağlayın, yoksa MFA yalnızca arayüz süsü olur:

   ```sql
   create or replace function public.is_admin()
   returns boolean language sql stable security definer set search_path = ''
   as $$
     select exists (
       select 1 from public.profiles p
       where p.id = auth.uid()
         and p.role = 'admin'
         and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
     );
   $$;
   ```

   Bu değişikliği **ancak** yönetici hesabına TOTP kaydedildikten sonra
   uygulayın; aksi hâlde yönetici kendi hesabından kilitlenir.

---

## 6. Yedekleme ve kurtarma — doğrulanmadı

Supabase planınızın gerçek yedekleme yeteneğini **varsaymadım**. Kontrol edin:

- Supabase → Database → Backups: günlük yedek var mı, kaç gün saklanıyor?
- Point-in-Time Recovery (PITR) yalnızca ücretli planlarda; açık mı?
- **Storage yedeklenmiyor olabilir.** Çoğu planda veritabanı yedeklenir ama
  Storage nesneleri yedeklenmez. Yüklenen materyaller için ayrı bir dışa
  aktarma işi gerekir.

Yapılacaklar:

1. Planın yedekleme kapsamını yazılı olarak doğrulayın.
2. **Geri yükleme tatbikatı yapın** — hiç denenmemiş yedek, yedek değildir.
   Boş bir Supabase projesine geri yükleyip arşivin açıldığını görün.
3. RPO/RTO hedefi belirleyin (öneri: RPO 24 saat, RTO 8 saat — bir bölüm
   arşivi için makul).
4. Storage için aylık dışa aktarma: `supabase storage` CLI ya da service_role
   ile çalışan bir betik; çıktı kurum dışı bir yerde saklanmalı.
5. Kazara silmeye karşı: `materials` silme işlemi artık `denetim_kaydi`
   tablosuna iz bırakıyor (bkz. `supabase/migrations/002_denetim_kaydi.sql`),
   ancak **iz kaydı dosyayı geri getirmez**. Gerçekten geri alınabilir silme
   isteniyorsa `deleted_at` sütunuyla yumuşak silmeye geçilmelidir.

---

## 7. DNS ve e-posta

- **DNSSEC:** alan adı kayıt firmasında `sosyolab.tr` için etkinleştirin.
  Cloudflare kullanıyorsanız Cloudflare → DNS → DNSSEC → Enable, ardından
  verilen DS kaydını kayıt firmasına girin.
- **CAA kaydı** (yanlış sertifika verilmesini sınırlar):
  ```
  sosyolab.tr.  CAA  0 issue "letsencrypt.org"
  sosyolab.tr.  CAA  0 issue "pki.goog"
  sosyolab.tr.  CAA  0 issuewild ";"
  ```
  *Not: GitHub Pages ve Cloudflare hangi CA'yı kullanıyorsa ona izin verin;
  yanlış CAA sertifika yenilemesini kırar. Önce mevcut sertifikanın
  vericisini kontrol edin.*
- **E-posta:** SosyoLab hiçbir e-posta göndermiyor (Supabase Auth e-posta
  sağlayıcısı kullanılmıyor; giriş öğrenci numarası + davet kodu ile).
  Bu nedenle SPF/DKIM/DMARC **platform için N/A**'dır.

  Ancak `sosyolab.tr` alan adından e-posta gönderilmiyorsa bile, adın
  sahtelenmesini engellemek için şu kayıtlar önerilir:
  ```
  sosyolab.tr.        TXT  "v=spf1 -all"
  _dmarc.sosyolab.tr. TXT  "v=DMARC1; p=reject; rua=mailto:<adres>"
  *._domainkey.sosyolab.tr. TXT "v=DKIM1; p="
  ```
  *Alan adından gerçekten e-posta gönderiyorsanız bunları uygulamayın —
  tüm postanız reddedilir.*

---

## 8. Supabase proje ayarları — kontrol listesi

Dashboard'dan elle doğrulanacaklar (depo kodundan görülemez):

- [ ] **API → Exposed schemas**: yalnızca `public`. `storage`, `auth`,
      `graphql_public` gibi şemalar PostgREST'e açık olmamalı.
- [ ] **Authentication → URL Configuration → Site URL**:
      `https://arsiv.sosyolab.tr`
- [ ] **Redirect URLs**: yalnızca `https://arsiv.sosyolab.tr/**`.
      Joker (`*`) ya da `http://` girdisi bırakmayın — açık yönlendirme ve
      jeton sızıntısına yol açar.
- [ ] **Authentication → Providers → Anonymous sign-ins**: açık olmalı
      (öğrenci gönderimleri buna dayanıyor). Göç 001 uygulandıktan sonra
      anonim kullanıcı davet doğrulamadan hiçbir şey yazamaz; göç 003'ten
      sonra **okuyamaz da**. 003 uygulanmadıysa bu ayar açıkken kodu
      bilmeyen biri de onaylı arşivin tamamını okuyabilir.
- [ ] **Authentication → Rate Limits**: varsayılanlar düşürülsün (bkz. 1.5).
- [ ] **Database → Extensions**: `pgcrypto` etkin (göç 001 için gerekli).
- [ ] **Storage → materyaller kovası**: `public = false`. Dashboard'dan
      görsel olarak doğrulayın.
- [ ] **Project Settings → API keys**: `service_role` anahtarının hiçbir
      istemci koduna, CI değişkenine ya da paylaşılan belgeye girmediğini
      doğrulayın. Şüphe varsa **döndürün (rotate)**.
- [ ] **Database → Roles**: `anon` ve `authenticated` rollerine fazladan
      `GRANT` verilmemiş olsun.
- [ ] **Logs**: PostgREST ve Auth loglarının saklama süresini kontrol edin;
      IP adresleri KVKK kapsamında kişisel veridir (bkz. bölüm 9).

---

## 9. KVKK — barındırma tarafındaki yükümlülükler

- **Veri yeri:** Supabase projesinin bölgesini kontrol edin. AB dışındaysa
  (ör. `us-east-1`) öğrenci verisi yurt dışına aktarılıyor demektir; KVKK
  md. 9 uyarınca **açık rıza ya da uygun bir aktarım mekanizması** gerekir.
  Aydınlatma metninde bu açıkça yazmalıdır.
- **Log saklama:** Supabase Auth logları IP adresi tutar. Saklama süresini
  gerekli olan en kısa süreye indirin.
- **Cloudflare kullanılırsa** analitik ve log tutma ayarlarını gözden geçirin;
  Cloudflare Web Analytics çerezsizdir ve bu site için yeterlidir.
- **Çerez/onay bandı:** bu site analitik, reklam ya da izleme çerezi
  kullanmıyor. `localStorage` yalnızca oturum ve kullanıcının kendi tercihleri
  (kaydettikleri, son görüntülenenler) için kullanılıyor; bunlar hizmetin
  çalışması için zorunlu olduğundan **onay bandı gerekmez**. Bu durum
  değişirse (analitik eklenirse) onay bandı zorunlu hâle gelir.
- **Aydınlatma metni** hâlâ **eksiktir** — bkz. üretim öncesi engelleyiciler.

---

## 10. GitHub deposu ayarları

Depo kodundan yapılamaz, Settings'ten yapılır:

- [ ] Settings → Branches → `main` için **branch protection**:
      doğrudan push kapalı, PR zorunlu, force push kapalı, silme kapalı
- [ ] Settings → Code security → **Secret scanning** + **Push protection**: açık
- [ ] Settings → Code security → **Dependabot alerts**: açık
      *(Not: bu projede `package.json` yoktur; tek üçüncü taraf bağımlılık
      `vendor/supabase-js-2.45.4.min.js` dosyasıdır ve Dependabot onu görmez.
      Sürüm takibini elle yapın — bkz. aşağıdaki not.)*
- [ ] Settings → Actions → General → Workflow permissions:
      **Read repository contents permission** (workflow zaten kendi izinlerini
      daraltıyor, ama varsayılan da dar olmalı)
- [ ] Settings → Environments → `github-pages`: deployment branch olarak
      yalnızca `main`
- [ ] Settings → Pages → **Enforce HTTPS**: açık

### supabase-js sürüm takibi

Kütüphane depoya alındı (`vendor/`), bu yüzden CDN kesintisi ve tedarik
zinciri riski yok — ama güvenlik yamaları otomatik gelmiyor. Üç ayda bir:

```bash
# Yeni sürümü indir, hash'i güncelle, workflow'daki beklenen değeri değiştir
curl -sSLo vendor/supabase-js-<YENİ>.min.js \
  https://cdn.jsdelivr.net/npm/@supabase/supabase-js@<YENİ>/dist/umd/supabase.js
sha256sum vendor/supabase-js-<YENİ>.min.js
# index.html içindeki <script src>, .github/workflows/deploy.yml içindeki
# dosya adı, hash ve doğrulama listesi birlikte güncellenir.
```

Mevcut sürüm: **2.45.4**
SHA-256: `8596965fe918e656600a1b568d3a168f5c0d3d22a600886bb6f44a6555db01e7`

---

## 11. Yayına alma sırası

Bu sıra önemlidir; atlanan ya da yeri değişen bir adım siteyi kırabilir.
İki faz vardır ve **ikisi karıştırılmamalıdır**.

### Kritik kural — dağıtım tetikleyicisi

`.github/workflows/deploy.yml` **`push: branches: [main]`** ile tetiklenir.
Yani:

> **`app.js`'i yayına almak = `main`'e push etmek.**
> "Önce app.js'i yayınla, sonra commit/push et" diye bir sıra YOKTUR;
> push'un kendisi dağıtımdır.

Bu yüzden veritabanı göçü push'tan **önce**, arayüz testleri push'tan
**sonra** yapılır.

### İki doğrulama türü — karıştırma

| Tür | Nedir | Neye ihtiyaç duyar | Nerede |
|---|---|---|---|
| **VERİTABANI DOĞRULAMASI** | RLS/politika davranışı; tarayıcı konsolundan doğrudan Supabase API çağrıları | Yalnızca uygulanmış göç. **Yeni `app.js` GEREKMEZ** | `LIVE-VALIDATION.md` B, B.2, C bölümleri |
| **ARAYÜZ DOĞRULAMASI** | Damgasız oturumun panele düşmemesi gibi arayüz davranışları | **Yayınlanmış yeni `app.js` GEREKİR** | `LIVE-VALIDATION.md` A, B.3 bölümleri |

Veritabanı doğrulaması push'tan önce yapılabilir ve yapılmalıdır: bir sorun
çıkarsa henüz hiçbir şey yayınlanmamış olur.

---

### FAZ 1 — İlk kurulum (bir kez; halihazırda tamamlandı)

1. `supabase/schema.sql` çalıştırılır (bölüm 12).
2. `supabase/migrations/001_davet_kodlari.sql` çalıştırılır.
3. En az bir davet kodu tanımlanır (göç dosyası bölüm 6).
4. `supabase/migrations/002_denetim_kaydi.sql` çalıştırılır.
5. Yönetici hesabıyla giriş yapılıp onay kuyruğunun çalıştığı doğrulanır.
6. `config.js` → `INVITE_MODE: "server"`, `LOCAL_INVITE_CODE` satırı **silinir**.

---

### FAZ 2 — Launch gate sertleştirmesi (003 + 004 + yeni `app.js`)

Bu sürümün sırası. Adımlar atlanmaz ve yerleri değişmez.

1. **Envanter — göçten ÖNCE, `PRE` modunda.** `supabase/inventory.sql`
   **mod zorunludur**:
   ```
   psql "<baglanti>" -v mod=PRE -f supabase/inventory.sql
   ```
   **A, B, C, D, E, F, G bloklarının HEPSİ 0 satır döndürmelidir.**

   > **`mod` neden zorunlu:** envanterin tek modlu ilk sürümü 003 SONRASI
   > durumu zorunlu kılıyordu, runbook ise onu 003'ten ÖNCE çalıştırıp
   > "hepsi 0 satır" bekliyordu — mantıksal olarak imkânsız bir kapı.
   > Canlı preflight bunu doğruladı (A'da 1, B'de 4 bulgu). Operatörün
   > öğreneceği tek ders "kırmızıyı yok say" olurdu; tam olarak kaçınmak
   > istediğimiz şey. `mod` verilmezse psql hata verip DURUR.
   >
   > `PRE` modunda blok F, SL-01/03/09 sertleştirmelerinin **hiçbirinin**
   > uygulanmamış olduğunu doğrular; `POST` modunda **hepsinin** uygulanmış
   > olduğunu. Simetrik olduğu için "kısmen uygulanmış" durumu da yakalar.

2. **Sapma varsa DUR.** Satır dönen her blok, üretimde depoda izi olmayan bir
   politika / gövde / RLS / GRANT sapması olduğunu gösterir. Açıklanmadan
   3. adıma geçilmez. Özellikle B bloğu önemlidir: adı doğru olduğu hâlde
   gövdesi `using (true)` yapılmış bir politikayı yalnızca o yakalar.

    **Blok K ayrıca okunur** (kapıyı bloklamaz): `denetim_kaydi` ve
   `davet_dogrulamalari` üzerinde `anon`/`authenticated` rollerinde kalan
   `TRUNCATE` ayrıcalığını listeler. TRUNCATE **RLS'i aşar**; göç 001/002
   yalnızca `insert, update, delete` revoke ettiği için geride kalmıştır.
   Genel API yüzeyinden erişilemez (roller NOLOGIN, PostgREST TRUNCATE
    üretmez) ama ayrı bir göçle kapatılmalıdır.
3. **`supabase/migrations/003_launch_gate_hardening.sql` çalıştırılır.**
   *Arşiv okumasını ve depo yüklemesini davet damgasına bağlar, gönderimde
  dosya sahipliğini zorunlu kılar, yetim dosya temizliğini açar. Göç,
  politikalara dokunmadan ÖNCE ön koşulları doğrular: `public.materials` ve
  `storage.objects` var olmalı, ikisinde de RLS açık olmalı, ayrıca
  `davet_dogrulandi_mi()`, `is_admin()` ve `storage.foldername()`
  bulunmalıdır. Dosya tek bir transaction'dır: hata olursa hiçbir şey
  değişmez.*
4. **Envanter — göçten SONRA, `POST` modunda.**
   ```
   psql "<baglanti>" -v mod=POST -f supabase/inventory.sql
   ```
   A–G yine 0 satır dönmeli. Blok F artık beş sertleştirmenin **hepsinin**
   uygulandığını doğrular: `materyal_yetim_silme` politikası ve
   `dosya_materyale_bagli_mi` fonksiyonu var olmalı; `materials_okuma`,
   `materyal_okuma` ve `materyal_yukleme` gövdelerinde `davet_dogrulandi_mi`,
   `materials_gonderim` gövdesinde `foldername` geçmelidir. Blok H'deki ham
   döküm depo dosyalarıyla gözle karşılaştırılır (blok B gerekli koşulu
   denetler, tam gövde eşitliğini değil).
5. **Residual privilege hardening — `004_revoke_public_table_ddl_privs.sql`.**
    003 `POST` gate geçtikten sonra uygulanır; kapsamı yalnızca
    `public.denetim_kaydi` ve `public.davet_dogrulamalari` tablolarında
    `anon/authenticated` için `TRUNCATE, REFERENCES, TRIGGER` revoke etmektir.

    Karar notu (K.2 = Seçenek B): `public.denetim_kaydi` üzerinde
    `authenticated` için doğrudan `SELECT` grant TASARLANMAMIŞTIR.
    `denetim_okuma` politikası savunma-in-depth olarak kalır.

    004 sonrası envanterde Blok K için beklenen sonuç: **0 satır**.

6. **Teacher role migration — `005_teacher_role.sql`.**
  `profiles.role` kümesi `teacher` ile genişler, `teacher_courses` tablosu
  ve öğretim elemanı için doğrudan yayın (server-side trigger) akışı kurulur.
  Bu adımda policy/fonksiyonlar güncellendiği için ardından envanter tekrar
  çalıştırılır.

7. **VERİTABANI DOĞRULAMASI.** `LIVE-VALIDATION.md` bölüm B (canlı RLS),
   B.2 (davetsiz oturum) ve C (Storage) çalıştırılır. Bunlar konsol/API
   testleridir; **eski `app.js` ile çalışır.** Hepsi geçmeden ilerlenmez.
8. **Depo değişiklikleri commit + push edilir** (`main`).
9. **GitHub Pages yeni `app.js`'i otomatik dağıtır.** Actions sekmesinden
   "GitHub Pages'e yayınla" işinin yeşil olduğu doğrulanır. İş, gizli anahtar
   taraması / inline betik denetimi / bağımlılık hash'i / yayın klasörü
   doğrulaması kapılarını da çalıştırır.
10. **Smoke:** `bash scripts/smoke.sh` → **FAIL 0 olmalı.**
11. **Üretim varlıkları yeni HEAD ile eşleşiyor mu** doğrulanır (smoke §3 bunu
   bayt bayt yapar; bayat CDN önbelleği burada yakalanır).
12. **ARAYÜZ DOĞRULAMASI.** `LIVE-VALIDATION.md` bölüm A (yönetici girişi) ve
  B.3 (UI-01…UI-03, damgasız oturum yönlendirmesi) çalıştırılır. **Bunlar
  yeni `app.js` gerektirir, bu yüzden 9. adımdan sonradır.**
13. **Zorunlu temizlik.** `LIVE-VALIDATION.md` bölüm D — test materyalleri,
    test kullanıcıları, geçici davet kodu ve artık dosyalar silinir.
14. **Kenar katmanı ve kalanlar:** Cloudflare proxy + başlıklar (bölüm 1),
    ardından doğrulama:
    ```bash
    curl -sSI https://arsiv.sosyolab.tr | grep -iE 'strict-transport|content-security|x-frame|x-content-type|referrer|permissions'
    ```
    TLS taraması <https://www.ssllabs.com/ssltest/analyze.html?d=arsiv.sosyolab.tr>
    (hedef **A** ya da üstü), CSP ihlali olmadığının konsoldan doğrulanması,
    MFA (bölüm 5) ve zararlı yazılım taraması (bölüm 4).

### Geri dönüş

3. adım sorun çıkarırsa: `003` dosyasının sonundaki geri alma bloğu
çalıştırılır (o da tek transaction'dır). 7. adım sorun çıkarırsa: önceki
commit'e dönülüp push edilir; Pages eski `app.js`'i yeniden yayınlar.
Veritabanı ve arayüzü birbirinden bağımsız geri alabilmek bu sıranın
kazancıdır.

---

## EK A — Üretim güvenlik başlıkları: tek blok

Aşağıdaki yedi başlık `arsiv.sosyolab.tr` için üretimde **mutlaka** dönmelidir.
GitHub Pages bunların hiçbirini gönderemez; bu yüzden hepsi kenar katmanında
(Cloudflare) tanımlanır.

### A.1 Cloudflare Transform Rule — kopyala/yapıştır tablosu

Rules → Transform Rules → **Modify Response Header** → Create
Filtre: `Hostname equals arsiv.sosyolab.tr`
Her satır için *Set static* seç.

```
Content-Security-Policy
default-src 'none'; base-uri 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://ulwgkfulxqfeicjftqeb.supabase.co wss://ulwgkfulxqfeicjftqeb.supabase.co; form-action 'none'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests

Strict-Transport-Security
max-age=31536000; includeSubDomains

X-Content-Type-Options
nosniff

Referrer-Policy
strict-origin-when-cross-origin

Permissions-Policy
accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), screen-wake-lock=(), usb=(), xr-spatial-tracking=()

X-Frame-Options
DENY

Cross-Origin-Opener-Policy
same-origin
```

`frame-ancestors 'none'` yalnızca yukarıdaki **CSP başlığının** içinde
bulunur. `index.html` içindeki `<meta>` CSP'de yoktur ve olamaz —
tarayıcı `<meta>` bağlamında bu yönergeyi yok sayar. Clickjacking koruması
bu başlık devreye alınana kadar **yalnızca** `app.js` içindeki betik
kontrolüne dayanır; bu bir alt sınırdır, başlığın yerini tutmaz.

### A.2 Uygulandığını doğrula

```bash
curl -sSI https://arsiv.sosyolab.tr \
  | grep -iE 'strict-transport|content-security|x-frame|x-content-type|referrer-policy|permissions-policy|cross-origin-opener'
```

Yedi satırın **tamamı** dönmelidir. Eksik olan her satır için ilgili kabul
kriteri (AC-04) karşılanmamış sayılır.

```bash
# HTTP -> HTTPS yönlendirmesi 301/308 olmalı
curl -sSI http://arsiv.sosyolab.tr | head -1
```

### A.3 CSP ihlali olmadığını doğrula

Siteyi aç, DevTools → Console. Giriş yap, bir ders aç, arama yap, materyal
aç, "Materyal Paylaş" formunu aç. Konsolda **hiçbir** CSP ihlali satırı
olmamalı. `connect-src` ihlali görürsen Supabase alan adı iki yerde de
(başlık ve `<meta>`) güncel değildir.

---

## EK B — Davet kodu üretim geçişi: kesin adımlar

Bu geçiş `config.js` içindeki düz metin `LOCAL_INVITE_CODE` değerini
tamamen ortadan kaldırır. Sıra değiştirilemez.

### B.0 Ön koşul

```sql
-- pgcrypto "extensions" şemasında mı?
select n.nspname as sema from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pgcrypto';
```
`extensions` dönmüyorsa göç dosyası kurulumda anlaşılır bir hata verir;
o hatadaki yönlendirmeyi izleyin.

### B.1 Şemayı güncelle

SQL Editor'de **sırayla**:

1. `supabase/schema.sql` — tamamını çalıştır.
   *Neden tekrar: `profiles_rol_koru` ve `profiles_rol_varsayilan`
   fonksiyonları düzeltildi. Bu düzeltme olmadan yeni bir yönetici hesabı
   oluşturulamaz (role sessizce `user`'a düşer).*
   Yalnızca o iki fonksiyonu güncellemek yeterliyse bölüm 3'teki iki
   `create or replace function` bloğunu çalıştırmak da olur.

2. `supabase/migrations/001_davet_kodlari.sql` — tamamını çalıştır.

3. `supabase/migrations/002_denetim_kaydi.sql` — tamamını çalıştır.
   *001'den sonra çalıştırılmalı, aksi hâlde davet damgası denetimi atlanır
   (dosya bunu NOTICE ile bildirir ve hata vermez).*

4. `supabase/migrations/003_launch_gate_hardening.sql` — tamamını çalıştır.
  *001'den sonra çalıştırılmalı; `public.materials` ve `storage.objects`
  tabloları yoksa, bu tablolarda RLS açık değilse ya da
  `davet_dogrulandi_mi()`, `is_admin()`, `storage.foldername()` yoksa dosya
  en başta anlaşılır bir hata verip durur.
   Bu göç **beş** politikayı yeniden kurar (`materials_okuma`,
   `materials_gonderim`, `materyal_okuma`, `materyal_yukleme` ve yeni
   `materyal_yetim_silme`); hiçbir veriye dokunmaz.*

   **Dosya tek bir transaction'dır (`begin; … commit;`).** Bir hata olursa
   tamamı geri alınır; politika düşmüş ama yenisi kurulmamış ara durum
   oluşmaz. Bu ara durum test edildi: transaction olmadan aynı hata arşivi
   **yönetici dahil** herkese kapatıyordu (12 politika, tüm roller 0 satır);
   transaction ile hiçbir şey değişmedi (13 politika, erişim aynı).

   **UYARI — göç sırası:** 003, 001'deki `materials_gonderim` politikasını
   yeniden kurar. **003'ten sonra 001'i tekrar çalıştırırsanız** gönderimdeki
   dosya sahipliği koşulu geri alınır ve SL-09 yeniden açılır.
   `supabase/inventory.sql` B bloğu bu durumu yakalar.

5. `supabase/migrations/004_revoke_public_table_ddl_privs.sql` — tamamını çalıştır.
  *Residual hardening adımıdır: `public.denetim_kaydi` ve
  `public.davet_dogrulamalari` tablolarında `anon`/`authenticated` için
  `TRUNCATE`, `REFERENCES`, `TRIGGER` ayrıcalıklarını kaldırır.*
  *K.2 kararı Seçenek B'dir: `denetim_kaydi` için authenticated'a doğrudan
  `SELECT` grant tasarlanmaz; `denetim_okuma` politikası savunma-in-depth
  olarak kalır.*

6. `supabase/migrations/005_teacher_role.sql` — tamamını çalıştır.
  *`teacher` rolü, `teacher_courses` tablosu, öğretim elemanı için
  ders-sahipliği kontrollü doğrudan yayın akışını ekler.*

Doğrula:

```sql
select to_regprocedure('public.davet_kullan(text)')        as rpc,
       to_regclass('public.davet_dogrulamalari')           as damga_tablosu,
       to_regclass('public.denetim_kaydi')                 as denetim_tablosu;
-- Üçü de NULL olmamalı.

select polname, cmd from pg_policies
 where tablename = 'materials' and polname = 'materials_gonderim';
-- Var olmalı.
```

### B.2 İlk davet kodunu oluştur

```sql
-- 1) Tahmin edilemez bir kod üret ve ÇIKTIYI GÜVENLİ YERE AL:
select upper(encode(extensions.gen_random_bytes(10), 'hex')) as davet_kodu;

-- 2) Üretilen değeri <KOD> yerine koyup çalıştır:
insert into public.davet_kodlari (kod_ozeti, etiket, gecerlilik_sonu, azami_kullanim)
values (extensions.crypt(upper('<KOD>'), extensions.gen_salt('bf', 10)),
        '2026-2027 Güz', '2027-02-01', 300);

-- 3) Kodun gerçekten doğrulandığını sına (kod DB'de düz metin durmuyor):
select etiket, (extensions.crypt(upper('<KOD>'), kod_ozeti) = kod_ozeti) as eslesti
  from public.davet_kodlari where aktif;
-- eslesti = true olmalı.
```

Kodu öğrencilere ilet. **Bu kodu hiçbir dosyaya, commit'e ya da bu depoya
yazma.** SQL Editor geçmişini temizle.

### B.3 Sunucu modunu aç

`config.js` dosyasında:

```diff
   SUPABASE_ANON_KEY: "sb_publishable_...",

-  INVITE_MODE: "local",
-  LOCAL_INVITE_CODE: "DEMO2026"
+  INVITE_MODE: "server"
 };
```

`LOCAL_INVITE_CODE` satırı **silinir**, boş bırakılmaz. `INVITE_MODE`
`"server"` olduğunda `app.js` bu değeri hiç okumaz, ama dosyada kalması
gereksiz bir bilgi sızıntısıdır.

### B.4 Yayınla

Değişikliği `main` dalına gönder. Actions akışı yayından önce şunları
denetler: gizli anahtar taraması, satır içi betik/stil denetimi,
`vendor/supabase-js` SHA-256 doğrulaması, yayın dosya envanteri.

Yayından sonra doğrula:

```bash
curl -sS https://arsiv.sosyolab.tr/config.js | grep -i invite
# Beklenen tek satır:  INVITE_MODE: "server"
# "LOCAL_INVITE_CODE" ya da "DEMO2026" GÖRÜNMEMELİ.
```

### B.5 Retest

Temiz bir tarayıcı profilinde:

| # | Adım | Beklenen |
|---|---|---|
| 1 | 10 haneli numara + **eski** kod (`DEMO2026`) | *"Davet kodu geçersiz ya da süresi dolmuş."* Giriş **olmaz**. |
| 2 | 10 haneli numara + **yeni** kod | Giriş olur, panel açılır. |
| 3 | Konsol: `await (window.supabase.createClient(SOSYOLAB_CONFIG.SUPABASE_URL, SOSYOLAB_CONFIG.SUPABASE_ANON_KEY)).rpc('davet_kullan', {p_kod:'DEMO2026'})` | `data: false` |
| 4 | Materyal Paylaş → küçük bir PDF gönder | Başarılı. (Davet damgası gönderim iznini açtı.) |
| 5 | Yeni gizli pencere, giriş yapmadan konsol:<br>`await (window.supabase.createClient(...)).auth.signInAnonymously()` sonra `.from('materials').insert({...})` | Reddedilir (`42501`) — davet damgası olmayan anonim oturum gönderim yapamaz. |
| 6 | SQL Editor: `select kullanim_sayisi from public.davet_kodlari where etiket='2026-2027 Güz';` | Giriş yapan öğrenci sayısı kadar. |

5. adım bu geçişin **asıl kazancıdır**: önceki durumda davet kodunu hiç
bilmeyen biri anonim oturum açıp gönderim yapabiliyordu.

### B.6 Geri alma

Sorun çıkarsa: `config.js` içinde `INVITE_MODE: "local"` ve
`LOCAL_INVITE_CODE` geri eklenir, yayınlanır. Veritabanı tarafında bir şey
geri almak gerekmez — `materials_gonderim` politikası admin ve daveti
doğrulanmış kullanıcıya açık kalır, ama yeni kullanıcılar damga alamaz.
Tam geri alma için 001 dosyasının sonundaki blok kullanılır.
