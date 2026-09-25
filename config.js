/* ============================================================================
   SosyoLab — Supabase yapılandırması
   ============================================================================

   Buraya YALNIZCA herkese açık olabilecek iki değer yazılır:

     SUPABASE_URL       Project Settings → API → Project URL
     SUPABASE_ANON_KEY  Project Settings → API → anon / publishable key

   Bu iki değer tarayıcıya gönderilir ve herkes tarafından görülebilir.
   Zaten öyle tasarlanmışlardır: yetkilendirme anahtarla değil, veritabanındaki
   RLS politikalarıyla yapılır.

   BURAYA ASLA YAZILMAZ:
     - service_role anahtarı
     - veritabanı parolası
     - admin parolası
     - herhangi bir gizli anahtar

   Bu alanlar boş bırakılırsa uygulama "demo modu"nda çalışır: örnek
   materyaller gösterilir, gönderim ve onay akışı kapalıdır.
   ============================================================================ */

window.SOSYOLAB_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: ""
};
