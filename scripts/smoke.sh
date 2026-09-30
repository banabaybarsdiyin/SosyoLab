#!/usr/bin/env bash
# ============================================================================
# SosyoLab — üretim salt-okuma smoke testi
# ----------------------------------------------------------------------------
# Bu betik ÜRETİME HİÇBİR ŞEY YAZMAZ:
#   - oturum açmaz, kullanıcı oluşturmaz
#   - davet kodu tüketmez (davet_kullan RPC'sini ÇAĞIRMAZ)
#   - hiçbir mutasyon isteği göndermez
#   - service_role ya da başka bir gizli anahtar kullanmaz
#
# Yalnızca genel (anon) anahtarla okuma sondajı ve HTTP GET yapar.
#
# Kullanım:
#   bash scripts/smoke.sh                 # canlıyı HEAD ile karşılaştırır
#   bash scripts/smoke.sh --ref origin/main
#   SITE=https://baska.ornek bash scripts/smoke.sh
#
# Çıkış kodu: 0 = tüm testler geçti, 1 = en az bir FAIL
# ============================================================================
set -uo pipefail

SITE="${SITE:-https://arsiv.sosyolab.tr}"
REF="HEAD"
[ "${1:-}" = "--ref" ] && REF="${2:?--ref bir git referansı bekler}"

UA="Mozilla/5.0 (compatible; SosyoLabSmoke/1.0)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

GECTI=0; KALDI=0; UYARI=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; GECTI=$((GECTI+1)); }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; KALDI=$((KALDI+1)); }
warn() { printf '  \033[33mUYARI\033[0m %s\n' "$1"; UYARI=$((UYARI+1)); }
baslik() { printf '\n\033[1m%s\033[0m\n' "$1"; }

VARLIKLAR="index.html config.js app.js styles.css 404.html 404.css
vendor/supabase-js-2.45.4.min.js
assets/fonts/inter-latin.subset.woff2
assets/fonts/inter-latin-ext.subset.woff2
assets/fonts/newsreader-latin.subset.woff2
assets/fonts/newsreader-latin-ext.subset.woff2"

# Yayınlanmaması gereken yollar
SIZINTI="/.env /.git/config /.git/HEAD /README.md /supabase/schema.sql
/supabase/migrations/001_davet_kodlari.sql
/supabase/migrations/003_launch_gate_hardening.sql /supabase/inventory.sql
/docs/DEPLOYMENT-SECURITY.md
/docs/LIVE-VALIDATION.md /.github/workflows/deploy.yml /app.js.map
/styles.css.map /backup.sql /dump.sql /config.js.bak /scripts/smoke.sh"

echo "SosyoLab smoke — $SITE  (referans: $REF)"

# ---------------------------------------------------------------------------
baslik "1. Varlık erişilebilirliği"
for f in $VARLIKLAR; do
  code=$(curl -sS -A "$UA" -o "$TMP/$(echo "$f" | tr / _)" -w '%{http_code}' "$SITE/$f" 2>/dev/null)
  [ "$code" = "200" ] && ok "$f → 200" || fail "$f → $code (200 bekleniyordu)"
done

# ---------------------------------------------------------------------------
baslik "2. Yayınlanmaması gereken yollar 404 mü"
for p in $SIZINTI; do
  code=$(curl -sS -A "$UA" -o /dev/null -w '%{http_code}' "$SITE$p" 2>/dev/null)
  [ "$code" = "404" ] && ok "$p → 404" || fail "$p → $code (ERİŞİLEBİLİR!)"
done

# ---------------------------------------------------------------------------
baslik "3. Canlı içerik $REF ile bayt bayt aynı mı"
if git rev-parse --git-dir >/dev/null 2>&1; then
  for f in $VARLIKLAR; do
    if git show "$REF:$f" > "$TMP/ref" 2>/dev/null; then
      a=$(sha256sum "$TMP/ref" | cut -d' ' -f1)
      b=$(sha256sum "$TMP/$(echo "$f" | tr / _)" | cut -d' ' -f1)
      [ "$a" = "$b" ] && ok "$f içerik eşleşiyor" || fail "$f FARKLI (bayat önbellek ya da eksik dağıtım?)"
    else
      warn "$f $REF içinde yok"
    fi
  done
else
  warn "git deposu değil, içerik karşılaştırması atlandı"
fi

# ---------------------------------------------------------------------------
baslik "4. config.js üretim değişmezleri"
CFG="$TMP/config.js"
grep -q 'INVITE_MODE: *"server"' "$CFG" && ok 'INVITE_MODE = "server"' || fail 'INVITE_MODE "server" değil'
grep -q 'LOCAL_INVITE_CODE *:' "$CFG" && fail 'LOCAL_INVITE_CODE hâlâ tanımlı' || ok 'LOCAL_INVITE_CODE tanımlı değil'
grep -qi 'DEMO2026' "$CFG" && fail 'DEMO2026 canlıda görünüyor' || ok 'DEMO2026 yok'
grep -q 'sb_publishable_' "$CFG" && ok 'anon anahtar sb_publishable_ biçiminde' || warn 'anon anahtar biçimi beklenenden farklı'

# ---------------------------------------------------------------------------
baslik "5. Canlı dosyalarda gizli anahtar taraması"
GIZLI='sb_secret_[A-Za-z0-9_-]{8,}'
GIZLI="$GIZLI"'|-----BEGIN [A-Z ]*PRIVATE KEY-----'
GIZLI="$GIZLI"'|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}'
GIZLI="$GIZLI"'|(service_role|SERVICE_ROLE|SUPABASE_SERVICE_ROLE_KEY|JWT_SECRET|DB_PASSWORD|ADMIN_PASSWORD)[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'<]'
bulgu=0
for f in "$TMP"/*; do
  [ -f "$f" ] || continue
  if grep -EqI "$GIZLI" "$f" 2>/dev/null; then fail "gizli anahtar deseni: $(basename "$f")"; bulgu=1; fi
done
[ "$bulgu" -eq 0 ] && ok "gizli anahtar deseni bulunmadı"
# auth.admin yalnızca vendor kütüphanesinde olabilir
grep -qI 'auth\.admin\.' "$TMP/app.js" && fail 'app.js içinde auth.admin.* çağrısı' || ok 'app.js auth.admin.* kullanmıyor'
grep -qI 'sourceMappingURL' "$TMP/app.js" && fail 'app.js source map yayınlıyor' || ok 'source map sızıntısı yok'

# ---------------------------------------------------------------------------
baslik "6. Satır içi betik / stil (katı CSP uyumu)"
GOVDE=$(perl -0777 -pe 's/<!--.*?-->//gs' "$TMP/index.html" 2>/dev/null || cat "$TMP/index.html")
printf '%s' "$GOVDE" | grep -qE '<style|[[:space:]]style=|[[:space:]]on[a-z]+=' \
  && fail 'index.html içinde satır içi stil/olay niteliği' || ok 'index.html satır içi stil/olay içermiyor'
printf '%s' "$GOVDE" | grep -qE '<script[^>]*>[^<[:space:]]' \
  && fail 'index.html içinde satır içi betik gövdesi' || ok 'index.html satır içi betik içermiyor'
grep -q 'Content-Security-Policy' "$TMP/index.html" && ok 'CSP <meta> etiketi mevcut' || fail 'CSP <meta> etiketi YOK'

# ---------------------------------------------------------------------------
baslik "7. Supabase RLS sınırı (anon salt okuma sondajı)"
URL=$(grep -oE 'https://[a-z0-9]+\.supabase\.co' "$CFG" | head -1)
KEY=$(grep -oE 'sb_publishable_[A-Za-z0-9_-]+' "$CFG" | head -1)
if [ -n "$URL" ] && [ -n "$KEY" ]; then
  for t in profiles materials davet_kodlari davet_dogrulamalari davet_denemeleri denetim_kaydi; do
    code=$(curl -sS -o /dev/null -w '%{http_code}' \
      -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
      "$URL/rest/v1/$t?select=*&limit=1" 2>/dev/null)
    case "$code" in
      401|403) ok  "$t → $code (anon erişemiyor)" ;;
      200)     fail "$t → 200 ANON OKUYABİLİYOR!" ;;
      *)       warn "$t → $code (beklenmeyen)" ;;
    esac
  done
else
  warn "Supabase URL/anahtar config.js'ten okunamadı, RLS sondajı atlandı"
fi

# ---------------------------------------------------------------------------
baslik "8. Taşıma güvenliği"
rcode=$(curl -sS -o /dev/null -w '%{http_code}' "$(echo "$SITE" | sed 's|https://|http://|')/" 2>/dev/null)
[ "$rcode" = "301" ] || [ "$rcode" = "308" ] && ok "HTTP → HTTPS yönlendirmesi ($rcode)" || warn "HTTP yönlendirmesi: $rcode"
curl -sS --tlsv1.2 --tls-max 1.2 -o /dev/null "$SITE/" 2>/dev/null && ok "TLS 1.2 çalışıyor" || fail "TLS 1.2 başarısız"
curl -sS --tlsv1.3 -o /dev/null "$SITE/" 2>/dev/null && ok "TLS 1.3 çalışıyor" || warn "TLS 1.3 doğrulanamadı"

baslik "9. Güvenlik başlıkları (GitHub Pages'te BEKLENEN EKSİK)"
H=$(curl -sSI -A "$UA" "$SITE/" 2>/dev/null)
for h in strict-transport-security content-security-policy x-content-type-options \
         referrer-policy permissions-policy x-frame-options; do
  printf '%s' "$H" | grep -qi "^$h:" && ok "$h mevcut" \
    || warn "$h YOK — kenar katmanı (Cloudflare) gerekiyor, bkz. docs/DEPLOYMENT-SECURITY.md EK A"
done

# ---------------------------------------------------------------------------
baslik "SONUÇ"
printf '  geçti: %s   kaldı: %s   uyarı: %s\n' "$GECTI" "$KALDI" "$UYARI"
[ "$KALDI" -eq 0 ] && { echo "  SMOKE OK"; exit 0; } || { echo "  SMOKE BAŞARISIZ"; exit 1; }
