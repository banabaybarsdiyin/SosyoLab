-- ============================================================================
-- SosyoLab — materyal gönderimi ve admin onayı için Supabase şeması
--
-- Supabase Dashboard → SQL Editor içine yapıştırıp çalıştırın.
-- Tek seferde çalışacak şekilde yazıldı; tekrar çalıştırmak güvenlidir.
--
-- Güvenlik notu: yetkilendirme sınırı burasıdır. Tarayıcıdaki JavaScript
-- yalnızca arayüzü düzenler; gerçek kontrol aşağıdaki RLS politikalarıdır.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PROFILLER
-- ----------------------------------------------------------------------------

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  student_number text,
  display_name text,
  role         text not null default 'user',
  created_at   timestamptz not null default now(),
  constraint profiles_role_gecerli check (role in ('user', 'admin')),
  constraint profiles_student_number_bicim
    check (student_number is null or student_number ~ '^[0-9]{10}$')
);

comment on table public.profiles is
  'auth.users ile eşleşen uygulama profili. role yalnızca user veya admin olabilir.';

-- ----------------------------------------------------------------------------
-- 2. MATERYALLER
-- ----------------------------------------------------------------------------

create table if not exists public.materials (
  id               uuid primary key default gen_random_uuid(),
  course_id        text not null,
  uploader_id      uuid references public.profiles (id) on delete set null,
  title            text not null,
  description      text,
  material_type    text,
  file_path        text not null,
  file_name        text not null,
  mime_type        text,
  file_size        bigint,
  status           text not null default 'pending',
  rejection_reason text,
  created_at       timestamptz not null default now(),
  reviewed_at      timestamptz,
  reviewed_by      uuid references public.profiles (id) on delete set null,

  constraint materials_status_gecerli check (status in ('pending', 'approved', 'rejected')),
  constraint materials_title_dolu     check (length(btrim(title)) between 1 and 200),
  constraint materials_course_dolu    check (length(btrim(course_id)) between 1 and 64),
  constraint materials_boyut_siniri   check (file_size is null or file_size <= 26214400), -- 25 MB
  constraint materials_mime_gecerli   check (
    mime_type is null or mime_type in (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/jpeg',
      'image/png'
    )
  ),
  constraint materials_tur_gecerli check (
    material_type is null or material_type in
      ('ders-notu', 'sunum', 'makale', 'sinav-calismasi', 'ozet', 'diger')
  ),
  -- İncelenmiş kayıtta inceleyen ve tarih dolu olmalı; bekleyen kayıtta boş.
  constraint materials_inceleme_tutarli check (
    (status = 'pending'  and reviewed_at is null and reviewed_by is null and rejection_reason is null)
    or (status = 'approved' and reviewed_at is not null and reviewed_by is not null)
    or (status = 'rejected' and reviewed_at is not null and reviewed_by is not null)
  )
);

create index if not exists materials_status_course_idx on public.materials (status, course_id);
create index if not exists materials_uploader_idx      on public.materials (uploader_id);

-- ----------------------------------------------------------------------------
-- 3. YARDIMCI FONKSİYONLAR
-- ----------------------------------------------------------------------------

-- RLS politikalarının profiles tablosunu okuyabilmesi için security definer.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Kullanıcı kendi rolünü değiştiremesin: admin olmayan güncellemelerde
-- role alanı eski değerine geri sabitlenir.
create or replace function public.profiles_rol_koru()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    new.role := old.role;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_rol_koru_trg on public.profiles;
create trigger profiles_rol_koru_trg
  before update on public.profiles
  for each row execute function public.profiles_rol_koru();

-- Yeni kayıtta rol her zaman 'user' başlar; admin yalnızca dashboard'dan verilir.
create or replace function public.profiles_rol_varsayilan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    new.role := 'user';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_rol_varsayilan_trg on public.profiles;
create trigger profiles_rol_varsayilan_trg
  before insert on public.profiles
  for each row execute function public.profiles_rol_varsayilan();

-- İnceleme alanlarını sunucu tarafında damgala: istemcinin gönderdiği
-- reviewed_by / reviewed_at değerlerine güvenilmez.
create or replace function public.materials_inceleme_damgala()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and new.status in ('approved', 'rejected') then
    new.reviewed_at := now();
    new.reviewed_by := auth.uid();
  end if;

  if new.status = 'approved' then
    new.rejection_reason := null;
  end if;

  -- İncelenmiş bir kayıt tekrar beklemeye alınamaz.
  if old.status in ('approved', 'rejected') and new.status = 'pending' then
    raise exception 'İncelenmiş materyal yeniden beklemeye alınamaz';
  end if;

  -- Dosya ve yükleyen bilgisi inceleme sırasında değiştirilemez.
  new.file_path   := old.file_path;
  new.uploader_id := old.uploader_id;
  new.created_at  := old.created_at;

  return new;
end;
$$;

drop trigger if exists materials_inceleme_damgala_trg on public.materials;
create trigger materials_inceleme_damgala_trg
  before update on public.materials
  for each row execute function public.materials_inceleme_damgala();

-- ----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------

alter table public.profiles  enable row level security;
alter table public.materials enable row level security;

-- --- profiles ---------------------------------------------------------------

drop policy if exists profiles_kendi_okur on public.profiles;
create policy profiles_kendi_okur on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_kendi_olusturur on public.profiles;
create policy profiles_kendi_olusturur on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists profiles_kendi_gunceller on public.profiles;
create policy profiles_kendi_gunceller on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
-- Rol yükseltme profiles_rol_koru_trg tarafından engellenir.

-- --- materials --------------------------------------------------------------

-- Okuma: onaylı her materyal herkese; kendi gönderisi sahibine; hepsi admine.
drop policy if exists materials_okuma on public.materials;
create policy materials_okuma on public.materials
  for select to authenticated
  using (
    status = 'approved'
    or uploader_id = auth.uid()
    or public.is_admin()
  );

-- Gönderim: yalnızca kendi adına ve yalnızca pending durumunda.
drop policy if exists materials_gonderim on public.materials;
create policy materials_gonderim on public.materials
  for insert to authenticated
  with check (
    uploader_id = auth.uid()
    and status = 'pending'
    and reviewed_at is null
    and reviewed_by is null
    and rejection_reason is null
  );

-- Güncelleme: yalnızca admin, yalnızca bekleyen kaydı sonuçlandırmak için.
drop policy if exists materials_inceleme on public.materials;
create policy materials_inceleme on public.materials
  for update to authenticated
  using (public.is_admin() and status = 'pending')
  with check (public.is_admin() and status in ('approved', 'rejected'));

-- Silme: yalnızca admin.
drop policy if exists materials_silme on public.materials;
create policy materials_silme on public.materials
  for delete to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 5. STORAGE
-- ----------------------------------------------------------------------------

-- Özel (public olmayan) kova: dosyaya erişim yalnızca imzalı bağlantıyla
-- ve yalnızca aşağıdaki politikalardan geçenler için mümkündür.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'materyaller', 'materyaller', false, 26214400,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg',
    'image/png'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Yükleme: yalnızca kendi klasörüne (ilk klasör adı kullanıcının uid'si).
drop policy if exists materyal_yukleme on storage.objects;
create policy materyal_yukleme on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'materyaller'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Okuma: kendi dosyası, admin, ya da onaylanmış bir materyale ait dosya.
-- Bekleyen dosya yalnızca sahibi ve admin tarafından açılabilir.
drop policy if exists materyal_okuma on storage.objects;
create policy materyal_okuma on storage.objects
  for select to authenticated
  using (
    bucket_id = 'materyaller'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
      or exists (
        select 1 from public.materials m
        where m.file_path = storage.objects.name
          and m.status = 'approved'
      )
    )
  );

-- Silme: yalnızca admin.
drop policy if exists materyal_silme on storage.objects;
create policy materyal_silme on storage.objects
  for delete to authenticated
  using (bucket_id = 'materyaller' and public.is_admin());

-- ----------------------------------------------------------------------------
-- 6. ADMIN SAĞLAMA (elle, dashboard üzerinden)
-- ----------------------------------------------------------------------------
--
-- Admin parolası bu dosyaya YAZILMAZ ve Git geçmişine girmez.
--
-- 1) Authentication → Users → Add user
--    E-posta: sosyolog.35@sosyolab.local
--    Parola : güçlü bir parola üret, yalnızca parola yöneticinde sakla
--    "Auto confirm user" işaretli olsun
--
-- 2) Oluşan kullanıcının UUID'sini kopyala ve aşağıyı çalıştır:
--
--    insert into public.profiles (id, display_name, role)
--    values ('BURAYA_UUID', 'Bölüm Yöneticisi', 'admin')
--    on conflict (id) do update set role = 'admin';
--
--    (role sütunu trigger ile korunur; bu insert'i SQL Editor'den
--     service_role yetkisiyle çalıştırdığınız için geçerlidir.)
--
-- 3) Authentication → Providers → Anonymous Sign-Ins açık olmalı:
--    öğrenci gönderimleri anonim oturumla yapılır, her gönderinin yine de
--    kendi auth.uid()'si olur ve RLS bu kimliğe göre çalışır.
-- ----------------------------------------------------------------------------
