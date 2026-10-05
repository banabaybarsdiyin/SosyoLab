# Teacher Regression Plan (T-01 ... T-15)

Bu dosya, teacher özelliği için eklenen regresyon setini toplar.

Migration karşılığı: `supabase/migrations/005_teacher_role.sql`

## Otomatik koşular

### Frontend

```bash
node scripts/regression_teacher_frontend_test.js
```

### DB sözleşme testleri

```bash
psql "<SUPABASE_CONNECTION_STRING>" -f supabase/regression_teacher_contract.sql
```

## Test matrisi

| ID | Senaryo | Kapsayan test |
|---|---|---|
| T-01 | user teacher rolüne yükselemez | `supabase/regression_teacher_contract.sql` |
| T-02 | teacher kendi atanmış dersini okuyabilir | `supabase/regression_teacher_contract.sql` |
| T-03 | teacher başka teacher'ın atamasını okuyamaz | `supabase/regression_teacher_contract.sql` |
| T-04 | teacher kendine ders atayamaz | `supabase/regression_teacher_contract.sql` |
| T-05 | teacher atanmış derse upload -> approved | `supabase/regression_teacher_contract.sql` |
| T-06 | teacher başka derse upload -> RLS reject | `supabase/regression_teacher_contract.sql` |
| T-07 | normal user upload -> pending | `supabase/regression_teacher_contract.sql` |
| T-08 | normal user status=approved gönderse bile approved olamaz | `supabase/regression_teacher_contract.sql` |
| T-09 | teacher admin değildir | `supabase/regression_teacher_contract.sql` |
| T-10 | teacher admin moderation yapamaz | `supabase/regression_teacher_contract.sql` |
| T-11 | admin mevcut moderation işlemlerini yapabilir | `supabase/regression_teacher_contract.sql` |
| T-12 | teacher_courses admin tarafından yönetilebilir | `supabase/regression_teacher_contract.sql` |
| T-13 | teacher Storage'a yalnız kendi UID klasörüne yükler | `supabase/regression_teacher_contract.sql` |
| T-14 | teacher yayımladığı dosya authenticated kullanıcı tarafından okunur | `supabase/regression_teacher_contract.sql` |
| T-15 | mevcut invite/RLS hardening regress etmez | `supabase/regression_teacher_contract.sql` |

## Frontend regresyon kontrol listesi

Aşağıdaki UI maddeleri `scripts/regression_teacher_frontend_test.js` içinde denetlenir:

- teacher login formu (`Öğretim Elemanı Girişi`)
- `signInWithPassword` + `role === 'teacher'` kontrolü
- `Derslerim` görünümü
- atanmış ders odaklı paylaşım kapısı
- teacher için `Materyal yayımlandı` mesajı
- admin panelinin `yetkili()` kapısı altında kalması
- normal kullanıcı mesaj/akışlarının korunması
