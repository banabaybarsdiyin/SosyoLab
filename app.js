/* ============================================================================
   SosyoLab — Sosyoloji Bölümü Ders Arşivi
   ----------------------------------------------------------------------------
   Bu dosya index.html içinden çıkarıldı. Gerekçe: katı Content-Security-Policy
   inline betik bloğuna izin vermiyor. Aynı nedenle üretilen işaretlemede
   hiçbir satır içi olay ya da biçim niteliği bulunmaz; olaylar
   addEventListener ile, biçimler styles.css içindeki sınıflarla verilir.

   Güvenlik sınırı burada DEĞİLDİR. Bu dosyadaki yetki kontrolleri yalnızca
   arayüzü düzenler; gerçek yetkilendirme Supabase RLS politikalarındadır
   (supabase/schema.sql). Tarayıcıdaki hiçbir değer güven kaynağı sayılmaz.
   ============================================================================ */

/* ----------------------------------------------------------------------------
   Kalıcı kayıt köprüsü
   SosyoLab ilk olarak window.storage API'si olan bir ortamda yazıldı. GitHub
   Pages'te böyle bir API yok; aynı sözleşme localStorage üzerinden karşılanır.
   Veri yalnızca kullanıcının kendi tarayıcısında durur.
   ---------------------------------------------------------------------------- */
/* SosyoLab, Claude artifact ortamında window.storage API'sini kullanıyor.
     GitHub Pages'te böyle bir API olmadığı için aynı sözleşmeyi localStorage
     üzerinden karşılıyoruz. Veri yalnızca kullanıcının kendi tarayıcısında durur. */
  (function () {
    if (window.storage) return;
    var bellek = {};
    var yerelVar = (function () {
      try { var t = "__sl__"; window.localStorage.setItem(t, "1"); window.localStorage.removeItem(t); return true; }
      catch (e) { return false; }
    })();
    var al = function (k) { return yerelVar ? window.localStorage.getItem(k) : (k in bellek ? bellek[k] : null); };
    var koy = function (k, v) { if (yerelVar) window.localStorage.setItem(k, v); else bellek[k] = v; };
    var sil = function (k) { if (yerelVar) window.localStorage.removeItem(k); else delete bellek[k]; };

    window.storage = {
      get: function (key) {
        var v = al(key);
        if (v === null) return Promise.reject(new Error("kayıt yok: " + key));
        return Promise.resolve({ key: key, value: v, shared: false });
      },
      set: function (key, value) {
        try { koy(key, String(value)); return Promise.resolve({ key: key, value: value, shared: false }); }
        catch (e) { return Promise.reject(e); }
      },
      delete: function (key) {
        sil(key);
        return Promise.resolve({ key: key, deleted: true, shared: false });
      },
      list: function (prefix) {
        var k = [], i;
        if (yerelVar) { for (i = 0; i < window.localStorage.length; i++) k.push(window.localStorage.key(i)); }
        else { k = Object.keys(bellek); }
        if (prefix) k = k.filter(function (x) { return x.indexOf(prefix) === 0; });
        return Promise.resolve({ keys: k, prefix: prefix, shared: false });
      }
    };
  })();

/* ----------------------------------------------------------------------------
   Çerçeveleme koruması
   Clickjacking'in asıl karşılığı frame-ancestors / X-Frame-Options başlığıdır.
   GitHub Pages depo kodundan başlık ayarlayamaz ve bu yönerge <meta> CSP'de
   yok sayılır; bu yüzden burada betikle bir alt sınır konur. Bu bir başlığın
   yerini TUTMAZ — kalıcı çözüm için bkz. docs/DEPLOYMENT-SECURITY.md.
   ---------------------------------------------------------------------------- */
(function () {
  try {
    if (window.top !== window.self) {
      document.documentElement.replaceChildren();
      window.top.location = window.self.location;
    }
  } catch (e) {
    /* Çapraz köken engeli: konumu değiştiremiyoruz, en azından içeriği gizle. */
    try { document.documentElement.replaceChildren(); } catch (e2) { /* yok sayılır */ }
  }
})();

(function () {
  "use strict";

  /* Örnek materyaller YALNIZCA sunucu yapılandırılmamışken gösterilir.
     Bulut modunda arşiv her zaman gerçek verilerle başlar: bulutBaslat()
     başarılı olduğu anda SEED tamamen devre dışı kalır. */
  const DEMO_VERI = true;

  const root = document.getElementById("sosyolab");

  /* ---------- ikonografi (Lucide çizgisi) ---------- */

  const I = {
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    plus: '<path d="M5 12h14M12 5v14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    logOut: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    layers: '<path d="m12 2 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
    bookOpen: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    presentation: '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>',
    playCircle: '<circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4z"/>',
    messageQuestion: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.6-4.6a2 2 0 0 0-2.8 0L3 21"/>',
    clapper: '<path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.4-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.4z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    fileText: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h6"/><path d="M16 13H8M16 17H8M10 9H8"/>',
    alignLeft: '<path d="M21 6H3M15 12H3M17 18H3"/>',
    clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4M12 16h4M8 11h.01M8 16h.01"/>',
    library: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>'
  };

  const svg = (d, cls) => '<svg class="icon ' + (cls || "") + '" viewBox="0 0 24 24" aria-hidden="true">' + d + "</svg>";

  /* ---------- veri modeli ---------- */

  const TURLER = {
    "ders-anlatimi": { ad: "Ders Anlatımı", icon: I.bookOpen, renk: "#2C4E75", oncelik: 1 },
    "slayt":         { ad: "Slayt", icon: I.presentation, renk: "#8A6113", oncelik: 1 },
    "video":         { ad: "Video", icon: I.playCircle, renk: "#6E3340", oncelik: 1 },
    "soru-cevap":    { ad: "Soru-Cevap", icon: I.messageQuestion, renk: "#2E5F5B", oncelik: 1 },
    "ders-notu":     { ad: "Ders Notları", icon: I.fileText, renk: "#3C4A57", oncelik: 1 },
    "gorsel":        { ad: "Görsel", icon: I.image, renk: "#2C4E75", oncelik: 2 },
    "animasyon":     { ad: "Animasyon", icon: I.clapper, renk: "#6E3340", oncelik: 2 },
    "ozet":          { ad: "Özetler", icon: I.alignLeft, renk: "#2E5F5B", oncelik: 2 },
    "cikmis-soru":   { ad: "Çıkmış Sorular", icon: I.clipboard, renk: "#8A6113", oncelik: 2 },
    "kaynak":        { ad: "Makale / Kaynak", icon: I.library, renk: "#3C4A57", oncelik: 2 }
  };

  /* ============================================================
     VERİ KATMANI — ders programı
     Çok dosyalı bir projede bu blok data/courses.js dosyasına taşınır.
     Kaynak: ERÜ Edebiyat Fakültesi Sosyoloji Bölümü
     2026–2027 Eğitim-Öğretim Yılı Güz Dönemi haftalık ders programı.
     room ve schedule alanları şemada duruyor; kaynak listede yer
     almadığı için null bırakıldı, veri gelince doldurulacak.
     Öğretim elemanı adları bu herkese açık gösteri sürümünde nötr
     etiketlerle (Öğretim Elemanı A, B, C ...) değiştirilmiştir. Gerçek
     adlar yalnızca erişimi kısıtlı bir sürümde kullanılmalıdır.
     ============================================================ */

  const AKADEMIK_YIL = "2026-2027";

  const DONEMLER = [
    { id: "2026-2027-fall", academicYear: "2026-2027", semester: "fall", name: "Güz Dönemi", kisa: "2026–2027 Güz", available: true },
    { id: "2026-2027-spring", academicYear: "2026-2027", semester: "spring", name: "Bahar Dönemi", kisa: "2026–2027 Bahar", available: false }
  ];

  const SINIFLAR = [1, 2, 3, 4];

  const GUZ = "2026-2027-fall";

  const DERSLER = [
    /* --- 1. Sınıf --- */
    { id: "sos101", code: "SOS 101", name: "Sosyolojiye Giriş I", termId: GUZ, academicYear: AKADEMIK_YIL, semester: "fall", grade: 1, instructor: "Öğretim Elemanı A", courseType: null, room: null, schedule: null },
    { id: "sos121", code: "SOS 121", name: "Psikolojiye Giriş I", termId: GUZ, academicYear: AKADEMIK_YIL, semester: "fall", grade: 1, instructor: "Öğretim Elemanı B", courseType: null, room: null, schedule: null },
    { id: "sos131", code: "SOS 131", name: "Felsefeye Giriş I", termId: GUZ, academicYear: AKADEMIK_YIL, semester: "fall", grade: 1, instructor: "Öğretim Elemanı C", courseType: null, room: null, schedule: null },
    { id: "sos141", code: "SOS 141", name: "Bilgi Tek. ve Uygulamaları", termId: GUZ, academicYear: AKADEMIK_YIL, semester: "fall", grade: 1, instructor: "Öğretim Elemanı D", courseType: null, room: null, schedule: null, kisaltilmis: true },
    { id: "sos151", code: "SOS 151", name: "Mantık I", termId: GUZ, academicYear: AKADEMIK_YIL, semester: "fall", grade: 1, instructor: "Öğretim Elemanı E", courseType: null, room: null, schedule: null },

    /* --- 2. Sınıf --- */
    { id: "sos201", code: "SOS 201", name: "Sosyal Sorumluluk Projesi", termId: GUZ, academicYear: AKADEMIK_YIL, semester: "fall", grade: 2, instructor: "Öğretim Elemanı F", courseType: "Uygulamalı", room: null, schedule: null },
    { id: "sos231", code: "SOS 231", name: "Sosyolojik Düşünce Tarihi I", termId: GUZ, academicYear: AKADEMIK_YIL, semester: "fall", grade: 2, instructor: "Öğretim Elemanı G", courseType: null, room: null, schedule: null },
    { id: "sos241", code: "SOS 241", name: "Nicel Araştırma Yöntemleri", termId: GUZ, academicYear: AKADEMIK_YIL, semester: "fall", grade: 2, instructor: "Öğretim Elemanı H", courseType: null, room: null, schedule: null },
    { id: "sos273", code: "SOS 273", name: "İnsan Ekolojisi", termId: GUZ, academicYear: AKADEMIK_YIL, semester: "fall", grade: 2, instructor: "Öğretim Elemanı I", courseType: null, room: null, schedule: null },
    { id: "sos281", code: "SOS 281", name: "Türkiye'de Toplumsal Dön.", termId: GUZ, academicYear: AKADEMIK_YIL, semester: "fall", grade: 2, instructor: "Öğretim Elemanı H", courseType: null, room: null, schedule: null, kisaltilmis: true },
    { id: "sos295", code: "SOS 295", name: "İleri İngilizce I", termId: GUZ, academicYear: AKADEMIK_YIL, semester: "fall", grade: 2, instructor: "Öğretim Elemanı J", courseType: null, room: null, schedule: null },
    { id: "sos297", code: "SOS 297", name: "Din ve Kadın Çalışmaları", termId: GUZ, academicYear: AKADEMIK_YIL, semester: "fall", grade: 2, instructor: "Öğretim Elemanı K", courseType: null, room: null, schedule: null },

    /* --- 3. Sınıf --- */
    { id: "sos301", code: "SOS 301", name: "Çağdaş Sosyoloji Teorileri I", termId: GUZ, academicYear: AKADEMIK_YIL, semester: "fall", grade: 3, instructor: "Öğretim Elemanı G", courseType: null, room: null, schedule: null },
    { id: "sos341", code: "SOS 341", name: "Akademik Araştırma ve Yazım Tek.", termId: GUZ, academicYear: AKADEMIK_YIL, semester: "fall", grade: 3, instructor: "Öğretim Elemanı F", courseType: null, room: null, schedule: null, kisaltilmis: true },
    { id: "sos345", code: "SOS 345", name: "Gelişim Psikolojisi", termId: GUZ, academicYear: AKADEMIK_YIL, semester: "fall", grade: 3, instructor: "Öğretim Elemanı L", courseType: null, room: null, schedule: null },
    { id: "sos361", code: "SOS 361", name: "Sinema Sosyolojisi", termId: GUZ, academicYear: AKADEMIK_YIL, semester: "fall", grade: 3, instructor: "Öğretim Elemanı A", courseType: null, room: null, schedule: null },
    { id: "sos373", code: "SOS 373", name: "Yerel Politikalar ve Demokratik Katılım", termId: GUZ, academicYear: AKADEMIK_YIL, semester: "fall", grade: 3, instructor: "Öğretim Elemanı I", courseType: null, room: null, schedule: null },
    { id: "sos377", code: "SOS 377", name: "Bilim ve Felsefe Tarihi", termId: GUZ, academicYear: AKADEMIK_YIL, semester: "fall", grade: 3, instructor: "Öğretim Elemanı C", courseType: null, room: null, schedule: null },
    { id: "osd301", code: "OSD 301", name: "Bölüm Dışı Seçmeli Ders", termId: GUZ, academicYear: AKADEMIK_YIL, semester: "fall", grade: 3, instructor: "Öğretim Elemanı H", courseType: null, room: null, schedule: null },

    /* --- 4. Sınıf --- */
    { id: "sos401", code: "SOS 401", name: "Bitirme Tezi I", termId: GUZ, academicYear: AKADEMIK_YIL, semester: "fall", grade: 4, instructor: "Bölüm Öğretim Üyeleri", courseType: "Uygulamalı", room: null, schedule: null },
    { id: "sos403", code: "SOS 403", name: "Postmodernizm ve Sosyal Teori", termId: GUZ, academicYear: AKADEMIK_YIL, semester: "fall", grade: 4, instructor: "Öğretim Elemanı F", courseType: null, room: null, schedule: null },
    { id: "sos411", code: "SOS 411", name: "Türk Sosyolojisi Tarihi I", termId: GUZ, academicYear: AKADEMIK_YIL, semester: "fall", grade: 4, instructor: "Öğretim Elemanı M", courseType: null, room: null, schedule: null },
    { id: "sos485", code: "SOS 485", name: "Öğrenme Psikolojisi", termId: GUZ, academicYear: AKADEMIK_YIL, semester: "fall", grade: 4, instructor: "Öğretim Elemanı B", courseType: null, room: null, schedule: null },
    { id: "sos489", code: "SOS 489", name: "Göç Çalışmaları", termId: GUZ, academicYear: AKADEMIK_YIL, semester: "fall", grade: 4, instructor: "Öğretim Elemanı N", courseType: null, room: null, schedule: null },
    { id: "pfd401", code: "PFD 401", name: "Özel Öğretim Yöntemleri", termId: GUZ, academicYear: AKADEMIK_YIL, semester: "fall", grade: 4, instructor: "Öğretim Elemanı K", courseType: null, room: null, schedule: null }
  ];

  /* Aşağıdaki kayıtların tamamı kurgusaldır: hiçbiri gerçek bir ders
     materyaline, dosyaya, bağlantıya ya da sınav evrakına karşılık gelmez.
     Yalnızca arayüzü doldurmak içindir. Gerçek kullanıma geçerken
     DEMO_VERI = false yapın, arşiv boş başlar. */
  const SEED = [
    { id: "m1", ders: "sos301", tur: "ders-notu", baslik: "Bourdieu: habitus, alan ve sermaye", hafta: 4, meta: "PDF · 18 sayfa", ekleyen: "Demo Öğrenci A", tarih: "2026-09-14", etiketler: ["Bourdieu", "Habitus", "Alan"], aciklama: "Örnek not; üç ana kavram örneklerle ayrılmış." },
    { id: "m2", ders: "sos301", tur: "slayt", baslik: "Giddens ve yapılaşma kuramı", hafta: 6, meta: "PDF · 38 slayt", ekleyen: "Demo Öğrenci B", tarih: "2026-09-18", etiketler: ["Giddens", "Yapılaşma"], aciklama: "Örnek sunum kaydı; kuramın temel kavramlarını şemayla gösterir." },
    { id: "m3", ders: "sos301", tur: "video", baslik: "Örnek anlatım: Foucault ve iktidar analitiği", hafta: 8, meta: "72 dk", ekleyen: "Demo Öğrenci C", tarih: "2026-09-21", etiketler: ["Foucault", "İktidar"], aciklama: "Örnek kayıt; gerçek bir ders kaydı değildir." },
    { id: "m4", ders: "sos301", tur: "cikmis-soru", baslik: "Örnek soru seti — dönem tekrarı", hafta: null, meta: "PDF · 6 sayfa", ekleyen: "Demo Moderatör", tarih: "2026-09-08", etiketler: ["Tekrar"], aciklama: "Örnek içerik; gerçek sınav evrakı değildir." },
    { id: "m5", ders: "sos301", tur: "soru-cevap", baslik: "Habitus ile alan arasındaki fark nedir?", hafta: 4, meta: "Tartışma · 11 yanıt", ekleyen: "Demo Öğrenci A", tarih: "2026-09-16", etiketler: ["Bourdieu"], aciklama: "Örnek tartışma başlığı." },

    { id: "m6", ders: "sos241", tur: "ders-notu", baslik: "Örneklem türleri ve örneklem büyüklüğü", hafta: 3, meta: "PDF · 12 sayfa", ekleyen: "Demo Öğrenci A", tarih: "2026-09-11", etiketler: ["Örneklem", "Yöntem"], aciklama: "Olasılıklı ve olasılıksız örneklem ayrımı, hesaplama örnekleriyle." },
    { id: "m7", ders: "sos241", tur: "video", baslik: "SPSS ile betimsel istatistik: ekran kaydı", hafta: 7, meta: "34 dk", ekleyen: "Demo Öğrenci C", tarih: "2026-09-19", etiketler: ["SPSS", "İstatistik"], aciklama: "Veri girişinden frekans tablolarına kadar adım adım." },
    { id: "m8", ders: "sos241", tur: "ozet", baslik: "Ölçek türleri karşılaştırma tablosu", hafta: null, meta: "PDF · 3 sayfa", ekleyen: "Demo Öğrenci B", tarih: "2026-09-20", etiketler: ["Ölçek", "Likert"], aciklama: "Nominal, ordinal, aralık ve oran ölçekleri tek tabloda." },
    { id: "m9", ders: "sos241", tur: "cikmis-soru", baslik: "Örnek alıştırma soruları", hafta: null, meta: "PDF · 4 sayfa", ekleyen: "Demo Moderatör", tarih: "2026-09-22", etiketler: ["Tekrar"], aciklama: "Örnek içerik; gerçek sınav evrakı değildir." },

    { id: "m10", ders: "sos231", tur: "ders-notu", baslik: "Durkheim: iş bölümü ve dayanışma", hafta: 3, meta: "PDF · 14 sayfa", ekleyen: "Demo Öğrenci A", tarih: "2026-09-11", etiketler: ["Durkheim"], aciklama: "Mekanik ve organik dayanışma ayrımı." },
    { id: "m11", ders: "sos231", tur: "ozet", baslik: "Protestan Ahlakı — bölüm bölüm özet", hafta: 7, meta: "PDF · 7 sayfa", ekleyen: "Demo Öğrenci A", tarih: "2026-09-18", etiketler: ["Weber"], aciklama: "Kitabın her bölümü birer paragrafta." },
    { id: "m12", ders: "sos231", tur: "slayt", baslik: "Comte'tan Simmel'e: düşünce haritası", hafta: 2, meta: "PDF · 22 slayt", ekleyen: "Demo Öğrenci B", tarih: "2026-09-09", etiketler: ["Comte", "Simmel"], aciklama: "Kuramcıların dönem ve etkileşim şeması." },

    { id: "m13", ders: "sos489", tur: "ders-notu", baslik: "Köyden kente göç: 1950–1980 verileri", hafta: 4, meta: "PDF · 31 sayfa", ekleyen: "Demo Moderatör", tarih: "2026-09-13", etiketler: ["Göç", "Kentleşme"], aciklama: "Örnek veri derlemesi; tablolar tarih sırasına dizili." },
    { id: "m14", ders: "sos489", tur: "kaynak", baslik: "Göç kuramları derlemesi (makale)", hafta: 6, meta: "PDF · 22 sayfa", ekleyen: "Demo Öğrenci A", tarih: "2026-09-19", etiketler: ["Kuram", "Göç"], aciklama: "İtme-çekme kuramından ağ kuramına kadar." },
    { id: "m15", ders: "sos489", tur: "gorsel", baslik: "Göç haritaları ve akış şemaları", hafta: 5, meta: "9 görsel", ekleyen: "Demo Öğrenci C", tarih: "2026-09-17", etiketler: ["Harita"], aciklama: "Örnek harita ve şema seti." },

    { id: "m16", ders: "sos401", tur: "kaynak", baslik: "Tez yazım kılavuzu ve biçim şablonu", hafta: 1, meta: "DOCX · 24 sayfa", ekleyen: "Demo Öğrenci A", tarih: "2026-09-05", etiketler: ["Tez", "Şablon"], aciklama: "Örnek biçim şablonu; kenar boşlukları ayarlı." },
    { id: "m17", ders: "sos401", tur: "slayt", baslik: "Literatür taraması nasıl yapılır", hafta: 2, meta: "PDF · 21 slayt", ekleyen: "Demo Moderatör", tarih: "2026-09-07", etiketler: ["Literatür", "Tez"], aciklama: "Veritabanı seçimi, anahtar kelime ve not tutma düzeni." },

    { id: "m18", ders: "sos341", tur: "ozet", baslik: "APA 7 kaynak gösterimi: hızlı başvuru", hafta: 3, meta: "PDF · 2 sayfa", ekleyen: "Demo Öğrenci B", tarih: "2026-09-15", etiketler: ["APA", "Kaynakça"], aciklama: "Kitap, makale, tez ve internet kaynağı örnekleri." },
    { id: "m19", ders: "sos361", tur: "video", baslik: "Film çözümlemesi örneği: mekân ve sınıf", hafta: 5, meta: "41 dk", ekleyen: "Demo Öğrenci C", tarih: "2026-09-16", etiketler: ["Çözümleme", "Mekân"], aciklama: "Örnek çözümleme kaydı." },
    { id: "m20", ders: "sos101", tur: "ders-anlatimi", baslik: "Sosyolojik tahayyül nedir?", hafta: 1, meta: "26 dk", ekleyen: "Demo Öğrenci C", tarih: "2026-09-06", etiketler: ["Mills"], aciklama: "Örnek giriş anlatımı; yeni başlayanlar için." },
    { id: "m21", ders: "sos101", tur: "kaynak", baslik: "Dönem okuma listesi", hafta: null, meta: "PDF · 2 sayfa", ekleyen: "Demo Öğrenci B", tarih: "2026-09-04", etiketler: ["Okuma listesi"], aciklama: "Zorunlu ve önerilen okumalar ayrı ayrı." }
  ];
  /* ---------- davet kodu doğrulaması ----------

     Statik bir sitede tarayıcıya ulaşan her değer herkese açıktır. Bu yüzden
     davet kodu ARTIK bu dosyada tutulmaz ve burada karşılaştırılmaz.

     İki mod vardır:

       "server"  Kod Supabase'e gönderilir; public.davet_kullan(p_kod) RPC'si
                 bcrypt özetiyle karşılaştırır, süre ve kullanım hakkını
                 atomik biçimde denetler ve public.davet_dogrulamalari
                 tablosuna damgayı basar. Kodun kendisi hiçbir zaman istemci
                 koduna girmez. Gönderim izni bu damgaya bağlıdır ve sınır
                 RLS'tedir; bu dosya damgayı hiç okumaz. Üretimde
                 kullanılacak mod budur.
                 Gerekli şema: supabase/migrations/001_davet_kodlari.sql

       "local"   Yalnızca sunucu tarafı henüz kurulmamışken. Kod config.js
                 içindeki LOCAL_INVITE_CODE değeriyle tarayıcıda karşılaştırılır.
                 Bu bir GÜVENLİK ÖNLEMİ DEĞİLDİR: kaynağa bakan herkes kodu
                 görür; anonim giriş zaten açık olduğu için kod hiç bilinmeden
                 de oturum açılabilir. Yalnızca kazara girişi azaltır.

     Varsayılan "local"dir; böylece sunucu göçü uygulanmadan mevcut kurulum
     bozulmaz. Göç uygulandıktan sonra config.js içinde INVITE_MODE "server"
     yapılmalıdır. */
  const AYAR = window.SOSYOLAB_CONFIG || {};
  const DAVET_SUNUCUDA = AYAR.INVITE_MODE === "server";
  const YEREL_DAVET_KODU =
    typeof AYAR.LOCAL_INVITE_CODE === "string" ? AYAR.LOCAL_INVITE_CODE.trim().toUpperCase() : "";

  /* Kurgusal demo kayıtları. Bu liste kaynak kodda açıkta durduğu için
     buraya asla gerçek öğrenci numarası veya adı yazılmaz; gerçek kayıt
     listesi ancak sunucu tarafında tutulabilir. */
  const KAYITLI = {
    "1000000001": { ad: "Demo Öğrenci A", sinif: 4 },
    "1000000002": { ad: "Demo Öğrenci B", sinif: 4 },
    "1000000003": { ad: "Demo Öğrenci C", sinif: 3 },
    "1000000004": { ad: "Demo Öğrenci D", sinif: 2 }
  };

  /* Yönetici giriş takma adı. Bu YALNIZCA bir kullanıcı adıdır; yetki vermez.
     Zincir: takma ad → sabit e-posta eşlemesi → Supabase parola doğrulaması →
     kimliği doğrulanmış UUID → profiles satırı → role === "admin".
     Zincirin herhangi bir halkası kopuyorsa giriş reddedilir. Bu e-posta
     arayüzde hiçbir yerde gösterilmez; yalnızca Supabase Auth'a gider. */
  const ADMIN_TAKMA_AD = "sosyolog35";
  const ADMIN_EPOSTA = "sosyolog.35@sosyolab.local";

  /* Uygulamada tanınan tek rol kümesi. */
  const ROLLER = ["ogrenci", "admin"];
  const ROL_ETIKET = { ogrenci: "Kullanıcı", admin: "Admin" };

  /* Arama kısayolunun etiketi platforma göre değişir; Windows'ta ⌘ göstermek
     yanıltıcıydı. Kod her iki tuşu da kabul etmeye devam eder. */
  const KISAYOL = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent) ? "⌘K" : "Ctrl+K";

  /* Ayrıcalıklı işlemler için tek kontrol noktası. */
  const yetkili = () => !!state.oturum && state.oturum.rol === "admin";

  /* ---------- durum ---------- */

  const state = {
    hazir: false,
    oturum: null,
    materyaller: DEMO_VERI ? SEED.slice() : [],
    favoriler: [],
    sonGoruntulenen: [],
    gorunum: "panel",
    dersId: null,
    kategori: "tumu",
    dersArama: "",
    sirala: "yeni",
    kategoriHepsi: false,
    nav: { donem: "2026-2027-fall", sinif: null },
    sekme: "materyaller",
    sidebarAcik: false,
    katman: null,
    secili: null,
    silOnay: false,
    aramaSorgu: "",
    gonderiler: [],
    bekleyen: [],
    paylasHata: null,
    paylasGonderiliyor: false,
    onayHata: null,
    reddedilen: null,
    hata: null,
    /* sayfalama */
    sayfa: 0,
    dahaVar: false,
    yukleniyor: false,
    /* devam eden tek seferlik işlemler: çift tıklama ikinci kez göndermesin */
    islemde: null,
    indiriliyor: false,
    girisDeneniyor: false
  };

  /* ---------- yardımcılar ---------- */

  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

  function tarihYaz(iso) {
    const d = new Date(iso);
    return d.getDate() + " " + AYLAR[d.getMonth()] + " " + d.getFullYear();
  }

  const gecenGun = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

  function goreceli(iso) {
    const g = gecenGun(iso);
    if (g <= 0) return "bugün";
    if (g === 1) return "dün";
    if (g < 7) return g + " gün önce";
    if (g < 30) return Math.floor(g / 7) + " hafta önce";
    return tarihYaz(iso);
  }

  const buHafta = (iso) => gecenGun(iso) <= 7;
  const dersBul = (id) => DERSLER.find((d) => d.id === id);
  const donemBul = (id) => DONEMLER.find((d) => d.id === id) || {};
  const donemAd = (id) => donemBul(id).kisa || "";
  const dersMateryal = (id) => state.materyaller.filter((m) => m.ders === id);

  /* Tek bir canlı bölge: ekran okuyucu her bildirimi duyurur, üst üste
     gelen mesajlar birikmez. Metin her zaman textContent ile yazılır. */
  let toastEl = null;
  let toastZaman = 0;

  function bildir(mesaj) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      toastEl.setAttribute("aria-live", "polite");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = mesaj;
    toastEl.hidden = false;
    clearTimeout(toastZaman);
    toastZaman = setTimeout(function () { if (toastEl) toastEl.hidden = true; }, 3200);
  }

  /* ---------- kalıcı kayıt ---------- */

  async function oku(anahtar) {
    try {
      const r = await window.storage.get(anahtar);
      return r && r.value ? JSON.parse(r.value) : null;
    } catch (e) { return null; }
  }

  async function yaz(anahtar, deger) {
    try { await window.storage.set(anahtar, JSON.stringify(deger)); return true; }
    catch (e) { return false; }
  }

  /* Depodan gelen veri bozuk, eksik ya da elle değiştirilmiş olabilir.
     Tarih/başlık gibi alanların tipi beklenenden farklıysa sıralama ve
     çizim adımları hata verir; bu yüzden yüklenen kayıtlar normalize
     edilip geçersiz olanlar sessizce atılır. */
  const metin = (v, varsayilan) => (typeof v === "string" ? v : (varsayilan || ""));

  /* Materyal bağlantısı kullanıcıdan gelir. Yalnızca http ve https'e izin
     verilir; javascript: ve data: gibi şemalar tıklandığında sayfa
     bağlamında kod çalıştırabileceği için boş değere düşürülür. */
  function guvenliUrl(v) {
    if (typeof v !== "string") return "";
    const t = v.trim();
    if (!t) return "";
    if (/^(https?:)?\/\//i.test(t) || /^[a-z][a-z0-9+.-]*:/i.test(t)) {
      try {
        const u = new URL(t, "https://ornek.invalid/");
        return (u.protocol === "http:" || u.protocol === "https:") ? u.href : "";
      } catch (e) { return ""; }
    }
    return "";
  }

  /* Kimlikler nitelik içine yazıldığı için biçimi sınırlanır. */
  const gecerliKimlik = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);

  function materyalNormalize(m) {
    if (!m || typeof m !== "object") return null;
    if (!gecerliKimlik(m.id)) return null;
    if (typeof m.baslik !== "string" || !m.baslik.trim()) return null;
    const tarih = /^\d{4}-\d{2}-\d{2}$/.test(m.tarih) ? m.tarih : new Date().toISOString().slice(0, 10);
    const hafta = Number(m.hafta);
    return {
      id: m.id,
      ders: dersBul(m.ders) ? m.ders : "",
      tur: TURLER[m.tur] ? m.tur : "ders-notu",
      baslik: m.baslik,
      hafta: hafta >= 1 && hafta <= 30 ? hafta : null,
      meta: metin(m.meta),
      ekleyen: metin(m.ekleyen, "Bilinmiyor"),
      tarih: tarih,
      etiketler: Array.isArray(m.etiketler) ? m.etiketler.filter((t) => typeof t === "string").slice(0, 8) : [],
      aciklama: metin(m.aciklama),
      url: guvenliUrl(m.url),
      /* Depodaki nesne yolu. Yalnızca imzalı bağlantı üretmek için kullanılır;
         hiçbir zaman doğrudan adres olarak gösterilmez. Biçim: <uid>/<ad>.<uz> */
      depoYolu: typeof m.depoYolu === "string" && /^[A-Za-z0-9_\-]+\/[A-Za-z0-9_\-.]+$/.test(m.depoYolu)
        ? m.depoYolu : "",
      durum: m.durum === "approved" || m.durum === "pending" || m.durum === "rejected" ? m.durum : ""
    };
  }

  /* Depodan gelen rol asla yükseltilmez: yalnızca tanınan roller kabul edilir,
     eski "moderatör" kayıtları admin'e taşınır, bilinmeyen her değer en düşük
     yetkiye (ogrenci) düşer. */
  function rolNormalize(v) {
    if (v === "moderatör" || v === "moderator") return "admin";
    return ROLLER.indexOf(v) > -1 ? v : "ogrenci";
  }

  function oturumNormalize(o) {
    if (!o || typeof o !== "object") return null;
    const rol = rolNormalize(o.rol);
    const sinif = Number(o.sinif);
    if (rol === "admin") {
      return {
        no: typeof o.no === "string" && /^[A-Za-z0-9._-]{1,32}$/.test(o.no) ? o.no : ADMIN_TAKMA_AD,
        ad: metin(o.ad, "Yönetici"),
        rol: "admin",
        sinif: SINIFLAR.indexOf(sinif) > -1 ? sinif : null
      };
    }
    if (typeof o.no !== "string" || !/^\d{10}$/.test(o.no)) return null;
    return {
      no: o.no,
      ad: metin(o.ad, "No. " + o.no.slice(-4)),
      rol: "ogrenci",
      sinif: SINIFLAR.indexOf(sinif) > -1 ? sinif : null
    };
  }

  const kimlikListesi = (v) =>
    Array.isArray(v) ? v.filter((x) => typeof x === "string" && x).slice(0, 200) : [];

  async function yukle() {
    const [mat, oturum, fav, son] = await Promise.all([
      oku("sosyolab:materyaller"), oku("sosyolab:oturum"),
      oku("sosyolab:favoriler"), oku("sosyolab:son")
    ]);

    if (Array.isArray(mat)) {
      const temiz = mat.map(materyalNormalize).filter(Boolean);
      if (temiz.length) state.materyaller = temiz;
    }

    const o = oturumNormalize(oturum);
    if (o) state.oturum = o;

    state.favoriler = kimlikListesi(fav);
    state.sonGoruntulenen = kimlikListesi(son);

    if (bulutBaslat()) {
      /* Sunucu bağlı: örnek kayıtlar ve yerel materyal önbelleği tamamen
         düşer. Arşivde yalnızca sunucudan gelen onaylı materyaller görünür. */
      state.materyaller = [];
      window.storage.delete("sosyolab:materyaller").catch(function () { /* yok sayılır */ });

      /* Bulut modunda oturumun tek kaynağı Supabase Auth'tur. Yerel kayıt
         yalnızca görünen ad / sınıf gibi arayüz bilgisini taşır; oturumun
         geçerliliği ve rol her açılışta sunucudan yeniden okunur. */
      const yerel = state.oturum;
      state.oturum = null;
      try {
        const s = await BULUT.istemci.auth.getSession();
        const oturum = s.data && s.data.session;
        if (oturum) {
          BULUT.uid = oturum.user.id;
          const pr = await BULUT.istemci.from("profiles")
            .select("id, role, display_name, student_number").eq("id", BULUT.uid).maybeSingle();
          if (!pr.error && pr.data) BULUT.profil = pr.data;
          state.oturum = bulutOturumuKur(yerel);
        }
        if (state.oturum) {
          await yaz("sosyolab:oturum", state.oturum);
          /* Paylaşılan materyal artık localStorage'da değil: onaylı kayıtlar
             sunucudan gelir. Yerel depo yalnızca tercih ve arayüz durumu tutar. */
          await bulutYenile();
        } else if (!s.error) {
          /* Oturum yokken arşiv sorgusu atılmaz: RLS okumayı kimliği
             doğrulanmış kullanıcıya açar, istek zaten 401 dönerdi. */
          await window.storage.delete("sosyolab:oturum");
        }
      } catch (e) {
        BULUT.hata = "Sunucuya şu an ulaşılamıyor. Arşiv eksik görünebilir.";
      }

      /* Oturum başka bir sekmede kapanırsa ya da yenilenemezse arayüz de kapanır. */
      BULUT.istemci.auth.onAuthStateChange(function (olay) {
        if (olay === "SIGNED_OUT" && state.oturum) { oturumuTemizle(); ciz(); }
      });
    }

    if (state.oturum && state.oturum.sinif) state.nav.sinif = state.oturum.sinif;

    state.hazir = true;
  }

  /* Supabase oturumundan arayüz oturumu kurar. Rol yalnızca profiles.role'den
     gelir; profil okunamazsa en düşük yetkiye (ogrenci) düşülür. */
  function bulutOturumuKur(yerel) {
    if (!BULUT.uid) return null;
    const p = BULUT.profil || {};
    if (p.role === "admin") {
      return oturumNormalize({ no: ADMIN_TAKMA_AD, ad: p.display_name || "Yönetici", rol: "admin", sinif: null });
    }
    const aday = yerel && /^\d{10}$/.test(yerel.no) ? yerel : { no: p.student_number, ad: p.display_name };
    return oturumNormalize({ no: aday.no, ad: aday.ad, sinif: aday.sinif, rol: "ogrenci" });
  }

  async function bulutYenile() {
    if (!BULUT.etkin) return;
    state.sayfa = 0;
    const onayli = await onayliMateryalleriGetir(0);
    if (onayli) {
      state.materyaller = onayli.kayitlar;
      state.dahaVar = onayli.dahaVar;
      BULUT.hata = null;
    } else {
      BULUT.hata = "Arşiv sunucudan alınamadı.";
    }
    state.gonderiler = await gonderilerimiGetir();
    state.bekleyen = yetkili() ? await bekleyenleriGetir() : [];
  }

  /* Bir sonraki materyal sayfasını ekler. Tüm arşivi tek seferde tarayıcıya
     çekmek büyüyen bir arşivde sürdürülebilir değil; kayıtlar SAYFA_BOYU'luk
     dilimler hâlinde istenir. */
  async function dahaFazlaMateryal() {
    if (!BULUT.etkin || state.yukleniyor || !state.dahaVar) return;
    state.yukleniyor = true;
    ciz();
    const r = await onayliMateryalleriGetir(state.sayfa + 1);
    state.yukleniyor = false;
    if (!r) { BULUT.hata = "Sonraki sayfa alınamadı."; return ciz(); }
    state.sayfa += 1;
    state.dahaVar = r.dahaVar;
    const varolan = {};
    state.materyaller.forEach(function (m) { varolan[m.id] = true; });
    state.materyaller = state.materyaller.concat(r.kayitlar.filter(function (m) { return !varolan[m.id]; }));
    ciz();
  }

  /* ============================================================
     BULUT KATMANI — Supabase
     Yapılandırma boşsa uygulama demo modunda çalışır: örnek materyaller
     gösterilir, gönderim ve onay akışı kapalıdır. Yetkilendirmenin gerçek
     sınırı veritabanındaki RLS politikalarıdır; buradaki kontroller
     yalnızca arayüzü düzenler.
     ============================================================ */

  const BULUT = { etkin: false, istemci: null, uid: null, profil: null, hata: null };

  function bulutYapilandirmasi() {
    const c = window.SOSYOLAB_CONFIG || {};
    const url = typeof c.SUPABASE_URL === "string" ? c.SUPABASE_URL.trim() : "";
    const key = typeof c.SUPABASE_ANON_KEY === "string" ? c.SUPABASE_ANON_KEY.trim() : "";
    if (!/^https:\/\/[^\s]+$/.test(url) || key.length < 20) return null;
    return { url: url, key: key };
  }

  function bulutBaslat() {
    const c = bulutYapilandirmasi();
    if (!c) return false;
    const lib = window.supabase;
    if (!lib || typeof lib.createClient !== "function") return false;
    try {
      BULUT.istemci = lib.createClient(c.url, c.key, { auth: { persistSession: true } });
      BULUT.etkin = true;
    } catch (e) {
      BULUT.etkin = false;
      BULUT.hata = "Supabase istemcisi başlatılamadı.";
    }
    return BULUT.etkin;
  }

  /* ---------- dosya kuralları ---------- */

  const MAKS_DOSYA = 25 * 1024 * 1024;

  const IZINLI_DOSYA = {
    pdf:  ["application/pdf"],
    docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    jpg:  ["image/jpeg"],
    jpeg: ["image/jpeg"],
    png:  ["image/png"]
  };

  /* Çalıştırılabilir ve tarayıcıda kod yürütebilen biçimler açıkça reddedilir. */
  const YASAKLI_UZANTI = ["exe", "js", "mjs", "html", "htm", "svg", "bat", "cmd", "com",
    "ps1", "sh", "zip", "rar", "7z", "jar", "msi", "scr", "php", "vbs", "dll", "apk"];

  const PAYLASIM_TURLERI = [
    { id: "ders-notu",       ad: "Ders Notu",      tur: "ders-notu" },
    { id: "sunum",           ad: "Sunum",          tur: "slayt" },
    { id: "makale",          ad: "Makale",         tur: "kaynak" },
    { id: "sinav-calismasi", ad: "Sınav Çalışması", tur: "cikmis-soru" },
    { id: "ozet",            ad: "Özet",           tur: "ozet" },
    { id: "diger",           ad: "Diğer",          tur: "ders-notu" }
  ];

  const DURUM_ETIKET = { pending: "İnceleniyor", approved: "Onaylandı", rejected: "Reddedildi" };

  function uzantiAl(ad) {
    const t = String(ad || "").toLowerCase();
    const i = t.lastIndexOf(".");
    return i > -1 ? t.slice(i + 1).replace(/[^a-z0-9]/g, "") : "";
  }

  /* Orijinal dosya adına güvenilmez: yalnızca görüntülemek için saklanır,
     yol ayırıcıları ve kontrol karakterleri temizlenir. */
  function gosterimAdi(ad) {
    return String(ad || "dosya")
      .replace(/[\\/\u0000-\u001f]/g, " ")   /* yol ayırıcı ve kontrol karakteri */
      .replace(/\.{2,}/g, ".")                /* ".." dizileri */
      .replace(/^[.\s]+/, "")                 /* baştaki nokta ve boşluklar */
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "dosya";
  }

  function rastgeleKimlik() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (e) { /* yok sayılır */ }
    return "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /* Depodaki dosya adı her zaman sunucu tarafında üretilmiş gibi kurulur:
     <kullanıcı uid>/<rastgele>.<uzantı> */
  function depoYolu(uid, uzanti) {
    return String(uid) + "/" + rastgeleKimlik() + "." + uzanti;
  }

  function dosyaDogrula(dosya) {
    if (!dosya) return { ok: false, hata: "Bir dosya seçmelisin." };
    const uz = uzantiAl(dosya.name);
    if (!uz) return { ok: false, hata: "Dosyanın uzantısı okunamadı." };
    if (YASAKLI_UZANTI.indexOf(uz) > -1) {
      return { ok: false, hata: "." + uz + " dosyaları güvenlik nedeniyle kabul edilmiyor." };
    }
    if (!IZINLI_DOSYA[uz]) {
      return { ok: false, hata: "Yalnızca PDF, DOCX, PPTX, JPG ve PNG kabul ediliyor." };
    }
    const mime = String(dosya.type || "").toLowerCase();
    if (mime && IZINLI_DOSYA[uz].indexOf(mime) === -1) {
      return { ok: false, hata: "Dosya türü uzantısıyla uyuşmuyor." };
    }
    if (typeof dosya.size === "number" && dosya.size > MAKS_DOSYA) {
      return { ok: false, hata: "Dosya 25 MB sınırını aşıyor." };
    }
    if (typeof dosya.size === "number" && dosya.size === 0) {
      return { ok: false, hata: "Dosya boş görünüyor." };
    }
    return { ok: true, uzanti: uz, mime: mime || IZINLI_DOSYA[uz][0] };
  }

  /* ---------- oturum ---------- */

  async function bulutOturumAc(rolIstegi, kimlik) {
    if (!BULUT.etkin) return { ok: false, hata: "Bulut yapılandırılmamış." };
    const c = BULUT.istemci;
    try {
      if (rolIstegi === "admin") {
        const eposta = kimlik.kullanici.indexOf("@") > -1
          ? kimlik.kullanici
          : kimlik.kullanici.toLowerCase() + "@sosyolab.local";
        const r = await c.auth.signInWithPassword({ email: eposta, password: kimlik.parola });
        if (r.error) return { ok: false, hata: "Kullanıcı adı veya parola hatalı." };
        BULUT.uid = r.data.user.id;
      } else {
        const mevcut = await c.auth.getSession();
        const s = mevcut.data && mevcut.data.session;
        if (s && s.user && s.user.is_anonymous) {
          BULUT.uid = s.user.id;
        } else {
          /* Öğrenci girişi tarayıcıda kalmış parola oturumunu (ör. yönetici)
             asla devralmaz: önce kapatılır, sonra yeni anonim oturum açılır. */
          if (s) await bulutCikis();
          const r = await c.auth.signInAnonymously();
          if (r.error) return { ok: false, hata: "Oturum açılamadı." };
          BULUT.uid = r.data.user.id;
        }
      }
      const p = await c.from("profiles").select("id, role, display_name, student_number")
        .eq("id", BULUT.uid).maybeSingle();
      if (!p.error && p.data) {
        BULUT.profil = p.data;
      } else {
        const yeni = {
          id: BULUT.uid,
          display_name: kimlik.ad || null,
          student_number: kimlik.no && /^\d{10}$/.test(kimlik.no) ? kimlik.no : null
        };
        const ins = await c.from("profiles").insert(yeni).select().maybeSingle();
        BULUT.profil = (!ins.error && ins.data) ? ins.data : { id: BULUT.uid, role: "user" };
      }
      /* Rol sunucudan gelir; tarayıcıdaki seçim rolü belirlemez. */
      return { ok: true, rol: BULUT.profil.role === "admin" ? "admin" : "ogrenci" };
    } catch (e) {
      return { ok: false, hata: "Bağlantı kurulamadı." };
    }
  }

  async function bulutCikis() {
    if (!BULUT.etkin) return;
    /* Sunucuya ulaşılamazsa signOut yerel oturumu silmez; yerel kapsamla
       tekrar denenir ki yenilemede eski oturum geri gelmesin. */
    try {
      const r = await BULUT.istemci.auth.signOut();
      if (r && r.error) await BULUT.istemci.auth.signOut({ scope: "local" });
    } catch (e) {
      try { await BULUT.istemci.auth.signOut({ scope: "local" }); } catch (e2) { /* yok sayılır */ }
    }
    BULUT.uid = null; BULUT.profil = null;
  }

  /* ---------- materyal verisi ---------- */

  function bulutSatiriCevir(r) {
    const tur = PAYLASIM_TURLERI.filter(function (t) { return t.id === r.material_type; })[0];
    return {
      id: typeof r.id === "string" ? r.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) : rastgeleKimlik(),
      ders: r.course_id,
      tur: tur ? tur.tur : "ders-notu",
      baslik: r.title,
      hafta: null,
      meta: gosterimAdi(r.file_name),
      ekleyen: (r.profiles && r.profiles.display_name) || "Bölüm öğrencisi",
      tarih: String(r.created_at || "").slice(0, 10),
      etiketler: [],
      aciklama: r.description || "",
      url: "",
      depoYolu: r.file_path,
      durum: r.status
    };
  }

  const SAYFA_BOYU = 100;

  async function onayliMateryalleriGetir(sayfa) {
    if (!BULUT.etkin) return null;
    const bas = (sayfa || 0) * SAYFA_BOYU;
    const r = await BULUT.istemci.from("materials")
      .select("id, course_id, title, description, material_type, file_path, file_name, created_at, status, profiles:uploader_id(display_name)")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(bas, bas + SAYFA_BOYU - 1);
    if (r.error) return null;
    const kayitlar = (r.data || []).map(bulutSatiriCevir).map(materyalNormalize).filter(Boolean);
    return { kayitlar: kayitlar, dahaVar: (r.data || []).length === SAYFA_BOYU };
  }

  async function gonderilerimiGetir() {
    if (!BULUT.etkin || !BULUT.uid) return [];
    const r = await BULUT.istemci.from("materials")
      .select("id, course_id, title, material_type, file_name, status, rejection_reason, created_at, reviewed_at")
      .eq("uploader_id", BULUT.uid)
      .order("created_at", { ascending: false })
      .limit(200);
    return r.error ? [] : (r.data || []);
  }

  async function bekleyenleriGetir() {
    if (!BULUT.etkin) return [];
    const r = await BULUT.istemci.from("materials")
      .select("id, course_id, title, description, material_type, file_path, file_name, created_at, status, profiles:uploader_id(display_name, student_number)")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(200);
    return r.error ? [] : (r.data || []);
  }

  async function gonderiOlustur(veri, dosya) {
    if (!BULUT.etkin || !BULUT.uid) return { ok: false, hata: "Bulut bağlantısı yok." };
    const d = dosyaDogrula(dosya);
    if (!d.ok) return { ok: false, hata: d.hata };

    const yol = depoYolu(BULUT.uid, d.uzanti);
    const yuk = await BULUT.istemci.storage.from("materyaller")
      .upload(yol, dosya, { contentType: d.mime, upsert: false });
    if (yuk.error) return { ok: false, hata: "Dosya yüklenemedi." };

    const ins = await BULUT.istemci.from("materials").insert({
      course_id: veri.ders,
      uploader_id: BULUT.uid,
      title: veri.baslik,
      description: veri.aciklama || null,
      material_type: veri.tur,
      file_path: yol,
      file_name: gosterimAdi(dosya.name),
      mime_type: d.mime,
      file_size: dosya.size || null,
      status: "pending"
    });
    if (ins.error) {
      try { await BULUT.istemci.storage.from("materyaller").remove([yol]); } catch (e) { /* yok sayılır */ }
      return { ok: false, hata: "Gönderi kaydedilemedi." };
    }
    return { ok: true };
  }

  async function gonderiSonuclandir(id, durum, sebep) {
    if (!BULUT.etkin) return { ok: false, hata: "Bulut bağlantısı yok." };
    const yama = { status: durum };
    if (durum === "rejected") yama.rejection_reason = (sebep || "").slice(0, 300) || null;
    const r = await BULUT.istemci.from("materials").update(yama).eq("id", id).eq("status", "pending");
    if (r.error) return { ok: false, hata: "İşlem reddedildi. Yetkin olmayabilir." };
    return { ok: true };
  }

  /* Materyali ve dosyasını birlikte siler. Yetki sınırı RLS'tir: materials
     ve storage.objects üzerindeki silme politikaları yalnızca admin'e açıktır,
     bu yüzden yetkisiz çağrı sunucuda reddedilir. */
  async function materyalSil(id, yol) {
    if (!BULUT.etkin) return { ok: false, hata: "Sunucu bağlantısı yok." };
    const r = await BULUT.istemci.from("materials").delete().eq("id", id).select("id");
    if (r.error) return { ok: false, hata: "Silme reddedildi. Yetkin olmayabilir." };
    if (!r.data || !r.data.length) return { ok: false, hata: "Kayıt bulunamadı ya da yetkin yok." };
    if (yol) {
      /* Dosya kalsa bile kayıt gittiği için erişilemez; yine de artık
         bırakmamak için siliniyor. Başarısızlığı işlemi bozmaz. */
      try { await BULUT.istemci.storage.from("materyaller").remove([yol]); }
      catch (e) { /* yok sayılır */ }
    }
    return { ok: true };
  }

  async function imzaliBaglanti(yol) {
    if (!BULUT.etkin) return "";
    const r = await BULUT.istemci.storage.from("materyaller").createSignedUrl(yol, 300);
    return (!r.error && r.data && guvenliUrl(r.data.signedUrl)) || "";
  }

  /* ---------- giriş ---------- */

  function girisGorunumu() {
    return `
      <div class="auth">
        <section class="auth-left" aria-hidden="true">
          <svg class="auth-figure" viewBox="0 0 400 400" aria-hidden="true">
            <circle cx="200" cy="200" r="150"/><circle cx="200" cy="200" r="98"/><circle cx="200" cy="200" r="46"/>
            <line x1="200" y1="50" x2="200" y2="350"/><line x1="50" y1="200" x2="350" y2="200"/>
            <line x1="94" y1="94" x2="306" y2="306"/><line x1="306" y1="94" x2="94" y2="306"/>
            <circle class="node" cx="200" cy="50" r="5"/><circle class="node" cx="306" cy="306" r="5"/>
            <circle class="node" cx="102" cy="200" r="5"/><circle class="node" cx="200" cy="246" r="5"/>
            <circle class="node" cx="271" cy="129" r="5"/>
          </svg>
          <div class="auth-brand">Sosyo<span>Lab</span></div>
          <div class="auth-copy">
            <h1>Sosyoloji Bölümünün ortak hafızası.</h1>
            <p>Ders notları, sunumlar, videolar ve akademik kaynaklar tek bir bölüm arşivinde.</p>
          </div>
          <div class="auth-points">
            <div>${svg(I.layers, "icon-sm")} Ders bazlı arşiv</div>
            <div>${svg(I.users, "icon-sm")} Öğrenci katkıları</div>
            <div>${svg(I.clock, "icon-sm")} Dönem boyunca güncellenen kaynaklar</div>
          </div>
        </section>

        <main class="auth-right" id="icerik">
          <div class="auth-card">
            <h2>Arşive giriş</h2>
            <p class="lede">Öğrenci numaran veya kullanıcı adınla giriş yap.</p>
            ${state.hata ? `<p class="form-error" role="alert">${esc(state.hata)}</p>` : ""}
            <div class="field">
              <label for="kimlik">Öğrenci numarası veya kullanıcı adı</label>
              <input class="input" id="kimlik" type="text" maxlength="64" autocomplete="username"
                     autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next">
            </div>
            <div class="field">
              <label for="sifre">Davet kodu veya parola</label>
              <input class="input" id="sifre" type="password" maxlength="128" autocomplete="current-password"
                     autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="go">
            </div>
            <button class="btn-primary" type="button" data-action="giris"${state.girisDeneniyor ? " disabled" : ""}>${
              state.girisDeneniyor ? '<span class="spinner"></span> Kontrol ediliyor…' : "Arşive Gir"}</button>
            <p class="auth-foot">Bölüm öğrencileri ve yöneticiler için.</p>
            <p class="auth-demo">Kimlik doğrulama ve materyal işlemleri sunucu tarafındaki kurallarla korunur.</p>
          </div>
        </main>
      </div>`;
  }

  const adminTakmaAdiMi = (v) => {
    const t = String(v || "").trim().toLowerCase();
    return t === ADMIN_TAKMA_AD || t === "sosyolog.35";
  };

  async function girisDene() {
    if (state.girisDeneniyor) return;
    const kimlik = (document.getElementById("kimlik").value || "").trim();
    const sifre = document.getElementById("sifre").value || "";

    if (!kimlik) return hataGoster("Öğrenci numaranı ya da kullanıcı adını gir.", "kimlik");
    if (!sifre) return hataGoster("Davet kodunu ya da parolanı gir.", "sifre");

    /* Tek uçuşta tek deneme: çift tıklama ikinci bir ağ isteği açmasın. */
    state.girisDeneniyor = true;
    state.hata = null;
    ciz();
    try {
      return adminTakmaAdiMi(kimlik) ? await yoneticiGirisi(sifre) : await ogrenciGirisi(kimlik, sifre);
    } catch (e) {
      return hataGoster("Giriş tamamlanamadı. Bağlantını kontrol edip tekrar dene.", "kimlik");
    } finally {
      state.girisDeneniyor = false;
    }
  }

  async function yoneticiGirisi(parola) {
    if (BULUT.etkin) {
      /* Parola tarayıcıda hiçbir şeyle karşılaştırılmaz: doğrulama Supabase
         Auth'ta yapılır, yetki sunucudaki profil satırından gelir. */
      const r = await bulutOturumAc("admin", { kullanici: ADMIN_EPOSTA, parola: parola });
      if (!r.ok) return hataGoster("Kullanıcı adı veya parola hatalı.", "sifre");
      if (r.rol !== "admin") {
        await bulutCikis();
        return hataGoster("Bu hesabın yönetim yetkisi yok.", "kimlik");
      }
      await oturumAc({
        no: ADMIN_TAKMA_AD,
        ad: (BULUT.profil && BULUT.profil.display_name) || "Yönetici",
        rol: "admin",
        sinif: null
      });
      await bulutYenile();
      return ciz();
    }

    /* Sunucu bağlı değilken yönetici girişi diye bir şey yoktur: parolayı
       doğrulayacak güvenilir bir taraf yok, tarayıcıdaki karşılaştırma ise
       yetki üretmez. Bu yüzden akış burada kesilir. */
    return hataGoster("Yönetici girişi yalnızca sunucu bağlıyken yapılabilir.", "kimlik");
  }

  async function ogrenciGirisi(kimlik, kod) {
    const no = kimlik.replace(/\D/g, "");
    if (no.length !== 10 || no !== kimlik) {
      return hataGoster("Öğrenci numarası 10 haneli olmalı.", "kimlik");
    }

    /* Demo listesi yalnızca sunucusuz gösterim içindir. Sunucu bağlıyken
       kaynak koddaki kurgusal adlar kullanılmaz; görünen ad numaradan türetilir
       ve gerçek ad yalnızca profiles satırından gelebilir. */
    const kayit = BULUT.etkin ? null : KAYITLI[no];
    const ad = kayit ? kayit.ad : "No. " + no.slice(-4);

    if (!BULUT.etkin) {
      if (!YEREL_DAVET_KODU || kod.trim().toUpperCase() !== YEREL_DAVET_KODU) {
        return hataGoster("Davet kodu doğrulanamadı.", "sifre");
      }
      return oturumAc({ no: no, ad: ad, rol: "ogrenci", sinif: kayit ? kayit.sinif : null });
    }

    /* Öğrenci girişi hiçbir zaman admin rolü talep edemez: rol sunucudaki
       profil satırından okunur ve varsayılanı sıradan kullanıcıdır. */
    const r = await bulutOturumAc("ogrenci", { no: no, ad: ad });
    if (!r.ok) return hataGoster(r.hata, "kimlik");

    const davet = await davetDogrula(kod);
    if (!davet.ok) {
      /* Davet geçersizse açılan anonim oturum açık bırakılmaz. */
      await bulutCikis();
      oturumuTemizle();
      return hataGoster(davet.hata, "sifre");
    }

    await oturumAc({ no: no, ad: ad, rol: r.rol, sinif: null });
    await bulutYenile();
    return ciz();
  }

  /* Davet kodunu doğrular. Sunucu modunda kod yalnızca Supabase'e gider ve
     karşılaştırma orada yapılır; tarayıcı geçerli kodu hiçbir zaman bilmez. */
  async function davetDogrula(kod) {
    const temiz = String(kod || "").trim();
    if (!temiz) return { ok: false, hata: "Davet kodunu gir." };

    if (!DAVET_SUNUCUDA) {
      /* Geçici mod — güvenlik sınırı değildir, bkz. yukarıdaki not. */
      if (!YEREL_DAVET_KODU) {
        return { ok: false, hata: "Davet kodu doğrulaması yapılandırılmamış. Bölüm temsilcisine bildir." };
      }
      return temiz.toUpperCase() === YEREL_DAVET_KODU
        ? { ok: true }
        : { ok: false, hata: "Davet kodu doğrulanamadı." };
    }

    try {
      const r = await BULUT.istemci.rpc("davet_kullan", { p_kod: temiz });
      if (r.error) return { ok: false, hata: "Davet kodu doğrulanamadı." };
      return r.data === true
        ? { ok: true }
        : { ok: false, hata: "Davet kodu geçersiz ya da süresi dolmuş." };
    } catch (e) {
      return { ok: false, hata: "Davet kodu şu an doğrulanamıyor. Sonra tekrar dene." };
    }
  }

  async function oturumAc(oturum) {
    state.oturum = oturumNormalize(oturum);
    state.hata = null;
    state.gorunum = "panel";
    state.dersId = null;
    state.katman = null;
    state.secili = null;
    state.nav.sinif = state.oturum && state.oturum.sinif ? state.oturum.sinif : null;
    await yaz("sosyolab:oturum", state.oturum);
    ciz();
  }

  /* Tek çıkış yolu: hem çıkış düğmesi hem de Supabase SIGNED_OUT olayı
     arayüz durumunu buradan temizler. */
  function oturumuTemizle() {
    state.oturum = null;
    state.secili = null;
    state.katman = null;
    state.gorunum = "panel";
    state.dersId = null;
    state.hata = null;
    state.nav.sinif = null;
    state.gonderiler = [];
    state.bekleyen = [];
    state.reddedilen = null;
    state.onayHata = null;
    window.storage.delete("sosyolab:oturum").catch(function () { /* yok sayılır */ });
  }

  function hataGoster(mesaj, alan) {
    state.hata = mesaj;
    state.girisDeneniyor = false;
    ciz();
    const el = document.getElementById(alan);
    if (el) el.focus();
  }

  /* ---------- kenar çubuğu ---------- */

  function kenarCubugu() {
    const tally = {};
    state.materyaller.forEach((m) => { tally[m.ekleyen] = (tally[m.ekleyen] || 0) + 1; });
    const enler = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const harf = (state.oturum.ad || "?").trim().charAt(0).toUpperCase() || "?";

    return `
      <aside class="sidebar${state.sidebarAcik ? " open" : ""}">
        <div class="sb-brand">
          <b>Sosyo<span>Lab</span></b>
          <small>Erciyes Üniversitesi<br>Sosyoloji Bölümü</small>
        </div>

        <nav class="sb-nav" aria-label="Arşiv gezinmesi">
          <button class="sb-link" data-action="panel" aria-current="${state.gorunum === "panel"}">
            ${svg(I.inbox)} Bölüm Arşivi
          </button>
          <button class="sb-link" data-action="favoriler" aria-current="${state.gorunum === "favoriler"}">
            ${svg(I.bookmark)} Kaydettiklerim${state.favoriler.length ? `<em>${state.favoriler.length}</em>` : ""}
          </button>
          <button class="sb-link" data-action="gonderilerim" aria-current="${state.gorunum === "gonderilerim"}">
            ${svg(I.inbox)} Gönderilerim${state.gonderiler.length ? `<em>${state.gonderiler.length}</em>` : ""}
          </button>
          ${yetkili() ? `
          <button class="sb-link" data-action="onay" aria-current="${state.gorunum === "onay"}">
            ${svg(I.clipboard)} Onay Bekleyenler${state.bekleyen.length ? `<span class="rozet">${state.bekleyen.length}</span>` : ""}
          </button>` : ""}

          <p class="sb-section">2026–2027 AKADEMİK YILI</p>
          ${DONEMLER.map(donemBlogu).join("")}
        </nav>

        <div class="sb-foot">
          <div class="contrib">
            <b>TOPLULUĞA KATKI</b>
            <div class="contrib-row"><span>Bu dönem</span><span>${state.materyaller.length} materyal</span></div>
            <div class="contrib-row"><span>Katkı veren</span><span>${Object.keys(tally).length} öğrenci</span></div>
            ${enler.map(([k, n]) => `<div class="contrib-row"><span>${esc(k)}</span><span>${n}</span></div>`).join("")}
          </div>
          <div class="sb-user">
            <span class="avatar" aria-hidden="true">${esc(harf)}</span>
            <div>
              <strong>${esc(state.oturum.ad)}</strong>
              <small>${esc(state.oturum.no)} · ${esc(ROL_ETIKET[state.oturum.rol] || "Kullanıcı")}</small>
            </div>
            <button class="icon-btn" data-action="cikis" aria-label="Çıkış yap" title="Çıkış yap">${svg(I.logOut, "icon-sm")}</button>
          </div>
        </div>
      </aside>`;
  }

  function donemBlogu(d) {
    const acik = state.nav.donem === d.id;
    const govde = !acik ? ""
      : d.available
        ? SINIFLAR.map((s) => sinifBlogu(d.id, s)).join("")
        : '<p class="sb-bos">Bahar dönemi ders programı henüz arşive eklenmedi.</p>';
    return `
      <button class="sb-term" data-action="donem" data-id="${d.id}" aria-expanded="${acik}">
        ${svg(I.chevronRight, "icon-sm chev")} ${esc(d.name)}
      </button>
      ${govde}`;
  }

  function sinifBlogu(donem, sinif) {
    const dersler = DERSLER.filter((c) => c.termId === donem && c.grade === sinif);
    if (!dersler.length) return "";
    const acik = state.nav.sinif === sinif;
    return `
      <button class="sb-class" data-action="sinif" data-sinif="${sinif}" aria-expanded="${acik}">
        ${svg(I.chevronRight, "icon-sm chev")} ${sinif}. Sınıf <em>${dersler.length}</em>
      </button>
      ${acik ? dersler.map((c) => {
        const n = dersMateryal(c.id).length;
        return `<button class="sb-course" data-action="ders" data-id="${c.id}" aria-current="${state.dersId === c.id && state.gorunum === "ders"}">
          <span>${esc(c.name)}</span>${n ? `<em>${n}</em>` : ""}
        </button>`;
      }).join("") : ""}`;
  }

  /* ---------- üst bar ---------- */

  function ustBar() {
    return `
      <header class="topbar">
        <button class="icon-btn menu-btn" data-action="menu" aria-label="Gezinmeyi aç">${svg(I.menu)}</button>
        <nav class="crumbs" aria-label="Konum">${kirintilar()}</nav>
        <div class="top-actions">
          <button class="search-trigger" data-action="ara-ac">
            ${svg(I.search, "icon-sm")}<span>Ders, konu veya materyal ara…</span><kbd class="kbd">${KISAYOL}</kbd>
          </button>
          <button class="btn" data-action="paylas-ac"${BULUT.etkin ? "" : ' disabled title="Gönderim şu an kapalı: sunucu bağlantısı yok."'}>
            ${svg(I.plus, "icon-sm")}<span class="label">Materyal Paylaş</span>
          </button>
        </div>
      </header>`;
  }

  function kirintilar() {
    if (state.gorunum === "favoriler") {
      return '<button data-action="panel">Bölüm Arşivi</button><span class="sep">/</span><span class="now">Kaydettiklerim</span>';
    }
    if (state.gorunum === "ders") {
      const c = dersBul(state.dersId);
      if (c) {
        return `<button data-action="panel">Bölüm Arşivi</button><span class="sep">/</span>
          <button data-action="donem" data-id="${c.termId}">${esc(donemAd(c.termId))}</button><span class="sep">/</span>
          <button data-action="sinif" data-sinif="${c.grade}">${c.grade}. Sınıf</button><span class="sep">/</span>
          <span class="now">${esc(c.name)}</span>`;
      }
    }
    return `<span class="now">Bölüm Arşivi</span><span class="sep">·</span><span>${esc(donemAd(state.nav.donem))}</span>`;
  }

  /* ---------- gösterge panosu ---------- */

  function panelGorunumu() {
    const sonEklenen = state.materyaller.slice().sort((a, b) => b.tarih.localeCompare(a.tarih)).slice(0, 6);

    const dersSon = {};
    state.materyaller.forEach((m) => {
      if (!dersSon[m.ders] || m.tarih > dersSon[m.ders]) dersSon[m.ders] = m.tarih;
    });
    const guncelDersler = Object.entries(dersSon).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 4);

    const sonBakilan = state.sonGoruntulenen
      .map((id) => state.materyaller.find((m) => m.id === id))
      .filter(Boolean).slice(0, 3);

    const katkiVeren = new Set(state.materyaller.map((m) => m.ekleyen)).size;

    return `
      <div class="content">
        <div class="page-head">
          <p class="eyebrow">${svg(I.layers, "icon-sm")} BÖLÜM ARŞİVİ</p>
          <h1 class="page-title">2026–2027 Akademik Yılı</h1>
          <p class="page-sub">Soldan dönem ve sınıf seçerek derse in, ya da yukarıdan ara.</p>
          <div class="stat-line">
            <span><b>${state.materyaller.length}</b> materyal</span>
            <span><b>${DERSLER.length}</b> ders</span>
            <span><b>${katkiVeren}</b> katkı veren öğrenci</span>
          </div>
        </div>

        <section class="cta">
          <h2>Bilgiyi kendine saklama.</h2>
          <p class="cta-slogan">Bir not senden, bir dönem herkese fayda.</p>
          <p class="cta-metin">Ders notlarını, özetlerini ve sunumlarını SosyoLab'a yükle. İncelenen materyaller bölüm arşivine eklenerek herkesin kullanımına açılır.</p>
          <button class="btn cta-btn" data-action="paylas-ac">${svg(I.plus, "icon-sm")} Materyal Paylaş</button>
          ${BULUT.etkin ? "" : `<p class="cta-not">Gönderim şu an kapalı: bu sürüm sunucuya bağlı değil, yalnızca arayüz gösterimi yapıyor.</p>`}
        </section>

        ${sonBakilan.length ? `
        <section class="section">
          <div class="section-head"><h2>Son görüntülediklerin</h2></div>
          <div class="mat-list">${sonBakilan.map(materyalSatiri).join("")}</div>
        </section>` : ""}

        <section class="section">
          <div class="section-head"><h2>Son eklenen materyaller</h2><p>Tüm derslerden</p></div>
          ${sonEklenen.length
            ? `<div class="mat-list">${sonEklenen.map(materyalSatiri).join("")}</div>`
            : `<div class="empty">${svg(I.inbox, "icon-lg")}
                 <strong>Arşiv henüz boş.</strong>
                 <p>${BULUT.etkin
                      ? "Onaylanan ilk materyal burada görünecek."
                      : "Bu sürüm sunucuya bağlı değil; arşiv içeriği gösterilemiyor."}</p>
               </div>`}
        </section>

        ${guncelDersler.length ? `
        <section class="section">
          <div class="section-head"><h2>Son güncellenen dersler</h2></div>
          <div class="cards">
            ${guncelDersler.map(([id, tarih]) => {
              const c = dersBul(id);
              if (!c) return "";
              return `<button class="card" data-action="ders" data-id="${id}">
                <span class="kod">${esc(c.code)}</span>
                <h3>${esc(c.name)}</h3>
                <p>${dersMateryal(id).length} materyal · ${esc(goreceli(tarih))} güncellendi</p>
              </button>`;
            }).join("")}
          </div>
        </section>` : ""}

        ${dahaFazlaDugmesi()}
      </div>`;
  }

  /* Arşiv büyüdükçe tüm kayıtlar tarayıcıya çekilmez; sonraki dilim istenir. */
  function dahaFazlaDugmesi() {
    if (!BULUT.etkin || !state.dahaVar) return "";
    return `
      <div class="daha-fazla">
        <button class="btn btn-ghost" data-action="daha-fazla"${state.yukleniyor ? " disabled" : ""}>
          ${state.yukleniyor ? '<span class="spinner"></span> Yükleniyor…' : "Daha fazla materyal yükle"}
        </button>
      </div>`;
  }

  /* ---------- ders sayfası ---------- */

  /* Yalnızca gerçekten veri karşılığı olan sekmeler. "Ders İçeriği" ve
     "Soru Havuzu" sekmeleri kaldırıldı: arkalarında hiçbir veri modeli yoktu,
     her zaman "henüz eklenmedi" gösteriyor ve kullanıcıya var olmayan bir
     özellik sözü veriyorlardı. */
  function sekmeler(hepsi) {
    const liste = [{ id: "materyaller", ad: "Materyaller" }];
    if (hepsi.some(function (m) { return m.hafta; })) liste.push({ id: "haftalar", ad: "Haftalar" });
    return liste;
  }

  function dersGorunumu() {
    const c = dersBul(state.dersId);
    if (!c) return panelGorunumu();

    const hepsi = dersMateryal(c.id);
    const katkiVeren = new Set(hepsi.map((m) => m.ekleyen)).size;
    const sonTarih = hepsi.map((m) => m.tarih).sort().pop();

    return `
      <div class="content">
        <div class="page-head">
          <p class="eyebrow">${esc(c.code)}${c.courseType ? " · " + esc(c.courseType).toUpperCase() : ""}</p>
          <h1 class="page-title">${esc(c.name)}</h1>
          <p class="course-instructor">${esc(c.instructor)}</p>
          <p class="page-sub">${esc(donemAd(c.termId))} · ${c.grade}. Sınıf</p>
          <div class="stat-line">
            <span>${svg(I.fileText, "icon-sm")} <b>${hepsi.length}</b> materyal</span>
            ${katkiVeren ? `<span>${svg(I.users, "icon-sm")} <b>${katkiVeren}</b> katkıda bulunan</span>` : ""}
            ${sonTarih ? `<span>${svg(I.clock, "icon-sm")} Son güncelleme ${esc(goreceli(sonTarih))}</span>` : ""}
          </div>
        </div>

        ${(function () {
          const sek = sekmeler(hepsi);
          const etkin = sek.some(function (t) { return t.id === state.sekme; }) ? state.sekme : "materyaller";
          const basliklar = sek.length > 1 ? `
            <div class="tabs" role="tablist" aria-label="Ders bölümleri">
              ${sek.map(function (t) {
                return `<button class="tab" role="tab" id="sekme-${t.id}" aria-controls="panel-${t.id}"
                        data-action="sekme" data-sekme="${t.id}" aria-selected="${etkin === t.id}"
                        tabindex="${etkin === t.id ? "0" : "-1"}">${esc(t.ad)}</button>`;
              }).join("")}
            </div>` : "";
          const govde = etkin === "haftalar" ? haftalarBolumu(hepsi) : materyallerBolumu(c, hepsi);
          return basliklar + `<div class="tabpanel" role="tabpanel" id="panel-${etkin}"
                                   aria-labelledby="sekme-${etkin}" tabindex="0">${govde}</div>`;
        })()}
      </div>`;
  }

  function materyallerBolumu(c, hepsi) {
    const sayim = {};
    hepsi.forEach((m) => { sayim[m.tur] = (sayim[m.tur] || 0) + 1; });

    const temel = Object.keys(TURLER).filter((t) => TURLER[t].oncelik === 1);
    const gosterilecek = state.kategoriHepsi ? Object.keys(TURLER) : temel;

    let liste = hepsi.filter((m) => state.kategori === "tumu" || m.tur === state.kategori);
    const q = state.dersArama.toLowerCase().trim();
    if (q) {
      liste = liste.filter((m) =>
        m.baslik.toLowerCase().includes(q) ||
        (m.aciklama || "").toLowerCase().includes(q) ||
        (m.etiketler || []).some((t) => t.toLowerCase().includes(q)));
    }
    liste = siralaListe(liste);

    return `
      <div class="cats" role="group" aria-label="İçerik kategorileri">
        <button class="cat" data-action="kategori" data-tur="tumu" aria-pressed="${state.kategori === "tumu"}">Tümü <em>${hepsi.length}</em></button>
        ${gosterilecek.map((t) => `
          <button class="cat" data-action="kategori" data-tur="${t}" aria-pressed="${state.kategori === t}">
            ${esc(TURLER[t].ad)} <em>${sayim[t] || 0}</em>
          </button>`).join("")}
        <button class="cat" data-action="kategori-hepsi">${state.kategoriHepsi ? "Daha az" : "Daha fazla"}</button>
      </div>

      <div class="list-tools">
        <span class="inline-search">
          ${svg(I.search, "icon-sm")}
          <input class="input" id="dersArama" type="search" placeholder="Bu derste ara…" value="${esc(state.dersArama)}">
        </span>
        <span class="sort-wrap">
          <label for="sirala">Sırala</label>
          <select class="select" id="sirala">
            <option value="yeni"${state.sirala === "yeni" ? " selected" : ""}>En yeni</option>
            <option value="eski"${state.sirala === "eski" ? " selected" : ""}>En eski</option>
            <option value="hafta"${state.sirala === "hafta" ? " selected" : ""}>Ders haftası</option>
            <option value="baslik"${state.sirala === "baslik" ? " selected" : ""}>Başlığa göre</option>
          </select>
        </span>
      </div>

      ${liste.length
        ? `<div class="mat-list">${liste.map(materyalSatiri).join("")}</div>`
        : bosDurum()}`;
  }

  function haftalarBolumu(hepsi) {
    if (!hepsi.length) return bosDurum();
    const gruplar = {};
    hepsi.forEach((m) => {
      const k = m.hafta || 0;
      (gruplar[k] = gruplar[k] || []).push(m);
    });
    const haftalar = Object.keys(gruplar).map(Number).sort((a, b) => (a || 99) - (b || 99));
    return haftalar.map((h) => `
      <section class="section">
        <div class="section-head">
          <h2>${h ? h + ". Hafta" : "Hafta belirtilmemiş"}</h2>
          <p>${gruplar[h].length} materyal</p>
        </div>
        <div class="mat-list">${siralaListe(gruplar[h]).map(materyalSatiri).join("")}</div>
      </section>`).join("");
  }

  function siralaListe(liste) {
    const l = liste.slice();
    if (state.sirala === "yeni") l.sort((a, b) => b.tarih.localeCompare(a.tarih));
    if (state.sirala === "eski") l.sort((a, b) => a.tarih.localeCompare(b.tarih));
    if (state.sirala === "baslik") l.sort((a, b) => a.baslik.localeCompare(b.baslik, "tr"));
    if (state.sirala === "hafta") l.sort((a, b) => (a.hafta || 99) - (b.hafta || 99));
    return l;
  }

  function bosDurum() {
    const tur = state.kategori === "tumu" ? null : TURLER[state.kategori];
    const baslik = state.dersArama
      ? "Aramanla eşleşen materyal yok."
      : tur
        ? "Bu ders için henüz " + tur.ad.toLowerCase() + " eklenmemiş."
        : "Bu derste henüz materyal yok.";
    return `
      <div class="empty">
        ${svg(I.inbox, "icon-lg")}
        <strong>${esc(baslik)}</strong>
        ${BULUT.etkin
          ? `<p>İlk materyali sen paylaş — inceleme sonrası bölümdeki herkes görür.</p>
             <button class="btn" data-action="paylas-ac">${svg(I.plus, "icon-sm")} Materyal Paylaş</button>`
          : `<p>Bu bölüme materyal eklenince burada görünecek.</p>`}
      </div>`;
  }

  function favoriGorunumu() {
    const liste = siralaListe(state.materyaller.filter((m) => state.favoriler.indexOf(m.id) > -1));
    return `
      <div class="content">
        <div class="page-head">
          <p class="eyebrow">${svg(I.bookmark, "icon-sm")} KİŞİSEL</p>
          <h1 class="page-title">Kaydettiklerim</h1>
          <p class="page-sub">Yalnızca sana görünür; sınav döneminde hızlı erişim için.</p>
        </div>
        ${liste.length
          ? `<div class="mat-list">${liste.map(materyalSatiri).join("")}</div>`
          : `<div class="empty">${svg(I.bookmark, "icon-lg")}<strong>Henüz materyal kaydetmedin.</strong><p>Listelerdeki yer imi simgesine basarak materyalleri buraya ekleyebilirsin.</p></div>`}
      </div>`;
  }

  /* ---------- materyal satırı ---------- */

  function materyalSatiri(m) {
    const t = TURLER[m.tur] || TURLER["ders-notu"];
    const c = dersBul(m.ders);
    const fav = state.favoriler.indexOf(m.id) > -1;
    const alt = ['<span class="kind">' + esc(t.ad) + "</span>",
      m.hafta ? m.hafta + ". Hafta" : null,
      m.meta ? esc(m.meta) : null].filter(Boolean).join(" · ");

    return `
      <div class="mat" data-tur="${esc(m.tur)}">
        <button class="mat-open" data-action="materyal" data-id="${esc(m.id)}">
          <span class="mat-icon">${svg(t.icon)}</span>
          <span class="mat-body">
            <span class="mat-title">${esc(m.baslik)}${buHafta(m.tarih) ? '<span class="tag-new">Bu hafta</span>' : ""}</span>
            <span class="mat-sub">${alt}</span>
            <span class="mat-by">${c ? esc(c.code) + " · " : ""}${esc(m.ekleyen)} ekledi · ${esc(tarihYaz(m.tarih))}</span>
          </span>
        </button>
        <button class="mat-fav" data-action="favori" data-id="${esc(m.id)}" aria-pressed="${fav}"
                aria-label="${fav ? "Kayıtlardan çıkar" : "Kaydet"}" title="${fav ? "Kayıtlardan çıkar" : "Kaydet"}">
          ${svg(I.bookmark, "icon-sm")}
        </button>
      </div>`;
  }

  /* ---------- detay çekmecesi ---------- */

  function cekmece() {
    const m = state.materyaller.find((x) => x.id === state.secili);
    if (!m) return "";
    const t = TURLER[m.tur] || TURLER["ders-notu"];
    const c = dersBul(m.ders);
    const fav = state.favoriler.indexOf(m.id) > -1;
    const silebilir = yetkili();

    return `
      <div class="scrim" data-action="kapat"></div>
      <aside class="drawer" data-tur="${esc(m.tur)}" role="dialog" aria-modal="true" aria-labelledby="cekmece-baslik">
        <div class="drawer-top">
          <span class="kind-tag">${svg(t.icon, "icon-sm")} ${esc(t.ad)}</span>
          <span class="drawer-tools">
            <button class="x-btn mat-fav" data-action="favori" data-id="${esc(m.id)}" aria-pressed="${fav}"
                    aria-label="${fav ? "Kayıtlardan çıkar" : "Kaydet"}">${svg(I.bookmark, "icon-sm")}</button>
            <button class="x-btn" data-action="kapat" aria-label="Kapat">${svg(I.x, "icon-sm")}</button>
          </span>
        </div>

        <h2 id="cekmece-baslik">${esc(m.baslik)}</h2>
        ${m.aciklama ? `<p class="note">${esc(m.aciklama)}</p>` : ""}

        <div class="facts">
          <div><span>Ders</span><span>${c ? esc(c.code) + " · " + esc(c.name) : "—"}</span></div>
          <div><span>Dönem</span><span>${c ? esc(donemAd(c.termId)) + " · " + c.grade + ". Sınıf" : "—"}</span></div>
          ${m.hafta ? `<div><span>Hafta</span><span>${m.hafta}. Hafta</span></div>` : ""}
          <div><span>Dosya</span><span>${esc(m.meta || "belirtilmemiş")}</span></div>
          <div><span>Ekleyen</span><span>${esc(m.ekleyen)}</span></div>
          <div><span>Eklenme</span><span>${esc(tarihYaz(m.tarih))}</span></div>
        </div>

        ${(m.etiketler || []).length ? `<div class="chips">${m.etiketler.map((e) => `<span class="chip-tag">#${esc(e)}</span>`).join("")}</div>` : ""}

        ${m.depoYolu
          ? `<button class="link-btn" data-action="dosya-ac" data-id="${esc(m.id)}"${state.indiriliyor ? " disabled" : ""}>
               ${state.indiriliyor ? '<span class="spinner"></span> Bağlantı hazırlanıyor…'
                 : svg(I.external, "icon-sm") + " Materyali aç"}
             </button>
             <p class="form-hint">Bağlantı kişiye özel üretilir ve 5 dakika sonra geçersiz olur.</p>`
          : m.url
            ? `<a class="link-btn" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${svg(I.external, "icon-sm")} Materyali aç</a>`
            : '<p class="soft-note">Bu materyalin dosyası henüz yüklenmemiş.</p>'}

        ${silebilir
          ? `<button class="danger" data-action="sil"${state.islemde === "sil" ? " disabled" : ""}>${
              state.islemde === "sil" ? "Kaldırılıyor…"
                : state.silOnay ? "Emin misin? Silmek için tekrar bas" : "Arşivden kaldır"}</button>`
          : ""}
      </aside>`;
  }

  /* ---------- materyal paylaşımı ---------- */

  function paylasKatmani() {
    const mevcut = dersBul(state.dersId);
    const secDonem = mevcut ? mevcut.termId : state.nav.donem;
    const secSinif = mevcut ? mevcut.grade : (state.nav.sinif || (state.oturum && state.oturum.sinif) || 1);
    const dersSecenek = DERSLER.filter(function (c) { return c.termId === secDonem && c.grade === secSinif; });

    return `
      <div class="scrim" data-action="kapat"></div>
      <div class="modal" role="dialog" aria-modal="true" aria-label="Materyal paylaş">
        <h2>Materyal Paylaş</h2>
        <p class="lede">Gönderin admin incelemesinden geçtikten sonra arşivde yayınlanır.</p>
        ${state.paylasHata ? `<p class="form-error" role="alert">${esc(state.paylasHata)}</p>` : ""}

        <div class="grid-2">
          <div class="field">
            <label for="p-donem">Dönem</label>
            <select class="input" id="p-donem" data-kapsam2="1">
              ${DONEMLER.filter(function (d) { return d.available; }).map(function (d) {
                return `<option value="${d.id}"${d.id === secDonem ? " selected" : ""}>${esc(d.kisa)}</option>`; }).join("")}
            </select>
          </div>
          <div class="field">
            <label for="p-sinif">Sınıf</label>
            <select class="input" id="p-sinif" data-kapsam2="1">
              ${SINIFLAR.map(function (n) {
                return `<option value="${n}"${n === secSinif ? " selected" : ""}>${n}. Sınıf</option>`; }).join("")}
            </select>
          </div>
          <div class="field wide">
            <label for="p-ders">Ders</label>
            <select class="input" id="p-ders">
              ${dersSecenek.length
                ? dersSecenek.map(function (c) {
                    return `<option value="${c.id}"${c.id === state.dersId ? " selected" : ""}>${esc(c.code)} · ${esc(c.name)}</option>`; }).join("")
                : '<option value="">Bu dönem ve sınıfta ders yok</option>'}
            </select>
          </div>
          <div class="field wide">
            <label for="p-baslik">Materyal başlığı</label>
            <input class="input" id="p-baslik" maxlength="200" placeholder="Örn. 4. hafta ders notları">
          </div>
          <div class="field wide">
            <label for="p-aciklama">Açıklama</label>
            <input class="input" id="p-aciklama" maxlength="300" placeholder="Hangi konuyu kapsıyor?">
          </div>
          <div class="field">
            <label for="p-tur">Materyal türü</label>
            <select class="input" id="p-tur">
              ${PAYLASIM_TURLERI.map(function (t) { return `<option value="${t.id}">${esc(t.ad)}</option>`; }).join("")}
            </select>
          </div>
          <div class="field">
            <label for="p-dosya">Dosya</label>
            <input class="input" id="p-dosya" type="file" accept=".pdf,.docx,.pptx,.jpg,.jpeg,.png">
          </div>
          <p class="form-hint wide">PDF, DOCX, PPTX, JPG veya PNG · en fazla 25 MB</p>
        </div>

        <div class="modal-actions">
          <button class="btn btn-ghost" data-action="kapat">Vazgeç</button>
          <button class="btn" data-action="paylas-gonder"${state.paylasGonderiliyor ? " disabled" : ""}>${
            state.paylasGonderiliyor ? '<span class="spinner"></span> Gönderiliyor…' : "İncelemeye Gönder"}</button>
        </div>
      </div>`;
  }

  async function paylasimGonder() {
    if (state.paylasGonderiliyor) return;
    const ders = document.getElementById("p-ders").value;
    const baslik = (document.getElementById("p-baslik").value || "").trim();
    const aciklama = (document.getElementById("p-aciklama").value || "").trim();
    const tur = document.getElementById("p-tur").value;
    const alan = document.getElementById("p-dosya");
    const dosya = alan && alan.files && alan.files[0];

    if (!ders) return paylasHata("Bir ders seç.");
    if (!dersBul(ders)) return paylasHata("Seçilen ders tanınmıyor.");
    if (!baslik) return paylasHata("Materyalin bir başlığa ihtiyacı var.");
    const d = dosyaDogrula(dosya);
    if (!d.ok) return paylasHata(d.hata);
    if (!BULUT.etkin) return paylasHata("Gönderim şu an kapalı: sunucu bağlantısı yok.");

    state.paylasGonderiliyor = true; state.paylasHata = null; ciz();
    const r = await gonderiOlustur({ ders: ders, baslik: baslik, aciklama: aciklama, tur: tur }, dosya);
    state.paylasGonderiliyor = false;

    if (!r.ok) return paylasHata(r.hata);
    state.katman = null;
    state.paylasHata = null;
    await bulutYenile();
    ciz();
    bildir("Materyalin incelemeye gönderildi. Admin onayından sonra arşivde yayınlanacak.");
  }

  function paylasHata(mesaj) {
    state.paylasHata = mesaj;
    state.paylasGonderiliyor = false;
    ciz();
  }

  /* ---------- gönderilerim ---------- */

  function gonderilerimGorunumu() {
    return `
      <div class="content">
        <div class="page-head">
          <p class="eyebrow">${svg(I.inbox, "icon-sm")} KİŞİSEL</p>
          <h1 class="page-title">Gönderilerim</h1>
          <p class="page-sub">Paylaştığın materyallerin inceleme durumu.</p>
        </div>
        ${!BULUT.etkin
          ? `<div class="empty">${svg(I.inbox, "icon-lg")}<strong>Gönderim şu an kapalı.</strong><p>Bu sürüm sunucuya bağlı değil; materyal gönderimi devre dışı.</p></div>`
          : state.gonderiler.length
            ? state.gonderiler.map(gonderiSatiri).join("")
            : `<div class="empty">${svg(I.inbox, "icon-lg")}<strong>Henüz materyal göndermedin.</strong><p>Arşive katkı vermek için gösterge panosundaki "Materyal Paylaş" düğmesini kullan.</p>
                 <button class="btn" data-action="paylas-ac">${svg(I.plus, "icon-sm")} Materyal Paylaş</button></div>`}
      </div>`;
  }

  function gonderiSatiri(g) {
    const c = dersBul(g.course_id);
    const durum = DURUM_ETIKET[g.status] || "İnceleniyor";
    const tur = PAYLASIM_TURLERI.filter(function (t) { return t.id === g.material_type; })[0];
    return `
      <div class="inceleme">
        <span class="durum durum-${esc(g.status)}">${esc(durum)}</span>
        <h3 class="gonderi-baslik">${esc(g.title)}</h3>
        <p class="alt">${c ? esc(c.code) + " · " + esc(c.name) : esc(g.course_id)}${tur ? " · " + esc(tur.ad) : ""}</p>
        <p class="alt">${esc(gosterimAdi(g.file_name))} · ${esc(String(g.created_at || "").slice(0, 10))}</p>
        ${g.status === "rejected" && g.rejection_reason
          ? `<p class="aciklama"><strong>Ret gerekçesi:</strong> ${esc(g.rejection_reason)}</p>` : ""}
      </div>`;
  }

  /* ---------- admin inceleme ---------- */

  function onayGorunumu() {
    if (!yetkili()) return panelGorunumu();
    return `
      <div class="content">
        <div class="page-head">
          <p class="eyebrow">${svg(I.clipboard, "icon-sm")} YÖNETİM</p>
          <h1 class="page-title">Onay Bekleyenler</h1>
          <p class="page-sub">Onaylanan materyaller doğrudan ders arşivinde yayınlanır.</p>
        </div>
        ${state.onayHata ? `<p class="form-error" role="alert">${esc(state.onayHata)}</p>` : ""}
        ${!BULUT.etkin
          ? `<div class="empty">${svg(I.clipboard, "icon-lg")}<strong>İnceleme kuyruğu kapalı.</strong><p>Bu sürüm sunucuya bağlı değil.</p></div>`
          : state.bekleyen.length
            ? state.bekleyen.map(bekleyenKarti).join("")
            : `<div class="empty">${svg(I.clipboard, "icon-lg")}<strong>Bekleyen gönderi yok.</strong><p>Yeni gönderiler burada görünecek.</p></div>`}
      </div>`;
  }

  function bekleyenKarti(g) {
    const c = dersBul(g.course_id);
    const tur = PAYLASIM_TURLERI.filter(function (t) { return t.id === g.material_type; })[0];
    const yukleyen = (g.profiles && g.profiles.display_name) || "Bilinmiyor";
    const no = (g.profiles && g.profiles.student_number) || "";
    const secili = state.reddedilen === g.id;
    const mesgul = !!state.islemde;
    return `
      <div class="inceleme" data-gonderi="${esc(g.id)}">
        <h3>${esc(g.title)}</h3>
        <p class="alt">${c ? esc(c.code) + " · " + esc(c.name) : esc(g.course_id)}${tur ? " · " + esc(tur.ad) : ""}</p>
        <p class="alt">${esc(yukleyen)}${no ? " · " + esc(no) : ""} · ${esc(String(g.created_at || "").slice(0, 10))}</p>
        <p class="alt">${esc(gosterimAdi(g.file_name))}</p>
        ${g.description ? `<p class="aciklama">${esc(g.description)}</p>` : ""}
        <div class="inceleme-actions">
          <button class="btn btn-ghost" data-action="onizle" data-id="${esc(g.id)}"${mesgul ? " disabled" : ""}>Önizle</button>
          <button class="btn btn-onay" data-action="onayla" data-id="${esc(g.id)}"${mesgul ? " disabled" : ""}>${
            state.islemde === g.id ? '<span class="spinner"></span> İşleniyor…' : "Onayla"}</button>
          <button class="btn btn-ret" data-action="ret-ac" data-id="${esc(g.id)}"${mesgul ? " disabled" : ""}>Reddet</button>
        </div>
        ${secili ? `
        <div class="sebep">
          <input class="input" id="ret-sebep" maxlength="300" placeholder="Ret gerekçesi (isteğe bağlı)">
          <div class="inceleme-actions tight">
            <button class="btn btn-ret" data-action="reddet" data-id="${esc(g.id)}"${mesgul ? " disabled" : ""}>Reddi Onayla</button>
            <button class="btn btn-ghost" data-action="ret-kapat">Vazgeç</button>
          </div>
        </div>` : ""}
      </div>`;
  }

  /* Yeni sekme kullanıcı tıklamasıyla aynı anda açılır; imzalı adres
     geldiğinde içine yüklenir. Aksi hâlde await sonrasındaki window.open
     tarayıcı tarafından açılır pencere engelleyiciye takılır. */
  async function imzaliAdreseGit(yol, hataMesaji) {
    const sekme = window.open("", "_blank", "noopener,noreferrer");
    const url = await imzaliBaglanti(yol);
    if (!url) {
      if (sekme) { try { sekme.close(); } catch (e) { /* yok sayılır */ } }
      return bildir(hataMesaji);
    }
    if (sekme) sekme.location = url;
    else window.open(url, "_blank", "noopener,noreferrer");
  }

  async function onizle(id) {
    const g = state.bekleyen.filter(function (x) { return x.id === id; })[0];
    if (!g) return;
    return imzaliAdreseGit(g.file_path, "Önizleme bağlantısı alınamadı.");
  }

  /* Arşivdeki onaylı materyalin dosyasını açar. Erişim izni istemcide
     değil storage.objects politikasında kontrol edilir; imzalı adres
     yalnızca politikadan geçen çağrı için üretilir. */
  async function materyalDosyasiniAc(id) {
    if (state.indiriliyor) return;
    const m = state.materyaller.find(function (x) { return x.id === id; });
    if (!m || !m.depoYolu) return bildir("Bu materyalin dosyası bulunamadı.");
    state.indiriliyor = true;
    ciz();
    try {
      await imzaliAdreseGit(m.depoYolu, "Dosya bağlantısı alınamadı. Yetkin olmayabilir.");
    } finally {
      state.indiriliyor = false;
      ciz();
    }
  }

  async function sonuclandir(id, durum) {
    if (state.islemde) return;
    const sebepAlani = document.getElementById("ret-sebep");
    const sebep = sebepAlani ? sebepAlani.value : "";
    state.islemde = id;
    state.onayHata = null;
    ciz();
    let r;
    try { r = await gonderiSonuclandir(id, durum, sebep); }
    catch (e) { r = { ok: false, hata: "İşlem tamamlanamadı. Bağlantını kontrol et." }; }
    state.islemde = null;
    if (!r.ok) { state.onayHata = r.hata; return ciz(); }
    state.reddedilen = null;
    await bulutYenile();
    ciz();
    bildir(durum === "approved" ? "Materyal onaylandı ve arşive eklendi." : "Materyal reddedildi.");
  }

  /* ---------- genel arama ---------- */

  function aramaKatmani() {
    const q = state.aramaSorgu.toLowerCase().trim();
    let dersSonuc = [], matSonuc = [];

    if (q) {
      dersSonuc = DERSLER.filter((c) =>
        c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)).slice(0, 5);
      matSonuc = state.materyaller.filter((m) =>
        m.baslik.toLowerCase().includes(q) ||
        (m.aciklama || "").toLowerCase().includes(q) ||
        m.ekleyen.toLowerCase().includes(q) ||
        (m.etiketler || []).some((t) => t.toLowerCase().includes(q))).slice(0, 8);
    }

    const bos = q && !dersSonuc.length && !matSonuc.length;

    return `
      <div class="scrim" data-action="kapat"></div>
      <div class="cmd" role="dialog" aria-modal="true" aria-label="Arama">
        <div class="cmd-input">
          ${svg(I.search)}
          <input id="aramaGiris" type="text" placeholder="Ders, konu veya materyal ara…" value="${esc(state.aramaSorgu)}" autocomplete="off">
          <kbd class="kbd">esc</kbd>
        </div>
        <div class="cmd-results">
          ${!q ? '<p class="cmd-empty">Ders adı, materyal başlığı, etiket ya da ekleyen kişi yazabilirsin.</p>' : ""}
          ${dersSonuc.length ? '<p class="cmd-group">DERSLER</p>' + dersSonuc.map((c) => `
            <button class="cmd-item" data-action="ders" data-id="${c.id}">
              ${svg(I.bookOpen, "icon-sm")}
              <div><strong>${esc(c.name)}</strong><small>${esc(c.code)} · ${esc(donemAd(c.termId))} · ${c.grade}. Sınıf</small></div>
            </button>`).join("") : ""}
          ${matSonuc.length ? '<p class="cmd-group">MATERYALLER</p>' + matSonuc.map((m) => {
            const t = TURLER[m.tur] || TURLER["ders-notu"];
            const c = dersBul(m.ders);
            return `<button class="cmd-item" data-action="materyal" data-id="${esc(m.id)}">
              ${svg(t.icon, "icon-sm")}
              <div><strong>${esc(m.baslik)}</strong><small>${esc(t.ad)}${c ? " · " + esc(c.code) : ""} · ${esc(m.ekleyen)}</small></div>
            </button>`;
          }).join("") : ""}
          ${bos ? '<p class="cmd-empty">Eşleşen sonuç yok. Başka bir kelime deneyebilirsin.</p>' : ""}
        </div>
      </div>`;
  }

  /* ---------- çizim ---------- */

  function ciz() {
    if (!state.hazir) {
      root.innerHTML = '<div class="skeleton" role="status" aria-label="Arşiv yükleniyor">'
        + '<div class="sk sk-a"></div><div class="sk sk-b"></div><div class="sk sk-c"></div></div>';
      return;
    }

    if (!state.oturum) {
      root.innerHTML = girisGorunumu();
      return;
    }

    const govde = state.gorunum === "ders" ? dersGorunumu()
      : state.gorunum === "favoriler" ? favoriGorunumu()
      : state.gorunum === "gonderilerim" ? gonderilerimGorunumu()
      : state.gorunum === "onay" ? onayGorunumu()
      : panelGorunumu();

    const katman = state.katman === "paylas" ? paylasKatmani()
      : state.katman === "ara" ? aramaKatmani()
      : state.secili ? cekmece()
      : "";

    root.innerHTML = `
      <div class="app">
        ${kenarCubugu()}
        <div class="main">
          ${ustBar()}
          <main id="icerik" tabindex="-1">
            ${sunucuUyarisi()}
            ${govde}
          </main>
        </div>
      </div>
      ${state.sidebarAcik ? '<div class="scrim scrim-menu" data-action="menu-kapat"></div>' : ""}
      ${katman}`;

    katmanOdagi();
  }

  /* Sunucuya ulaşılamıyorsa kullanıcı bunu bilmeli: eksik bir arşiv
     sessizce "boş arşiv" gibi görünmemeli. Ham Supabase hata metni
     hiçbir zaman ekrana basılmaz. */
  function sunucuUyarisi() {
    if (!BULUT.hata) return "";
    return `
      <p class="uyari" role="status">
        ${svg(I.clock, "icon-sm")}
        <span>${esc(BULUT.hata)} <button class="crumb-btn" data-action="yeniden-dene">Yeniden dene</button></span>
      </p>`;
  }

  /* Katman açıldığında odak içeri alınır, kapandığında çağıran öğeye döner.
     Escape ve Tab döngüsü aşağıdaki keydown dinleyicisinde ele alınır. */
  let odakDonusu = null;

  function acikKatman() {
    return root.querySelector('[role="dialog"]');
  }

  function odaklanabilirler(kap) {
    return Array.prototype.filter.call(
      kap.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      function (el) { return el.offsetParent !== null || el === document.activeElement; });
  }

  function katmanOdagi() {
    const kap = acikKatman();
    if (!kap) { odakDonusu = null; return; }
    if (state.katman === "ara") {
      const el = document.getElementById("aramaGiris");
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); return; }
    }
    if (kap.contains(document.activeElement)) return;
    const ilk = odaklanabilirler(kap)[0];
    if (ilk) ilk.focus();
    else { kap.setAttribute("tabindex", "-1"); kap.focus(); }
  }

  /* ---------- etkileşim ---------- */

  async function favoriDegistir(id) {
    const i = state.favoriler.indexOf(id);
    if (i > -1) state.favoriler.splice(i, 1); else state.favoriler.unshift(id);
    await yaz("sosyolab:favoriler", state.favoriler);
    ciz();
  }

  async function materyalAc(id) {
    state.secili = id;
    state.silOnay = false;
    state.katman = null;
    state.sonGoruntulenen = [id].concat(state.sonGoruntulenen.filter((x) => x !== id)).slice(0, 8);
    await yaz("sosyolab:son", state.sonGoruntulenen);
    ciz();
  }

  function dersAc(id) {
    const c = dersBul(id);
    state.dersId = id;
    state.gorunum = "ders";
    state.kategori = "tumu";
    state.dersArama = "";
    state.sekme = "materyaller";
    state.katman = null;
    state.secili = null;
    state.sidebarAcik = false;
    if (c) { state.nav.donem = c.termId; state.nav.sinif = c.grade; }
    ciz();
  }

  const KATMAN_ACAN = { "paylas-ac": 1, "ara-ac": 1, materyal: 1 };
  const KATMAN_KAPATAN = { kapat: 1 };

  root.addEventListener("click", async (e) => {
    const hedef = e.target.closest("[data-action]");
    if (!hedef) return;
    const action = hedef.dataset.action;

    if (KATMAN_ACAN[action] && !acikKatman()) odakDonusu = hedef;
    if (KATMAN_KAPATAN[action]) odagiGeriVer();

    if (action === "giris") return girisDene();

    if (action === "cikis") {
      oturumuTemizle();
      await bulutCikis();
      return ciz();
    }

    if (action === "panel") { state.gorunum = "panel"; state.dersId = null; state.katman = null; state.sidebarAcik = false; return ciz(); }
    if (action === "favoriler") { state.gorunum = "favoriler"; state.katman = null; state.sidebarAcik = false; return ciz(); }

    if (action === "gonderilerim") {
      state.gorunum = "gonderilerim"; state.katman = null; state.sidebarAcik = false;
      if (BULUT.etkin) state.gonderiler = await gonderilerimiGetir();
      return ciz();
    }

    if (action === "onay") {
      if (!yetkili()) return bildir("Bu bölüm yalnızca yöneticilere açık.");
      state.gorunum = "onay"; state.katman = null; state.sidebarAcik = false; state.reddedilen = null;
      if (BULUT.etkin) state.bekleyen = await bekleyenleriGetir();
      return ciz();
    }

    if (action === "paylas-ac") {
      state.katman = "paylas"; state.secili = null; state.paylasHata = null; state.sidebarAcik = false;
      return ciz();
    }
    if (action === "paylas-gonder") return paylasimGonder();
    if (action === "onizle") { if (!yetkili()) return bildir("Yetkin yok."); return onizle(hedef.dataset.id); }
    if (action === "onayla") { if (!yetkili()) return bildir("Yetkin yok."); return sonuclandir(hedef.dataset.id, "approved"); }
    if (action === "ret-ac") { if (!yetkili()) return bildir("Yetkin yok."); state.reddedilen = hedef.dataset.id; return ciz(); }
    if (action === "ret-kapat") { state.reddedilen = null; return ciz(); }
    if (action === "reddet") { if (!yetkili()) return bildir("Yetkin yok."); return sonuclandir(hedef.dataset.id, "rejected"); }
    if (action === "ders") return dersAc(hedef.dataset.id);

    if (action === "donem") { state.nav.donem = hedef.dataset.id; state.katman = null; return ciz(); }

    if (action === "sinif") {
      const s = parseInt(hedef.dataset.sinif, 10);
      state.nav.sinif = state.nav.sinif === s ? null : s;
      state.katman = null;
      return ciz();
    }

    if (action === "sekme") { state.sekme = hedef.dataset.sekme; return ciz(); }
    if (action === "kategori") { state.kategori = hedef.dataset.tur; return ciz(); }
    if (action === "kategori-hepsi") { state.kategoriHepsi = !state.kategoriHepsi; return ciz(); }
    if (action === "materyal") return materyalAc(hedef.dataset.id);
    if (action === "favori") return favoriDegistir(hedef.dataset.id);
    if (action === "ara-ac") { state.katman = "ara"; state.secili = null; return ciz(); }
    if (action === "dosya-ac") return materyalDosyasiniAc(hedef.dataset.id);
    if (action === "daha-fazla") return dahaFazlaMateryal();

    if (action === "yeniden-dene") {
      BULUT.hata = null;
      ciz();
      await bulutYenile();
      return ciz();
    }
    if (action === "kapat") { state.katman = null; state.secili = null; state.silOnay = false; return ciz(); }
    if (action === "menu") { state.sidebarAcik = true; return ciz(); }
    if (action === "menu-kapat") { state.sidebarAcik = false; return ciz(); }

    if (action === "sil") {
      if (!yetkili()) return bildir("Materyal silmek için yönetici yetkisi gerekir.");
      if (state.islemde) return;
      if (!state.silOnay) { state.silOnay = true; return ciz(); }

      const id = state.secili;
      const kayit = state.materyaller.find((m) => m.id === id);
      if (!kayit) { state.silOnay = false; return ciz(); }

      /* Bulut modunda silme önce sunucuda gerçekleşir. Eskiden yalnızca
         bellekteki dizi filtreleniyor, kullanıcıya "kaldırıldı" deniyor,
         ama kayıt ilk yenilemede geri geliyordu. */
      if (BULUT.etkin) {
        state.islemde = "sil";
        ciz();
        const r = await materyalSil(id, kayit.depoYolu);
        state.islemde = null;
        if (!r.ok) { state.silOnay = false; ciz(); return bildir(r.hata); }
      }

      state.materyaller = state.materyaller.filter((m) => m.id !== id);
      state.favoriler = state.favoriler.filter((x) => x !== id);
      state.sonGoruntulenen = state.sonGoruntulenen.filter((x) => x !== id);
      await yaz("sosyolab:favoriler", state.favoriler);
      await yaz("sosyolab:son", state.sonGoruntulenen);
      if (!BULUT.etkin) await yaz("sosyolab:materyaller", state.materyaller);
      state.secili = null;
      state.silOnay = false;
      odagiGeriVer();
      ciz();
      return bildir("Materyal arşivden kaldırıldı.");
    }
  });

  root.addEventListener("input", (e) => {
    if (e.target.id === "dersArama") {
      state.dersArama = e.target.value;
      const konum = e.target.selectionStart;
      ciz();
      const yeni = document.getElementById("dersArama");
      if (yeni) { yeni.focus(); yeni.setSelectionRange(konum, konum); }
      return;
    }
    if (e.target.id === "aramaGiris") { state.aramaSorgu = e.target.value; return ciz(); }
    if (e.target.id === "sirala") { state.sirala = e.target.value; return ciz(); }
    if (e.target.dataset && e.target.dataset.kapsam2) {
      const donem = document.getElementById("p-donem").value;
      const sinif = parseInt(document.getElementById("p-sinif").value, 10);
      const sec = document.getElementById("p-ders");
      const dersler = DERSLER.filter(function (c) { return c.termId === donem && c.grade === sinif; });
      sec.innerHTML = dersler.length
        ? dersler.map(function (c) { return `<option value="${c.id}">${esc(c.code)} · ${esc(c.name)}</option>`; }).join("")
        : '<option value="">Bu dönem ve sınıfta ders yok</option>';
      return;
    }
  });

  root.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (e.target.id === "kimlik" || e.target.id === "sifre") { e.preventDefault(); girisDene(); }
  });

  function odagiGeriVer() {
    const el = odakDonusu;
    odakDonusu = null;
    if (el && document.contains(el)) { try { el.focus(); } catch (e) { /* yok sayılır */ } }
  }

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && state.oturum) {
      e.preventDefault();
      state.katman = state.katman === "ara" ? null : "ara";
      state.secili = null;
      ciz();
      return;
    }

    if (e.key === "Escape" && (state.katman || state.secili || state.sidebarAcik)) {
      state.katman = null;
      state.secili = null;
      state.silOnay = false;
      state.sidebarAcik = false;
      ciz();
      odagiGeriVer();
      return;
    }

    /* Açık bir katman varken Tab katmanın içinde döner: klavye kullanıcısı
       arkadaki erişilemez içeriğe düşmez (WCAG 2.4.3 / 2.1.2). */
    if (e.key === "Tab") {
      const kap = acikKatman();
      if (!kap) return;
      const liste = odaklanabilirler(kap);
      if (!liste.length) return;
      const ilk = liste[0];
      const son = liste[liste.length - 1];
      if (!kap.contains(document.activeElement)) { e.preventDefault(); return ilk.focus(); }
      if (e.shiftKey && document.activeElement === ilk) { e.preventDefault(); return son.focus(); }
      if (!e.shiftKey && document.activeElement === son) { e.preventDefault(); return ilk.focus(); }
    }
  });

  yukle().then(ciz, function () { state.hazir = true; ciz(); });
})();
