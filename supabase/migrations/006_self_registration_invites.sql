-- ============================================================================
-- SosyoLab — 006: self registration + sınıf davet kodları + teacher onay
-- ============================================================================
-- AMAÇ
--   * Kullanıcı adı + parola ile self registration
--   * Davet kodunu server-side sınıflandırma (student grade 1..4 / teacher)
--   * Teacher kodu ile gelen hesabı doğrudan teacher yapmamak (pending)
--   * Teacher onayını admin kararına bağlamak
--
-- NOT
--   Bu migration, 005 sonrası forward-only eklemedir.
--   005 içeriğini değiştirmez.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 0) Ön koşullar
-- ----------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'public.profiles bulunamadı';
  end if;
  if to_regclass('public.davet_kodlari') is null then
    raise exception 'public.davet_kodlari bulunamadı (001 gerekli)';
  end if;
  if to_regclass('public.davet_dogrulamalari') is null then
    raise exception 'public.davet_dogrulamalari bulunamadı (001 gerekli)';
  end if;
  if to_regclass('public.davet_denemeleri') is null then
    raise exception 'public.davet_denemeleri bulunamadı (001 gerekli)';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'public.is_admin() bulunamadı';
  end if;
  if to_regprocedure('extensions.crypt(text,text)') is null then
    raise exception 'extensions.crypt(text,text) bulunamadı (pgcrypto gerekli)';
  end if;
  if to_regprocedure('extensions.gen_salt(text,integer)') is null then
    raise exception 'extensions.gen_salt(text,integer) bulunamadı (pgcrypto gerekli)';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1) Şema genişletmeleri
-- ----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists username text,
  add column if not exists class_year smallint,
  add column if not exists teacher_status text,
  add column if not exists auth_login_email text,
  add column if not exists teacher_reviewed_at timestamptz,
  add column if not exists teacher_reviewed_by uuid references public.profiles (id) on delete set null,
  add column if not exists teacher_rejection_reason text;

alter table public.davet_kodlari
  add column if not exists audience_type text,
  add column if not exists class_year smallint;

-- 005'ten önce teacher olan satırları yeni duruma hizala.
update public.profiles
   set teacher_status = 'approved'
 where role = 'teacher'
   and teacher_status is null;

-- Mevcut davet kayıtları migration kırmaması için legacy olarak işaretlenir.
update public.davet_kodlari
   set audience_type = 'legacy'
 where audience_type is null;

alter table public.davet_kodlari
  alter column audience_type set default 'legacy',
  alter column audience_type set not null;

-- ----------------------------------------------------------------------------
-- 2) Constraint ve index'ler
-- ----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_username_bicim') then
    alter table public.profiles drop constraint profiles_username_bicim;
  end if;
  alter table public.profiles
    add constraint profiles_username_bicim
    check (
      username is null
      or (
        username = lower(username)
        and username ~ '^[a-z0-9._]{4,24}$'
      )
    );
exception when duplicate_object then null;
end;
$$;

do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_username_rezerve') then
    alter table public.profiles drop constraint profiles_username_rezerve;
  end if;
  alter table public.profiles
    add constraint profiles_username_rezerve
    check (
      username is null
      or username not in ('admin', 'administrator', 'root', 'system', 'supabase', 'sosyolab', 'sosyolog35', 'sosyolog.35')
    );
exception when duplicate_object then null;
end;
$$;

do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_class_year_gecerli') then
    alter table public.profiles drop constraint profiles_class_year_gecerli;
  end if;
  alter table public.profiles
    add constraint profiles_class_year_gecerli
    check (class_year is null or class_year between 1 and 4);
exception when duplicate_object then null;
end;
$$;

do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_teacher_status_gecerli') then
    alter table public.profiles drop constraint profiles_teacher_status_gecerli;
  end if;
  alter table public.profiles
    add constraint profiles_teacher_status_gecerli
    check (teacher_status is null or teacher_status in ('pending', 'approved', 'rejected'));
exception when duplicate_object then null;
end;
$$;

do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_auth_login_email_bicim') then
    alter table public.profiles drop constraint profiles_auth_login_email_bicim;
  end if;
  alter table public.profiles
    add constraint profiles_auth_login_email_bicim
    check (
      auth_login_email is null
      or auth_login_email ~ '^[a-z0-9][a-z0-9._+-]{2,63}@auth\.sosyolab\.local$'
    );
exception when duplicate_object then null;
end;
$$;

do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_teacher_status_tutarli') then
    alter table public.profiles drop constraint profiles_teacher_status_tutarli;
  end if;
  alter table public.profiles
    add constraint profiles_teacher_status_tutarli
    check (
      (role = 'teacher' and teacher_status = 'approved' and class_year is null)
      or (role = 'user' and (teacher_status is null or teacher_status in ('pending', 'rejected')))
      or (role = 'admin' and teacher_status is null and class_year is null)
    );
exception when duplicate_object then null;
end;
$$;

create unique index if not exists profiles_username_unique
  on public.profiles (username)
  where username is not null;

create unique index if not exists profiles_auth_login_email_unique
  on public.profiles (auth_login_email)
  where auth_login_email is not null;

create index if not exists profiles_teacher_status_idx
  on public.profiles (teacher_status, created_at desc)
  where teacher_status is not null;

do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.davet_kodlari'::regclass and conname = 'davet_audience_turu_gecerli') then
    alter table public.davet_kodlari drop constraint davet_audience_turu_gecerli;
  end if;
  alter table public.davet_kodlari
    add constraint davet_audience_turu_gecerli
    check (audience_type in ('legacy', 'student', 'teacher'));
exception when duplicate_object then null;
end;
$$;

do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.davet_kodlari'::regclass and conname = 'davet_audience_class_tutarli') then
    alter table public.davet_kodlari drop constraint davet_audience_class_tutarli;
  end if;
  alter table public.davet_kodlari
    add constraint davet_audience_class_tutarli
    check (
      (audience_type = 'student' and class_year between 1 and 4)
      or (audience_type = 'teacher' and class_year is null)
      or (audience_type = 'legacy')
    );
exception when duplicate_object then null;
end;
$$;

create index if not exists davet_kodlari_audience_idx
  on public.davet_kodlari (aktif, audience_type, class_year, created_at desc);

-- ----------------------------------------------------------------------------
-- 3) Kayıt/teacher helper fonksiyonları
-- ----------------------------------------------------------------------------

create or replace function public.normalize_username(p_username text)
returns text
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select lower(regexp_replace(btrim(p_username), '\s+', '', 'g'));
$$;

revoke all on function public.normalize_username(text) from public, anon, authenticated;

create or replace function public.uye_profili_var_mi()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = auth.uid()
  );
$$;

revoke all on function public.uye_profili_var_mi() from public, anon;
grant execute on function public.uye_profili_var_mi() to authenticated;

-- Login UX: kullanıcı adı -> auth email çözümlemesi.
-- Kullanıcı yoksa da sahte bir iç e-posta döner; istemci aynı hata yoluna düşer.
create or replace function public.kullanici_email_bul(p_username text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_username text := public.normalize_username(coalesce(p_username, ''));
  v_email text;
  v_fallback text;
begin
  if v_username = '' then
    v_username := 'missing';
  end if;
  v_fallback := 'u.' || md5('login:' || v_username || ':v2') || '@auth.sosyolab.local';

  if v_username !~ '^[a-z0-9._]{4,24}$' then
    return v_fallback;
  end if;

  select p.auth_login_email
    into v_email
    from public.profiles p
   where p.username = v_username
   limit 1;

  return coalesce(v_email, v_fallback);
end;
$$;

revoke all on function public.kullanici_email_bul(text) from public;
grant execute on function public.kullanici_email_bul(text) to anon, authenticated;

-- Registration akışı için davet kodu tüketimi (student/teacher sınıfları).
-- Not: Bu fonksiyon DB içinde bağımsız bir brute-force garantisi vermez.
-- Güvenlik varsayımı: yüksek entropili kod (128-bit+) + platform rate-limit.
create or replace function public.kayit_icin_davet_kodu_kullan(p_kod text)
returns table (audience_type text, class_year smallint, davet_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_kod text := upper(btrim(coalesce(p_kod, '')));
  v_satir public.davet_kodlari%rowtype;
  v_tuketildi boolean;
begin
  if v_uid is null then
    raise exception 'Kayıt işlemi için aktif oturum gerekli';
  end if;

  if current_setting('sosyolab.registration_context', true) is distinct from 'on' then
    raise exception 'Davet kodu yalnızca kayıt tamamlama akışında kullanılabilir';
  end if;

  if v_kod = '' or length(v_kod) > 64 then
    raise exception 'Davet kodu geçersiz ya da süresi dolmuş';
  end if;

  -- Damga yalnızca aynı kod/audience sözleşmesi için yeniden kullanılabilir.
  return query
  select k.audience_type, k.class_year, k.id
    from public.davet_dogrulamalari d
    join public.davet_kodlari k on k.id = d.davet_id
   where d.user_id = v_uid
     and k.audience_type in ('student', 'teacher')
     and k.kod_ozeti = extensions.crypt(v_kod, k.kod_ozeti)
   limit 1;

  if found then
    return;
  end if;

  if exists (select 1 from public.davet_dogrulamalari d where d.user_id = v_uid) then
    raise exception 'Davet kodu kayıt damgasıyla eşleşmiyor';
  end if;

  for v_satir in
    select k.* from public.davet_kodlari k
     where k.aktif
       and k.audience_type in ('student', 'teacher')
       and (k.gecerlilik_sonu is null or k.gecerlilik_sonu > now())
       and (k.azami_kullanim is null or k.kullanim_sayisi < k.azami_kullanim)
     order by k.created_at desc
     limit 25
  loop
    if v_satir.kod_ozeti = extensions.crypt(v_kod, v_satir.kod_ozeti) then
      update public.davet_kodlari as k
         set kullanim_sayisi = k.kullanim_sayisi + 1
       where k.id = v_satir.id
         and k.aktif
         and k.audience_type in ('student', 'teacher')
         and (k.gecerlilik_sonu is null or k.gecerlilik_sonu > now())
         and (k.azami_kullanim is null or k.kullanim_sayisi < k.azami_kullanim);

      v_tuketildi := found;
      if not v_tuketildi then
        raise exception 'Davet kodu geçersiz ya da süresi dolmuş';
      end if;

      insert into public.davet_dogrulamalari (user_id, davet_id, ogrenci_no)
      values (v_uid, v_satir.id, null)
      on conflict (user_id) do nothing;

      return query
      select v_satir.audience_type, v_satir.class_year, v_satir.id;
      return;
    end if;
  end loop;

  raise exception 'Davet kodu geçersiz ya da süresi dolmuş';
end;
$$;

revoke all on function public.kayit_icin_davet_kodu_kullan(text) from public, anon, authenticated;

-- 001 helper'ı audience kontrolü yapmaz. Yeni frontend yalnız kayıt RPC'sini
-- kullanır; migration penceresinde eski istemciyle kod tüketimi desteklenmez.
revoke all on function public.davet_kullan(text) from public, anon, authenticated;

create or replace function public.kullanici_kaydi_tamamla(
  p_username text,
  p_sifreli_davet_kodu text,
  p_display_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_username text := public.normalize_username(coalesce(p_username, ''));
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_audience text;
  v_class_year smallint;
  v_davet_id uuid;
  v_mevcut public.profiles%rowtype;
  v_display_name text;
begin
  if v_uid is null then
    raise exception 'Kayıt için giriş oturumu bulunamadı';
  end if;

  if v_username !~ '^[a-z0-9._]{4,24}$' then
    raise exception 'Kullanıcı adı 4-24 karakter olmalı ve yalnızca harf/rakam/._ içermeli';
  end if;

  if v_username in ('admin', 'administrator', 'root', 'system', 'supabase', 'sosyolab', 'sosyolog35', 'sosyolog.35') then
    raise exception 'Bu kullanıcı adı kullanılamaz';
  end if;

  if v_email !~ '^[a-z0-9][a-z0-9._+-]{2,63}@auth\.sosyolab\.local$' then
    raise exception 'Kayıt kimliği geçersiz. Lütfen kaydı tekrar başlat.';
  end if;

  -- Henüz profile satırı olmayan aynı UID'nin eşzamanlı kayıtlarını da sırala.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 006));

  select *
    into v_mevcut
    from public.profiles p
   where p.id = v_uid
   for update;

  if found and (
      v_mevcut.role in ('admin', 'teacher')
      or v_mevcut.username is not null
      or v_mevcut.auth_login_email is not null
      or coalesce(v_mevcut.teacher_status, '') in ('pending', 'approved', 'rejected')
    ) then
    raise exception 'Bu hesap için kayıt zaten tamamlanmış';
  end if;

  perform set_config('sosyolab.registration_context', 'on', true);

  select k.audience_type, k.class_year, k.davet_id
    into v_audience, v_class_year, v_davet_id
    from public.kayit_icin_davet_kodu_kullan(p_sifreli_davet_kodu) k;

  if v_audience not in ('student', 'teacher') then
    raise exception 'Bu davet kodu kayıt için uygun değil';
  end if;

  if v_audience = 'teacher' and btrim(coalesce(p_display_name, '')) = '' then
    raise exception 'Öğretim elemanı başvurusu için ad soyad zorunludur';
  end if;

  v_display_name := nullif(btrim(coalesce(p_display_name, '')), '');
  if v_display_name is null then
    v_display_name := coalesce(nullif(v_mevcut.display_name, ''), initcap(v_username));
  end if;

  insert into public.profiles (
    id, username, display_name, role, class_year, teacher_status,
    auth_login_email, student_number, teacher_reviewed_at,
    teacher_reviewed_by, teacher_rejection_reason
  ) values (
    v_uid,
    v_username,
    v_display_name,
    'user',
    case when v_audience = 'student' then v_class_year else null end,
    case when v_audience = 'teacher' then 'pending' else null end,
    v_email,
    null,
    null,
    null,
    null
  )
  on conflict (id) do update
    set username = excluded.username,
        display_name = excluded.display_name,
        role = 'user',
        class_year = excluded.class_year,
        teacher_status = excluded.teacher_status,
        auth_login_email = coalesce(public.profiles.auth_login_email, excluded.auth_login_email),
        student_number = null,
        teacher_reviewed_at = null,
        teacher_reviewed_by = null,
        teacher_rejection_reason = null
  where public.profiles.role = 'user';

  if not found then
    raise exception 'Profil kaydı güncellenemedi';
  end if;

  perform set_config('sosyolab.registration_context', 'off', true);

  return jsonb_build_object(
    'ok', true,
    'audience_type', v_audience,
    'class_year', case when v_audience = 'student' then v_class_year else null end,
    'teacher_status', case when v_audience = 'teacher' then 'pending' else null end,
    'username', v_username,
    'davet_id', v_davet_id
  );
end;
$$;

revoke all on function public.kullanici_kaydi_tamamla(text, text, text) from public, anon;
grant execute on function public.kullanici_kaydi_tamamla(text, text, text) to authenticated;

-- Admin öğretim elemanı başvurusu kararı (role yükseltmesi sadece burada).
create or replace function public.ogretmen_basvurusunu_karara_bagla(
  p_profile_id uuid,
  p_karar text,
  p_ret_gerekcesi text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_karar text := lower(btrim(coalesce(p_karar, '')));
  v_satir public.profiles%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Bu işlem yalnızca yöneticiye açıktır';
  end if;

  if v_karar not in ('approve', 'reject') then
    raise exception 'Geçersiz karar';
  end if;

  select *
    into v_satir
    from public.profiles p
   where p.id = p_profile_id
   for update;

  if not found then
    raise exception 'Başvuru profili bulunamadı';
  end if;

  if coalesce(v_satir.teacher_status, '') <> 'pending' then
    raise exception 'Yalnızca pending başvurular değerlendirilebilir';
  end if;

  perform set_config('sosyolab.teacher_review_context', 'on', true);

  update public.profiles p
     set role = case when v_karar = 'approve' then 'teacher' else 'user' end,
         teacher_status = case when v_karar = 'approve' then 'approved' else 'rejected' end,
         class_year = case when v_karar = 'approve' then null else p.class_year end,
         teacher_reviewed_at = now(),
         teacher_reviewed_by = auth.uid(),
         teacher_rejection_reason = case
           when v_karar = 'reject' then nullif(btrim(coalesce(p_ret_gerekcesi, '')), '')
           else null
         end
   where p.id = p_profile_id;

  return jsonb_build_object(
    'ok', true,
    'profile_id', p_profile_id,
    'teacher_status', case when v_karar = 'approve' then 'approved' else 'rejected' end,
    'role', case when v_karar = 'approve' then 'teacher' else 'user' end
  );
end;
$$;

revoke all on function public.ogretmen_basvurusunu_karara_bagla(uuid, text, text) from public, anon;
grant execute on function public.ogretmen_basvurusunu_karara_bagla(uuid, text, text) to authenticated;

-- Admin yardımcı fonksiyonu: hash'li davet kodu ekleme.
create or replace function public.admin_davet_kodu_olustur(
  p_kod text,
  p_audience_type text,
  p_class_year smallint,
  p_etiket text default null,
  p_gecerlilik_sonu timestamptz default null,
  p_azami_kullanim integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kod text := upper(btrim(coalesce(p_kod, '')));
  v_audience text := lower(btrim(coalesce(p_audience_type, '')));
  v_id uuid;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Bu işlem yalnızca yöneticiye açıktır';
  end if;

  -- 32 hex karakter = 128-bit rastgelelik kapasitesi.
  if v_kod !~ '^[A-F0-9]{32}$' then
    raise exception 'Kod 32 hex karakter olmalı (en az 128-bit rastgelelik standardı)';
  end if;

  if v_audience not in ('student', 'teacher') then
    raise exception 'audience_type yalnızca student veya teacher olabilir';
  end if;

  if v_audience = 'student' and (p_class_year is null or p_class_year not between 1 and 4) then
    raise exception 'Student kodları için class_year 1..4 zorunlu';
  end if;

  if v_audience = 'teacher' and p_class_year is not null then
    raise exception 'Teacher kodları class_year içeremez';
  end if;

  insert into public.davet_kodlari (
    kod_ozeti, etiket, ogrenci_no, gecerlilik_sonu, azami_kullanim,
    aktif, created_by, audience_type, class_year
  )
  values (
    extensions.crypt(v_kod, extensions.gen_salt('bf', 10)),
    nullif(btrim(coalesce(p_etiket, '')), ''),
    null,
    p_gecerlilik_sonu,
    p_azami_kullanim,
    true,
    auth.uid(),
    v_audience,
    case when v_audience = 'student' then p_class_year else null end
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.admin_davet_kodu_olustur(text, text, smallint, text, timestamptz, integer) from public, anon;
grant execute on function public.admin_davet_kodu_olustur(text, text, smallint, text, timestamptz, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) Membership sınırı ve erişim politikaları
-- ----------------------------------------------------------------------------

-- Davetsiz/orphan hesapların profile satırı basarak username rezerve etmesi
-- engellenir. Profil oluşturma yalnızca SECURITY DEFINER kayıt RPC'si içinden
-- yapılır.
drop policy if exists profiles_kendi_olusturur on public.profiles;
revoke insert on table public.profiles from anon, authenticated;

-- Davet damgası tek başına üyelik sayılmaz: aktif profile membership zorunlu.
create or replace function public.davet_dogrulandi_mi()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.uye_profili_var_mi() and exists (
    select 1 from public.davet_dogrulamalari d where d.user_id = auth.uid()
  );
$$;

revoke all on function public.davet_dogrulandi_mi() from public, anon;
grant execute on function public.davet_dogrulandi_mi() to authenticated;

drop policy if exists materials_okuma on public.materials;
create policy materials_okuma on public.materials
  for select to authenticated
  using (
    public.uye_profili_var_mi()
    and (
      uploader_id = auth.uid()
      or public.is_admin()
      or (status = 'approved' and public.davet_dogrulandi_mi())
    )
  );

drop policy if exists materials_gonderim on public.materials;
create policy materials_gonderim on public.materials
  for insert to authenticated
  with check (
    public.uye_profili_var_mi()
    and uploader_id = auth.uid()
    and (storage.foldername(file_path))[1] = auth.uid()::text
    and (
      (
        public.is_teacher()
        and public.teacher_has_course(course_id)
        and status = 'approved'
        and reviewed_at is not null
        and reviewed_by = auth.uid()
        and rejection_reason is null
      )
      or
      (
        not public.is_teacher()
        and exists (select 1 from public.profiles p
                    where p.id = auth.uid() and p.teacher_status is null)
        and status = 'pending'
        and reviewed_at is null
        and reviewed_by is null
        and rejection_reason is null
        and (public.is_admin() or public.davet_dogrulandi_mi())
      )
    )
  );

drop policy if exists materyal_okuma on storage.objects;
create policy materyal_okuma on storage.objects
  for select to authenticated
  using (
    bucket_id = 'materyaller'
    and public.uye_profili_var_mi()
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
      or (
        public.davet_dogrulandi_mi()
        and exists (
          select 1 from public.materials m
          where m.file_path = storage.objects.name
            and m.status = 'approved'
        )
      )
    )
  );

drop policy if exists materyal_yukleme on storage.objects;
create policy materyal_yukleme on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'materyaller'
    and public.uye_profili_var_mi()
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.profiles p
                where p.id = auth.uid()
                  and (p.teacher_status is null or p.teacher_status = 'approved'))
    and (
      public.is_admin()
      or public.is_teacher()
      or public.davet_dogrulandi_mi()
    )
  );

-- ----------------------------------------------------------------------------
-- 5) Profil alanlarını koruyan trigger
-- ----------------------------------------------------------------------------

create or replace function public.profiles_kayit_alanlarini_koru()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- İç güvenli işlemler (registration / admin review) trigger kısıtlarını baypas eder.
  if current_setting('sosyolab.registration_context', true) = 'on'
     or current_setting('sosyolab.teacher_review_context', true) = 'on' then
    return new;
  end if;

  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.class_year := null;
      new.teacher_status := null;
      new.auth_login_email := null;
      new.teacher_reviewed_at := null;
      new.teacher_reviewed_by := null;
      new.teacher_rejection_reason := null;
    else
      new.username := old.username;
      new.class_year := old.class_year;
      new.teacher_status := old.teacher_status;
      new.auth_login_email := old.auth_login_email;
      new.teacher_reviewed_at := old.teacher_reviewed_at;
      new.teacher_reviewed_by := old.teacher_reviewed_by;
      new.teacher_rejection_reason := old.teacher_rejection_reason;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.profiles_kayit_alanlarini_koru() from public, anon, authenticated;

drop trigger if exists profiles_kayit_alanlarini_koru_trg on public.profiles;
create trigger profiles_kayit_alanlarini_koru_trg
  before insert or update on public.profiles
  for each row execute function public.profiles_kayit_alanlarini_koru();

-- ----------------------------------------------------------------------------
-- 6) teacher_courses koruması (sos401 teacher'a atanamaz)
-- ----------------------------------------------------------------------------

-- Önce 005 döneminden kalan atamaları temizle; CHECK bundan sonra doğrulanır.
delete from public.teacher_courses
where lower(btrim(course_id)) = 'sos401';

alter table public.teacher_courses
  drop constraint if exists teacher_courses_sos401_yasak;
alter table public.teacher_courses
  add constraint teacher_courses_sos401_yasak
  check (lower(btrim(course_id)) <> 'sos401');

-- Yanlış bir satır kısıtlar atlanarak eklenmiş olsa da doğrudan yayın verme.
create or replace function public.teacher_has_course(p_course_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(btrim(p_course_id)) <> 'sos401'
    and public.is_teacher()
    and exists (
      select 1 from public.teacher_courses tc
       where tc.teacher_id = auth.uid() and tc.course_id = p_course_id
    );
$$;

revoke all on function public.teacher_has_course(text) from public, anon;
grant execute on function public.teacher_has_course(text) to authenticated;

create or replace function public.teacher_courses_teacher_koru()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(btrim(new.course_id)) = 'sos401' then
    raise exception 'sos401 yalnızca yönetici tarafından yönetilir; öğretim elemanına atanamaz';
  end if;

  if not exists (
    select 1
      from public.profiles p
     where p.id = new.teacher_id
       and p.role = 'teacher'
       and p.teacher_status = 'approved'
  ) then
    raise exception 'teacher_courses.teacher_id yalnızca onaylı role=teacher profiline atanabilir';
  end if;

  return new;
end;
$$;

revoke all on function public.teacher_courses_teacher_koru() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7) Dokümantasyon notu (SQL içinde)
-- ----------------------------------------------------------------------------
-- Kod sınıfları:
--   STUDENT_GRADE_1 -> audience_type='student', class_year=1
--   STUDENT_GRADE_2 -> audience_type='student', class_year=2
--   STUDENT_GRADE_3 -> audience_type='student', class_year=3
--   STUDENT_GRADE_4 -> audience_type='student', class_year=4
--   TEACHER         -> audience_type='teacher', class_year=null
--
-- Örnek (gerçek kodu migration'a yazmayın):
--   select public.admin_davet_kodu_olustur('<KOD>', 'student', 1, 'STUDENT_GRADE_1', now() + interval '90 days', 200);
--   select public.admin_davet_kodu_olustur('<KOD>', 'teacher', null, 'TEACHER', now() + interval '30 days', 50);

commit;
