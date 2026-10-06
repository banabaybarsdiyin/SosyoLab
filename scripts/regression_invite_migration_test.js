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

function main() {
  mustContain('add column if not exists username text', 'profiles.username eklenmeli');
  mustContain('add column if not exists class_year smallint', 'profiles.class_year eklenmeli');
  mustContain('add column if not exists teacher_status text', 'profiles.teacher_status eklenmeli');
  mustContain("audience_type in ('legacy', 'student', 'teacher')", 'davet audience türleri student/teacher içermeli');
  mustContain("class_year between 1 and 4", 'student davetleri sınıf yılı kısıtı içermeli');
  mustContain("'sosyolog35'", 'Admin takma adı rezerve kullanıcı listesinde olmalı');

  mustContain('create or replace function public.normalize_username', 'normalize_username fonksiyonu olmalı');
  mustContain('create or replace function public.kullanici_email_bul', 'kullanici_email_bul fonksiyonu olmalı');
  mustContain('create or replace function public.kayit_icin_davet_kodu_kullan', 'kayit_icin_davet_kodu_kullan fonksiyonu olmalı');
  mustContain('create or replace function public.kullanici_kaydi_tamamla', 'kullanici_kaydi_tamamla fonksiyonu olmalı');
  mustContain('create or replace function public.ogretmen_basvurusunu_karara_bagla', 'ogretmen_basvurusunu_karara_bagla fonksiyonu olmalı');
  mustContain('create or replace function public.admin_davet_kodu_olustur', 'admin_davet_kodu_olustur fonksiyonu olmalı');

  mustContain('create or replace function public.profiles_kayit_alanlarini_koru()', 'profiles kayıt alanı koruma trigger fonksiyonu olmalı');
  mustContain('create trigger profiles_kayit_alanlarini_koru_trg', 'profiles kayıt alanı koruma triggerı olmalı');
  mustContain("if lower(btrim(new.course_id)) = 'sos401' then", 'sos401 teacher atama blokajı canonical kontrol içermeli');
  mustContain("and p.teacher_status = 'approved'", 'teacher_courses için approved teacher kontrolü olmalı');

  console.log('PASS regression_invite_migration_test');
}

try {
  main();
} catch (err) {
  console.error('FAIL regression_invite_migration_test');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
