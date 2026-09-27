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

Bu, **politika mantığının doğru olduğunu** kanıtlar. Aşağıdaki canlı testler
farklı bir şeyi kanıtlar: **üretimdeki Supabase projesinin gerçekten bu
politikalarla yapılandırıldığını.** İkisi birbirinin yerine geçmez.

---

## A. Yönetici giriş testi (AUTH-01 → AUTH-09)

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

## B. Canlı RLS testi (ACCESS-01 → ACCESS-07)

### Yaklaşım

İki geçici anonim kullanıcı (**TEST_USER_A**, **TEST_USER_B**) oluşturulur ve
tüm iddialar **tarayıcıdaki public API** üzerinden sınanır. `service_role`
hiçbir adımda kullanılmaz.

### Ön koşullar

1. `001_davet_kodlari.sql` uygulanmış olmalı.
2. Test için **ayrı bir davet kodu** oluştur (dönem kodunu kullanma):

   ```sql
   -- SQL Editor. <TESTKOD> yerine üretilmiş bir değer koy:
   --   select upper(encode(extensions.gen_random_bytes(10), 'hex'));
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
  let dv = await A.from('davet_dogrulamalari').select('user_id');
  ok('INVITE-05', 'Damga gerçekten yazıldı', dv.data && dv.data.length === 1, JSON.stringify(dv.data));
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
| ACCESS-06c | SQL Editor: `select reviewed_by, reviewed_at from public.materials where title like 'ZZTEST%';` → `reviewed_by` **yönetici UID'si** (`ebc2d10f-8140-4b63-81f1-2dcdc8f36472`), `reviewed_at` dolu. İstemci bu alanları göndermedi; sunucu damgaladı. |
| ACCESS-08 | Öğrenci sekmesinde konsolda `await (window.supabase.createClient(SOSYOLAB_CONFIG.SUPABASE_URL, SOSYOLAB_CONFIG.SUPABASE_ANON_KEY)).from('materials').select('id').eq('status','approved')` → onaylanan kayıt görünür. |
| AUDIT-01 | SQL Editor: `select eylem, aktor_id, nesne_id, olusma from public.denetim_kaydi order by olusma desc limit 10;` → `materyal_onay` satırı, `aktor_id` = yönetici UID. |

---

## C. Canlı Storage testi (STORAGE-01 → STORAGE-06)

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

  // STORAGE-04b: A kendi objesini de silemez (silme admin-only)
  await A.storage.from('materyaller').remove([UID_A + '/zz-a.pdf']);
  let kendiVar = !(await A.storage.from('materyaller').download(UID_A + '/zz-a.pdf')).error;
  ok('STORAGE-04b', 'Silme yalnızca yöneticiye açık', kendiVar, 'A dosyası duruyor=' + kendiVar);

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
| STORAGE-06 | ZZTEST kaydını **Onayla**, sonra öğrenci sekmesinde arşivden aç → **Materyali aç** | Dosya açılır. Onaylı materyalin dosyası tasarım gereği tüm kimlikli kullanıcılara açıktır. |
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
 where id in ('<UID_A>', '<UID_B>')           -- betiğin yazdırdığı UID'ler
   and is_anonymous = true;                    -- güvenlik ağı: gerçek hesap silinmesin

-- 4) Geçici davet kodunu kapat
update public.davet_kodlari set aktif = false where etiket = 'GEÇİCİ TEST — silinecek';
delete from public.davet_kodlari where etiket = 'GEÇİCİ TEST — silinecek';

-- 5) Artık dosya kaldı mı?
select name from storage.objects
 where name like '<UID_A>/%' or name like '<UID_B>/%';
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
> `where` olmadan asla çalıştırmayın. Yönetici hesabı
> (`ebc2d10f-8140-4b63-81f1-2dcdc8f36472`) bu sorguya **asla** girmemeli.

---

## E. Sonucu nasıl raporlayacaksın

Her test için yalnızca üç değerden birini yaz:

- **PASS** — beklenen davranışı kendi gözünle gördün
- **FAIL** — beklenenden farklı sonuç (bu bir bulgudur, hemen bildir)
- **BLOCKED** — ön koşul sağlanmadığı için yapılamadı

"Muhtemelen çalışıyor" diye PASS yazma. Bir FAIL varsa üretime çıkma.
