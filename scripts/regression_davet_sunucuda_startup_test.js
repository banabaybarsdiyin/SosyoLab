#!/usr/bin/env node
'use strict';

/* Öğrenci arşivi açılış regresyonu (DAVET_SUNUCUDA).
   a0e4931 tanımı kaldırıp kullanımı bıraktı: öğrenci oturumu her açılışta
   ReferenceError ile yukle()'nin catch'ine düşüyor, arşiv hiç istenmiyor ve
   "Sunucuya şu an ulaşılamıyor" uyarısı çıkıyordu. Fonksiyon dilimleri bu
   kapsam hatasını göremez; bu test app.js'in TAMAMINI sahte DOM ve sahte
   Supabase istemcisiyle VM'de çalıştırıp açılış akışının sonucunu ölçer.
   Ağ, gerçek Supabase ya da gerçek hesap kullanılmaz. */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');
const nodeCrypto = require('crypto');

const appPath = process.env.SOSYOLAB_APP || path.join(__dirname, '..', 'app.js');
const SRC = fs.readFileSync(appPath, 'utf8');

const UID = '00000000-0000-4000-8000-0000000000aa';
const UYARI_ERISIM = 'Sunucuya şu an ulaşılamıyor';
const UYARI_ARSIV = 'Arşiv sunucudan alınamadı.';
const DAVETSIZ = 'Arşive girmek için davet kodunu doğrulaman gerekiyor.';
const BASLIK = 'Hotfix Test Materyali';
const TEST_URL = 'https://test.invalid';
const TEST_KEY = 'test-only-placeholder-key-000000';

const PROFIL = {
  ogrenci: { id: UID, role: 'student', display_name: 'Test Öğrenci', username: 'test.ogrenci', class_year: 3, teacher_status: null },
  admin: { id: UID, role: 'admin', display_name: 'Test Yönetici', username: 'test.admin', class_year: null, teacher_status: null },
  teacher: { id: UID, role: 'teacher', display_name: 'Test Öğretmen', username: 'test.ogretmen', class_year: null, teacher_status: 'approved' }
};

const MATERYAL = {
  id: 'hotfix1', course_id: 'sos301', title: BASLIK, description: '', material_type: 'ders-notu',
  file_path: null, file_name: 'not.pdf', created_at: '2026-10-01T00:00:00Z', status: 'approved',
  profiles: { display_name: 'Test' }
};

function depoOlustur(ilk) {
  const m = new Map(Object.entries(ilk || {}));
  return {
    map: m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => Array.from(m.keys())[i] || null,
    get length() { return m.size; }
  };
}

function istemciOlustur(sen, log) {
  function yanit(q) {
    const ops = q.ops.map((o) => o[0]);
    if (q.tablo === 'profiles' && ops.includes('maybeSingle')) {
      return sen.profilHata ? { data: null, error: { message: 'TypeError: Failed to fetch' } } : { data: PROFIL[sen.rol], error: null };
    }
    if (q.tablo === 'materials' && q.ops.some((o) => o[0] === 'eq' && o[1][0] === 'status' && o[1][1] === 'approved')) {
      log.arsivIstegi++;
      return sen.arsivHata ? { data: null, error: { message: 'TypeError: Failed to fetch' } } : { data: [MATERYAL], error: null };
    }
    if (ops.includes('select') && q.ops.some((o) => o[0] === 'select' && o[1][1] && o[1][1].head)) return { data: null, count: 3, error: null };
    return { data: [], error: null };
  }
  function sorgu(tablo) {
    const q = { tablo, ops: [] };
    log.tablolar.push(tablo);
    const p = new Proxy({}, {
      get(_, ad) {
        if (ad === 'then') return (ok, ret) => Promise.resolve(yanit(q)).then(ok, ret);
        return (...args) => { q.ops.push([ad, args]); return p; };
      }
    });
    return p;
  }
  const kanal = {
    on() { return kanal; },
    subscribe() { return kanal; },
    track: () => Promise.resolve('ok'),
    untrack: () => Promise.resolve('ok'),
    unsubscribe: () => Promise.resolve('ok'),
    presenceState: () => ({})
  };
  return {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'test-access', refresh_token: 'test-refresh', user: { id: UID } } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null })
    },
    from: (t) => sorgu(t),
    rpc: async (ad) => {
      log.rpc.push(ad);
      if (ad === 'davet_dogrulandi_mi') {
        if (sen.damga === 'hata') return { data: null, error: { message: 'rpc failed' } };
        return { data: sen.damga !== false, error: null };
      }
      return { data: null, error: null };
    },
    channel: () => kanal,
    removeChannel: () => Promise.resolve('ok'),
    realtime: { setAuth() {} }
  };
}

/* app.js'i baştan sona çalıştırır ve açılışın bitmesini bekler. */
async function ac(kaynak, sen) {
  const log = { rpc: [], tablolar: [], arsivIstegi: 0, hatalar: [] };
  const root = {
    _html: '',
    set innerHTML(v) { this._html = String(v); },
    get innerHTML() { return this._html; },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    contains: () => false
  };
  const document = {
    getElementById: (id) => (id === 'sosyolab' ? root : null),
    addEventListener() {},
    contains: () => false,
    querySelector: () => null,
    querySelectorAll: () => [],
    activeElement: null,
    visibilityState: 'visible'
  };
  const ctx = {
    document,
    localStorage: sen.depo,
    navigator: { platform: 'Linux', userAgent: 'node-test' },
    location: { href: TEST_URL + '/', hash: '', search: '', pathname: '/' },
    crypto: nodeCrypto.webcrypto,
    console: { log() {}, info() {}, warn() {}, error: (...a) => log.hatalar.push(a.join(' ')) },
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, URL, TextEncoder, TextDecoder,
    addEventListener() {},
    removeEventListener() {}
  };
  ctx.window = ctx;
  if (sen.config !== undefined) ctx.SOSYOLAB_CONFIG = sen.config;
  if (sen.config) ctx.supabase = { createClient: () => istemciOlustur(sen, log) };
  vm.createContext(ctx);
  vm.runInContext(kaynak, ctx, { filename: 'app.js' });
  for (let i = 0; i < 100 && (!root._html || root._html.includes('class="skeleton"')); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  await new Promise((r) => setTimeout(r, 20));
  return { html: root._html, log };
}

const SERVER = { SUPABASE_URL: TEST_URL, SUPABASE_ANON_KEY: TEST_KEY, INVITE_MODE: 'server' };
const yerelOturum = (rol) => ({ 'sosyolab:oturum': JSON.stringify({ rol, no: 'test.ogrenci', ad: 'Test', sinif: 3 }) });

function sorunsuzArsiv(r, etiket) {
  assert.ok(!r.html.includes(UYARI_ERISIM), etiket + ': yanlış "sunucuya ulaşılamıyor" uyarısı çıkmamalı');
  assert.ok(!r.html.includes(UYARI_ARSIV), etiket + ': arşiv uyarısı çıkmamalı');
  assert.strictEqual(r.log.arsivIstegi, 1, etiket + ': onaylı arşiv tam bir kez istenmeli');
  assert.ok(r.html.includes(BASLIK), etiket + ': sunucudan gelen materyal ekranda olmalı');
}

/* Senaryolar; her biri yeni bir sayfa açılışıdır. */
async function senaryolar(kaynak) {
  // 1) öğrenci ilk açılış (server modu, damga var)
  const depo = depoOlustur(yerelOturum('ogrenci'));
  let r = await ac(kaynak, { config: SERVER, rol: 'ogrenci', damga: true, depo });
  sorunsuzArsiv(r, 'öğrenci ilk açılış');
  assert.deepStrictEqual(r.log.rpc, ['davet_dogrulandi_mi'], 'server modunda davet damgası sunucuya sorulmalı');

  // 2) sayfa yenileme: aynı depo ile ikinci açılış
  r = await ac(kaynak, { config: SERVER, rol: 'ogrenci', damga: true, depo });
  sorunsuzArsiv(r, 'öğrenci sayfa yenileme');

  // 3) davet damgası yok: davet ekranına döner, arşiv istenmez
  r = await ac(kaynak, { config: SERVER, rol: 'ogrenci', damga: false, depo: depoOlustur(yerelOturum('ogrenci')) });
  assert.ok(r.html.includes(DAVETSIZ), 'damgasız öğrenci davet açıklamasını görmeli');
  assert.strictEqual(r.log.arsivIstegi, 0, 'damgasız öğrenci için arşiv istenmemeli');
  assert.ok(!r.html.includes(UYARI_ERISIM), 'damgasız öğrencide yanlış sunucu uyarısı çıkmamalı');

  // 4) damga RPC hatası: mevcut sözleşme (RLS sınırdır) -> arşive devam
  r = await ac(kaynak, { config: SERVER, rol: 'ogrenci', damga: 'hata', depo: depoOlustur(yerelOturum('ogrenci')) });
  sorunsuzArsiv(r, 'damga RPC hatası');

  // 5) gerçek ağ hatası: doğru uyarı
  r = await ac(kaynak, { config: SERVER, rol: 'ogrenci', damga: true, arsivHata: true, depo: depoOlustur(yerelOturum('ogrenci')) });
  assert.ok(r.html.includes(UYARI_ARSIV), 'arşiv ağ hatasında "Arşiv sunucudan alınamadı." gösterilmeli');
  assert.ok(!r.html.includes(UYARI_ERISIM), 'arşiv ağ hatası istisna yoluna düşmemeli');
  assert.strictEqual(r.log.arsivIstegi, 1, 'ağ hatasında arşiv isteği yine de gönderilmiş olmalı');

  // 6) profil okunamazsa en düşük yetki (öğrenci) ile devam edilir
  r = await ac(kaynak, { config: SERVER, rol: 'ogrenci', damga: true, profilHata: true, depo: depoOlustur(yerelOturum('ogrenci')) });
  sorunsuzArsiv(r, 'profil okuma hatası');

  // 7) admin ve öğretmen: damga sorulmaz, arşiv yüklenir
  for (const rol of ['admin', 'teacher']) {
    r = await ac(kaynak, { config: SERVER, rol, damga: false, depo: depoOlustur() });
    assert.ok(!r.html.includes(UYARI_ERISIM), rol + ': yanlış sunucu uyarısı çıkmamalı');
    assert.strictEqual(r.log.arsivIstegi, 1, rol + ': arşiv istenmeli');
    assert.ok(!r.log.rpc.includes('davet_dogrulandi_mi'), rol + ': davet damgası sorulmamalı');
    assert.ok(!r.html.includes(DAVETSIZ), rol + ': davet ekranına düşmemeli');
  }

  // 8) INVITE_MODE varyantları: yalnız tam "server" damgayı sunucuya sorar
  for (const [mod, sunucu] of [['server', true], ['local', false], [undefined, false], ['SERVER', false], [' server', false], [null, false], [true, false]]) {
    const config = { SUPABASE_URL: TEST_URL, SUPABASE_ANON_KEY: TEST_KEY };
    if (mod !== undefined) config.INVITE_MODE = mod;
    r = await ac(kaynak, { config, rol: 'ogrenci', damga: false, depo: depoOlustur(yerelOturum('ogrenci')) });
    const etiket = 'INVITE_MODE=' + JSON.stringify(mod);
    assert.ok(!r.html.includes(UYARI_ERISIM), etiket + ': yanlış sunucu uyarısı çıkmamalı');
    assert.strictEqual(r.log.rpc.includes('davet_dogrulandi_mi'), sunucu, etiket + ': damga sorgusu yalnız server modunda');
    if (sunucu) assert.ok(r.html.includes(DAVETSIZ), etiket + ': damgasız öğrenci davet ekranına dönmeli');
    else sorunsuzArsiv(r, etiket);
  }

  // 9) yapılandırma hiç yok (window.SOSYOLAB_CONFIG tanımsız): demo modu açılır, istisna yok
  r = await ac(kaynak, { config: undefined, depo: depoOlustur(yerelOturum('ogrenci')) });
  assert.ok(r.html && !r.html.includes('class="skeleton"'), 'yapılandırmasız açılış tamamlanmalı');
  assert.ok(!r.html.includes(UYARI_ERISIM), 'demo modunda sunucu uyarısı çıkmamalı');
}

async function main() {
  const kayit = [];
  const dinle = (e) => kayit.push(String((e && e.stack) || e));
  process.on('unhandledRejection', dinle);

  // Tanım tam bir kez, IIFE üst düzeyinde ve kullanımından önce olmalı.
  const tanimlar = SRC.match(/^\s*const DAVET_SUNUCUDA = .*$/gm) || [];
  assert.strictEqual(tanimlar.length, 1, 'DAVET_SUNUCUDA tam bir kez tanımlanmalı');
  assert.strictEqual(tanimlar[0].trim(), 'const DAVET_SUNUCUDA = (window.SOSYOLAB_CONFIG || {}).INVITE_MODE === "server";', 'tanım INVITE_MODE sözleşmesini izlemeli');
  assert.ok(/^ {2}const DAVET_SUNUCUDA/m.test(SRC), 'tanım IIFE üst düzeyinde (2 boşluk girinti) olmalı');
  assert.ok(SRC.indexOf('const DAVET_SUNUCUDA') < SRC.indexOf('async function davetDamgasiVarMi'), 'tanım kullanımdan önce gelmeli');

  // Davranış: gerçek açılış akışı.
  await senaryolar(SRC);

  // Mutasyon: test hatayı yakalamalı (tanımsız / ters / büyük-küçük harf duyarsız).
  const satir = tanimlar[0];
  const mutantlar = {
    'tanım silindi (a0e4931 hatası)': SRC.replace(satir + '\n', '').replace(satir + '\r\n', ''),
    'karşılaştırma ters': SRC.replace(satir, satir.replace('=== "server"', '!== "server"')),
    'her zaman sunucu': SRC.replace(satir, '  const DAVET_SUNUCUDA = true;'),
    'hiç sunucu değil': SRC.replace(satir, '  const DAVET_SUNUCUDA = false;')
  };
  for (const [ad, kaynak] of Object.entries(mutantlar)) {
    assert.notStrictEqual(kaynak, SRC, 'mutant uygulanamadı: ' + ad);
    let yakalandi = false;
    try { await senaryolar(kaynak); } catch (e) { yakalandi = e instanceof assert.AssertionError; }
    assert.ok(yakalandi, 'mutant yakalanmadı: ' + ad);
  }

  process.off('unhandledRejection', dinle);
  assert.deepStrictEqual(kayit, [], 'yakalanmamış Promise reddi olmamalı');
  console.log('PASS regression_davet_sunucuda_startup_test (tam app.js açılışı: öğrenci/yenileme/damga/ağ hatası/admin/öğretmen/INVITE_MODE; 4 mutant yakalandı)');
  process.exit(0);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
