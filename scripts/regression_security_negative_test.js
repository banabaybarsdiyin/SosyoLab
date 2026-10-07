#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '006_self_registration_invites.sql');
const src = fs.readFileSync(migrationPath, 'utf8');

function mustContain(pattern, message) {
  if (pattern instanceof RegExp) {
    assert.ok(pattern.test(src), message);
    return;
  }
  assert.ok(src.includes(pattern), message);
}

function mustNotContain(pattern, message) {
  if (pattern instanceof RegExp) {
    assert.ok(!pattern.test(src), message);
    return;
  }
  assert.ok(!src.includes(pattern), message);
}

function main() {
  // F-05 end-to-end: resolver ve kayıt yalnız Edge Function (service_role).
  mustContain('revoke all on function public.kullanici_email_bul(text) from public, anon, authenticated;', 'Login çözümleme istemcilere kapalı olmalı');
  mustContain('grant execute on function public.kullanici_email_bul(text) to service_role;', 'Login çözümleme yalnız service_role olmalı');
  mustNotContain(/grant execute on function public\.kullanici_email_bul\(text\) to [^;]*(anon|authenticated)/, 'Login çözümleme anon/authenticated grant almamalı');
  mustContain('revoke all on function public.kayit_on_kontrol(text, text, text) from public, anon, authenticated;', 'Kayıt ön kontrolü istemcilere kapalı olmalı');
  mustContain('grant execute on function public.kayit_on_kontrol(text, text, text) to service_role;', 'Kayıt ön kontrolü yalnız service_role olmalı');
  // F-05: bilinmeyen username fallback'i offline hesaplanabilir olmamalı.
  mustNotContain(/md5\('login:/, 'Login fallback offline hesaplanabilir md5 formülü kullanmamalı');
  mustContain("extensions.hmac(convert_to('login:v3:' || v_username, 'UTF8'), v_pepper, 'sha256')", 'Login fallback pepper ile HMAC türetilmeli');
  mustContain('revoke all on schema sosyolab_private from public, anon, authenticated, service_role;', 'Pepper şeması istemci rollerine ve doğrudan service_role erişimine kapalı olmalı');
  for (const t of ['login_pepper', 'sunucu_pepperlari', 'istek_sayaclari', 'kayit_iptalleri']) {
    mustContain(`revoke all on table sosyolab_private.${t} from public, anon, authenticated, service_role;`, `sosyolab_private.${t} doğrudan erişime kapalı olmalı`);
  }
  mustNotContain(/grant[^;]*sosyolab_private/i, 'Pepper şeması/tablosuna hiçbir grant verilmemeli');
  // F-01 / F-06: hız sınırı ve kayıt kesinleştirme yalnız Edge Function (service_role).
  for (const sig of ['istek_siniri_tuket(jsonb)', 'kayit_sonucunu_kesinlestir(uuid)']) {
    mustContain(`revoke all on function public.${sig} from public, anon, authenticated;`, sig + ' istemcilere kapalı olmalı');
    mustContain(`grant execute on function public.${sig} to service_role;`, sig + ' yalnız service_role olmalı');
  }
  // F-02: davet araması pepper'lı HMAC, istemcilere kapalı; kayıt yolunda bcrypt yok.
  mustContain('revoke all on function public.davet_arama_ozeti(text) from public, anon, authenticated;', 'Davet arama özeti istemcilere kapalı olmalı');
  mustNotContain(/grant execute on function public\.davet_arama_ozeti/, 'Davet arama özetine grant verilmemeli');
  const kayitYolu = src.slice(src.indexOf('create or replace function public.kayit_icin_davet_kodu_kullan'), src.indexOf('-- Admin öğretim elemanı başvurusu kararı'));
  assert.ok(kayitYolu.length > 1000 && !/crypt\(/.test(kayitYolu), 'Kayıt yolunda (ön kontrol/tüketim/tamamla) bcrypt çağrısı olmamalı');
  // F-04: iç Auth kimliği istemci SELECT'ine kapalı (kolon düzeyi grant).
  mustContain('revoke select on table public.profiles from anon, authenticated;', 'profiles tablo düzeyi SELECT kaldırılmalı');
  mustContain("and a.attname <> 'auth_login_email';", 'auth_login_email kolon grant listesinden hariç tutulmalı');
  mustContain("auth_login_email ~ '^u\\.[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}@auth\\.sosyolab\\.local$'", 'auth_login_email tek canonical biçime kısıtlanmalı');

  mustContain('revoke all on function public.kayit_icin_davet_kodu_kullan(uuid, text) from public, anon, authenticated;', 'Kayıt davet helper fonksiyonu istemci rollerine kapalı olmalı');
  mustNotContain(/grant execute on function public\.kayit_icin_davet_kodu_kullan/, 'Kayıt davet helper fonksiyonuna grant edilmemeli');
  mustContain("if current_setting('sosyolab.registration_context', true) is distinct from 'on' then", 'Kayıt davet helper fonksiyonu NULL context dahil kayıt dışını reddetmeli');

  mustContain('revoke all on function public.kullanici_kaydi_tamamla(uuid, text, text, text) from public, anon, authenticated;', 'Kayıt tamamlama istemcilere kapalı olmalı');
  mustContain('grant execute on function public.kullanici_kaydi_tamamla(uuid, text, text, text) to service_role;', 'Kayıt tamamlama yalnız service_role (Edge Function) olmalı');
  mustContain('drop function if exists public.kullanici_kaydi_tamamla(text, text, text);', 'Eski istemci oturumlu kayıt imzası kaldırılmalı');
  mustContain(/from auth\.users u\s+where u\.id = v_uid;/, 'Kayıt kimliği JWT yerine auth.users satırından okunmalı');
  mustContain('revoke insert on table public.profiles from anon, authenticated;', 'profiles doğrudan insert yetkisi anon/authenticated için kapatılmalı');
  mustContain('drop policy if exists profiles_kendi_olusturur on public.profiles;', 'profiles self insert policy kaldırılmalı');

  mustContain('revoke all on function public.ogretmen_basvurusunu_karara_bagla(uuid, text, text) from public, anon;', 'Teacher karar fonksiyonu anon erişimini kapatmalı');
  mustContain('if not public.is_admin() then', 'Teacher karar fonksiyonu admin kapısı içermeli');

  mustContain('revoke all on function public.admin_davet_kodu_olustur(text, text, smallint, text, timestamptz, integer) from public, anon;', 'Invite üretim fonksiyonu anon erişimini kapatmalı');
  mustContain("if auth.uid() is not null and not public.is_admin() then", 'Invite üretim fonksiyonu admin olmayan authenticated kullanıcıyı engellemeli');

  mustNotContain('grant execute on function public.ogretmen_basvurusunu_karara_bagla(uuid, text, text) to anon', 'Teacher karar fonksiyonuna anon grant edilmemeli');
  mustNotContain('grant execute on function public.admin_davet_kodu_olustur(text, text, smallint, text, timestamptz, integer) to anon', 'Invite üretim fonksiyonuna anon grant edilmemeli');

  console.log('PASS regression_security_negative_test');
}

try {
  main();
} catch (err) {
  console.error('FAIL regression_security_negative_test');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
