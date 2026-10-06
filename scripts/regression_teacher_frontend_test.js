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
  mustContain('const ROLLER = ["ogrenci", "teacher", "admin"]', 'ROLLER içinde teacher olmalı');
  mustContain('teacher: "Öğretim Elemanı"', 'ROL_ETIKET teacher etiketi olmalı');
  mustContain('Öğretim Elemanı Başvuruları', 'Admin menüsünde öğretim elemanı başvuruları görünmeli');

  mustContain('data-action="auth-sekme"', 'Auth ekranında giriş/kayıt sekmeleri olmalı');
  mustContain('async function kayitDene()', 'Kayıt akışı olmalı');
  mustContain('rpc("kullanici_kaydi_tamamla"', 'Kayıt akışı kullanıcı_kaydi_tamamla RPC çağırmalı');
  mustContain('rpc("kullanici_email_bul"', 'Giriş akışı kullanıcı_email_bul RPC çağırmalı');

  mustContain('Derslerim', 'Sidebar içinde Derslerim görünümü olmalı');
  mustContain('function derslerimGorunumu()', 'Derslerim sayfası olmalı');
  mustContain('Yalnızca atanmış derslerin için materyal paylaşabilirsin.', 'Derslerim açıklaması olmalı');

  mustContain('if (!paylasimAcikMi()) {', 'Paylaşım aksiyonu teacher için kapı kontrolü yapmalı');
  mustContain('Materyal yayımlandı.', 'Teacher yükleme sonrası yayımlandı mesajı olmalı');
  mustContain('Materyalin incelemeye gönderildi. Admin onayından sonra arşivde yayınlanacak.', 'Öğrenci mesajı korunmalı');

  mustContain('const yetkili = () => !!state.oturum && state.oturum.rol === "admin";', 'Admin yetki semantiği korunmalı');
  mustContain('if (!yetkili()) return panelGorunumu();', 'Admin onay görünümü admin kapısıyla korunmalı');
  mustContain('async function ogretmenBasvurusunuSonuclandir(id, karar)', 'Admin başvuru karar fonksiyonu olmalı');
  mustContain('rpc("ogretmen_basvurusunu_karara_bagla"', 'Admin başvuru onay/reddi RPC üzerinden olmalı');

  console.log('PASS regression_teacher_frontend_test');
}

try {
  main();
} catch (err) {
  console.error('FAIL regression_teacher_frontend_test');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
