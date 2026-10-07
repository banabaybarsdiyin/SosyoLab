-- ============================================================================
-- SosyoLab — legacy kullanıcı kimlik backfill'i (HESAP BAŞINA, OPERATÖR)
-- ============================================================================
-- 006/007 SONRASI çalışır. Migration değildir; otomatik toplu backfill yoktur.
-- Her hesap için preserve kararı ve kullanıcıyla kararlaştırılmış username
-- gerekir (DEPLOYMENT-SECURITY bölüm 12, TEACHER-SETUP "Hesap başına plan").
--
-- Ön adım (bu dosyadan ÖNCE, güvenli operatör ortamında):
--   Yeni canonical iç kimlik üret:
--     select 'u.' || replace(gen_random_uuid()::text, '-', '') || '@auth.sosyolab.local';
--   Auth email'ini Supabase Auth Admin API ile TAM bu değere çek
--   (auth.users SQL'den güncellenmez). Gerekirse parola güvenli kanaldan
--   yeniden belirlenir. Gerçek değerler repoya/loglara/paylaşılan kayda yazılmaz.
--
-- Çalıştırma (psql; değişkenler komut satırı geçmişine yazılmasın diye
-- güvenli ortamda verilir):
--   psql <baglanti> -v ON_ERROR_STOP=1 \
--     -v profil_id=<UUID> -v kullanici_adi=<ad> -v giris_kimligi=<u....@auth.sosyolab.local> \
--     -f supabase/legacy_user_backfill.sql
--
-- Sözleşme: tek transaction; profil yalnız username VE auth_login_email
-- boşken doldurulur (üzerine yazmaz); ad canonical/benzersiz/rezerve değil;
-- kimlik canonical ve Auth email'iyle birebir aynı; sonunda resolver bu
-- kimliği döndürür. Herhangi bir ihlal -> RAISE, hiçbir değişiklik kalmaz.
-- Çıktı yalnız sabit metin/boolean'dır; email/ad yazdırılmaz.
-- ============================================================================

begin;

select (set_config('sosyolab.bf_profil', :'profil_id', true)
     || set_config('sosyolab.bf_ad', :'kullanici_adi', true)
     || set_config('sosyolab.bf_kimlik', :'giris_kimligi', true)) is not null as parametreler_hazir;

do $$
declare
  v_id uuid;
  v_ad text := current_setting('sosyolab.bf_ad');
  v_kimlik text := current_setting('sosyolab.bf_kimlik');
  v_profil public.profiles%rowtype;
  v_auth_email text;
  v_anonim boolean;
begin
  begin
    v_id := current_setting('sosyolab.bf_profil')::uuid;
  exception when others then
    raise exception 'backfill: profil_id geçerli bir UUID değil';
  end;

  if to_regprocedure('public.kayit_sonucunu_kesinlestir(uuid)') is null then
    raise exception 'backfill: final 006/007 uygulanmamış';
  end if;

  select * into v_profil from public.profiles p where p.id = v_id for update;
  if not found then
    raise exception 'backfill: profil yok (profilsiz Auth hesabı bu yolla bağlanmaz; bkz. orphan prosedürü)';
  end if;
  if v_profil.username is not null or v_profil.auth_login_email is not null then
    raise exception 'backfill: profil zaten kimlik taşıyor; üzerine yazılmaz';
  end if;

  if v_ad is distinct from public.normalize_username(v_ad)
     or v_ad !~ '^[a-z0-9._]{4,24}$'
     or v_ad in ('admin', 'administrator', 'root', 'system', 'supabase', 'sosyolab', 'sosyolog35', 'sosyolog.35') then
    raise exception 'backfill: kullanıcı adı canonical değil, biçim dışı veya rezerve';
  end if;
  if exists (select 1 from public.profiles p where p.username = v_ad) then
    raise exception 'backfill: kullanıcı adı alınmış';
  end if;

  if v_kimlik !~ '^u\.[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}@auth\.sosyolab\.local$' then
    raise exception 'backfill: giriş kimliği canonical değil (u.<UUIDv4 hex>@auth.sosyolab.local)';
  end if;
  if exists (select 1 from public.profiles p where p.auth_login_email = v_kimlik) then
    raise exception 'backfill: giriş kimliği başka profilde kullanılıyor';
  end if;

  select lower(coalesce(u.email, '')), coalesce(u.is_anonymous, false)
    into v_auth_email, v_anonim
    from auth.users u where u.id = v_id;
  if v_anonim then
    raise exception 'backfill: anonim Auth hesabı backfill edilmez';
  end if;
  if v_auth_email is distinct from v_kimlik then
    raise exception 'backfill: Auth email henüz bu kimliğe çekilmemiş (önce Admin API)';
  end if;

  update public.profiles p
     set username = v_ad,
         auth_login_email = v_kimlik
   where p.id = v_id
     and p.username is null
     and p.auth_login_email is null;
  if not found then
    raise exception 'backfill: profil güncellenemedi';
  end if;

  if public.kullanici_email_bul(v_ad) is distinct from v_kimlik then
    raise exception 'backfill: resolver yeni kimliği döndürmüyor';
  end if;
end;
$$;

select 'backfill tamam' as sonuc;

commit;
