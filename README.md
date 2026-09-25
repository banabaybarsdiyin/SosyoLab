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

### İki giriş modu var, ikisi de gerçek kimlik doğrulama değildir

Giriş ekranında iki mod bulunur:

- **Kullanıcı Girişi** — öğrenci numarası + davet kodu. Arşivi görüntüler,
  arama yapar, favori ekler.
- **Admin Girişi** — kullanıcı adı + parola. Yukarıdakilerin tamamına ek olarak
  materyal ekleyebilir ve silebilir.

Demo bilgileri (kaynak kodda `KAYITLI`, `KOD` ve `ADMIN` sabitlerinde açıkça
durur ve bilerek sahtedir; gerçek yönetici parolası kaynak koda hiç girmez):

| Mod | Bilgi |
|---|---|
| Kullanıcı | `1000000001` / `DEMO2026` |
| Admin (yalnızca demo modu) | `Sosyolog.35` / `DEMO-ADMIN-2026` |

### Giriş gerçek kimlik doğrulama değildir

Her iki modun da kontrolü tamamen tarayıcıda çalışır. Davet kodu, admin
kullanıcı adı ve admin parolası JavaScript kaynağında düz metin olarak durur;
sayfanın kaynağını görüntüleyen herkes okuyabilir. Sunucu tarafında doğrulama,
oturum imzalama ya da yetki kontrolü yoktur. Bu yüzden:

- Buradaki giriş ekranı bir erişim kısıtı değil, bir gösterimdir.
- Kaynak koddaki `KAYITLI`, `KOD` ve `ADMIN` değerleri kurgusaldır ve sır
  değildir.
- Admin rolü yalnızca arayüzdeki yönetim denetimlerini açar. Tarayıcı
  geliştirici araçlarından ya da `localStorage` elle düzenlenerek aşılabilir;
  gerçek bir yetki sınırı değildir.
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
