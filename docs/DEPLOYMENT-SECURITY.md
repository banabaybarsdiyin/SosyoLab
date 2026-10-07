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
istekleri **görmez**. Bu yüzden 006 ile birincil hız sınırı Edge Function'ın
içindedir (`giris`/`kayit` → `public.istek_siniri_tuket`, atomik DB sayacı;
bölüm 11 ve "Hız sınırı (F-01)"). Auth tarafında ek olarak:

- Supabase → Authentication → Rate Limits: `Sign in / Sign up`, `Anonymous
  sign-ins` ve `Token refresh` limitlerini bölümün gerçek kullanıcı sayısına
  göre düşürün (varsayılanlar bir bölüm için fazla cömerttir).
- Supabase → Authentication → Attack Protection: **Captcha AÇILMAZ** (006
  mimarisinde parola isteği Edge Function'dan gider; captcha token akışı bu
  depoda yoktur ve açılırsa tüm girişler reddedilir). İleride eklenirse
  token tarayıcıdan `giris`'e, oradan Auth'a taşınmalıdır.
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
- [ ] **Authentication → Sign In / Providers → "Allow new users to sign up"**:
      **KAPALI** (006 ve sonrası). Kayıt yalnız `kayit` Edge Function'ı
      üzerinden Admin API ile yapılır; public signup açık kalırsa herkes
      Auth hesabı açabilir ve confirmation kapalıyken `user_already_exists`
      farkı oluşur (bkz. bölüm 11, F-05).
- [ ] **Authentication → Providers → Anonymous sign-ins**: **KAPALI** (006
      uygulaması anonim oturum kullanmaz; açık kalırsa kimliksiz Auth hesabı
      üretilebilir).
- [ ] **Authentication → Providers → Email → Confirm email**: **AÇIK**
      bırakılması önerilir (varsayılan). Edge Function kullanıcıyı
      `email_confirm: true` ile oluşturduğu için kayıt bundan etkilenmez;
      signup yanlışlıkla açılırsa mevcut kullanıcı için yanıt maskelenir.
      Magic link/OTP, telefon ve OAuth provider'ları kapalı olmalı.
- [ ] **Authentication → Password policy**: istemci/sunucu minimumu (8
      karakter) ile aynı ya da daha gevşek olmalı; daha sıkı politika
      kayıtta tek tip `kayit_basarisiz` döndürür.
- [ ] **Edge Functions → `giris`, `kayit`**: `supabase/config.toml` ile
      (`verify_jwt = false`) deploy edilmiş, secrets ayarlı (bölüm 11 adım 6).
      Sunucu anahtarları (secret key / legacy service_role) yalnız Edge
      Function ortamında bulunur; tarayıcıya, repoya, CI'ya girmez.
- [ ] **Project Settings → API Keys → Secret keys**: en az bir **secret key**
      (`sb_secret_…`, adı `default`) mevcut. Edge ortamına
      `SUPABASE_SECRET_KEYS` olarak platform enjekte eder. `Sb-Forwarded-For`
      YALNIZ secret key ile çalışır; publishable ve legacy anon/service_role
      anahtarlar desteklenmez (Supabase "Rate limits" belgesi).
- [ ] **Authentication → Rate Limits → IP Address Forwarding**: **AÇIK**.
      Kapalıysa Auth, `giris` isteklerini fonksiyonun çıkış IP'sine yazar ve
      sign-in limiti (varsayılan 5 dakikada 30) tüm kullanıcılar için ortak
      tükenir (F-01).
- [ ] **Authentication → Rate Limits → Sign-ups and sign-ins**: kampüs
      NAT'ı arkasında aynı IP'den aynı anda giriş yapacak öğrenci sayısını
      karşılayacak değer (Edge IP limiti `RL_GIRIS_IP` ile uyumlu).
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

> **Mevcut SosyoLab production'ı bu yolu KULLANMAZ.** Production'a 006'nın
> eski bir sürümü uygulanmış bulundu (PRE-FLIGHT: anon'a açık
> `kullanici_email_bul`, `kod_arama_ozeti` yok). O durum için yalnız
> **bölüm 12 (OLD-006 PRODUCTION RECONCILIATION, migration 007)** geçerlidir.
> Bu bölüm 005 durumundaki ya da boş kurulumlar içindir (006 sonrası 007
> idempotent no-op'tur).

Bu prosedür mevcut 005 production şeması içindir. Yeni boş kurulumda önce
`schema.sql` → `001` → `002` → `003` → `004` → `005` uygulanır.
Uygulanmış eski migration dosyaları tekrar çalıştırılmaz. `inventory.sql`
yalnız POST-006 sözleşmesidir; eski PRE/POST-003 gate olarak kullanılmaz.

006 ile giriş ve kayıt **server-side Auth sınırına** taşınır: Edge Function
`giris` (kullanıcı adı + parola → oturum) ve `kayit` (davetli kayıt). Public
Auth signup ve anonymous sign-in kapatılır. Bu üç parça (DB 006, Edge
Functions, Auth ayarları) tek bakım penceresinde ve frontend'den ÖNCE
tamamlanır.

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
   `davet_kullan` istemci erişimini kapatır; eski frontend kayıt/giriş
   akışları 006 sonrası çalışmaz.
5. `supabase/migrations/006_self_registration_invites.sql` uygula. Ön koşul
   olarak `service_role` rolü ve pgcrypto (`crypt`, `gen_salt`, `hmac`,
   `gen_random_bytes`) bulunmalıdır; yoksa migration durur.
6. **Edge Functions deploy** (Supabase CLI, güvenli operatör ortamı):

   ```bash
   # verify_jwt=false supabase/config.toml'dan gelir (bayrağa bağlı değil).
   supabase functions deploy giris
   supabase functions deploy kayit
   supabase secrets set ALLOWED_ORIGINS=https://arsiv.sosyolab.tr
   supabase secrets set ADMIN_LOGIN_EMAIL=<yönetici Auth email adresi>
   # İsteğe bağlı (varsayılanlar 1000 / 2500 ms):
   supabase secrets set LOGIN_FLOOR_MS=1000 REGISTER_FLOOR_MS=2500
   # İsteğe bağlı hız sınırları "limit/pencere_saniye" (varsayılanlar):
   #   RL_GIRIS_IP_AD=10/900  RL_GIRIS_IP=200/900  RL_GIRIS_AD=50/3600  RL_KAYIT_IP=60/3600
   # CLIENT_IP_HEADER yalnız LIVE-VALIDATION G7 sonucu değiştirilir
   # (varsayılan x-forwarded-for, ilk değer).
   ```

   Platform enjekte eder (elle yazılmaz): `SUPABASE_URL`,
   `SUPABASE_SECRET_KEYS` (secret key JSON'u; `default` adı kullanılır,
   farklıysa `AUTH_SECRET_KEY_NAME`), legacy `SUPABASE_ANON_KEY` /
   `SUPABASE_SERVICE_ROLE_KEY`. Repoya, belgeye, CI'ya veya tarayıcıya hiçbir
   gerçek anahtar girmez. **`AUTH_IP_FORWARDING` varsayılanı `required`:**
   secret key yoksa fonksiyon başlamaz (fail-closed); Auth'un fonksiyon
   IP'sinde birleşen limitine sessizce dönülmez. `AUTH_IP_FORWARDING=disabled`
   yalnız yazılı operatör kararıyla ve residual risk kabulüyle kullanılır.
   Sunucu RPC'leri secret key varsa onunla, yoksa legacy service_role ile
   yapılır. verify_jwt=false gerekir: fonksiyonlar oturum öncesi çağrılır ve
   publishable key JWT değildir; yetki sınırı fonksiyonun kendisi (Origin,
   hız sınırı) + service_role-only RPC'lerdir. **`supabase config push`
   kullanılmaz** (config.toml yalnız fonksiyon ayarı içerir).
7. **Auth ayarları** (bölüm 8): "Allow new users to sign up" **KAPALI**,
   Anonymous sign-ins **KAPALI**, magic link/OTP/telefon/OAuth kapalı, Confirm
   email açık (önerilen), password policy ≤ 8 karakter minimum, **IP Address
   Forwarding AÇIK**, Captcha kapalı. Değerler LIVE-VALIDATION G1'de
   Management API ile salt-okunur doğrulanır.
8. Kararlaştırılmış **explicit POST-006 legacy backfill** uygula. 006 sadece
   eski teacher durumunu approved yapar; username/Auth email migration yapmaz.
   Username canonical/benzersiz/rezerve olmayan, `auth_login_email` canonical
   (`u.<UUIDv4 hex>@auth.sosyolab.local`) ve Auth email ile **aynı** olmalıdır
   (Auth tarafı Admin API ile değiştirilir). Admin, `ADMIN_LOGIN_EMAIL` ile
   eşlenen takma ad girişini kullanır; admin username eksikliği blocker değildir.
9. **POST-006 inventory:** `psql <baglanti> -v ON_ERROR_STOP=1 -v mod=POST
   -f supabase/inventory.sql`. A–G/G2/K/L **0 satır**; H/I/J bilgi amaçlıdır.
   `kullanici_email_bul`, `kayit_on_kontrol`, `kullanici_kaydi_tamamla`
   yalnız service_role EXECUTE'a sahip olmalı (anon/authenticated/PUBLIC yok).
   Ham policy/function gövdelerini depo ile karşılaştır; katalog alt dize
   kontrolü gerçek runtime veya tam gövde eşitliği kanıtı değildir.
10. SQL runtime/contract verification: önce yerelde
    `pwsh -NoProfile -File scripts/runtime_006_security_test.ps1` (T01–T53 +
    teacher contract PASS) ve `node scripts/regression_edge_config_test.js`.
    Ardından [LIVE-VALIDATION.md](LIVE-VALIDATION.md) "Server-side Auth
    sınırı" **G1–G10 PASS/FAIL kapıları** — önce staging projede, sonra
    production'da frontend deploy'dan ÖNCE. Tek bir FAIL frontend deploy'u
    durdurur.
11. Registration smoke (`kayit` üzerinden): yanlış kod membership ve Auth
    hesabı vermez; student user/class_year olur; Auth Users listesinde
    profilsiz yeni hesap kalmaz.
12. Teacher pending smoke: user/pending, başvuru ekranı, upload/member-write
    kapalı; mevcut okuma davranışı korunur.
13. Admin approval smoke: approve → teacher/approved → ders ataması → yalnız
    atanmış derste direct publish. Reject → rejected ve upload kapalı.
14. **Frontend deploy. Frontend; DB 006, Edge Functions ve Auth ayarlarından
    önce deploy edilmez.** `.github/workflows/deploy.yml` main push ile yayın
    yapar; main push bir dağıtım işlemidir. Bu remediation turunda push/deploy
    yapılmaz.
15. Yayın sonrası `scripts/smoke.sh` çalıştır.
16. **4 öğrenci sınıfı + 1 teacher production invite kodunu** yalnız
    `admin_davet_kodu_olustur` RPC/helper ile oluştur (EK B). Bunlar smoke
    fixture kodları değil, operatörün güvenli ortamda ürettiği gerçek kodlardır.
    006 migration'ı arama özeti (`kod_arama_ozeti`) olmayan aktif
    student/teacher kodlarını pasife alır (NOTICE); hash'ten düz metin
    üretilemediği için dönüştürülmez — bunlar için de yeni kod üretilir.
17. Final UI verification yap; admin/student/teacher giriş, pending/rejected,
    dosya erişimi ve çıkış/yenileme davranışını doğrula.

Üretim smoke hesapları ve geçici kodlar ayrıca operatörce yönetilir; yerel
harness production'a bağlanmaz. Başarısız gate atlanmaz.

**Geri dönüş sırası.** (a) Frontend deploy edilmeden bir adım başarısızsa:
Edge Function'lar forward-fix edilir; frontend eski hâlde kalır, bakım
penceresi sürer. (b) Frontend sonrası sorun: önce bakım moduna al, frontend'i
önceki commit'e döndür, Edge Function'ları forward-fix et veya snapshot'tan
DB'yi geri yükle (bakım penceresinde, Auth ile tutarlı). **Public signup veya
anonymous sign-in geri dönüş aracı olarak yeniden açılmaz** — açılması F-05
oracle'ını ve kimliksiz Auth hesabı üretimini geri getirir. `login_pepper`
geri dönüşte de değiştirilmez. Eski migration/anon kayıt modeline kontrolsüz
dönüş yapılmaz.

**Profilsiz Auth hesabı temizliği.** Kayıt telafisi (Admin API silme)
başarısız olursa, kesinleştirme RPC'si hata verirse veya fonksiyon yarıda
kesilirse profilsiz, erişimsiz ve
kimliği hiç istemciye dönmemiş bir Auth hesabı kalabilir (`kayit_telafi_basarisiz`
/ `kayit_durumu_belirsiz` logları). Operatör düzenli olarak listeler ve
Admin API ile siler (SQL'den `auth.users` silinmez):

```sql
select u.id, u.created_at
  from auth.users u
  left join public.profiles p on p.id = u.id
 where p.id is null
   and u.email like 'u.%@auth.sosyolab.local'
   and u.created_at < now() - interval '1 hour';
```

### Username enumeration (F-05): server-side Auth sınırı

**Kök neden (önceki tasarım).** Supabase Auth parola girişi yalnız email
kabul eder; iç kimlik rastgele olduğu için tarayıcı önce RPC ile
`kullanıcı adı → email` çözüyordu. Pepper'lı fallback RPC yanıtını eşitlese
de tarayıcı bu email'i öğreniyordu; confirmation kapalıyken Auth `signUp`
kayıtlı email için `user_already_exists` döndürdüğünden RPC + signUp
birleşimi hesap varlığını yeniden ortaya çıkarıyordu. Tarayıcı iç kimliği
bildiği ve Auth uç noktalarına doğrudan erişebildiği sürece bu kapatılamaz.

**Güvenlik sözleşmesi (doğru kapsam):**

> Oturum açmamış / kimlik doğrulaması öncesi istemci, RPC, Edge Function,
> Supabase Auth uç noktası veya bunların birleşimiyle bir kullanıcı adının ya
> da başka bir hesabın iç Auth kimliğinin (`u.<UUIDv4 hex>@auth.sosyolab.local`)
> varlığını güvenilir biçimde öğrenemez.

Kapsam dışı (bilinçli): giriş yapmış kullanıcı **kendi** iç email'ini kendi
access token'ındaki `email` claim'inde ve supabase-js oturum nesnesinde
görür; bu Supabase Auth'un doğasıdır ve yalnız kendi parolasını bilen
kişiye kendi kimliğini verir. Uygulama bu değeri hiçbir yerde istemez ve
`profiles.auth_login_email` istemci SELECT'ine kapalıdır (F-04; admin dahil
— kolon yetkisi authenticated rolünde yoktur).

**006 mimarisi:**

- `kullanici_email_bul`, `kayit_on_kontrol`, `kullanici_kaydi_tamamla`,
  `kayit_sonucunu_kesinlestir`, `istek_siniri_tuket` yalnız **service_role**
  (Edge Function) tarafından çağrılabilir. Giriş/kayıt yanıtlarında email
  yoktur. Kimlikler 122-bit rastgele olduğu için tahmin edilemez;
  saldırganın Auth `signup`/`token`/`otp` uç noktalarına soracağı bir kimliği
  yoktur.
- **Public signup kapalı:** `/auth/v1/signup` her email için aynı
  `signup_disabled` hatasını, kullanıcı aramasından önce döndürür. Auth
  kullanıcısını yalnız `kayit`, Admin API ile, geçerli davet ön kontrolünden
  sonra oluşturur.
- **`giris`:** kullanıcı adını canonicalize eder; önce hız sınırı (aşağıda),
  sonra iç kimliği server-side çözer (olmayan ad için de hiçbir hesaba ait
  olmayan canonical kimlik), Auth parola doğrulamasını her istekte aynen
  yaptırır. Başarısızlık her durumda aynı
  `401 {"ok":false,"hata":"giris_basarisiz"}` (aynı başlıklar); Auth'un hata
  kodu yansıtılmaz. Tüm yanıtlar `LOGIN_FLOOR_MS` tabanına kadar bekletilir
  (taban aşılırsa `giris_taban_asildi` logu — tabanı yükseltin). Başarıda
  yalnız oturum token'ları döner.
- **`kayit`:** (0) IP hız sınırı. (1) `kayit_on_kontrol` — geçersiz/dolmuş/
  tükenmiş kod veya alınmış ad için Auth kullanıcısı hiç oluşturulmaz; kod
  geçersizken ad durumu sonucu değiştirmez. (2) Admin API ile rastgele
  canonical kimlik, `email_confirm: true`. (3) `kullanici_kaydi_tamamla` tek
  transaction'da davet tüketimi + damga + profil. (4) Sonuç bilinmiyorsa
  `kayit_sonucunu_kesinlestir`: tamamla ile **aynı advisory lock**'u alır,
  süren bir tamamla bitene kadar bekler; profil varsa `tamam` (yanıt
  kaybolmuş, başarı), yoksa iptal damgası (`sosyolab_private.kayit_iptalleri`)
  yazar ve `iptal` döner — bundan sonra gecikmiş bir tamamla bu kullanıcı
  için reddedilir. (5) Yalnız `iptal` sonrası Auth kullanıcısı Admin API ile
  silinir; kesinleştirme hata verirse silme yapılmaz ve temizlik sorgusu
  devreye girer. Böylece "commit sürerken profil görünmedi → sil → cascade +
  davet kotası bir eksik" penceresi (F-06) kapanır.
- Pepper'lı canonical fallback ve canonical CHECK korunur. `login_pepper`
  **rotate edilmez**.

### Hız sınırı (F-01)

- **Katman A — Edge Function + DB sayacı:** `public.istek_siniri_tuket`
  (`sosyolab_private.istek_sayaclari`), sabit pencere, atomik
  `INSERT … ON CONFLICT DO UPDATE` sayacı. Kovalar sırayla değerlendirilir ve
  ilk aşılan kovada durulur (reddedilen istek sonraki kovaları artırmaz).
  - `giris`: (istemci IP, kullanıcı adı) `RL_GIRIS_IP_AD` → (istemci IP)
    `RL_GIRIS_IP` → (kullanıcı adı, tüm IP'ler) `RL_GIRIS_AD`.
  - `kayit`: (istemci IP) `RL_KAYIT_IP`, ön kontrol ve Admin API'den önce.
  - Karar hesap varlığına hiç bakmaz: var olan ve olmayan ad aynı sayaç
    dizisini ve aynı `429 {"ok":false,"hata":"cok_fazla_istek"}` yanıtını
    görür (başarılı giriş de sayılır; sıfırlama yok → doğru parola 429'da
    ayırt edilemez). Limiter hatası → `503 gecici_hata`, Auth'a gidilmez
    (fail-closed).
  - Ham IP/kullanıcı adı saklanmaz: anahtar pepper'lı HMAC'tır; süresi dolan
    pencereler her çağrıda partiyle silinir (TTL).
  - İstemci IP'si yalnız `CLIENT_IP_HEADER` başlığından (varsayılan
    `x-forwarded-for`, ilk değer) okunur; diğer başlıklar yok sayılır.
    Geçersiz/eksik değer tek ortak `bilinmeyen` kovasına düşer (sınır
    kalkmaz). IPv6 /64 önekiyle, IPv4-mapped IPv6 IPv4 olarak sayılır.
    Gateway'in bu başlığı istemci değeriyle ezdiği LIVE-VALIDATION G7'de
    kanıtlanır.
- **Katman B — Auth IP atfı:** parola isteği `Sb-Forwarded-For: <istemci IP>`
  ve **secret key** ile gönderilir (publishable / legacy anahtarlarla
  desteklenmez; Dashboard'da IP Address Forwarding açık olmalı). Böylece
  Auth'un IP limiti fonksiyon çıkış IP'sinde birleşmez ve tek saldırgan tüm
  kullanıcıları kilitleyemez. Secret key yoksa fonksiyon başlamaz
  (`AUTH_IP_FORWARDING=required`, varsayılan).

### Davet araması (F-02)

`kod_arama_ozeti = HMAC-SHA256(sunucu pepper'ı, 'davet:v1:' || UPPER(kod))`,
benzersiz kısmi indeks. Ön kontrol ve tüketim tek HMAC + indeksli eşitlik
yapar; aktif kod sayısından bağımsızdır ve istek başına bcrypt çalışmaz
(T52: 0 `crypt()` çağrısı). Pepper `sosyolab_private.sunucu_pepperlari`'nda,
istemcilere ve doğrudan service_role'e kapalıdır; özet tarayıcıda
hesaplanamaz. Düz metin saklanmaz/loglanmaz; bcrypt `kod_ozeti` 001
uyumluluğu için yazılmaya devam eder. Aktif student/teacher kodunda arama
özeti CHECK ile zorunludur.

**Residual:**

- **Geçerli davet kodu sahibi** kayıt denemesiyle bir kullanıcı adının
  alınmış olduğunu öğrenebilir (benzersiz, kullanıcı seçimli ad ile kayıt
  doğası gereği). Davetsiz istemci için yanıt aynıdır. Davet kodları 128-bit,
  süreli ve kotalıdır; başarısız denemeler davet tüketmez; denemeler IP
  başına sınırlıdır.
- **Hedefli hesap kilidi:** `RL_GIRIS_AD` (varsayılan saatte 50) farklı
  IP'lerden bir kullanıcı adına deneme yapan saldırganın o hesabı pencere
  boyunca kilitlemesine izin verir (dağıtık parola denemesine karşı bilinçli
  ödünleşim; tek IP en çok `RL_GIRIS_IP_AD` kadar katkı yapabilir).
- **Kampüs NAT'ı:** aynı IP arkasındaki kullanıcılar `RL_GIRIS_IP` ve Auth
  sign-in limitini paylaşır; değerler bölüm sayısına göre ayarlanır.
- **İstemci IP başlığı:** güvenilirliği hosted gateway davranışına bağlıdır
  (G7). Başlık sahtelenebilir çıkarsa (IP+ad) kovası atlanabilir; (ad)
  kovası yine de hesap başına denemeyi sınırlar. G7 FAIL ise release durur.
- GoTrue davranışı (signup kapalıyken tek tip red, bcrypt yalnız var olan
  hesapta, `Sb-Forwarded-For`) yerelde **model/adaptör sözleşmesi** ile test
  edildi; hosted kanıt değildir, LIVE-VALIDATION G1–G10 ile doğrulanır.

---

## 12. OLD-006 PRODUCTION RECONCILIATION (migration 007)

### Neden ayrı bir yol

Canlı PRE-FLIGHT, production'ın 005'te değil **eski bir 006** sürümünde
olduğunu gösterdi:

- `kullanici_email_bul(text)` anon/authenticated'a açık;
- istemci oturumuyla çalışan `kullanici_kaydi_tamamla(text,text,text)` ve
  `kayit_icin_davet_kodu_kullan(text)` mevcut;
- `kod_arama_ozeti`, `sosyolab_private`, hız sınırı ve kesinleştirme yok;
- `authenticated`, `profiles.auth_login_email` SELECT/UPDATE yetkisine sahip;
- `supabase_migrations.schema_migrations` yok.

İmza, ACL ve kolon parmak izi git `c1f3068` ve `a0e4931` 006 sürümlerinin
ikisiyle de birebir uyuşuyor (001–005 o tarihten beri değişmedi). Sağlanan
fonksiyon MD5'leri hiçbir commit'in gövdesiyle (LF/CRLF/trim varyantları)
eşleşmedi; hesaplama yöntemi bilinmediği için kanıt olarak kullanılmadı.
007 iki sürümü de desteklenen başlangıç durumu sayar.

**006 production'da yeniden çalıştırılmaz ve değiştirilmez.** 006 temiz
kurulum migration'ıdır. 007 = eski 006 → final 006 (860b278) DB durumu.

### 007 sözleşmesi

- **Bölüm 0 — fail-closed ön koşullar.** Yalnız iki durum kabul edilir:
  `eski_006` (eski imzalar var, final nesnelerin hiçbiri yok) ve `final_006`
  (final nesnelerin tamamı var; idempotent tekrar). Aşağıdakilerin her biri
  RAISE + tam rollback'tir:
  - 005 durumu (006 kolonları yok)
  - kısmi/karışık durum (ör. yarım `sosyolab_private`, tek bir final fonksiyon)
  - beklenmeyen overload
  - `auth.users` üzerinde internal olmayan trigger
  - Auth'suz profil
  - canonical olmayan `auth_login_email` (eski 006 CHECK'i `ad@auth.sosyolab.local` biçimine izin veriyordu)
  - geçersiz/rezerve username
  - role/teacher_status/class_year tutarsızlığı
  - beklenmeyen davet yapısı

  Satır sayısı (16/15) şart koşulmaz; yapısal invariant'lar kontrol edilir.
- **Bölüm 1–7 — final 006 gövdesinin birebir kopyası.** Paralel tasarım
  yoktur. `scripts/regression_007_reconciliation_test.js` byte eşitliğini
  denetler. Eski imzalar `drop function if exists` ile kaldırılır, final
  RPC'ler, pepper'lar (`on conflict do nothing` — final durumda rotate
  edilmez), hız sınırı, HMAC davet araması, kolon yetkileri ve politikalar
  kurulur. Arama özeti olmayan **aktif** student/teacher kodu pasife alınır
  (silinmez). Production'da yalnız 1 pasif legacy kod vardır; o olduğu gibi
  kalır.
- **Bölüm 9 — fail-closed son koşullar.** Satır sayıları korunur
  (`profiles`, `auth.users`, `davet_kodlari`, `davet_dogrulamalari`,
  `materials`, sos401 dışı atamalar, username'siz profil, profilsiz Auth).
  Eski imzalar yoktur. Sunucu RPC'lerinde PUBLIC/anon/authenticated
  EXECUTE yok, service_role EXECUTE var; iç helper'lar istemcilere kapalıdır.
  `auth_login_email` SELECT ve tablo düzeyi SELECT authenticated için kapalı,
  uygulamanın okuduğu kolonlar açık; profiles INSERT kapalı.
  `sosyolab_private` hiçbir API rolüne açık değil. Pepper satırları tam ve
  final durumda değişmemiş. Özet index'i ve CHECK'i mevcut, üyelik
  politikaları `uye_profili_var_mi()` içeriyor. Herhangi biri → RAISE, tam
  rollback.
- Fonksiyon yetkileri hiçbir default privilege'a dayanmaz (production'da
  service_role'e otomatik fonksiyon grant'i yoktur).
- **Kapsam dışı (bilinçli):** legacy kimlik backfill'i ve profilsiz Auth
  hesabı. 007 ikisine de dokunmaz.

Yerel kanıt: `node scripts/runtime_007_drift_test.js` ve
`node scripts/regression_007_reconciliation_test.js` (bkz. LIVE-VALIDATION).

### Production sırası (mevcut SosyoLab)

Herhangi bir adımda beklenmeyen sonuç → **DUR**; sonraki adıma geçilmez.

1. **Bakım penceresi.** 007 sonrası eski frontend'in giriş/kayıt akışı
   fail-closed kırılır (resolver ve eski RPC'ler kapanır). Kullanıcılar
   bilgilendirilir; frontend bu süre boyunca değiştirilmez.
2. **Snapshot / backup** (Dashboard → Database → Backups veya PITR noktası
   kaydı). Geri dönüş yalnız bu snapshot'tan, bakım penceresi içinde yapılır.
3. **PRE fingerprint (salt okuma):**
   `psql <baglanti> -v ON_ERROR_STOP=1 -f supabase/pre_007_fingerprint.sql`.
   `durum = eski_006` ve tüm `engel_*` = 0 olmalı. `DESTEKLENMIYOR` ya da
   `engel_*` > 0 → **DUR**, 007 uygulanmaz, bulgu raporlanır.
4. **007 transaction:**
   `psql <baglanti> -v ON_ERROR_STOP=1 -f supabase/migrations/007_production_006_reconciliation.sql`.
   NOTICE'ta `007 başlangıç durumu: eski_006` ve `007 tamam` görülmeli.
   Hata → transaction geri alınmıştır; **DUR**. `supabase db push`
   **kullanılmaz** (migration geçmişi yok; push 001'den başlamaya çalışır).
5. **POST inventory:**
   `psql <baglanti> -v ON_ERROR_STOP=1 -v mod=POST -f supabase/inventory.sql`
   → A–G/G2/K/L 0 satır. Ayrıca `pre_007_fingerprint.sql` artık
   `durum = final_006` vermeli.
6. **Operatör legacy kullanıcı backfill'i** (hesap başına, otomatik değil):
   - `psql … -f supabase/legacy_identity_inventory.sql` salt-okunur
     envanteri verir. Email, ad soyad, öğrenci no ve tam UUID yazdırmaz;
     8 haneli kısa önek ve email sınıfı kullanır. Profil başına aksiyon:
     preserve (backfill) / re-onboard / test hesabı silme.
   - Preserve kararı için: kullanıcıyla canonical, benzersiz, rezerve
     olmayan bir username kararlaştırılır. Yeni canonical iç kimlik üretilir
     (`'u.' || replace(gen_random_uuid()::text,'-','') || '@auth.sosyolab.local'`)
     ve Auth email'i **Admin API** ile bu değere çekilir (SQL'den
     `auth.users` güncellenmez). Gerekirse parola güvenli kanaldan
     yeniden belirlenir.
   - Ardından: `psql … -v profil_id=<UUID> -v kullanici_adi=<ad>
     -v giris_kimligi=<kimlik> -f supabase/legacy_user_backfill.sql`.
     Şablon tek transaction'dır ve dolu kimliğin üzerine yazmaz. Alınmış /
     rezerve / canonical olmayan adı, canonical olmayan kimliği, başka
     profildeki kimliği, Admin API adımı yapılmamış hesabı ve anonim hesabı
     reddeder; sonunda resolver'ın yeni kimliği döndürdüğünü doğrular.
   - Admin hesabı `ADMIN_LOGIN_EMAIL` takma adıyla girer; admin için
     backfill opsiyoneldir.
   - Davet damgası olmayan preserve hesabı, arşive erişim için ayrıca
     operatör kararı gerektirir. Envanterde `davet_damgasi` sütununa bakılır.
   - Belirsiz kalan hesap → o hesap için DUR, kararı kaydet. Diğer hesaplar
     ve release, karar kaydedilene kadar bekler.
7. **Profilsiz Auth (orphan) incelemesi.** Envanterin C bölümü bu hesabı
   sınıflandırır: anonim / yarım kayıt / diğer. 007 hesabı korur; final RLS
   profil üyeliği istediği için giriş, okuma ve yükleme yapamaz
   (`runtime_007_drift_test` (15)). Silme yalnız açık operatör kararıyla ve
   **Admin API** ile yapılır. Anonim kalıntı, anonymous sign-in kapatıldıktan
   (adım 9) sonra silinebilir. Gerçek bir kullanıcıysa `kayit` ile yeniden
   onboard edilir.
8. **Edge Functions:** bölüm 11 adım 6'daki gibi (`config.toml`,
   `verify_jwt=false`, secrets; `AUTH_IP_FORWARDING=required`).
9. **Auth ayarları:** bölüm 8 / bölüm 11 adım 7. Public signup KAPALI,
   anonymous sign-in KAPALI, IP Address Forwarding AÇIK.
10. **LIVE-VALIDATION G1–G10** (sentetik hesap ve kodla). Tek bir FAIL
    frontend'i durdurur. G7, G8'in IP-B kontrolüyle birlikte; G9 pozitif
    kontrolle (`select=username` → 200) değerlendirilir.
11. **Frontend release** (main merge = deploy). Yalnız 1–10 PASS ise.
    Ardından `scripts/smoke.sh`, EK B ile production davet kodları ve final
    UI doğrulaması.
12. **Migration geçmişi uzlaştırması** (aşağıda). Yalnız 1–11 tamamlandıktan
    ve şema final durumla eşleştikten sonra.

**Geri dönüş.** 4. adımda hata → otomatik rollback; production değişmemiştir.
5–10 arasında FAIL → frontend eski hâlinde kalır, bakım penceresi sürer;
forward-fix edilir ya da snapshot'tan geri yüklenir. Public signup veya
anonymous sign-in geri dönüş aracı olarak **açılmaz**.

### Migration geçmişi uzlaştırma planı (UYGULANMADI — gelecek adım)

Production'da `supabase_migrations.schema_migrations` yoktur. Repo sürümleri
dosya adının sayısal önekidir: `001`, `002`, `003`, `004`, `005`, `006`,
`007`. Bu sürümler geçmişe yalnız **şema 007 sonrası final duruma eşit ve
adım 1–11 PASS iken** "applied" olarak işlenir. 006 burada "final 006
durumu 007 ile sağlandı" anlamına gelir: 006 dosyası production'da hiç
çalıştırılmaz.

```bash
# Güvenli operatör ortamı; token/parola komut satırına yazılmaz.
supabase link --project-ref <REF>
supabase migration list                    # beklenen: local 001..007, remote boş
pwsh -NoProfile -File scripts/runtime_006_security_test.ps1   # yerel kanıt tekrar
psql <baglanti> -v ON_ERROR_STOP=1 -f supabase/pre_007_fingerprint.sql   # durum = final_006
supabase migration repair --status applied 001 002 003 004 005 006 007
supabase migration list                    # beklenen: 001..007 local = remote
```

- `migration repair` yalnız geçmiş satırı yazar, SQL çalıştırmaz.
  **`supabase db push` hiçbir aşamada geçmiş onarılmadan çalıştırılmaz.**
  Aksi halde 001'den itibaren yeniden uygulamaya çalışır.
- `pre_007_fingerprint.sql` `final_006` dışında bir şey veriyorsa repair
  **yapılmaz**.
- Sonraki her migration (`008…`) normal CLI akışıyla, önce staging'de
  uygulanır.

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
