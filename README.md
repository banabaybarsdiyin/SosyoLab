# SosyoLab

Erciyes Üniversitesi Edebiyat Fakültesi Sosyoloji Bölümü ders materyali arşivi.
2026–2027 Güz dönemi ders programı üzerine kurulu, tek dosyalık statik web uygulaması.

## Yapı

- `index.html` — uygulamanın tamamı (HTML, CSS, JS tek dosyada; derleme adımı yok)
- `404.html` — hatalı adresler için
- `.nojekyll` — GitHub Pages'in Jekyll işlemesini atlaması için
- `.github/workflows/deploy.yml` — `main` dalına her push'ta otomatik yayın

## Geliştirme

Kurulum gerekmez. Dosyayı tarayıcıda açmak yeterli, ya da:

```
python3 -m http.server 8000
```

## Bu sürüm bir gösteri sürümüdür

### Tek giriş formu, iki rol

Giriş ekranında tek bir form vardır. Girilen kimliğe göre yönlendirme yapılır:

- **Öğrenci** — 10 haneli öğrenci numarası + davet kodu. Arşivi görüntüler,
  arama yapar, favori ekler, materyal gönderir.
- **Yönetici** — `sosyolog35` kullanıcı adı + parola. Yukarıdakilere ek olarak
  gönderileri onaylar, reddeder ve materyal yönetir.

Yönetici girişinde parola tarayıcıda hiçbir şeyle karşılaştırılmaz. Takma ad
`sosyolog.35@sosyolab.local` adresine eşlenir, doğrulama Supabase Auth'ta
yapılır ve yetki yalnızca `public.profiles.role = 'admin'` satırından gelir.
Zincirin herhangi bir halkası kopuyorsa giriş reddedilir.

Öğrenci demo bilgileri kaynak koddaki `KAYITLI` ve `KOD` sabitlerindedir ve
bilerek sahtedir. Gerçek yönetici parolası kaynak koda hiç girmez; yalnızca
Supabase Auth içinde bulunur.

### Giriş gerçek kimlik doğrulama değildir

Supabase yapılandırılmamışken (demo modu) uygulama yalnızca arayüz gösterimi
yapar: davet kodu tarayıcıda karşılaştırılır, yönetici girişi tamamen kapalıdır
ve materyal gönderimi çalışmaz. Bu modda:

- Demo modundaki giriş ekranı bir erişim kısıtı değil, bir gösterimdir.
- Kaynak koddaki `KAYITLI`, `KOD` ve `ADMIN` değerleri kurgusaldır ve sır
  değildir.
- Supabase bağlıyken durum farklıdır: rol sunucudaki profil satırından okunur,
  yerel depodaki bayat bir `admin` kaydı yönetim arayüzünü açamaz ve her veri
  işlemi RLS politikalarından geçer.
- Roller: `ogrenci` (varsayılan) ve `admin`. Depodan gelen tanınmayan her rol
  değeri en düşük yetkiye düşürülür, asla admin'e yükseltilmez.
- **Gerçek öğrenci numarası, gerçek ad veya bölümün gerçek davet kodu bu
  depoya yazılmamalıdır.** Gerçek kayıt listesi ancak bir sunucuda tutulabilir.

### Gömülü veri kurgusaldır

Uygulamanın içindeki örnek materyallerin tamamı kurgusaldır; hiçbiri gerçek bir
ders materyaline, dosyaya ya da sınav evrakına karşılık gelmez. Öğrenci kayıtları
da kurgusaldır. Öğretim elemanı adları bu herkese açık sürümde nötr etiketlerle
(Öğretim Elemanı A, B, C …) değiştirilmiştir; ders kodları ve adları gerçektir.

### Veri paylaşılmaz

Eklenen materyaller `localStorage` üzerinde, yalnızca ekleyen kişinin kendi
tarayıcısında saklanır. Başka bir öğrenci göremez. Ortak arşiv için sunucu
gerekir.

### Materyal bağlantıları

Materyal bağlantısı olarak yalnızca `http` ve `https` adresleri kabul edilir.
`javascript:` ve `data:` gibi şemalar kaydedilmez ve çizilmez; bu şemalar
tıklandığında sayfa bağlamında kod çalıştırabilir. Dış bağlantılar
`rel="noopener noreferrer"` ile açılır.

### `noindex` bir güvenlik önlemi değildir

`index.html` içindeki `robots: noindex, nofollow` etiketi yalnızca arama
motorlarında listelenmeyi engeller. Sayfa herkese açıktır; adresi bilen herkes
açabilir. Görünürlük ayarıdır, erişim denetimi değildir.

## Gerçek kullanım için gerekenler

- Sunucu tarafında kimlik doğrulama (ör. Supabase Auth), kayıtlı öğrenci listesi
  ve sunucuda doğrulanan admin rolü
- Ortak veritabanı ve dosya depolama
- Yetki kuralları (kimin ekleyebildiği, kimin silebildiği)

## Supabase kurulumu

Uygulama `config.js` boşken **demo modunda** çalışır: örnek materyaller görünür,
gönderim ve onay akışı kapalıdır. Paylaşımlı arşivi açmak için:

1. **Proje oluştur** — supabase.com → New project. Bölge olarak Frankfurt (eu-central-1)
   Türkiye'ye en yakın seçenektir.

2. **Şemayı kur** — Dashboard → SQL Editor → `supabase/schema.sql` dosyasının
   tamamını yapıştırıp çalıştır. Bu dosya tabloları, kısıtları, RLS politikalarını
   ve depolama kovasını oluşturur.

3. **Anonim girişi aç** — Authentication → Providers → Anonymous Sign-Ins → enable.
   Öğrenci gönderimleri anonim oturumla yapılır; her gönderinin yine de kendi
   `auth.uid()` kimliği olur ve RLS bu kimliğe göre çalışır.

4. **Admin hesabı aç** — Authentication → Users → Add user:
   - E-posta: `sosyolog.35@sosyolab.local`
   - Parola: güçlü bir parola üret, **yalnızca parola yöneticinde sakla**
   - "Auto confirm user" işaretli olsun

   Sonra SQL Editor'de, oluşan kullanıcının UUID'si ile:

   ```sql
   insert into public.profiles (id, display_name, role)
   values ('BURAYA_UUID', 'Bölüm Yöneticisi', 'admin')
   on conflict (id) do update set role = 'admin';
   ```

5. **Genel anahtarları gir** — Project Settings → API:

   | Değer | Nereye |
   |---|---|
   | Project URL | `config.js` → `SUPABASE_URL` |
   | anon / publishable key | `config.js` → `SUPABASE_ANON_KEY` |

   Bu iki değer tarayıcıya gider ve herkes tarafından görülebilir; öyle
   tasarlanmışlardır. **`service_role` anahtarı, veritabanı parolası ve admin
   parolası bu depoya asla yazılmaz.**

6. **Demo yönetici girişini kapat** — Supabase çalışır hâle geldikten sonra
   `index.html` içindeki `DEMO_ADMIN_ETKIN` değerini `false` yap. Bu andan
   sonra yönetim yalnızca Supabase Auth oturumuyla açılır; kaynak koddaki
   sahte demo kimliği hiçbir işe yaramaz.

### Materyal akışı

```
Öğrenci dosya yükler  →  status = pending  →  admin inceler
                                              ├─ Onayla  → status = approved → arşivde görünür
                                              └─ Reddet  → status = rejected → gerekçe gönderene görünür
```

Bekleyen ve reddedilen materyaller ders arşivinde görünmez. Dosyalar özel bir
depolama kovasında durur; erişim imzalı bağlantıyla ve materyalin durumuna göre
verilir.

### Artık ne nerede saklanıyor

| Veri | Yer |
|---|---|
| Materyaller, gönderiler, roller | Supabase PostgreSQL (RLS ile) |
| Yüklenen dosyalar | Supabase Storage (özel kova) |
| Favoriler, son görüntülenenler, arayüz durumu | tarayıcı `localStorage` |

Paylaşılan materyal verisi artık `localStorage`'da tutulmuyor. Mevcut yerel
veriler silinmedi; demo modunda hâlâ kullanılıyorlar.
