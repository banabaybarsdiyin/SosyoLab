# Teacher Hesap Kurulumu (Manuel)

Bu belge, ilk öğretim elemanı hesaplarının güvenli biçimde elle hazırlanması içindir.

## Önemli Güvenlik Kuralları

- `service_role` anahtarı tarayıcı koduna konulmaz.
- Repo içine gerçek e-posta, parola, UID veya davet kodu yazılmaz.
- Öğretim elemanı yetkisi yalnız frontend ile değil, veritabanı RLS/policy ile uygulanır.

## 1) Auth kullanıcısını oluştur

Supabase Dashboard > Authentication > Users üzerinden kullanıcıyı oluştur:

- Email: öğretim elemanının kurumsal e-postası
- Password: güçlü bir parola
- Auto-confirm: açık

Not: Bu adım sonunda oluşan UID, `auth.users.id` değeridir.

## 2) Profile kaydını güvenli şekilde teacher yap

Aşağıdaki SQL'i Supabase SQL Editor'de çalıştır:

```sql
-- UUID gerçek auth.users UID olacak
-- Not: auth.users'a INSERT yapılmaz; yalnızca public.profiles upsert edilir.
insert into public.profiles (id, role, display_name)
values ('<TEACHER_UUID>', 'teacher', 'Öğretim Elemanı Adı')
on conflict (id) do update
set role = excluded.role,
    display_name = excluded.display_name
returning id, role, display_name;
```

Bu yöntem, profile satırı yoksa oluşturur; varsa teacher rolüne günceller.

## 3) Ders atamalarını gir

```sql
insert into public.teacher_courses (teacher_id, course_id)
values
  ('<TEACHER_UUID>', '<COURSE_ID>')
on conflict do nothing;
```

Birden fazla ders için aynı `teacher_id` ile çok satır ekleyebilirsin.

## 4) Doğrulama sorguları

```sql
select id, role, display_name
from public.profiles
where id = '<TEACHER_UUID>';

select teacher_id, course_id, created_at
from public.teacher_courses
where teacher_id = '<TEACHER_UUID>'
order by course_id;
```

Beklenen:

- `profiles.role = 'teacher'`
- `teacher_courses` içinde atanmış ders satırları

## 5) Minimum smoke kontrolü

Öğretim elemanı hesabıyla giriş yapıp şunları doğrula:

- Sidebar'da `Derslerim` görünüyor.
- Yalnız atanmış derslerde `Materyal Paylaş` açılıyor.
- Yükleme sonrası mesaj `Materyal yayımlandı`.
- Admin araçları (`Onay Bekleyenler`, `Arşivden kaldır`) görünmüyor.
