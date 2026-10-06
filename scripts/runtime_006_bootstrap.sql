-- Disposable PostgreSQL only. Minimal Supabase substitutes, NOT platform tests.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create schema storage;
create schema extensions;
create schema runtime_test;
create table auth.users (
  id uuid primary key, email text, is_anonymous boolean default false,
  raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}'
);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb);
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt()->>'sub','')::uuid;
$$;
create function storage.foldername(text) returns text[] language sql immutable as $$
  select (string_to_array($1,'/'))[1:greatest(array_length(string_to_array($1,'/'),1)-1,0)];
$$;
create table storage.buckets (
  id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text not null, owner uuid, metadata jsonb default '{}'
);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
grant usage on schema public,auth,storage,runtime_test to anon,authenticated;
grant select,insert,update,delete on storage.objects,storage.buckets to anon,authenticated;
revoke create on schema public from public,anon,authenticated;

-- Assertions run with the caller's role: they never bypass RLS.
create function runtime_test.assert_true(ok boolean, label text) returns void
language plpgsql security invoker as $$
begin
  if ok is distinct from true then raise exception 'FAIL %',label; end if;
end;
$$;
create function runtime_test.denied(stmt text, expected_state text, expected_message text default null)
returns void language plpgsql security invoker as $$
declare denied boolean := false;
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate <> expected_state or
       (expected_message is not null and position(expected_message in sqlerrm)=0) then
      raise exception 'Unexpected rejection: % %',sqlstate,sqlerrm;
    end if;
    denied := true;
  end;
  if not denied then raise exception 'FAIL expected denial: %',stmt; end if;
end;
$$;
create function runtime_test.identity(n integer) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function runtime_test.login(n integer) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object(
    'sub',runtime_test.identity(n),'email','u.test'||n||'@auth.sosyolab.local')::text,false)::void;
$$;
