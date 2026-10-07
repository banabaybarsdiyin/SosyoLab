#!/usr/bin/env node
'use strict';
// 007 static contract (no Docker, no network). Runtime proof is
// scripts/runtime_007_drift_test.js; this guards the source shape:
//   * 007 sections 1-7 are a byte-identical copy of final 006 (no parallel
//     design; a later 006 edit without regenerating 007 FAILS here),
//   * 007's own sections (preconditions/postconditions) never delete data,
//   * one transaction; fail-closed precondition and postcondition blocks exist,
//   * operator SQL files are read-only / PII-free / non-overwriting.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const ACIK = '-- >>> 006 FINAL GÖVDESİ (bölüm 1-7, birebir) >>>\n';
const KAPALI = '\n-- <<< 006 FINAL GÖVDESİ <<<';

function main() {
  const m006 = read('supabase/migrations/006_self_registration_invites.sql');
  const m007 = read('supabase/migrations/007_production_006_reconciliation.sql');

  // 1) Embedded body == final 006 sections 1-7.
  const bas = m006.indexOf('-- ----------------------------------------------------------------------------\n-- 1) Şema genişletmeleri');
  const son = m006.lastIndexOf('\ncommit;');
  assert.ok(bas > 0 && son > bas, '006 section markers');
  const govde006 = m006.slice(bas, son).replace(/\n+$/, '');
  assert.strictEqual(m007.split(ACIK).length, 2, '007 opens the embedded 006 body exactly once');
  assert.strictEqual(m007.split(KAPALI).length, 2, '007 closes the embedded 006 body exactly once');
  const govde007 = m007.slice(m007.indexOf(ACIK) + ACIK.length, m007.indexOf(KAPALI));
  assert.strictEqual(govde007, govde006, '007 embedded body must equal final 006 sections 1-7 byte-for-byte (regenerate 007)');

  // 2) 007's own code: one transaction, fail-closed, no data deletion.
  const kendi = m007.slice(0, m007.indexOf(ACIK)) + m007.slice(m007.indexOf(KAPALI));
  const kod = kendi.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  assert.strictEqual((m007.match(/^begin;$/gm) || []).length, 1, 'single begin');
  assert.strictEqual((m007.match(/^commit;$/gm) || []).length, 1, 'single commit');
  assert.ok(m007.trimEnd().endsWith('commit;'), 'commit is last');
  assert.ok(!/\b(delete\s+from|truncate|drop\s+table|drop\s+schema|drop\s+function)\b/i.test(kod), '007 own sections never delete/drop');
  assert.ok(!/\b(update|insert\s+into|delete\s+from)\s+auth\./i.test(m007), '007 never writes auth.*');
  assert.ok(!/\bdelete\s+from\s+public\.(profiles|davet_kodlari|davet_dogrulamalari|materials)\b/i.test(m007), '007 never deletes user/invite/material rows');
  for (const s of ['desteklenmeyen şema durumu', 'beklenmeyen overload', 'internal olmayan trigger',
    'canonical olmayan', '006 kolonları yok', 'veri koruma ihlali', 'EXECUTE % rolüne açık',
    'profiles istemci yetkileri', 'mevcut pepper değişti']) {
    assert.ok(kendi.includes(s), '007 fail-closed check present: ' + s);
  }
  assert.ok(kendi.indexOf('do $$') < kendi.indexOf(KAPALI) && kendi.lastIndexOf('007 son koşul') > kendi.indexOf(KAPALI),
    'preconditions before, postconditions after the 006 body');

  // 3) Operator files.
  for (const f of ['supabase/pre_007_fingerprint.sql', 'supabase/legacy_identity_inventory.sql']) {
    const s = read(f);
    const kodS = s.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
    assert.match(kodS, /^\s*begin transaction read only;/m, f + ' is read-only');
    assert.ok(!/^\s*(insert|update|delete|alter|create|drop|grant|revoke|truncate)\b/im.test(kodS), f + ' has no write statement');
    assert.ok(!/\b(display_name|student_number|ogrenci_no|raw_user_meta_data)\b/.test(kodS), f + ' prints no personal field');
    // Auth email only ever appears inside classification expressions.
    for (const m of kodS.matchAll(/[^\n]*\bu\.email\b[^\n]*/g)) {
      assert.match(m[0], /\b(when|lower\(|coalesce\(lower)/, f + ' must not output u.email: ' + m[0].trim());
    }
  }
  const bf = read('supabase/legacy_user_backfill.sql');
  const bfKod = bf.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  for (const v of [":'profil_id'", ":'kullanici_adi'", ":'giris_kimligi'"]) assert.ok(bfKod.includes(v), 'backfill psql variable ' + v);
  assert.ok(/username is null\s+and p\.auth_login_email is null/.test(bfKod), 'backfill never overwrites');
  assert.ok(!/\b(update|insert\s+into|delete\s+from)\s+auth\./i.test(bfKod), 'backfill never writes auth.* (Admin API only)');
  assert.ok(!/delete\s+from/i.test(bfKod), 'backfill never deletes');
  assert.strictEqual((bfKod.match(/^begin;$/gm) || []).length, 1, 'backfill single transaction');

  console.log('PASS regression_007_reconciliation_test (007 body == final 006; own sections fail-closed, non-destructive; operator SQL read-only/PII-free)');
}

try { main(); } catch (err) {
  console.error('FAIL regression_007_reconciliation_test');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
