# Canlı doğrulama prosedürleri — arsiv.sosyolab.tr

Bu belge, **üretim ortamında elle** yapılacak doğrulamaları içerir. Hiçbiri
otomatik çalıştırılmaz; her adımı sen yürütürsün.

## Neden elle

Üç şey otomatik yapılamaz:

1. **Yönetici parolası** — kimse (bu belgeyi yazan dahil) parolayı bilmemeli.
2. **Test hesabı oluşturmak** üretim `auth.users` tablosuna satır yazar.
3. **service_role ile yapılan test, RLS kanıtı değildir** — o rol RLS'i aşar.
   Bu yüzden aşağıdaki testler gerçek tarayıcı oturumu ve public API ile
   çalışır, SQL Editor ile değil.

## Zaten kanıtlanmış olanlar

Aşağıdaki testleri yapmadan önce bilmen gereken: `schema.sql`,
`001_davet_kodlari.sql` ve `002_denetim_kaydi.sql` dosyaları **gerçek bir
PostgreSQL 16 üzerinde** çalıştırıldı ve 57 politika testi geçti (davet akışı,
ACCESS, STORAGE, denetim kaydı, eşzamanlılık). Ayrıntı: P0 closure raporu.

> **`003_launch_gate_hardening.sql` bu 57 testin İÇİNDE DEĞİLDİR** — o göç
> daha sonra yazıldı. 003 ayrı olarak, PostgreSQL 16 üzerinde tablo sahibi
> superuser OLMAYAN bir kurulumda 40 kontrollük bir matrisle sınandı (SL-09
> saldırı zinciri, yetim silme, transaction geri alma dahil). Ama o da yerel
> bir yeniden kurulumdu: **üretimin gerçekten bu politikalarla yapılandırıldığı
> yalnızca aşağıdaki adımlarla kanıtlanır** —
> ACCESS-11/11b/11c (SL-09 sınırı), B.2 (davetsiz oturum), B.3 (arayüz
> yönlendirmesi) ve STORAGE-04b/04c (yetim silme). Bu adımlar çalıştırılmadan
> 003 üretimde doğrulanmış sayılmaz.

Bu, **politika mantığının doğru olduğunu** kanıtlar. Aşağıdaki canlı testler
farklı bir şeyi kanıtlar: **üretimdeki Supabase projesinin gerçekten bu
politikalarla yapılandırıldığını.** İkisi birbirinin yerine geçmez.

---

## Yer tutucular

Bu belgedeki `<...>` ifadeleri **doldurulacak yer tutuculardır**. Gerçek
değerleri buraya yazmayın: depo herkese açıktır.

| Yer tutucu | Nereden alınır | Deponun içine yazılır mı |
|---|---|---|
| `<TESTKOD>` | Test için üretilen geçici davet kodu (B bölümü, 2. ön koşul) | **Hayır** |
| `<ONAYLI_YOL>` | Onaylanmış test materyalinin `file_path` değeri | Hayır |
| `<UID_A>` `<UID_B>` `<UID_D>` | Test betiklerinin konsola yazdırdığı geçici anonim UID'ler | Hayır |
| `<YONETICI_UID>` | Supabase → Authentication → Users → yönetici satırı | **Hayır — kesinlikle** |

> Yönetici UID'si bir kimlik bilgisi değildir, ama üretim kimliğidir ve
> herkese açık bir depoda durmasının hiçbir faydası yok. Gerektiğinde
> dashboard'dan okuyun, kullandıktan sonra bırakın.

---

## A. Yönetici giriş testi (AUTH-01 → AUTH-09)

> **ARAYÜZ DOĞRULAMASI** — yayınlanmış yeni `app.js` gerektirir.
> Yayın sırasında FAZ 2 adım 10'da çalıştırılır (bkz. DEPLOYMENT-SECURITY bölüm 11).

**Ön koşul:** Yönetici parolası yalnızca senin parola yöneticinde.
Parolayı hiçbir yere yazma, ekran paylaşımında gösterme, bu belgeye ekleme.

Temiz bir tarayıcı profili kullan (ya da gizli pencere) — eski bir oturumun
sonucu maskelemesini önler.

| # | Adım | Beklenen UI durumu |
|---|---|---|
| **A** | `https://arsiv.sosyolab.tr` aç | Giriş ekranı. İki alan **tamamen boş** (içlerinde örnek/ipucu metni yok). Dışarıda "Öğrenci numarası veya kullanıcı adı" ve "Davet kodu veya parola" etiketleri görünür. Hiçbir yerde `@sosyolab.local` yazmıyor. |
| **B** | Kullanıcı adı: `sosyolog35` · Parola: doğru parola · "Arşive Gir" | Düğme kısa süre "Kontrol ediliyor…" olur ve **devre dışı** kalır (çift tıklama ikinci istek atmaz). Sonra panel açılır. |
| **C** | Sol kenar çubuğunu incele | **"Onay Bekleyenler"** bağlantısı görünür. Alt köşede ad ve `sosyolog35 · Admin` yazar. Üstte "Materyal Paylaş" düğmesi etkin. |
| **D** | "Onay Bekleyenler"e gir | Bekleyen gönderi varsa kart listesi; her kartta **Önizle / Onayla / Reddet**. Bekleyen yoksa "Bekleyen gönderi yok." boş durumu. |
| **E** | Bir materyal aç (çekmece) | "Materyali aç" düğmesi ve altında *"Bağlantı kişiye özel üretilir ve 5 dakika sonra geçersiz olur."* notu. Alt kısımda **"Arşivden kaldır"** düğmesi görünür. |
| **F** | Sayfayı yenile (F5) | Oturum korunur, panel açılır, **"Onay Bekleyenler" hâlâ görünür**. Rol her açılışta `profiles` tablosundan yeniden okunur. |
| **G** | Yeni bir sekmede aynı adresi aç | Aynı oturum, yönetici araçları görünür. |
| **H** | İlk sekmede çıkış düğmesine bas | Giriş ekranına döner. |
| **I** | İkinci sekmeyi yenile | **Giriş ekranı** gelir. Yönetici araçları görünmez. (Supabase `SIGNED_OUT` olayı ile arayüz temizlenir.) |
| **J** | Yenile (F5) | Hâlâ giriş ekranı. Yönetici oturumu geri **gelmez**. |

### Aynı oturumda ek negatif testler

| # | Adım | Beklenen |
|---|---|---|
| **K** | `sosyolog35` + **yanlış** parola | *"Kullanıcı adı veya parola hatalı."* Odak parola alanına gider. Panel açılmaz. |
| **L** | Çıkış yaptıktan sonra konsolda:<br>`localStorage.setItem('sosyolab:oturum', JSON.stringify({no:'sosyolog35',ad:'X',rol:'admin',sinif:null}))` sonra F5 | **Giriş ekranı.** Yönetici arayüzü açılmaz, uydurma kayıt silinir. |
| **M** | Konsolda `Object.keys(localStorage).filter(k=>k.startsWith('sb-'))` | Çıkıştan sonra **boş dizi** — Supabase oturumu da temizlenmiş. |

> **L ve M testleri yerelde üretim yapılandırmasıyla zaten çalıştırıldı ve
> geçti.** Canlı ortamda yinelemek yine değerli: aynı davranışın üretimde de
> geçerli olduğunu gösterir.

---

## B. Canlı RLS testi (ACCESS-01 → ACCESS-11c)

> **VERİTABANI DOĞRULAMASI** — yalnızca uygulanmış göç gerektirir, yeni
> `app.js` GEREKMEZ. Yayın sırasında FAZ 2 adım 5'te, push'tan ÖNCE çalıştırılır.

### Yaklaşım

İki geçici anonim kullanıcı (**TEST_USER_A**, **TEST_USER_B**) oluşturulur ve
tüm iddialar **tarayıcıdaki public API** üzerinden sınanır. `service_role`
hiçbir adımda kullanılmaz.

### Ön koşullar

1. `001_davet_kodlari.sql` uygulanmış olmalı.
2. Test için **ayrı bir davet kodu** oluştur (dönem kodunu kullanma):

   ```sql
   -- SQL Editor. <TESTKOD> yerine üretilmiş bir değer koy:
   --   select upper(encode(extensions.gen_random_bytes(16), 'hex')); -- 32 hex = 128-bit
   insert into public.davet_kodlari (kod_ozeti, etiket, azami_kullanim, gecerlilik_sonu)
   values (extensions.crypt(upper('<TESTKOD>'), extensions.gen_salt('bf', 10)),
           'GEÇİCİ TEST — silinecek', 5, now() + interval '2 hours');
   ```

3. **Gerçek öğrenci verisi kullanma.** Test materyallerinin başlığı
   `ZZTEST` ile başlasın; temizlik bunu kullanır.

### Test betiği

`https://arsiv.sosyolab.tr` adresini aç, **giriş yapma**, tarayıcı konsolunu
aç ve aşağıdakini yapıştır. `<TESTKOD>` yerine 2. adımdaki kodu yaz.

> Betik kendi Supabase istemcilerini `persistSession: false` ile kurar; senin
> oturumunu bozmaz. Konsola yapıştırılan kod CSP `script-src` kısıtından
> etkilenmez (devtools ayrı bir bağlamda çalışır).

```js
(async () => {
  const KOD = '<TESTKOD>';                     // <-- doldur
  const C = window.SOSYOLAB_CONFIG;
  const mk = () => window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY,
                    { auth: { persistSession: false, autoRefreshToken: false } });
  const R = [];
  const ok = (kod, ad, gecti, ek = '') =>
    R.push({ kod, sonuc: gecti ? 'PASS' : 'FAIL', test: ad, ayrinti: String(ek).slice(0, 120) });

  const A = mk(), B = mk();
  const a = await A.auth.signInAnonymously(); if (a.error) throw a.error;
  const b = await B.auth.signInAnonymously(); if (b.error) throw b.error;
  const UID_A = a.data.user.id, UID_B = b.data.user.id;
  console.log('TEST_USER_A =', UID_A, '\nTEST_USER_B =', UID_B, '\n(temizlik için sakla)');

  // Profil oluştur (uygulamanın ilk giriş akışı)
  await A.from('profiles').insert({ id: UID_A, display_name: 'ZZTEST A' });
  await B.from('profiles').insert({ id: UID_B, display_name: 'ZZTEST B' });

  // Yeni profil admin olamaz
  let p = await A.from('profiles').select('role').eq('id', UID_A).maybeSingle();
  ok('ACCESS-00', 'Yeni profil role=user', p.data && p.data.role === 'user', p.data && p.data.role);

  // Davet doğrulanmadan gönderim engellenir
  let ins = await A.from('materials').insert({
    course_id: 'sos101', uploader_id: UID_A, title: 'ZZTEST davetsiz',
    file_path: UID_A + '/zz0.pdf', file_name: 'zz0.pdf', status: 'pending' });
  ok('INVITE-03', 'Davet yoksa gönderim reddedilir', !!ins.error, ins.error && ins.error.code);

  // Davet doğrula
  let d1 = await A.rpc('davet_kullan', { p_kod: 'KESINLIKLE-YANLIS' });
  ok('INVITE-01', 'Yanlış kod false döner', d1.data === false, JSON.stringify(d1.data));
  let d2 = await A.rpc('davet_kullan', { p_kod: KOD });
  ok('INVITE-04', 'Doğru kod true döner', d2.data === true, JSON.stringify(d2.data));
  // INVITE-05: damganın yazıldığı, uygulamanın GERÇEK erişim yolundan sınanır.
  // Damga tablosu istemciye kapalıdır (authenticated'ın SELECT ayrıcalığı YOK);
  // app.js de onu hiç okumaz, davet_dogrulandi_mi() RPC'sini sorar (app.js ~1045).
  // Tabloyu doğrudan select etmek 42501 / HTTP 403 verir — bu beklenen ve
  // istenen davranıştır, INVITE-05b onu ayrıca kanıtlar.
  let dv = await A.rpc('davet_dogrulandi_mi');
  ok('INVITE-05', 'Damga gerçekten yazıldı (RPC)', dv.data === true,
     dv.error ? dv.error.code : JSON.stringify(dv.data));

  // INVITE-05b: damga tablosu istemciye AYRICALIK DÜZEYİNDE kapalı.
  // Üretimde kanıtlanan sözleşme tam olarak şudur:
  //   ERROR 42501: permission denied for table davet_dogrulamalari
  // PostgREST bunu gövdesinde code:"42501" ile 403 sınıfında döner. supabase-js
  // 2.45.4 (vendor/supabase-js-2.45.4.min.js) hatalı yanıtın gövdesini JSON.parse
  // edip error nesnesi yapar: {code, details, hint, message}; status da yanıtta
  // gelir. Yani error.code PostgreSQL SQLSTATE'idir — varsayım değil, bu
  // sürümün fiilî davranışı.
  //
  // KABUL EDILMEYENLER — bilinçli olarak KATI:
  //   * BOŞ BAŞARILI SONUÇ PASS DEĞİLDİR. O, "SELECT ayrıcalığı VAR, RLS
  //     değerlendirildi ve satırları filtreledi" demektir — kanıtladığımız
  //     "ayrıcalık hiç yok" sözleşmesinden maddeten farklı bir durumdur.
  //   * İLGİSİZ HATA PASS DEĞİLDİR (ağ hatası, PGRST3xx jeton hatası, 404 …).
  // Dört sonucu ayırt edebilmek için tanı metni her durumda doldurulur.
  let dt = await A.from('davet_dogrulamalari').select('user_id');
  const dtKod = dt.error ? dt.error.code : null;
  const dtTani = dt.error
    ? ('code=' + JSON.stringify(dtKod) + ' status=' + dt.status + ' msg=' +
       String(dt.error.message || '').slice(0, 55))
    : ((dt.data || []).length === 0
        ? 'BAŞARILI+BOŞ — grant VAR, RLS filtreledi: SÖZLEŞME İHLALİ'
        : 'BAŞARILI+' + dt.data.length + ' SATIR OKUNDU: SÖZLEŞME İHLALİ');
  ok('INVITE-05b', 'Damga tablosu ayrıcalık düzeyinde kapalı (42501)',
     dtKod === '42501', dtTani);
  await B.rpc('davet_kullan', { p_kod: KOD });

  // A ve B birer pending materyal oluşturur
  const insA = await A.from('materials').insert({
    course_id: 'sos101', uploader_id: UID_A, title: 'ZZTEST A materyal',
    file_path: UID_A + '/zz1.pdf', file_name: 'zz1.pdf', status: 'pending' }).select('id').maybeSingle();
  ok('INVITE-06', 'Damga sonrası gönderim çalışır', !insA.error, insA.error && insA.error.message);
  const insB = await B.from('materials').insert({
    course_id: 'sos101', uploader_id: UID_B, title: 'ZZTEST B materyal',
    file_path: UID_B + '/zz2.pdf', file_name: 'zz2.pdf', status: 'pending' }).select('id').maybeSingle();

  // ACCESS-01: A, B'nin profilini okuyamaz
  let r = await A.from('profiles').select('id').eq('id', UID_B);
  ok('ACCESS-01', "A, B'nin profilini okuyamaz", r.data && r.data.length === 0, JSON.stringify(r.data));

  // ACCESS-02 / 05: A, B'nin pending materyalini okuyamaz
  r = await A.from('materials').select('id,title').eq('uploader_id', UID_B);
  ok('ACCESS-02', "A, B'nin pending materyalini okuyamaz", r.data && r.data.length === 0, JSON.stringify(r.data));
  r = await A.from('materials').select('id').neq('status', 'approved');
  ok('ACCESS-05', 'A yalnızca kendi onaysız kaydını görür',
     r.data && r.data.length === 1, 'görülen=' + (r.data || []).length);

  // ACCESS-03: A kendi rolünü admin yapamaz
  await A.from('profiles').update({ role: 'admin' }).eq('id', UID_A);
  r = await A.from('profiles').select('role').eq('id', UID_A).maybeSingle();
  ok('ACCESS-03', 'A kendi rolünü admin yapamaz', r.data && r.data.role === 'user', r.data && r.data.role);

  // ACCESS-04: A, B adına materyal ekleyemez
  r = await A.from('materials').insert({
    course_id: 'sos101', uploader_id: UID_B, title: 'ZZTEST sahte sahip',
    file_path: UID_B + '/zz3.pdf', file_name: 'zz3.pdf', status: 'pending' });
  ok('ACCESS-04', "A, B adına materyal ekleyemez", !!r.error, r.error && r.error.code);

  // ACCESS-04b: A doğrudan approved ekleyemez
  r = await A.from('materials').insert({
    course_id: 'sos101', uploader_id: UID_A, title: 'ZZTEST kendini onaylama',
    file_path: UID_A + '/zz4.pdf', file_name: 'zz4.pdf', status: 'approved' });
  ok('ACCESS-04b', 'A doğrudan approved ekleyemez', !!r.error, r.error && r.error.code);

  // ACCESS-11: A, file_path olarak B'nin klasörünü GÖSTEREMEZ  ← göç 003 / SL-09
  // Bu, denetimde uçtan uca doğrulanmış saldırı zincirinin ilk halkasıdır:
  //   A, B'nin özel nesnesini gösteren kayıt açar → yönetici onaylar →
  //   B'nin onaylanmamış dosyası bütün davetlilere okunur hâle gelir.
  // 003 zinciri burada, INSERT sınırında kırar.
  r = await A.from('materials').insert({
    course_id: 'sos101', uploader_id: UID_A, title: 'ZZTEST baskasinin dosyasi',
    file_path: UID_B + '/zz-calinti.pdf', file_name: 'zz-calinti.pdf', status: 'pending' });
  ok('ACCESS-11', "A, B'nin depo yolunu gösteren kayıt açamaz", !!r.error, r.error && r.error.code);

  // ACCESS-11b: kendi klasörü dışındaki biçimler de reddedilir
  r = await A.from('materials').insert({
    course_id: 'sos101', uploader_id: UID_A, title: 'ZZTEST koksuz yol',
    file_path: 'koksuz.pdf', file_name: 'koksuz.pdf', status: 'pending' });
  ok('ACCESS-11b', 'Klasörsüz file_path reddedilir', !!r.error, r.error && r.error.code);

  // ACCESS-11c: meşru akış bozulmadı — kendi klasörü kabul edilir
  r = await A.from('materials').insert({
    course_id: 'sos101', uploader_id: UID_A, title: 'ZZTEST kendi klasoru',
    file_path: UID_A + '/zz-kendi.pdf', file_name: 'zz-kendi.pdf', status: 'pending' });
  ok('ACCESS-11c', 'Kendi klasörünü gösteren gönderim çalışır', !r.error, r.error && r.error.message);

  // ACCESS-07: A kendi materyalini onaylayamaz
  await A.from('materials').update({ status: 'approved' }).eq('id', insA.data.id);
  r = await A.from('materials').select('status').eq('id', insA.data.id).maybeSingle();
  ok('ACCESS-07', 'A materyalini onaylayamaz', r.data && r.data.status === 'pending', r.data && r.data.status);

  // ACCESS-07b: A materyal silemez
  await A.from('materials').delete().eq('id', insA.data.id);
  r = await A.from('materials').select('id').eq('id', insA.data.id);
  ok('ACCESS-07b', 'A materyal silemez', r.data && r.data.length === 1, 'kalan=' + (r.data || []).length);

  // Davet kodu tablosu istemciye kapalı
  r = await A.from('davet_kodlari').select('id');
  ok('ACCESS-10', 'davet_kodlari istemciye kapalı',
     !!r.error || (r.data && r.data.length === 0), r.error ? r.error.code : JSON.stringify(r.data));

  // Denetim kaydı normal kullanıcıya kapalı
  r = await A.from('denetim_kaydi').select('id');
  ok('AUDIT-05', 'Normal kullanıcı denetim kaydını okuyamaz',
     !!r.error || (r.data && r.data.length === 0), r.error ? r.error.code : JSON.stringify(r.data));

  console.table(R);
  console.log('PASS:', R.filter(x => x.sonuc === 'PASS').length, '/ FAIL:', R.filter(x => x.sonuc === 'FAIL').length);
  console.log('TEMİZLİK İÇİN:\n  TEST_USER_A =', UID_A, '\n  TEST_USER_B =', UID_B);
  window.__ZZTEST = { UID_A, UID_B, matA: insA.data && insA.data.id, matB: insB.data && insB.data.id };
})();
```

### ACCESS-06: yönetici tarafı (ayrı tarayıcı profili)

Yukarıdaki betik bitince, **başka bir tarayıcı profilinde** yöneticiyle
giriş yap:

| # | Beklenen |
|---|---|
| ACCESS-06 | "Onay Bekleyenler" listesinde **ZZTEST A materyal** ve **ZZTEST B materyal** görünür (normal kullanıcı bunları göremiyordu). |
| ACCESS-06b | Birini **Onayla** → başarı bildirimi, kart listeden düşer. |
| ACCESS-06c | SQL Editor: `select reviewed_by, reviewed_at from public.materials where title like 'ZZTEST%';` → `reviewed_by` **yönetici UID'si** (`<YONETICI_UID>`), `reviewed_at` dolu. İstemci bu alanları göndermedi; sunucu damgaladı. |
| ACCESS-08 | Öğrenci sekmesinde konsolda `await (window.supabase.createClient(SOSYOLAB_CONFIG.SUPABASE_URL, SOSYOLAB_CONFIG.SUPABASE_ANON_KEY)).from('materials').select('id').eq('status','approved')` → onaylanan kayıt görünür. |
| AUDIT-01 | SQL Editor: `select eylem, aktor_id, nesne_id, olusma from public.denetim_kaydi order by olusma desc limit 10;` → `materyal_onay` satırı, `aktor_id` = yönetici UID. |

---

## B.2 Davetsiz oturum testleri (INVITE-07 → INVITE-11)

> **VERİTABANI DOĞRULAMASI** — yeni `app.js` GEREKMEZ. FAZ 2 adım 5.

**Bu bölüm göç 003'ün asıl kazancını sınar.** 003 öncesinde davet kodu
yalnızca gönderimi kısıtlıyordu: anonim giriş açık olduğu için kodu hiç
bilmeyen biri oturum açıp onaylı arşivin tamamını okuyabiliyor ve kovaya
dosya yazabiliyordu (denetim bulguları SL-01 ve SL-03).

**Ön koşul:** yukarıdaki ACCESS-06b adımında en az bir ZZTEST materyali
onaylanmış olmalı — testin "onaylı içerik" görmemesi anlamlı olsun diye.

`https://arsiv.sosyolab.tr` adresinde **yeni bir gizli pencere** aç (temiz
localStorage şart: aksi hâlde istemci mevcut davetli oturumu devralır),
konsola yapıştır:

```js
(async () => {
  const C = window.SOSYOLAB_CONFIG;
  const R = [];
  const ok = (kod, ad, gecti, ek = '') =>
    R.push({ kod, sonuc: gecti ? 'PASS' : 'FAIL', test: ad, ayrinti: String(ek).slice(0, 140) });

  // Davetsiz kullanıcı: anonim oturum açar, davet_kullan ÇAĞIRMAZ.
  const D = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY,
              { auth: { persistSession: false, autoRefreshToken: false } });
  const d = await D.auth.signInAnonymously(); if (d.error) throw d.error;
  const UID_D = d.data.user.id;
  console.log('TEST_USER_D (davetsiz) =', UID_D, '(temizlik için sakla)');
  await D.from('profiles').insert({ id: UID_D, display_name: 'ZZTEST D davetsiz' });

  // Damga gerçekten yok
  let v = await D.rpc('davet_dogrulandi_mi');
  ok('INVITE-07', 'Damga yok (kontrol)', v.data === false, JSON.stringify(v.data));

  // INVITE-08: onaylı arşivi okuyamaz  ← SL-01
  let r = await D.from('materials').select('id,title').eq('status', 'approved');
  ok('INVITE-08', 'Davetsiz kullanıcı onaylı arşivi okuyamaz',
     !r.error && r.data && r.data.length === 0,
     r.error ? r.error.code : 'görülen=' + (r.data || []).length);

  // INVITE-09: kovaya yükleyemez  ← SL-03
  const dosya = new Blob([new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31,0x2e,0x34,0x0a])],
                         { type: 'application/pdf' });
  let u = await D.storage.from('materyaller').upload(UID_D + '/zz-d.pdf', dosya,
            { contentType: 'application/pdf' });
  ok('INVITE-09', 'Davetsiz kullanıcı kovaya yükleyemez', !!u.error, u.error && u.error.message);

  // INVITE-10: materials kaydı açamaz (001'den beri geçerli, regresyon kontrolü)
  r = await D.from('materials').insert({
    course_id: 'sos101', uploader_id: UID_D, title: 'ZZTEST D gönderim',
    file_path: UID_D + '/zz-d.pdf', file_name: 'zz-d.pdf', status: 'pending' });
  ok('INVITE-10', 'Davetsiz kullanıcı gönderim yapamaz', !!r.error, r.error && r.error.code);

  // INVITE-11: onaylı bir dosya için çalışan imzalı bağlantı ÜRETEMEZ.
  // <ONAYLI_YOL> yerine SQL Editor'den alınan yolu yaz:
  //   select file_path from public.materials where status='approved' and title like 'ZZTEST%' limit 1;
  const ONAYLI_YOL = '<ONAYLI_YOL>';
  if (ONAYLI_YOL === '<ONAYLI_YOL>') {
    R.push({ kod: 'INVITE-11', sonuc: 'ATLANDI', test: 'İmzalı bağlantı reddi', ayrinti: 'ONAYLI_YOL doldurulmadı' });
  } else {
    let s = await D.storage.from('materyaller').createSignedUrl(ONAYLI_YOL, 60);
    let erisildi = false;
    if (!s.error && s.data) { try { erisildi = (await fetch(s.data.signedUrl)).ok; } catch (e) {} }
    ok('INVITE-11', 'Davetsiz kullanıcı onaylı dosyayı indiremez',
       !!s.error || !erisildi, s.error ? s.error.message : 'fetch.ok=' + erisildi);
  }

  console.table(R);
  console.log('PASS:', R.filter(x => x.sonuc === 'PASS').length,
              '/ FAIL:', R.filter(x => x.sonuc === 'FAIL').length,
              '/ ATLANDI:', R.filter(x => x.sonuc === 'ATLANDI').length);
  console.log('TEMİZLİK İÇİN: TEST_USER_D =', UID_D);
})();
```

> **ATLANDI bir PASS değildir.** INVITE-11 doldurulmadan bu bölüm tamamlanmış
> sayılmaz: imzalı bağlantı reddi, okuma reddinin dosya tarafındaki karşılığıdır.

### B.3 Arayüz kontrolü — damgasız oturum panele düşmemeli

> **ARAYÜZ DOĞRULAMASI** — yayınlanmış yeni `app.js` GEREKİR. FAZ 2 adım 10,
> yani commit/push ve Pages dağıtımından SONRA.

`app.js` göç 003'ten sonra, oturumu olup davet damgası olmayan kullanıcıyı
panele almaz (aksi hâlde BOŞ bir arşiv görüp nedenini anlamazdı).

| # | Adım | Beklenen |
|---|---|---|
| UI-01 | Yeni gizli pencere → 10 haneli numara + **yanlış** kod → "Arşive Gir" | *"Davet kodu geçersiz ya da süresi dolmuş."* Panel açılmaz. |
| UI-02 | Aynı pencerede sayfayı **yenile** (F5) | Giriş ekranı. Panel **açılmaz**. Üstte *"Arşive girmek için davet kodunu doğrulaman gerekiyor."* görünebilir. |
| UI-03 | Aynı pencerede **doğru** kodu gir | Panel açılır, arşiv dolu gelir. Yeni bir anonim kullanıcı oluşmaz: damga mevcut kimliğe basılır. |

> UI-02 bilinçli bir tasarım: Supabase oturumu kapatılmaz, yalnızca arayüz
> giriş ekranında tutulur. Böylece kullanıcı kodu girdiğinde aynı anonim
> kimlik damgalanır ve her denemede geride yeni bir `auth.users` satırı
> kalmaz. Erişimi kesen şey bu arayüz kararı değil, RLS'tir.

---

## C. Canlı Storage testi (STORAGE-01 → STORAGE-06)

> **VERİTABANI DOĞRULAMASI** — yeni `app.js` GEREKMEZ (STORAGE-05/06 yönetici
> arayüzünü kullanır; onları FAZ 2 adım 10'a bırakabilirsiniz). FAZ 2 adım 5.

Yukarıdaki RLS betiğinden **hemen sonra**, aynı konsolda çalıştır (oturumlar
`window.__ZZTEST` üzerinden yeniden kurulur):

```js
(async () => {
  const C = window.SOSYOLAB_CONFIG;
  const mk = () => window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY,
                    { auth: { persistSession: false, autoRefreshToken: false } });
  const R = [];
  const ok = (kod, ad, gecti, ek = '') =>
    R.push({ kod, sonuc: gecti ? 'PASS' : 'FAIL', test: ad, ayrinti: String(ek).slice(0, 140) });

  const A = mk(), B = mk();
  const a = await A.auth.signInAnonymously(), b = await B.auth.signInAnonymously();
  const UID_A = a.data.user.id, UID_B = b.data.user.id;
  const KOD = '<TESTKOD>';                     // <-- doldur
  await A.rpc('davet_kullan', { p_kod: KOD });
  await B.rpc('davet_kullan', { p_kod: KOD });
  await A.from('profiles').insert({ id: UID_A, display_name: 'ZZTEST SA' });
  await B.from('profiles').insert({ id: UID_B, display_name: 'ZZTEST SB' });
  const dosya = new Blob([new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31,0x2e,0x34,0x0a])],
                         { type: 'application/pdf' });

  // STORAGE-00: A kendi dizinine yükler
  let u = await A.storage.from('materyaller').upload(UID_A + '/zz-a.pdf', dosya, { contentType: 'application/pdf' });
  ok('STORAGE-00', 'A kendi dizinine yükleyebilir', !u.error, u.error && u.error.message);

  // STORAGE-03: A, B'nin dizinine yükleyemez
  u = await A.storage.from('materyaller').upload(UID_B + '/sizma.pdf', dosya, { contentType: 'application/pdf' });
  ok('STORAGE-03', "A, B'nin dizinine yükleyemez", !!u.error, u.error && u.error.message);

  // B kendi dosyasını yükler ve PENDING materyal kaydı açar
  await B.storage.from('materyaller').upload(UID_B + '/zz-b.pdf', dosya, { contentType: 'application/pdf' });
  await B.from('materials').insert({ course_id: 'sos101', uploader_id: UID_B, title: 'ZZTEST S B',
    file_path: UID_B + '/zz-b.pdf', file_name: 'zz-b.pdf', status: 'pending' });

  // STORAGE-01 / 02: A, B'nin pending dosyasını indiremez (path tahminiyle de)
  let d = await A.storage.from('materyaller').download(UID_B + '/zz-b.pdf');
  ok('STORAGE-01', "A, B'nin pending dosyasını indiremez", !!d.error, d.error && d.error.message);
  let s = await A.storage.from('materyaller').createSignedUrl(UID_B + '/zz-b.pdf', 60);
  let erisildi = false;
  if (!s.error && s.data) { try { erisildi = (await fetch(s.data.signedUrl)).ok; } catch (e) {} }
  ok('STORAGE-02', 'Path değiştirerek imzalı bağlantı alınamaz (IDOR yok)',
     !!s.error || !erisildi, s.error ? s.error.message : 'fetch.ok=' + erisildi);

  // STORAGE-04: A, B'nin objesini silemez
  let rm = await A.storage.from('materyaller').remove([UID_B + '/zz-b.pdf']);
  let halaVar = !(await B.storage.from('materyaller').download(UID_B + '/zz-b.pdf')).error;
  ok('STORAGE-04', "A, B'nin objesini silemez", halaVar, 'B hâlâ okuyabiliyor=' + halaVar);

  // STORAGE-04b: A kendi YETİM objesini silebilir (göç 003 temizlik yolu).
  // Ayrı bir dosya kullanılır: zz-a.pdf STORAGE-08'de hâlâ gerekli.
  await A.storage.from('materyaller').upload(UID_A + '/zz-yetim.pdf', dosya, { contentType: 'application/pdf' });
  await A.storage.from('materyaller').remove([UID_A + '/zz-yetim.pdf']);
  let yetimGitti = !!(await A.storage.from('materyaller').download(UID_A + '/zz-yetim.pdf')).error;
  ok('STORAGE-04b', 'Sahip kendi YETİM objesini silebilir', yetimGitti, 'silindi=' + yetimGitti);

  // STORAGE-04c: bağlı obje sahibi tarafından BİLE silinemez.
  // zz-b.pdf'i B'nin pending materyali gösteriyor; yayın koruması budur.
  await B.storage.from('materyaller').remove([UID_B + '/zz-b.pdf']);
  let bagliVar = !(await B.storage.from('materyaller').download(UID_B + '/zz-b.pdf')).error;
  ok('STORAGE-04c', 'Materyale bağlı obje sahibi tarafından bile silinemez',
     bagliVar, 'duruyor=' + bagliVar);

  // Signed URL süresi: 5 saniyelik bağlantı 7 saniye sonra geçersiz olmalı
  let kisa = await A.storage.from('materyaller').createSignedUrl(UID_A + '/zz-a.pdf', 5);
  let hemen = kisa.data ? (await fetch(kisa.data.signedUrl)).status : 0;
  await new Promise(r => setTimeout(r, 7000));
  let sonra = kisa.data ? (await fetch(kisa.data.signedUrl)).status : 0;
  ok('STORAGE-08', 'İmzalı bağlantı süresi dolunca geçersiz olur',
     hemen === 200 && sonra !== 200, 'hemen=' + hemen + ' 7sn sonra=' + sonra);

  console.table(R);
  console.log('TEMİZLİK:\n  UID_A =', UID_A, '\n  UID_B =', UID_B);
})();
```

### STORAGE-05 / 06: yönetici tarafı

Yönetici profilinde:

| # | Adım | Beklenen |
|---|---|---|
| STORAGE-05 | "Onay Bekleyenler" → ZZTEST kaydında **Önizle** | Yeni sekmede PDF açılır — yönetici pending dosyayı okuyabiliyor. |
| STORAGE-06 | ZZTEST kaydını **Onayla**, sonra öğrenci sekmesinde arşivden aç → **Materyali aç** | Dosya açılır. Onaylı materyalin dosyası, **daveti doğrulanmış** her kullanıcıya açıktır (göç 003 öncesinde kimliği doğrulanmış herkese açıktı). |
| STORAGE-05b | Çekmecede **Arşivden kaldır** → tekrar bas | Kayıt gider. SQL Editor: `select count(*) from storage.objects where name like UID_B \|\| '%';` → 0. Hem kayıt hem dosya silindi. |
| — | Adres çubuğuna imzalı bağlantıyı yapıştırıp **5 dakika** bekle, yenile | Erişim reddedilir. |

---

## D. Temizlik — ZORUNLU

Testten sonra mutlaka yap. Sıra önemli: dosyalar → kayıtlar → kullanıcılar.

```sql
-- 1) Test materyallerinin dosya yollarını al (silmeden önce not et)
select id, file_path from public.materials where title like 'ZZTEST%';
```

```js
// 2) Storage nesnelerini sil — yönetici oturumundaki tarayıcı konsolunda.
//    (Silme politikası admin-only olduğu için yönetici olarak çalıştır.)
//    Yolları 1. adımdan yapıştır:
await window.supabase
  .createClient(SOSYOLAB_CONFIG.SUPABASE_URL, SOSYOLAB_CONFIG.SUPABASE_ANON_KEY)
  .storage.from('materyaller')
  .remove(['<UID_A>/zz-a.pdf', '<UID_B>/zz-b.pdf', '<UID_A>/zz1.pdf', '<UID_B>/zz2.pdf']);
```

```sql
-- 3) Test kayıtlarını ve kullanıcılarını sil (SQL Editor).
--    auth.users silinince profiles, davet_dogrulamalari, davet_denemeleri
--    ON DELETE CASCADE ile temizlenir; materials.uploader_id ise
--    ON DELETE SET NULL olduğu için önce materyalleri siliyoruz.

delete from public.materials where title like 'ZZTEST%';

delete from auth.users
 where id in ('<UID_A>', '<UID_B>', '<UID_D>')  -- betiklerin yazdırdığı UID'ler
                                                 -- UID_D: B.2 davetsiz oturum testi
   and is_anonymous = true;                      -- güvenlik ağı: gerçek hesap silinmesin

-- 4) Geçici davet kodunu kapat
update public.davet_kodlari set aktif = false where etiket = 'GEÇİCİ TEST — silinecek';
delete from public.davet_kodlari where etiket = 'GEÇİCİ TEST — silinecek';

-- 5) Artık dosya kaldı mı?
--    zz-yetim.pdf (STORAGE-04b) ve zz-d.pdf (INVITE-09) burada GÖRÜNMEMELİ:
--    ilki test sırasında silindi, ikincisi hiç yüklenemedi.
select name from storage.objects
 where name like '<UID_A>/%' or name like '<UID_B>/%' or name like '<UID_D>/%';
-- Satır dönerse: storage.objects üzerinden elle sil (service_role):
--   delete from storage.objects where name like '<UID_A>/%' or name like '<UID_B>/%';
--   NOT: bu yalnızca metadata'yı siler. Asıl dosyayı Dashboard → Storage
--   üzerinden ya da yukarıdaki .remove() çağrısıyla silmek gerekir.

-- 6) Denetim kaydında ZZTEST izleri kalır ve BU DOĞRUDUR — iz silinemez.
--    Test olduklarını not etmek için:
select id, eylem, nesne_id, ayrinti->>'baslik' as baslik, olusma
  from public.denetim_kaydi
 where ayrinti->>'baslik' like 'ZZTEST%' order by olusma desc;
```

```sql
-- 7) Son doğrulama: hiçbir test artığı kalmadı mı?
select 'materials' as tablo, count(*) from public.materials where title like 'ZZTEST%'
union all select 'profiles', count(*) from public.profiles where display_name like 'ZZTEST%'
union all select 'davet_kodlari', count(*) from public.davet_kodlari where etiket like 'GEÇİCİ TEST%';
-- Üç satır da 0 olmalı.
```

> **Uyarı:** `delete from auth.users` yalnızca yukarıdaki iki UID ile ve
> `is_anonymous = true` koşuluyla çalıştırılmalı. Koşulu kaldırmayın ve
> `where` olmadan asla çalıştırmayın. **Yönetici hesabının UID'si bu
> sorguya asla girmemeli.** Gerçek UID bu depoya YAZILMAZ — depo herkese
> açıktır; UID'yi Supabase → Authentication → Users ekranından okuyun ve
> yalnızca o an kullanın.

---

## E. Sonucu nasıl raporlayacaksın

Her test için yalnızca üç değerden birini yaz:

- **PASS** — beklenen davranışı kendi gözünle gördün
- **FAIL** — beklenenden farklı sonuç (bu bir bulgudur, hemen bildir)
- **BLOCKED** — ön koşul sağlanmadığı için yapılamadı

"Muhtemelen çalışıyor" diye PASS yazma. Bir FAIL varsa üretime çıkma.
