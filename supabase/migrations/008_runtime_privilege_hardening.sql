-- ============================================================================
-- SosyoLab — 008: gereksiz tablo ayrıcalıklarını kaldır (TRUNCATE/REFERENCES/TRIGGER)
-- ============================================================================
-- AMAÇ
--   Hosted Supabase varsayılan grant'leri public tablolara anon/authenticated/
--   service_role için TRUNCATE, REFERENCES ve TRIGGER de verir. Uygulama ve
--   Edge Function bunların hiçbirini kullanmaz; TRUNCATE ise RLS'e tabi
--   değildir. 004 bunu yalnız denetim_kaydi/davet_dogrulamalari için kapatmıştı;
--   008 runtime tablolarının tamamında kapatır.
--
-- KAPSAM (bilinçli olarak dar)
--   * Yalnız TRUNCATE, REFERENCES, TRIGGER revoke edilir.
--   * SELECT/INSERT/UPDATE/DELETE grant'leri, kolon grant'leri (007'nin
--     auth_login_email kapanışı dahil), RLS, politikalar ve fonksiyon
--     EXECUTE grant'leri DEĞİŞMEZ. Veri değişmez.
--   * Sıra: 001..006 -> 007 -> 008. Final 006/007 durumu ön koşuldur.
--   * Tekrar çalıştırılabilir: REVOKE olmayan ayrıcalıkta hatasızdır.
-- ============================================================================

begin;

do $$
declare
  v_tablo text;
begin
  foreach v_tablo in array array['public.profiles', 'public.materials', 'public.teacher_courses',
      'public.davet_kodlari', 'public.davet_dogrulamalari', 'public.davet_denemeleri', 'public.denetim_kaydi'] loop
    if to_regclass(v_tablo) is null then
      raise exception '008: % bulunamadı', v_tablo;
    end if;
  end loop;
  if to_regprocedure('public.kayit_sonucunu_kesinlestir(uuid)') is null
     or to_regprocedure('public.kullanici_kaydi_tamamla(text,text,text)') is not null then
    raise exception '008: final 006/007 durumu bulunamadı (önce 006 veya production için 007)';
  end if;
  foreach v_tablo in array array['anon', 'authenticated', 'service_role'] loop
    if not exists (select 1 from pg_roles where rolname = v_tablo) then
      raise exception '008: % rolü bulunamadı', v_tablo;
    end if;
  end loop;
end;
$$;

revoke truncate, references, trigger
  on table public.profiles, public.materials, public.teacher_courses,
           public.davet_kodlari, public.davet_dogrulamalari, public.davet_denemeleri,
           public.denetim_kaydi
  from public, anon, authenticated, service_role;

-- Son koşul: ayrıcalıklar gerçekten yok; dokunulmayan sözleşme korunmuş.
do $$
declare
  v_tablo text;
  v_rol text;
  v_yetki text;
begin
  foreach v_tablo in array array['public.profiles', 'public.materials', 'public.teacher_courses',
      'public.davet_kodlari', 'public.davet_dogrulamalari', 'public.davet_denemeleri', 'public.denetim_kaydi'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = v_tablo::regclass) then
      raise exception '008 son koşul: % RLS kapalı', v_tablo;
    end if;
    foreach v_rol in array array['anon', 'authenticated', 'service_role'] loop
      foreach v_yetki in array array['TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
        if has_table_privilege(v_rol, v_tablo, v_yetki) then
          raise exception '008 son koşul: % üzerinde % için % kaldı', v_tablo, v_rol, v_yetki;
        end if;
      end loop;
      if has_any_column_privilege(v_rol, v_tablo, 'REFERENCES') then
        raise exception '008 son koşul: % üzerinde % için kolon REFERENCES kaldı', v_tablo, v_rol;
      end if;
    end loop;
  end loop;

  if has_column_privilege('authenticated', 'public.profiles', 'auth_login_email', 'select')
     or not has_column_privilege('authenticated', 'public.profiles', 'username', 'select') then
    raise exception '008 son koşul: profiles kolon sözleşmesi bozuldu';
  end if;
end;
$$;

commit;
