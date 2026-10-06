# 006 öğretim elemanı onboarding ve legacy geçişi

Yeni production modelinde öğretmen kendi username/password hesabını oluşturur.
Yetki RLS/policy ve server helper ile uygulanır; tarayıcıya service_role veya
başka bir server secret konmaz. Gerçek kimlik, parola ve davet kodu repoya yazılmaz.

## Yeni öğretmen

1. Operatör/admin, CSPRNG ile ürettiği 32 hex/128-bit teacher kodunu yalnız
   `admin_davet_kodu_olustur` helper ile oluşturur ve güvenli kanaldan iletir.
2. Öğretmen kayıt ekranında username/password, teacher daveti ve ad soyad girer.
3. Kayıt RPC'si daveti doğrular: `role='user'`, `teacher_status='pending'`,
   `class_year=NULL`. Internal Auth email login sözleşmesini kullanır.
4. Pending öğretmen login olur ve kendi başvuru bekleme ekranını görür.
   Mevcut okuma erişimi korunur; normal öğrenci upload/publish kullanamaz.
   Materyal ve storage INSERT server-side policy ile kapalıdır.
5. Admin başvuruyu `ogretmen_basvurusunu_karara_bagla` ile approve eder:
   `role='teacher'`, `teacher_status='approved'`.
   Reject durumunda `role='user'`, `teacher_status='rejected'` kalır;
   otomatik öğrenciye dönüş veya uygulama materyal yükleme hakkı verilmez.
6. Admin onaylı öğretmene `teacher_courses` ataması yapar:

   ```sql
   insert into public.teacher_courses (teacher_id, course_id)
   values ('<ONAYLI_TEACHER_UUID>', '<COURSE_ID>') on conflict do nothing;
   ```

7. Öğretmen yalnız atanmış derste materyal paylaşır; server trigger kaydı
   doğrudan approved yapar ve review alanlarını damgalar. Atanmamış ders
   reddedilir. `lower(btrim(course_id))='sos401'` atanamaz; bu dersi admin
   `public.materials` üzerinden yönetmeye devam eder.

Eski **Auth Dashboard kurumsal email hesabı + doğrudan role='teacher' upsert**
yöntemi **DEPRECATED**. Yeni onboarding için kullanılmaz; 006 durum/login
tutarlılığını sağlamaz ve pending/admin approval akışını atlar.

## Legacy öğretmen: koşullu migration

Production'da legacy teacher bulunup bulunmadığı henüz bilinmiyor. Önce
`supabase/pre_006_inventory.sql` 005 şemasında read-only çalıştırılır.
Admin satırı bulunması otomatik FAIL değildir.

- **teacher count=0:** Auth migration **N/A**. Gerçek Auth hesabı oluşturma,
  email değiştirme veya teacher backfill gerekmez.
- **teacher count>0:** production apply öncesi **BLOCKER** olarak kaydet.
  Hesap başına açık migration planı, operatör, bakım penceresi ve geri dönüş
  planı hazırlanmadan 006 apply edilmez. Plan uygulanıp doğrulanmadan yeni
  frontend deploy edilmez. 006 otomatik `teacher_status='approved'` backfill
  yapar; Auth email/username dönüştürmez.

Hesap başına plan:

1. UUID, kurumsal Auth email, mevcut dersler, materyal sahipliği ve oturumları
   güvenli operatör kaydında envanterle. UUID/sahiplik referanslarını koru.
2. Kullanıcıyla canonical, benzersiz, rezerve olmayan 4–24 karakter username
   ve internal `@auth.sosyolab.local` login kimliğini kararlaştır. SQL
   `normalize_username` sözleşmesi ve index çakışmaları kontrol edilsin.
3. Auth email değişikliği gerekiyorsa **Supabase Auth Admin API veya güvenli
   operator-side işlem** kullan. Browser/service_role çözümü üretme; doğrudan
   `auth.users` SQL update reçetesi kullanılmaz. Yetkili server credential
   yalnız güvenli operatör ortamında tutulur ve repoya/loglara girmez.
4. DB snapshot sonrasında 006 apply et. Planlanan Auth geçişi ve explicit
   **POST-006** profile backfill ile `username`, `auth_login_email`,
   `role='teacher'`, `teacher_status='approved'`, `class_year=NULL` değerlerini
   aynı hesabın Auth kimliğiyle hizala. Parola değişimi gerekip gerekmediğini
   açıkça belirle; yeni parola güvenli kanaldan yönetilir. Eski oturumların
   kapatılması ve yeniden giriş planı uygulanır.
5. Yeni username/password login, atanmış derste direct publish, atanmamış
   ders reddi, admin olmayan moderation reddi ve sos401 reddini doğrula.
   POST inventory geçsin; ardından frontend yayın sırasına devam et.

Legacy user için frontend öncesinde **preserve / re-onboard / test hesabıysa
silme planı** kararı alınır. Preserve seçilirse aynı UUID ve materyal sahipliği
korunur; username/Auth login ve davet membership durumu explicit backfill ile
doğrulanır. Re-onboard seçilirse eski materyal sahipliğinin nasıl korunacağı
ayrıca planlanır. Test hesabı silme yalnız açık operatör planıyla yapılır.

006 canonical legacy sos401 atamalarını siler; sayı sıfır olsa da cleanup
çalışır. CHECK + trigger yeni atamaları kapatır, `teacher_has_course` yanlış
satır var olsa bile FALSE döner. Admin materyal yönetimi etkilenmez.

Tam yayın sırası: [DEPLOYMENT-SECURITY.md](DEPLOYMENT-SECURITY.md) bölüm 11.
Doğrulama: [LIVE-VALIDATION.md](LIVE-VALIDATION.md). Bu remediation turunda
production bağlantısı, Auth migration veya gerçek davet üretimi yapılmaz.
