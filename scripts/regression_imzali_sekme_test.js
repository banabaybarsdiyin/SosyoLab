#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const appPath = path.join(__dirname, '..', 'app.js');
const appSrc = fs.readFileSync(appPath, 'utf8');

function extractFunctionSource(src, signature) {
  const start = src.indexOf(signature);
  if (start < 0) throw new Error('Function signature not found: ' + signature);

  let i = src.indexOf('{', start);
  if (i < 0) throw new Error('Opening brace not found for: ' + signature);

  let depth = 0;
  let quote = null;
  let esc = false;
  let lineComment = false;
  let blockComment = false;

  for (; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];

    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }

    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i++;
      }
      continue;
    }

    if (quote) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === '\\') {
        esc = true;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      lineComment = true;
      i++;
      continue;
    }

    if (ch === '/' && next === '*') {
      blockComment = true;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }

    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return src.slice(start, i + 1);
      }
    }
  }

  throw new Error('Unclosed function body for: ' + signature);
}

function makeTab(options) {
  const opts = options || {};
  const state = { replaced: null, href: null, closed: false, opener: {} };
  const tab = {
    opener: state.opener,
    location: {
      replace(url) {
        if (opts.throwOnReplace) throw new Error('replace failed');
        state.replaced = url;
      },
      set href(url) {
        state.href = url;
      },
      get href() {
        return state.href;
      }
    },
    close() {
      state.closed = true;
    },
    __state: state
  };
  return tab;
}

async function runCase(imzaliFnSource, cfg) {
  const messages = [];
  let openCount = 0;

  const context = {
    window: {
      open() {
        openCount++;
        return cfg.openReturn;
      }
    },
    bildir(msg) {
      messages.push(msg);
      return msg;
    },
    imzaliBaglanti: async function () {
      return cfg.imzaliSonuc;
    }
  };

  vm.createContext(context);
  vm.runInContext(imzaliFnSource + '\nthis.__testFn = imzaliAdreseGit;', context);
  await context.__testFn('dummy/path.pdf', cfg.hataMesaji);

  return { messages, openCount };
}

async function main() {
  const imzaliFnSource = extractFunctionSource(appSrc, 'async function imzaliAdreseGit');

  const openCalls = (imzaliFnSource.match(/window\.open\s*\(/g) || []).length;
  assert.strictEqual(openCalls, 1, 'imzaliAdreseGit içinde ikinci window.open olmamalı');

  assert.ok(
    appSrc.includes('return imzaliAdreseGit(g.file_path, "Önizleme bağlantısı alınamadı.");'),
    'onizle akışı imzaliAdreseGit helperını kullanmalı'
  );
  assert.ok(
    appSrc.includes('await imzaliAdreseGit(m.depoYolu, "Dosya bağlantısı alınamadı. Yetkin olmayabilir.");'),
    'materyalDosyasiniAc akışı imzaliAdreseGit helperını kullanmalı'
  );

  {
    const tab = makeTab();
    const r = await runCase(imzaliFnSource, {
      openReturn: tab,
      imzaliSonuc: { url: 'https://example.com/signed-ok' },
      hataMesaji: 'Dosya bağlantısı alınamadı. Yetkin olmayabilir.'
    });
    assert.strictEqual(r.openCount, 1, 'tek kullanıcı tıklaması tek sekme açmalı');
    assert.strictEqual(tab.opener, null, 'sekme opener bağı koparılmalı');
    assert.strictEqual(tab.__state.replaced, 'https://example.com/signed-ok', 'başarılı imzalı URL aynı sekmeye yüklenmeli');
    assert.strictEqual(tab.__state.closed, false, 'başarılı akışta sekme kapanmamalı');
    assert.deepStrictEqual(r.messages, [], 'başarılı akışta hata mesajı olmamalı');
  }

  {
    const tab = makeTab();
    const r = await runCase(imzaliFnSource, {
      openReturn: tab,
      imzaliSonuc: { url: '', hataKodu: '42501', hataMesaji: 'permission denied' },
      hataMesaji: 'Dosya bağlantısı alınamadı. Yetkin olmayabilir.'
    });
    assert.strictEqual(r.openCount, 1, 'imzalı URL başarısız olsa da ikinci sekme açılmamalı');
    assert.strictEqual(tab.__state.closed, true, 'imzalı URL başarısızsa boş sekme kapanmalı');
    assert.deepStrictEqual(r.messages, ['Dosya bağlantısı alınamadı. Yetkin olmayabilir.'], 'beklenen kullanıcı mesajı gösterilmeli');
  }

  {
    const r = await runCase(imzaliFnSource, {
      openReturn: null,
      imzaliSonuc: { url: 'https://example.com/signed-ok' },
      hataMesaji: 'Dosya bağlantısı alınamadı. Yetkin olmayabilir.'
    });
    assert.strictEqual(r.openCount, 1, 'popup blocked senaryosunda ikinci window.open çağrısı olmamalı');
    assert.deepStrictEqual(r.messages, ['Tarayıcı yeni sekmeyi engelledi. Açılır pencerelere izin ver.'], 'popup blocked için anlaşılır mesaj gösterilmeli');
  }

  {
    const tab = makeTab({ throwOnReplace: true });
    const r = await runCase(imzaliFnSource, {
      openReturn: tab,
      imzaliSonuc: { url: 'https://example.com/signed-fallback' },
      hataMesaji: 'Dosya bağlantısı alınamadı. Yetkin olmayabilir.'
    });
    assert.strictEqual(r.openCount, 1, 'replace fallback senaryosunda tek sekme kullanılmalı');
    assert.strictEqual(tab.__state.href, 'https://example.com/signed-fallback', 'replace hata verirse href fallback çalışmalı');
    assert.deepStrictEqual(r.messages, [], 'fallback başarılıysa hata mesajı olmamalı');
  }

  console.log('PASS regression_imzali_sekme_test');
}

main().catch((err) => {
  console.error('FAIL regression_imzali_sekme_test');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
