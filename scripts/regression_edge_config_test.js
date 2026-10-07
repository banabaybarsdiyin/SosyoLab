#!/usr/bin/env node
'use strict';
// F-03/F-04 deploy contract (static; no network, no Supabase CLI):
//   * supabase/config.toml pins verify_jwt=false for the pre-auth functions
//     `giris` and `kayit` and carries the CLI-required project_id,
//   * entrypoints build the adapter from env (IP forwarding fail-closed),
//   * browser code never requests the internal Auth identity column and never
//     embeds a server key.
// The validator is exercised against mutated configs so a wrong config FAILS.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

// Minimal TOML reader for the subset used here: [table.sub] headers and
// key = string | boolean. Anything else in a function table is rejected.
function parseToml(src) {
  const out = {};
  let table = out;
  let tableName = '';
  const seen = new Set();
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').replace(/^#.*$/, '').trim();
    if (!line) continue;
    let m = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
    if (m) {
      if (seen.has(m[1])) throw new Error('duplicate table [' + m[1] + ']');
      seen.add(m[1]);
      tableName = m[1];
      table = m[1].split('.').reduce((o, k) => (o[k] = o[k] || {}), out);
      continue;
    }
    m = /^([A-Za-z0-9_]+)\s*=\s*(true|false|"[^"]*")$/.exec(line);
    if (!m) throw new Error('unsupported TOML line: ' + line);
    if (Object.prototype.hasOwnProperty.call(table, m[1])) throw new Error('duplicate key ' + tableName + '.' + m[1]);
    table[m[1]] = m[2] === 'true' ? true : m[2] === 'false' ? false : m[2].slice(1, -1);
  }
  return out;
}

function validateConfig(src) {
  const c = parseToml(src);
  assert.ok(typeof c.project_id === 'string' && c.project_id.length > 0, 'project_id is required by the Supabase CLI');
  for (const fn of ['giris', 'kayit']) {
    const t = c.functions && c.functions[fn];
    assert.ok(t, `[functions.${fn}] missing`);
    assert.strictEqual(t.verify_jwt, false, `[functions.${fn}] verify_jwt must be false (pre-auth endpoint)`);
    assert.notStrictEqual(t.enabled, false, `[functions.${fn}] must not be disabled`);
  }
  assert.ok(!/sb_secret_|service_role\s*=|eyJhbGci/.test(src), 'config.toml must not contain keys');
  return c;
}

function main() {
  const cfg = read('supabase/config.toml');
  validateConfig(cfg);

  // Mutation checks: each of these broken configs must be rejected.
  const mutants = {
    'giris verify_jwt true': cfg.replace(/(\[functions\.giris\]\s*\nverify_jwt = )false/, '$1true'),
    'kayit verify_jwt true': cfg.replace(/(\[functions\.kayit\]\s*\nverify_jwt = )false/, '$1true'),
    'kayit section missing': cfg.replace(/\[functions\.kayit\][\s\S]*$/, ''),
    'verify_jwt key missing': cfg.replace(/(\[functions\.giris\]\s*\n)verify_jwt = false\n/, '$1'),
    'project_id missing': cfg.replace(/^project_id = .*$/m, ''),
    'duplicate table overrides': cfg + '\n[functions.giris]\nverify_jwt = true\n',
    'giris disabled': cfg.replace(/(\[functions\.giris\]\s*\nverify_jwt = false)/, '$1\nenabled = false')
  };
  for (const [ad, m] of Object.entries(mutants)) {
    assert.notStrictEqual(m, cfg, 'mutant applied: ' + ad);
    assert.throws(() => validateConfig(m), undefined, 'config validator must reject: ' + ad);
  }

  // Entrypoints: adapter from env (Sb-Forwarded-For needs SUPABASE_SECRET_KEYS;
  // default mode "required" fails closed), no hard-coded keys, no JWT flag reliance.
  for (const fn of ['giris', 'kayit']) {
    const src = read(`supabase/functions/${fn}/index.ts`);
    assert.ok(src.includes('supabaseDepsFromEnv(env, fetch)'), fn + ': adapter built from env');
    assert.ok(src.includes(fn === 'giris' ? 'sinir.handleLogin(req)' : 'sinir.handleRegister(req)'), fn + ': handler');
    assert.ok(!/sb_secret_|eyJ|SERVICE_ROLE_KEY|console\.log/.test(src), fn + ': no keys / logs in entrypoint');
  }
  const core = read('supabase/functions/_shared/kimlik_siniri.mjs');
  assert.ok(core.includes('"sb-forwarded-for"'), 'core forwards end-user IP to Auth');
  assert.ok(/"AUTH_IP_FORWARDING"\) \|\| "required"/.test(core), 'IP forwarding defaults to required');

  // Browser: never selects the internal Auth identity; no server keys.
  const app = read('app.js');
  assert.ok(!app.includes('auth_login_email'), 'app.js must not request auth_login_email');
  for (const m of app.matchAll(/\.select\("([^"]*)"\)/g)) assert.ok(!m[1].includes('*'), 'no select * from browser: ' + m[1]);
  const conf = read('config.js');
  assert.ok(!/sb_secret_|service_role"?\s*:|SERVICE_ROLE/.test(conf.replace(/\/\*[\s\S]*?\*\//g, '')), 'config.js carries no server key');
  assert.ok(app.includes('if (sonuc.durum === 429)'), 'browser shows a rate-limit message for 429');

  console.log('PASS regression_edge_config_test (config.toml verify_jwt=false pinned + 7 mutants rejected; entrypoints/env; browser identity/key hygiene)');
}

try { main(); } catch (err) {
  console.error('FAIL regression_edge_config_test');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
