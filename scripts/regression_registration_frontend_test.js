#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const appPath = path.join(__dirname, '..', 'app.js');
const src = fs.readFileSync(appPath, 'utf8');

function mustContain(pattern, message) {
  if (pattern instanceof RegExp) {
    assert.ok(pattern.test(src), message);
    return;
  }
  assert.ok(src.includes(pattern), message);
}

function main() {
  mustContain('data-action="auth-sekme"', 'Auth ekranında giriş/kayıt sekmeleri olmalı');
  mustContain('data-action="kayit-ol"', 'Kayıt düğmesi olmalı');
  mustContain('function kullaniciAdiGecerli(v)', 'Kullanıcı adı doğrulama helperı olmalı');
  mustContain('async function kayitDene()', 'Kayıt akışı olmalı');
  mustContain('if (adminTakmaAdiMi(kullaniciAdi))', 'Kayıtta admin takma adı çakışması engellenmeli');
  mustContain('auth.signUp({ email: email, password: sifre })', 'Kayıt akışı signUp kullanmalı');
  mustContain('rpc("kullanici_kaydi_tamamla"', 'Kayıt tamamlamada RPC çağrısı olmalı');
  mustContain('async function kullaniciEmailiniBul(kullaniciAdi)', 'Kullanıcı adı -> email çözümleme helperı olmalı');
  mustContain('rpc("kullanici_email_bul"', 'Girişte kullanıcı_email_bul RPC çağrısı olmalı');
  mustContain('auth.signInWithPassword({ email: email, password: sifre })', 'Girişte signInWithPassword kullanılmalı');
  mustContain('if (BULUT.profil.teacher_status === "pending")', 'Teacher pending kullanıcı mesajı korunmalı');

  console.log('PASS regression_registration_frontend_test');
}

try {
  main();
} catch (err) {
  console.error('FAIL regression_registration_frontend_test');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
