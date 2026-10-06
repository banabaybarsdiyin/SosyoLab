#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const appPath = path.join(__dirname, '..', 'app.js');
const src = fs.readFileSync(appPath, 'utf8');

function mustContain(pattern, message) {
  if (pattern instanceof RegExp) {
    assert.ok(pattern.test(src), message);
    return;
  }
  assert.ok(src.includes(pattern), message);
}

async function main() {
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

  // Execute the actual upload gates, rather than treating includes() as runtime.
  const gates = src.slice(src.indexOf('  function paylasimAcikMi()'), src.indexOf('  /* Tek bir canlı bölge'));
  const upload = src.slice(src.indexOf('  async function gonderiOlustur('), src.indexOf('  async function gonderiSonuclandir('));
  const context = {
    BULUT: { etkin: true, profil: null },
    state: { gorunum: 'ders', dersId: 'sos101' },
    ogretmenMi: () => false,
    ogretmenDersineAtandiMi: () => true,
    dosyaDogrula: () => { throw new Error('Restricted upload reached file processing'); }
  };
  vm.createContext(context);
  vm.runInContext(gates + upload, context);
  for (const status of ['pending', 'rejected']) {
    context.BULUT.profil = { teacher_status: status };
    assert.strictEqual(context.paylasimAcikMi(), false, status + ' upload UI must close');
    assert.strictEqual((await context.gonderiOlustur({}, {})).ok, false, status + ' upload must stop before network/file processing');
  }
  context.BULUT.profil = { teacher_status: null };
  assert.strictEqual(context.paylasimAcikMi(), true, 'student upload UI stays open');
  context.BULUT.profil = { teacher_status: 'approved' };
  context.ogretmenMi = () => true;
  assert.strictEqual(context.paylasimAcikMi(), true, 'assigned approved teacher upload stays open');
  context.ogretmenDersineAtandiMi = () => false;
  assert.strictEqual(context.paylasimAcikMi(), false, 'unassigned teacher upload UI closes');

  // Wrong username and wrong password follow the same actual UI error path.
  const login = src.slice(src.indexOf('  async function girisDene()'), src.indexOf('  async function kullaniciEmailiniBul('));
  const messages = [];
  let username = 'unknown.user';
  Object.assign(context, {
    state: { girisDeneniyor: false },
    document: { getElementById: id => ({ value: id === 'kimlik' ? username : 'synthetic-wrong-password' }) },
    kullaniciAdiNormalize: s => s.toLowerCase(),
    kullaniciAdiGecerli: () => true,
    adminTakmaAdiMi: () => false,
    kullaniciEmailiniBul: async () => 'u.fixture@auth.sosyolab.local',
    hataGoster: message => messages.push(message),
    ciz: () => {}
  });
  context.BULUT.istemci = { auth: { signInWithPassword: async () => ({ error: { message: 'Invalid credentials' } }) } };
  vm.runInContext(login, context);
  await context.girisDene();
  username = 'known.user';
  await context.girisDene();
  assert.deepStrictEqual(messages, ['Kullanıcı adı veya parola hatalı.', 'Kullanıcı adı veya parola hatalı.']);

  console.log('PASS regression_registration_frontend_test');
}

main().catch(err => {
  console.error('FAIL regression_registration_frontend_test');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
