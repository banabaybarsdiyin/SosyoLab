-- ============================================================================
-- SosyoLab — 004: teacher rolü ve doğrudan yayın akışı
-- ============================================================================
-- AMAÇ
--   * profiles.role kümesini user|teacher|admin olarak genişletmek
--   * öğretim elemanı-ders eşleşmesini public.teacher_courses tablosunda tutmak
--   * teacher için materyal gönderimini sunucu tarafında doğrudan approved yapmak
--   * yetkiyi yalnızca RLS/policy/fonksiyon katmanında uygulamak
--
-- GÜVENLİK İLKESİ
--   Tarayıcıdan gelen status/review alanlarına güvenilmez. INSERT sırasında
--   durum ve inceleme damgaları trigger ile sunucuda yeniden yazılır.
--
-- İŞLEM GÜVENLİĞİ
--   Bu göç tek transaction olarak çalışır; bir adım hata verirse tüm değişim
--   geri alınır.
--
-- ROLLBACK NOTU (forward-only)
--   Üretimde rollback önerilmez. Geri dönüş gerekirse yeni bir migration ile:
--     1) teacher oturumlarını kapat
--     2) teacher_courses verisini arşivleyip tabloyu kaldır
--     3) policy/fonksiyonları eski haline döndür
--     4) profiles.role check kısıtını user|admin'e geri daralt
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 0) Ön koşullar
-- ----------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'public.profiles bulunamadı. Önce schema.sql uygulanmalı.';
  end if;

  if to_regclass('public.materials') is null then
    raise exception 'public.materials bulunamadı. Önce schema.sql uygulanmalı.';
  end if;

  if to_regprocedure('public.is_admin()') is null then
    raise exception 'public.is_admin() bulunamadı. Önce schema.sql uygulanmalı.';
  end if;

  if to_regprocedure('public.davet_dogrulandi_mi()') is null then
    raise exception 'public.davet_dogrulandi_mi() bulunamadı. Önce 001 migration uygulanmalı.';
  end if;

  if to_regprocedure('storage.foldername(text)') is null then
    raise exception 'storage.foldername(text) bulunamadı. Supabase Storage etkin değil ya da şema farklı.';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1) profiles.role: user|teacher|admin
-- ----------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname = 'profiles_role_gecerli'
  ) then
    alter table public.profiles
      drop constraint profiles_role_gecerli;
  end if;

  alter table public.profiles
    add constraint profiles_role_gecerli
    check (role in ('user', 'teacher', 'admin'));
exception
  when duplicate_object then
    null;
end;
$$;

comment on constraint profiles_role_gecerli on public.profiles is
  'Profil rolü yalnızca user, teacher veya admin olabilir.';

-- ----------------------------------------------------------------------------
-- 2) teacher_courses tablosu
-- ----------------------------------------------------------------------------

create table if not exists public.teacher_courses (
  teacher_id  uuid not null references public.profiles (id) on delete cascade,
  course_id   text not null,
  created_at  timestamptz not null default now(),
  constraint teacher_courses_pk primary key (teacher_id, course_id),
  constraint teacher_courses_course_dolu check (length(btrim(course_id)) between 1 and 64)
);

create index if not exists teacher_courses_course_idx on public.teacher_courses (course_id);

comment on table public.teacher_courses is
  'Öğretim elemanlarının materyal yükleyebileceği ders atamaları.';

create or replace function public.teacher_courses_teacher_koru()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.profiles p
     where p.id = new.teacher_id
       and p.role = 'teacher'
  ) then
    raise exception 'teacher_courses.teacher_id yalnızca role=teacher profiline atanabilir';
  end if;

  return new;
end;
$$;

revoke all on function public.teacher_courses_teacher_koru() from public, anon, authenticated;

drop trigger if exists teacher_courses_teacher_koru_trg on public.teacher_courses;
create trigger teacher_courses_teacher_koru_trg
  before insert or update on public.teacher_courses
  for each row execute function public.teacher_courses_teacher_koru();

-- ----------------------------------------------------------------------------
-- 3) Yardımcı fonksiyonlar: is_teacher, teacher_has_course
-- ----------------------------------------------------------------------------

create or replace function public.is_teacher()
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
       and p.role = 'teacher'
  );
$$;

revoke all on function public.is_teacher() from public, anon;
grant execute on function public.is_teacher() to authenticated;

create or replace function public.teacher_has_course(p_course_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_teacher() and exists (
    select 1
      from public.teacher_courses tc
     where tc.teacher_id = auth.uid()
       and tc.course_id = p_course_id
  );
$$;

revoke all on function public.teacher_has_course(text) from public, anon;
grant execute on function public.teacher_has_course(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4) teacher_courses RLS
-- ----------------------------------------------------------------------------

alter table public.teacher_courses enable row level security;

drop policy if exists teacher_courses_okuma on public.teacher_courses;
create policy teacher_courses_okuma on public.teacher_courses
  for select to authenticated
  using (
    teacher_id = auth.uid()
    or public.is_admin()
  );

drop policy if exists teacher_courses_admin_ekleme on public.teacher_courses;
create policy teacher_courses_admin_ekleme on public.teacher_courses
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists teacher_courses_admin_silme on public.teacher_courses;
create policy teacher_courses_admin_silme on public.teacher_courses
  for delete to authenticated
  using (public.is_admin());

-- Teacher UPDATE yetkisi bilinçli olarak yok: atamasını değiştiremez.

-- ----------------------------------------------------------------------------
-- 5) materials INSERT: direct publish server-side
-- ----------------------------------------------------------------------------

create or replace function public.materials_gonderim_durumunu_ata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Kimlik doğrulaması olmadan materyal gönderimi yapılamaz';
  end if;

  if public.is_teacher() then
    if not public.teacher_has_course(new.course_id) then
      raise exception 'Öğretim elemanı bu ders için materyal yükleme yetkisine sahip değil';
    end if;

    new.status := 'approved';
    new.reviewed_at := now();
    new.reviewed_by := auth.uid();
    new.rejection_reason := null;
  else
    new.status := 'pending';
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.rejection_reason := null;
  end if;

  return new;
end;
$$;

revoke all on function public.materials_gonderim_durumunu_ata() from public, anon, authenticated;

drop trigger if exists materials_gonderim_durumunu_ata_trg on public.materials;
create trigger materials_gonderim_durumunu_ata_trg
  before insert on public.materials
  for each row execute function public.materials_gonderim_durumunu_ata();

-- 003'te daraltılan sahiplik + davet koşulları korunur.
drop policy if exists materials_gonderim on public.materials;
create policy materials_gonderim on public.materials
  for insert to authenticated
  with check (
    uploader_id = auth.uid()
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
        and status = 'pending'
        and reviewed_at is null
        and reviewed_by is null
        and rejection_reason is null
        and (public.is_admin() or public.davet_dogrulandi_mi())
      )
    )
  );

-- ----------------------------------------------------------------------------
-- 6) storage.objects INSERT: teacher yüklemesine izin
-- ----------------------------------------------------------------------------

drop policy if exists materyal_yukleme on storage.objects;
create policy materyal_yukleme on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'materyaller'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (
      public.is_admin()
      or public.is_teacher()
      or public.davet_dogrulandi_mi()
    )
  );

commit;
