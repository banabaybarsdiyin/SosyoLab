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
  mustContain('Öğretim Elemanı Girişi', 'Giriş ekranında Öğretim Elemanı Girişi olmalı');

  mustContain('async function ogretimElemaniGirisiDene()', 'Teacher login deneme akışı olmalı');
  mustContain('async function ogretimElemaniGirisi(eposta, parola)', 'Teacher login fonksiyonu olmalı');
  mustContain('signInWithPassword({ email: eposta, password: parola })', 'Teacher login signInWithPassword kullanmalı');
  mustContain('if (BULUT.profil.role !== "teacher")', 'Teacher login role kontrolü yapmalı');

  mustContain('Derslerim', 'Sidebar içinde Derslerim görünümü olmalı');
  mustContain('function derslerimGorunumu()', 'Derslerim sayfası olmalı');
  mustContain('Yalnızca atanmış derslerin için materyal paylaşabilirsin.', 'Derslerim açıklaması olmalı');

  mustContain('if (!paylasimAcikMi()) {', 'Paylaşım aksiyonu teacher için kapı kontrolü yapmalı');
  mustContain('Materyal yayımlandı.', 'Teacher yükleme sonrası yayımlandı mesajı olmalı');
  mustContain('Materyalin incelemeye gönderildi. Admin onayından sonra arşivde yayınlanacak.', 'Öğrenci mesajı korunmalı');

  mustContain('const yetkili = () => !!state.oturum && state.oturum.rol === "admin";', 'Admin yetki semantiği korunmalı');
  mustContain('if (!yetkili()) return panelGorunumu();', 'Admin onay görünümü admin kapısıyla korunmalı');

  console.log('PASS regression_teacher_frontend_test');
}

try {
  main();
} catch (err) {
  console.error('FAIL regression_teacher_frontend_test');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
