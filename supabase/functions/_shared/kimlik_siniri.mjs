// SosyoLab server-side Auth sınırı: kullanıcı adı ile giriş ve davetli kayıt.
//
// Neden server-side: Supabase Auth parola girişi yalnız email kabul eder ve
// email confirmation kapalıyken signUp/otp gibi uç noktalar kayıtlı bir email
// için farklı yanıt verir. Tarayıcı iç login kimliğini (u.<UUIDv4>@...) hiç
// öğrenmezse bu uç noktalara soracağı bir kimlik de olmaz. Bu modül:
//   * kullanıcı adını server-side çözer (service_role RPC) ve Auth'a parola
//     doğrulamasını burada yaptırır; tarayıcıya yalnız oturum döner,
//   * Auth kullanıcısını yalnız geçerli davet ön kontrolünden sonra Admin API
//     ile oluşturur, profil/davet tüketimini tek DB transaction'ında bitirir ve
//     başarısızlıkta sonucu DB'de kesinleştirip Auth kullanıcısını geri siler,
//   * her isteği, hesap durumuna bakmadan önce istemci IP'si (ve girişte
//     kullanıcı adı) boyutlarında atomik DB hız sınırından geçirir; Auth'a
//     giden parola isteğine gerçek istemci IP'sini `Sb-Forwarded-For` ile
//     iletir (secret key gerekir), böylece Auth limiti fonksiyon IP'sinde
//     birleşmez.
// Başarısız giriş/kayıt yanıtları (status, gövde, başlıklar) hesap varlığından
// bağımsızdır ve sabit bir süre tabanına kadar bekletilir.
//
// Çalışma ortamından bağımsızdır (Deno Edge + Node testleri). Hiçbir secret
// içermez; anahtarlar yalnız ortam değişkeninden gelir ve yanıta yazılmaz.

export const KANONIK_KIMLIK = /^u\.[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}@auth\.sosyolab\.local$/;
const KULLANICI_ADI = /^[a-z0-9._]{4,24}$/;
const REZERVE = new Set(["admin", "administrator", "root", "system", "supabase", "sosyolab", "sosyolog35", "sosyolog.35"]);
const ADMIN_TAKMA_ADLARI = new Set(["sosyolog35", "sosyolog.35"]);
const MAKS_GOVDE = 4096;
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
// Güvenilir IP belirlenemeyen tüm istekler TEK ortak kovaya düşer: sınır
// kalkmaz (fail-open değil), yalnız bu istekler birbirini kısıtlar.
export const BILINMEYEN_IP = "bilinmeyen";

const GECERSIZ_ISTEK = { ok: false, hata: "gecersiz_istek" };
const GIRIS_BASARISIZ = { ok: false, hata: "giris_basarisiz" };
const KAYIT_BASARISIZ = { ok: false, hata: "kayit_basarisiz" };
const COK_FAZLA_ISTEK = { ok: false, hata: "cok_fazla_istek" };
const GECICI_HATA = { ok: false, hata: "gecici_hata" };

// Varsayılan limitler: kampüs NAT'ı arkasındaki bir sınıfın aynı anda giriş
// yapabilmesi (IP kovası geniş) ile tek hesaba parola denemesini sınırlamak
// (IP+ad ve ad kovaları dar) arasında denge. Ortam değişkeniyle ayarlanır.
export const VARSAYILAN_LIMITLER = Object.freeze({
  girisIpAd: Object.freeze({ limit: 10, pencere: 900 }),
  girisIp: Object.freeze({ limit: 200, pencere: 900 }),
  girisAd: Object.freeze({ limit: 50, pencere: 3600 }),
  kayitIp: Object.freeze({ limit: 60, pencere: 3600 })
});

// SQL public.normalize_username ile aynı: baş/son/iç boşluk silinir, küçültülür.
export function kanonikKullaniciAdi(v) {
  return String(v).trim().replace(/\s+/g, "").toLowerCase();
}

export function yeniKayitKimligi(randomUUID) {
  const e = "u." + String(randomUUID()).replace(/-/g, "").toLowerCase() + "@auth.sosyolab.local";
  if (!KANONIK_KIMLIK.test(e)) throw new Error("kimlik_uretilemedi");
  return e;
}

// IP sözdizimini doğrular. `adres` Auth'a iletilecek değerdir; `kova` hız
// sınırı anahtarıdır: IPv4 tam adres, IPv6 /64 önek (tek abonelikteki adres
// rotasyonu limiti aşamaz), IPv4-mapped IPv6 ise IPv4 olarak ele alınır.
export function ipCoz(ham) {
  const s = String(ham == null ? "" : ham).trim().toLowerCase();
  if (IPV4.test(s)) return { adres: s, kova: s };
  if (s.length < 2 || s.length > 45 || !s.includes(":") || !/^[0-9a-f:.]+$/.test(s)) return null;
  let govde = s;
  let v4son = null;
  const m = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    if (!IPV4.test(m[2])) return null;
    v4son = m[2];
    govde = m[1] + "0:0";
  }
  const parcalar = govde.split("::");
  if (parcalar.length > 2) return null;
  const bol = (p) => (p === "" ? [] : p.split(":"));
  const bas = bol(parcalar[0]);
  const son = parcalar.length === 2 ? bol(parcalar[1]) : [];
  const eksik = 8 - bas.length - son.length;
  if (parcalar.length === 1 ? eksik !== 0 : eksik < 1) return null;
  const gruplar = [...bas, ...Array(parcalar.length === 2 ? eksik : 0).fill("0"), ...son];
  if (gruplar.length !== 8 || gruplar.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const h = gruplar.map((g) => g.padStart(4, "0"));
  if (v4son && h.slice(0, 5).every((g) => g === "0000") && h[5] === "ffff") return { adres: v4son, kova: v4son };
  if (v4son) return null;
  return { adres: s, kova: h.slice(0, 4).join(":") + "::/64" };
}

function limitOku(deger, varsayilan) {
  const m = /^\s*(\d{1,6})\s*\/\s*(\d{1,5})\s*$/.exec(deger || "");
  if (!m) return varsayilan;
  const limit = Number(m[1]);
  const pencere = Number(m[2]);
  return limit >= 1 && limit <= 100000 && pencere >= 1 && pencere <= 86400 ? { limit, pencere } : varsayilan;
}

export function configFromEnv(env) {
  const sayi = (k, d) => {
    const n = Number.parseInt(env(k) || "", 10);
    return Number.isFinite(n) && n >= 0 ? n : d;
  };
  const L = VARSAYILAN_LIMITLER;
  return {
    allowedOrigins: (env("ALLOWED_ORIGINS") || "").split(",").map((s) => s.trim()).filter(Boolean),
    adminEmail: (env("ADMIN_LOGIN_EMAIL") || "").trim().toLowerCase() || null,
    loginFloorMs: sayi("LOGIN_FLOOR_MS", 1000),
    registerFloorMs: sayi("REGISTER_FLOOR_MS", 2500),
    // Gateway'in istemci IP'sini yazdığı başlık. Canlı doğrulamada (LIVE-
    // VALIDATION) sahte değerle ezilemediği kanıtlanmadan değiştirilmez.
    clientIpHeader: (env("CLIENT_IP_HEADER") || "x-forwarded-for").trim().toLowerCase(),
    rateLimits: {
      girisIpAd: limitOku(env("RL_GIRIS_IP_AD"), L.girisIpAd),
      girisIp: limitOku(env("RL_GIRIS_IP"), L.girisIp),
      girisAd: limitOku(env("RL_GIRIS_AD"), L.girisAd),
      kayitIp: limitOku(env("RL_KAYIT_IP"), L.kayitIp)
    }
  };
}

export function createAuthBoundary(deps, config) {
  const cfg = Object.assign({ allowedOrigins: [], adminEmail: null, loginFloorMs: 1000, registerFloorMs: 2500, clientIpHeader: "x-forwarded-for" }, config);
  cfg.rateLimits = Object.assign({}, VARSAYILAN_LIMITLER, config && config.rateLimits);
  const randomUUID = deps.randomUUID || (() => globalThis.crypto.randomUUID());
  const now = deps.now || (() => Date.now());
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const log = deps.log || ((olay, ayrinti) => console.error(JSON.stringify({ olay, ayrinti: ayrinti == null ? null : String(ayrinti) })));
  for (const k of ["rpc", "passwordGrant", "adminCreateUser", "adminDeleteUser"]) {
    if (typeof deps[k] !== "function") throw new Error("kimlik_siniri_yapilandirma_eksik:" + k);
  }

  function cors(origin) {
    if (!origin) return {};
    return {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
      "access-control-max-age": "600",
      "vary": "Origin"
    };
  }

  function json(status, body, origin) {
    return new Response(JSON.stringify(body), {
      status,
      headers: Object.assign({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, cors(origin))
    });
  }

  // Yalnız istek biçimine bağlı erken yanıtlar (hesap durumuna bakılmadan).
  function kapi(req) {
    const origin = req.headers.get("origin");
    if (origin && !cfg.allowedOrigins.includes(origin)) return { yanit: new Response(null, { status: 403 }) };
    if (req.method === "OPTIONS") return { yanit: new Response(null, { status: 204, headers: cors(origin) }) };
    if (req.method !== "POST") return { yanit: json(405, GECERSIZ_ISTEK, origin) };
    return { origin };
  }

  async function govdeOku(req) {
    const text = await req.text();
    if (text.length > MAKS_GOVDE) return null;
    try {
      const o = JSON.parse(text);
      return o && typeof o === "object" && !Array.isArray(o) ? o : null;
    } catch (e) {
      return null;
    }
  }

  // Yalnız yapılandırılmış güvenilir başlık okunur; ilk değer alınır. Başka
  // başlıklar (istemcinin eklediği x-real-ip vb.) hiç okunmaz. Geçersiz/eksik
  // değer -> ortak BILINMEYEN_IP kovası.
  function istemciIp(req) {
    const ham = req.headers.get(cfg.clientIpHeader);
    return (ham && ipCoz(ham.split(",")[0])) || null;
  }

  // true: devam; false: 429; null: limiter çalışmadı -> 503 (fail-closed).
  // Sıra önemlidir: DB ilk aşılan kovada durur, sonrakileri artırmaz.
  async function sinirla(kovalar) {
    const r = await deps.rpc("istek_siniri_tuket", {
      p_kovalar: kovalar.map(([anahtar, l]) => ({ anahtar, limit: l.limit, pencere: l.pencere }))
    });
    if (r.error || typeof r.data !== "boolean") {
      log("istek_siniri_hatasi", r.error && r.error.status);
      return null;
    }
    return r.data;
  }

  // Taban süre: var olan/olmayan hesap yollarının süre farkını örter.
  async function bekle(baslangic, taban, olay) {
    const kalan = baslangic + taban - now();
    if (kalan > 0) await sleep(kalan);
    else log(olay, -kalan);
  }

  async function girisIsle(req) {
    const b = await govdeOku(req);
    if (!b || typeof b.kullanici_adi !== "string" || typeof b.parola !== "string"
        || b.kullanici_adi.length > 64 || b.parola.length < 1 || b.parola.length > 128) {
      return [400, GECERSIZ_ISTEK];
    }
    const ad = kanonikKullaniciAdi(b.kullanici_adi);
    const ip = istemciIp(req);
    const kova = ip ? ip.kova : BILINMEYEN_IP;
    // Hız sınırı hesap durumuna bakılmadan, yalnız (IP, kullanıcı adı) ile
    // karar verir: var olan ve olmayan ad aynı sayaç davranışını görür.
    const izin = await sinirla([
      ["giris|ip_ad|" + kova + "|" + ad, cfg.rateLimits.girisIpAd],
      ["giris|ip|" + kova, cfg.rateLimits.girisIp],
      ["giris|ad|" + ad, cfg.rateLimits.girisAd]
    ]);
    if (izin === null) return [503, GECICI_HATA];
    if (!izin) return [429, COK_FAZLA_ISTEK];
    // Çözümleme her istekte çalışır; olmayan kullanıcı adı da canonical,
    // hiçbir hesaba ait olmayan bir kimlik döner ve Auth çağrısı aynen yapılır.
    const r = await deps.rpc("kullanici_email_bul", { p_username: ad });
    let email;
    if (ADMIN_TAKMA_ADLARI.has(ad) && cfg.adminEmail) {
      email = cfg.adminEmail;
    } else if (!r.error && typeof r.data === "string" && KANONIK_KIMLIK.test(r.data)) {
      email = r.data;
    } else {
      log("giris_cozumleme_hatasi", r.error && r.error.status);
      email = yeniKayitKimligi(randomUUID);
    }
    const t = await deps.passwordGrant({ email, password: b.parola, istemciIp: ip ? ip.adres : null });
    const o = t && t.body;
    if (t && t.status === 200 && o && typeof o.access_token === "string" && typeof o.refresh_token === "string") {
      return [200, {
        ok: true,
        oturum: {
          access_token: o.access_token,
          refresh_token: o.refresh_token,
          expires_in: o.expires_in,
          expires_at: o.expires_at,
          token_type: o.token_type
        }
      }];
    }
    // Auth'un hata kodu (invalid_credentials, rate limit, banned...) dışarı
    // yansımaz; yalnız operatör logu.
    log("giris_reddedildi", t && t.status);
    return [401, GIRIS_BASARISIZ];
  }

  async function kayitIsle(req) {
    const b = await govdeOku(req);
    if (!b || typeof b.kullanici_adi !== "string" || typeof b.parola !== "string"
        || typeof b.davet_kodu !== "string" || (b.ad_soyad != null && typeof b.ad_soyad !== "string")) {
      return [400, GECERSIZ_ISTEK];
    }
    const ad = kanonikKullaniciAdi(b.kullanici_adi);
    const kod = b.davet_kodu.trim();
    const adSoyad = (b.ad_soyad || "").trim() || null;
    // Yalnız girdinin kendisine bağlı biçim kuralları (istemcide de uygulanır).
    if (!KULLANICI_ADI.test(ad) || REZERVE.has(ad) || b.parola.length < 8 || b.parola.length > 72
        || !kod || kod.length > 64 || (adSoyad && adSoyad.length > 80)) {
      return [400, GECERSIZ_ISTEK];
    }

    // 0) Hız sınırı: DB'deki davet/ad kontrolünden ve Auth'tan önce.
    const ip = istemciIp(req);
    const izin = await sinirla([["kayit|ip|" + (ip ? ip.kova : BILINMEYEN_IP), cfg.rateLimits.kayitIp]]);
    if (izin === null) return [503, GECICI_HATA];
    if (!izin) return [429, COK_FAZLA_ISTEK];

    // 1) Ön kontrol: geçersiz/dolmuş/tükenmiş kod veya alınmış ad -> Auth
    //    kullanıcısı hiç oluşturulmaz. Kod geçersizken ad durumu sonucu değiştirmez.
    const on = await deps.rpc("kayit_on_kontrol", { p_username: ad, p_sifreli_davet_kodu: kod, p_display_name: adSoyad });
    if (on.error || on.data !== true) return [422, KAYIT_BASARISIZ];

    // 2) Auth kullanıcısı: rastgele canonical kimlik, yalnız server-side.
    const u = await deps.adminCreateUser({ email: yeniKayitKimligi(randomUUID), password: b.parola });
    if (!u || u.error || typeof u.id !== "string") {
      log("kayit_auth_olusturulamadi", u && u.error && (u.error.code || u.error.status));
      return [422, KAYIT_BASARISIZ];
    }

    // 3) Profil + davet tüketimi tek transaction.
    const t = await deps.rpc("kullanici_kaydi_tamamla", {
      p_user_id: u.id, p_username: ad, p_sifreli_davet_kodu: kod, p_display_name: adSoyad
    });
    if (!t.error && t.data && t.data.ok === true) {
      return [200, { ok: true, audience_type: t.data.audience_type, teacher_status: t.data.teacher_status || null }];
    }

    // 4) Sonucu DB'de kesinleştir. Fonksiyon tamamla ile aynı advisory lock'u
    //    alır: süren bir tamamla bitene kadar bekler. Profil varsa kayıt
    //    tamamdır (yanıt kaybolmuş). Yoksa iptal damgası bırakır; bundan sonra
    //    tamamla bu kullanıcı için hiçbir zaman commit edemez -> silmek güvenli.
    const d = await deps.rpc("kayit_sonucunu_kesinlestir", { p_user_id: u.id });
    const durum = !d.error && d.data && d.data.durum;
    if (durum === "tamam") {
      const ts = d.data.teacher_status || null;
      return [200, { ok: true, audience_type: ts ? "teacher" : "student", teacher_status: ts }];
    }
    if (durum !== "iptal") {
      // Durum bilinmiyor: tamamlanmış bir kaydı silmemek için Auth kullanıcısı
      // korunur. Profilsizse erişimi yoktur, kimliği hiç dönmedi; temizlik
      // sorgusu (DEPLOYMENT-SECURITY) siler.
      log("kayit_durumu_belirsiz", u.id);
      return [422, KAYIT_BASARISIZ];
    }

    // 5) Telafi: profilsiz Auth kullanıcısı bırakılmaz.
    const s = await deps.adminDeleteUser(u.id);
    if (s && s.error) log("kayit_telafi_basarisiz", u.id);
    return [422, KAYIT_BASARISIZ];
  }

  async function sarmala(req, isle, taban, basarisiz, olay) {
    const k = kapi(req);
    if (k.yanit) return k.yanit;
    const baslangic = now();
    let sonuc;
    try {
      sonuc = await isle(req);
    } catch (e) {
      log(olay + "_istisna", e && e.name);
      sonuc = basarisiz;
    }
    await bekle(baslangic, taban, olay + "_taban_asildi");
    return json(sonuc[0], sonuc[1], k.origin);
  }

  return {
    handleLogin: (req) => sarmala(req, girisIsle, cfg.loginFloorMs, [401, GIRIS_BASARISIZ], "giris"),
    handleRegister: (req) => sarmala(req, kayitIsle, cfg.registerFloorMs, [422, KAYIT_BASARISIZ], "kayit")
  };
}

// Supabase REST/Auth adaptörü (Edge Function). Anahtarlar yalnız bu sunucu
// tarafı isteklerde kullanılır.
//
// Auth IP yönlendirme sözleşmesi (Supabase "Rate limits" belgesi): parola
// isteğine `Sb-Forwarded-For` yalnız SECRET API key (`sb_secret_...`) ile
// eklenir; publishable ve legacy anon/service_role anahtarlarla desteklenmez
// ve projede Authentication > Rate Limits > IP Address Forwarding açık
// olmalıdır. ipForwarding="required" iken secret key yoksa adaptör kurulmaz
// (fail-closed); "disabled" yalnız bilinçli operatör kararıdır ve Auth
// limitini fonksiyon IP'sinde birleştirir (residual).
export function supabaseDeps({ url, anonKey, serviceKey, secretKey, ipForwarding, fetchImpl }) {
  if (!/^https?:\/\/\S+$/.test(url || "") || typeof fetchImpl !== "function") {
    throw new Error("kimlik_siniri_ortam_degiskenleri_eksik");
  }
  if (ipForwarding !== "required" && ipForwarding !== "disabled") {
    throw new Error("kimlik_siniri_ip_yonlendirme_modu_gecersiz");
  }
  const secret = /^sb_secret_\S+$/.test(secretKey || "") ? secretKey : null;
  if (ipForwarding === "required" && !secret) {
    throw new Error("kimlik_siniri_ip_yonlendirme_secret_key_eksik");
  }
  const sunucuAnahtari = secret || serviceKey;
  if (!sunucuAnahtari || (ipForwarding === "disabled" && !anonKey)) {
    throw new Error("kimlik_siniri_ortam_degiskenleri_eksik");
  }
  const base = url.replace(/\/+$/, "");
  const anahtar = (key) => {
    const h = { apikey: key };
    if (/^eyJ/.test(key)) h.authorization = "Bearer " + key;
    return h;
  };
  async function cagir(yol, init) {
    const r = await fetchImpl(base + yol, init);
    const text = await r.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
    return { status: r.status, body };
  }
  const servis = (method, body) => ({
    method,
    headers: Object.assign({ "content-type": "application/json" }, anahtar(sunucuAnahtari)),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const ok = (s) => s >= 200 && s < 300;
  return {
    async rpc(name, args) {
      try {
        const r = await cagir("/rest/v1/rpc/" + encodeURIComponent(name), servis("POST", args));
        return ok(r.status) ? { data: r.body } : { error: { status: r.status } };
      } catch (e) {
        return { error: { status: 0 } };
      }
    },
    async passwordGrant({ email, password, istemciIp }) {
      const headers = { "content-type": "application/json" };
      if (ipForwarding === "required") {
        Object.assign(headers, anahtar(secret));
        const ip = istemciIp && ipCoz(istemciIp);
        if (ip) headers["sb-forwarded-for"] = ip.adres;
      } else {
        Object.assign(headers, anahtar(anonKey));
      }
      try {
        return await cagir("/auth/v1/token?grant_type=password", {
          method: "POST",
          headers,
          body: JSON.stringify({ email, password })
        });
      } catch (e) {
        return { status: 0, body: null };
      }
    },
    async adminCreateUser({ email, password }) {
      try {
        const r = await cagir("/auth/v1/admin/users", servis("POST", { email, password, email_confirm: true }));
        if (ok(r.status) && r.body && typeof r.body.id === "string") return { id: r.body.id };
        return { error: { status: r.status, code: r.body && (r.body.error_code || r.body.code) } };
      } catch (e) {
        return { error: { status: 0 } };
      }
    },
    async adminDeleteUser(id) {
      try {
        const r = await cagir("/auth/v1/admin/users/" + encodeURIComponent(id), servis("DELETE"));
        return ok(r.status) ? {} : { error: { status: r.status } };
      } catch (e) {
        return { error: { status: 0 } };
      }
    }
  };
}

// Hosted Edge ortamı: SUPABASE_SECRET_KEYS JSON sözlüğüdür ({"default": ...}).
export function secretKeyFromEnv(env) {
  try {
    const o = JSON.parse(env("SUPABASE_SECRET_KEYS") || "{}");
    const k = o && typeof o === "object" ? o[(env("AUTH_SECRET_KEY_NAME") || "default").trim()] : null;
    return typeof k === "string" ? k : "";
  } catch (e) {
    return "";
  }
}

export function supabaseDepsFromEnv(env, fetchImpl) {
  return supabaseDeps({
    url: env("SUPABASE_URL"),
    anonKey: env("SUPABASE_ANON_KEY"),
    serviceKey: env("SUPABASE_SERVICE_ROLE_KEY"),
    secretKey: secretKeyFromEnv(env),
    ipForwarding: (env("AUTH_IP_FORWARDING") || "required").trim().toLowerCase(),
    fetchImpl
  });
}
