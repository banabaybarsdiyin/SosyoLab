/* ============================================================================
   SosyoLab — Supabase yapılandırması
   ============================================================================

   BU DOSYA TARAYICIYA GÖNDERİLİR VE HERKES TARAFINDAN OKUNABİLİR.
   İçindeki hiçbir değeri "gizli" saymayın.

   ----------------------------------------------------------------------------
   SUPABASE_URL / SUPABASE_ANON_KEY
   ----------------------------------------------------------------------------
   Project Settings → API → Project URL ve anon / publishable key.
   Bu iki değerin herkese açık olması tasarım gereğidir: yetkilendirme
   anahtarla değil, veritabanındaki RLS politikalarıyla yapılır.

   BURAYA ASLA YAZILMAZ:
     - service_role anahtarı        - veritabanı parolası
     - admin parolası               - JWT secret
     - erişim / yenileme jetonu     - herhangi bir gizli anahtar

   Bu alanlar boş bırakılırsa uygulama "demo modu"nda çalışır: örnek
   materyaller gösterilir, gönderim ve onay akışı kapalıdır.

   ----------------------------------------------------------------------------
   INVITE_MODE — davet kodu doğrulaması
   ----------------------------------------------------------------------------
   "server"  ÜRETİMDE KULLANILACAK MOD.
             Davet kodu Supabase'e gönderilir; public.davet_kullan(p_kod)
             RPC'si kodu hash'lenmiş kayıtla karşılaştırır, süresini ve
             kullanım hakkını denetler, profiles.invite_verified damgasını
             basar. Geçerli kod hiçbir zaman istemci koduna girmez.

             ÖN KOŞUL: supabase/migrations/001_davet_kodlari.sql veritabanında
             çalıştırılmış olmalı ve en az bir davet kodu tanımlanmalıdır.
             Göç uygulanmadan bu mod açılırsa öğrenci girişi çalışmaz.

   "local"   GEÇİCİ MOD — varsayılan. Kod aşağıdaki LOCAL_INVITE_CODE ile
             tarayıcıda karşılaştırılır.

             BU BİR GÜVENLİK ÖNLEMİ DEĞİLDİR. Bu dosyaya bakan herkes kodu
             görür; dahası anonim giriş açık olduğu için kod hiç bilinmeden
             de oturum açılabilir. Yalnızca kazara girişi azaltır.
             Bölümün gerçek davet kodunu buraya YAZMAYIN.

   LOCAL_INVITE_CODE yalnızca "local" modda okunur; "server" modda tamamen
   göz ardı edilir ve bu satır silinmelidir.
   ============================================================================ */

window.SOSYOLAB_CONFIG = {
  SUPABASE_URL: "https://ulwgkfulxqfeicjftqeb.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_3XVOH1j-GFus3hIbzxI8Qg_aHiTPElA",

  INVITE_MODE: "server"
};
