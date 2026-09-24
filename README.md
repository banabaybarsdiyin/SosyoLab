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

### Giriş gerçek kimlik doğrulama değildir

Öğrenci numarası ve davet kodu kontrolü tamamen tarayıcıda çalışır. Davet kodu
JavaScript kaynağında düz metin olarak durur; sayfanın kaynağını görüntüleyen
herkes okuyabilir. Sunucu tarafında doğrulama, oturum imzalama ya da yetki
kontrolü yoktur. Bu yüzden:

- Buradaki giriş ekranı bir erişim kısıtı değil, bir gösterimdir.
- Kaynak koddaki `KAYITLI` listesi ve `KOD` değeri kurgusaldır.
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

- Sunucu tarafında kimlik doğrulama (ör. Supabase Auth) ve kayıtlı öğrenci listesi
- Ortak veritabanı ve dosya depolama
- Yetki kuralları (kimin ekleyebildiği, kimin silebildiği)
