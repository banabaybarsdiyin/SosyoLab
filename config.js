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
         Kayıt sırasında davet kodu yalnızca Supabase'e gönderilir;
         public.kayit_icin_davet_kodu_kullan() /
         public.kullanici_kaydi_tamamla() akışı kodu hash'lenmiş kayıtla
         karşılaştırır, süresini/kullanım hakkını denetler ve kullanıcıyı
         student(1..4) veya teacher(pending) olarak sınıflandırır.

         ÖN KOŞUL: 001..006 göçleri veritabanında uygulanmış olmalı.

  "local"   GEÇİCİ/legacy mod. Davet damgası kontrolleri server moduna göre
         eksik kalabilir. Üretimde kullanılmamalıdır.
   ============================================================================ */

window.SOSYOLAB_CONFIG = {
  SUPABASE_URL: "https://ulwgkfulxqfeicjftqeb.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_3XVOH1j-GFus3hIbzxI8Qg_aHiTPElA",

  INVITE_MODE: "server"
};
