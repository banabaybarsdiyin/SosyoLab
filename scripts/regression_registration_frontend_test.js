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
  mustContain('sinirCagir("kayit"', 'Kayıt server-side Edge Function sınırından geçmeli');
  mustContain('sinirCagir("giris"', 'Giriş server-side Edge Function sınırından geçmeli');
  mustContain('auth.setSession({ access_token: o.access_token, refresh_token: o.refresh_token })', 'Giriş sunucunun döndürdüğü oturumu kurmalı');
  // F-05 end-to-end: browser never knows or sends an internal Auth identity.
  for (const bad of ['auth.signUp(', 'signInWithPassword(', 'signInWithOtp(', 'rpc("kullanici_email_bul"',
    'rpc("kullanici_kaydi_tamamla"', 'auth.sosyolab.local', 'AUTH_INTERNAL_DOMAIN', 'sosyolog.35@', 'auth.admin.']) {
    assert.ok(!src.includes(bad), 'Tarayıcı kodunda olmamalı: ' + bad);
  }
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

  // Login: wrong username and wrong password are one server answer and one UI
  // message; the request carries only username/password; success sets the
  // server-issued session. Real girisDene + sinirCagir code runs in a VM.
  const login = src.slice(src.indexOf('  async function sinirCagir('), src.indexOf('  async function kayitDene()'));
  const messages = [];
  const invokes = [];
  let username = 'unknown.user';
  let reply = { error: { name: 'FunctionsHttpError', context: { status: 401 } } };
  const sessions = [];
  const profileSelects = [];
  Object.assign(context, {
    state: { girisDeneniyor: false },
    document: { getElementById: id => ({ value: id === 'kimlik' ? username : 'synthetic-password' }) },
    kullaniciAdiNormalize: s => s.toLowerCase(),
    kullaniciAdiGecerli: () => true,
    adminTakmaAdiMi: () => false,
    hataGoster: message => messages.push(message),
    ciz: () => {},
    oturumAc: async () => {},
    bulutYenile: async () => {},
    bildir: () => {},
    bulutCikis: async () => {}
  });
  context.BULUT.istemci = {
    functions: { invoke: async (ad, opts) => { invokes.push([ad, opts.body]); return reply; } },
    auth: {
      setSession: async t => { sessions.push(t); return { data: { user: { id: 'u-1' } } }; },
      signInWithPassword: () => { throw new Error('direct Auth sign-in must not be used'); },
      signUp: () => { throw new Error('direct Auth signup must not be used'); }
    },
    from: tablo => ({ select: kolonlar => { profileSelects.push([tablo, kolonlar]); return { eq: () => ({ maybeSingle: async () => ({ data: { id: 'u-1', role: 'user', username: 'known.user' } }) }) }; } }),
    rpc: () => { throw new Error('browser must not call resolver RPC'); }
  };
  vm.runInContext(login, context);
  await context.girisDene();
  username = 'known.user';
  await context.girisDene();
  assert.deepStrictEqual(messages, ['Kullanıcı adı veya parola hatalı.', 'Kullanıcı adı veya parola hatalı.']);
  assert.deepStrictEqual(invokes.map(i => i[0]), ['giris', 'giris']);
  for (const [, body] of invokes) {
    assert.strictEqual(Object.keys(body).sort().join(), 'kullanici_adi,parola');
    assert.ok(!JSON.stringify(body).includes('@'), 'login request carries no email');
  }
  reply = { error: { name: 'FunctionsFetchError' } };
  await context.girisDene();
  assert.strictEqual(messages[2], 'Giriş tamamlanamadı. Bağlantını kontrol edip tekrar dene.');
  reply = { data: { ok: true, oturum: { access_token: 'a', refresh_token: 'r' } } };
  messages.length = 0;
  await context.girisDene();
  assert.deepStrictEqual(messages, []);
  assert.strictEqual(JSON.stringify(sessions), JSON.stringify([{ access_token: 'a', refresh_token: 'r' }]));
  assert.strictEqual(context.BULUT.uid, 'u-1');
  // F-04: the post-login profile read never requests the internal identity.
  assert.ok(profileSelects.length >= 1 && profileSelects.every(([t, k]) => t === 'profiles' && !/auth_login_email|\*/.test(k)),
    'profile select must not request auth_login_email: ' + JSON.stringify(profileSelects));
  // F-01: rate limit / temporary failure are their own (account-independent) messages.
  messages.length = 0;
  reply = { error: { name: 'FunctionsHttpError', context: { status: 429 } } };
  await context.girisDene();
  reply = { error: { name: 'FunctionsHttpError', context: { status: 503 } } };
  await context.girisDene();
  assert.deepStrictEqual(messages, ['Çok fazla deneme yapıldı. Birkaç dakika bekleyip tekrar dene.',
    'Hizmet şu an yanıt veremiyor. Biraz sonra tekrar dene.']);

  // Registration: one server call, no browser Auth account, identical message
  // for invalid invite and taken username.
  const reg = src.slice(src.indexOf('  async function kayitDene()'), src.indexOf('  function authSekmeDegistir('));
  const fields = { 'kayit-kullanici': 'new.user', 'kayit-sifre': 'Synthetic-Pass-1', 'kayit-sifre-tekrar': 'Synthetic-Pass-1',
    'kayit-davet': 'A'.repeat(32), 'kayit-adsoyad': '' };
  invokes.length = 0; messages.length = 0;
  Object.assign(context, {
    state: { kayitGonderiliyor: false },
    document: { getElementById: id => ({ value: fields[id] || '', focus: () => {} }) },
    oturumuTemizle: () => {}
  });
  vm.runInContext(reg, context);
  reply = { error: { name: 'FunctionsHttpError' } };
  await context.kayitDene();
  fields['kayit-kullanici'] = 'taken.user';
  await context.kayitDene();
  assert.deepStrictEqual(messages, ['Kayıt tamamlanamadı. Kullanıcı adı veya davet kodunu kontrol et.',
    'Kayıt tamamlanamadı. Kullanıcı adı veya davet kodunu kontrol et.']);
  assert.strictEqual(Object.keys(invokes[0][1]).sort().join(), 'ad_soyad,davet_kodu,kullanici_adi,parola');
  assert.ok(invokes.every(i => i[0] === 'kayit' && !JSON.stringify(i[1]).includes('@')), 'registration sends no identity');
  reply = { error: { name: 'FunctionsHttpError', context: { status: 429 } } };
  messages.length = 0;
  await context.kayitDene();
  assert.deepStrictEqual(messages, ['Çok fazla deneme yapıldı. Birkaç dakika bekleyip tekrar dene.']);
  reply = { data: { ok: true, audience_type: 'teacher', teacher_status: 'pending' } };
  await context.kayitDene();
  assert.strictEqual(context.state.kayitMesaj, 'Öğretim elemanı başvurun alındı. Yönetici onayından sonra öğretim elemanı özellikleri açılacaktır.');

  // Server generates the only Auth identity; same canonical regex as SQL.
  const core = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'kimlik_siniri.mjs')).href);
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '006_self_registration_invites.sql'), 'utf8');
  assert.ok(migration.includes(core.KANONIK_KIMLIK.source), 'server and SQL canonical identity regex must match');
  const nodeCrypto = require('crypto');
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const e = core.yeniKayitKimligi(() => nodeCrypto.randomUUID());
    assert.ok(core.KANONIK_KIMLIK.test(e), 'non-canonical server identity: ' + e);
    seen.add(e);
  }
  assert.strictEqual(seen.size, 500);
  assert.throws(() => core.yeniKayitKimligi(() => 'not-a-uuid'), /kimlik_uretilemedi/);

  console.log('PASS regression_registration_frontend_test');
}

main().catch(err => {
  console.error('FAIL regression_registration_frontend_test');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
