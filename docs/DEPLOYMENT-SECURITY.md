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

## 11. 006 production release sırası

Bu prosedür mevcut 005 production şeması içindir. Yeni boş kurulumda önce
`schema.sql` → `001` → `002` → `003` → `004` → `005` uygulanır.
Uygulanmış eski migration dosyaları tekrar çalıştırılmaz. `inventory.sql`
yalnız POST-006 sözleşmesidir; eski PRE/POST-003 gate olarak kullanılmaz.

1. DB backup/snapshot al; Auth geri kazanım ve bakım penceresini planla.
2. **PRE-006 read-only inventory:** `supabase/pre_006_inventory.sql` çalıştır.
   Yalnız 005 ve önceki kolonlara başvurur. Toplam profil, admin/teacher/user
   sayıları, teacher/admin kimlikleri ve Auth email, canonical sos401
   atamaları, aktif legacy davetler ve seçili anonymous/provider metadata raporlanır.
3. Legacy teacher/user/sos401 sonuçlarını değerlendir ve kararını kaydet.
   Admin bulunması otomatik FAIL değildir. Teacher=0: legacy Auth migration
   **N/A**. Teacher>0: [TEACHER-SETUP.md](TEACHER-SETUP.md) uyarınca açık
   migration planı hazırlanmadan production apply edilmez; plan uygulanıp
   doğrulanmadan frontend deploy edilmez. Legacy user varsa **preserve /
   re-onboard / test hesabıysa silme planı** kararı gerekir; otomatik silme yoktur.
   sos401=0 olsa da 006 cleanup savunması uygulanır.
4. Gerçek blocker veya kararsız legacy geçiş varsa **DUR**. Auth/provider
   ayarları ve mevcut uygulama için bakım penceresi doğrulansın: 006 eski
   `davet_kullan` istemci erişimini kapatır.
5. `supabase/migrations/006_self_registration_invites.sql` uygula.
6. Kararlaştırılmış **explicit POST-006 legacy backfill** uygula. 006 sadece
   eski teacher durumunu approved yapar; username/Auth email migration yapmaz.
   Username canonical/benzersiz/rezerve olmayan, `auth_login_email` internal
   sözleşmesine uygun ve Auth ile aynı olmalıdır. Adminin mevcut takma ad
   girişi ayrı sözleşmedir; admin username eksikliği otomatik blocker değildir.
7. **POST-006 inventory:** `psql <baglanti> -v ON_ERROR_STOP=1 -v mod=POST
   -f supabase/inventory.sql`. A–G/G2/K/L **0 satır**; H/I/J bilgi amaçlıdır.
   Profiles direct INSERT policy ve anon/authenticated INSERT privilege
   **olmamalı**; SELECT/UPDATE, membership, ACL ve teacher korumaları bulunmalı.
   Ham policy/function gövdelerini depo ile karşılaştır; katalog alt dize
   kontrolü gerçek runtime veya tam gövde eşitliği kanıtı değildir.
8. SQL runtime/contract verification yap. Önce yerelde
   `pwsh -NoProfile -File scripts/runtime_006_security_test.ps1`: T01–T25
   gerçek SQL/RLS olarak PASS olmalı. Gerçek Supabase Auth/Storage/HTTP
   davranışı için [LIVE-VALIDATION.md](LIVE-VALIDATION.md) geçerlidir.
9. Registration smoke: DB 006 üzerinde yeni frontend adayını yerel/staging
   ortamda doğrula; yanlış kod membership vermez, student user/class_year olur.
10. Teacher pending smoke: user/pending, başvuru ekranı, upload/member-write
    kapalı; mevcut okuma davranışı korunur.
11. Admin approval smoke: approve → teacher/approved → ders ataması → yalnız
    atanmış derste direct publish. Reject → rejected ve upload kapalı.
12. **Frontend deploy. Frontend DB 006'dan önce deploy edilmez.**
    `.github/workflows/deploy.yml` main push ile yayın yapar; main push bir
    dağıtım işlemidir. Bu remediation turunda push/deploy yapılmaz.
13. Yayın sonrası `scripts/smoke.sh` çalıştır.
14. **4 öğrenci sınıfı + 1 teacher production invite kodunu** yalnız
    `admin_davet_kodu_olustur` RPC/helper ile oluştur (EK B). Bunlar smoke
    fixture kodları değil, operatörün güvenli ortamda ürettiği gerçek kodlardır.
15. Final UI verification yap; admin/student/teacher giriş, pending/rejected,
    dosya erişimi ve çıkış/yenileme davranışını doğrula.

Üretim smoke hesapları ve geçici kodlar ayrıca operatörce yönetilir; yerel
harness production'a bağlanmaz. Başarısız gate atlanmaz. Geri dönüş için
bakım penceresi ve snapshot/forward fix kullanılır; eski migration/anon
kayıt modeline kontrolsüz dönüş yapılmaz.

### Residual risk: username enumeration (P2, blocker değil)

`kullanici_email_bul` anon'a yalnız internal `@auth.sosyolab.local` adresini
verir; kişisel Auth email dönmez. Bilinmeyen username için deterministik
fallback, bilinen için rastgele internal email döndüğü için bu iki sonuç
karşılaştırılarak username varlığı tahmin edilebilir. UI yanlış username
ve yanlış parola için aynı `Kullanıcı adı veya parola hatalı.` mesajını verir;
bu RPC farkını ortadan kaldırmaz. Bu tur mimari yeniden yazılmaz; HMAC/server
secret tarayıcıya veya SQL kaynağına gömülmez. Platform rate limit ve izleme
operasyonel kontrol olarak ayrıca doğrulanır.

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

## EK B — 006 production davet üretim sözleşmesi

Production self-registration kodları **SADECE**
`public.admin_davet_kodu_olustur` RPC/helper prosedürüyle oluşturulur.
Doğrudan `davet_kodlari INSERT` production onboarding için kullanılmaz.
Helper 32 hex formatını (128-bit rastgelelik kapasitesi) zorunlu kılar;
operatör kodu CSPRNG ile üretmelidir. Format tek başına rastgelelik kanıtı değildir.

```sql
-- Güvenli operatör oturumu: değeri yalnız güvenli kanaldan dağıt, repoya yazma.
select upper(encode(extensions.gen_random_bytes(16), 'hex'));
-- Her sınıf için 1,2,3,4 ayrı helper çağrısı; gerçek değerleri burada saklama.
select public.admin_davet_kodu_olustur(
  '<32_HEX_KOD>', 'student', 1::smallint, 'STUDENT_GRADE_1',
  now() + interval '90 days', 200);
select public.admin_davet_kodu_olustur(
  '<32_HEX_KOD>', 'teacher', null, 'TEACHER',
  now() + interval '30 days', 50);
```

Tabloda plaintext değil tuzlu bcrypt özeti vardır. Mevcut bcrypt CHECK düz
metin saklama kazasını engeller; **plaintext kod formatını veya entropisini
hash üzerinden CHECK ile kanıtlamak mümkün değildir**. Bu yüzden sahte bir
entropy CHECK eklenmedi; helper giriş kontrolü ve operatör prosedürü zorunludur.
SQL Editor/DB owner doğrudan hash insert ile bu prosedürü aşabilir; bu
ayrıcalıklı operasyon sınırı bir residual risktir.

006 eski kayıtları `audience_type='legacy'` yapar ve eski `davet_kullan(text)`
EXECUTE'unu PUBLIC/anon/authenticated için kaldırır. Legacy kodlar yeni
student/teacher registration kodu olarak kullanılmaz. Öğrenciler username +
password + sınıf davetiyle; öğretmenler teacher daveti + ad soyadla kayıt olur.
`INVITE_MODE='server'` kullanılır, `LOCAL_INVITE_CODE` yayın yapılandırmasında
yer almaz. Email provider açık ve internal email kayıtlarında confirmation
ayarının registration akışına uygun olması gerekir.
