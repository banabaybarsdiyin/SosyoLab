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
  mustContain('grant execute on function public.kullanici_email_bul(text) to anon, authenticated;', 'Login çözümleme fonksiyonu anon+authenticated erişimine açık olmalı');

  mustContain('revoke all on function public.kayit_icin_davet_kodu_kullan(text) from public, anon, authenticated;', 'Kayıt davet helper fonksiyonu istemci rollerine kapalı olmalı');
  mustNotContain('grant execute on function public.kayit_icin_davet_kodu_kullan(text) to authenticated', 'Kayıt davet helper fonksiyonuna authenticated grant edilmemeli');
  mustContain("if current_setting('sosyolab.registration_context', true) is distinct from 'on' then", 'Kayıt davet helper fonksiyonu NULL context dahil kayıt dışını reddetmeli');

  mustContain('revoke all on function public.kullanici_kaydi_tamamla(text, text, text) from public, anon;', 'Kayıt tamamlama anon erişimini kapatmalı');
  mustContain('grant execute on function public.kullanici_kaydi_tamamla(text, text, text) to authenticated;', 'Kayıt tamamlama yalnız authenticated olmalı');
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
