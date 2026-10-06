-- Only fixed SYNTHETIC identities/codes. Never connect this to Supabase.
insert into auth.users(id,email,is_anonymous,raw_app_meta_data)
select runtime_test.identity(n),
       case when n=2 then 'legacy-teacher@example.invalid' else 'u.test'||n||'@auth.sosyolab.local' end,
       n=3, jsonb_build_object('provider',case when n=3 then 'anonymous' else 'email' end)
from generate_series(1,24) n;
insert into public.profiles(id,role,display_name) values
  (runtime_test.identity(1),'admin','Synthetic admin'),
  (runtime_test.identity(2),'teacher','Synthetic legacy teacher'),
  (runtime_test.identity(3),'user','Synthetic legacy anonymous user');
insert into public.teacher_courses(teacher_id,course_id) values
  (runtime_test.identity(2),'sos401'),(runtime_test.identity(2),' SOS401 ');
insert into public.davet_kodlari(kod_ozeti,etiket,azami_kullanim)
values(extensions.crypt('SYNTHETIC-LEGACY',extensions.gen_salt('bf',4)),'synthetic legacy',1);
