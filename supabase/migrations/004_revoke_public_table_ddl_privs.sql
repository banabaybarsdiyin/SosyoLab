-- ============================================================================
-- SosyoLab — 004: public tablolarında kalıntı DDL ayrıcalıklarını daralt
-- ============================================================================
-- Amaç:
--   public.denetim_kaydi ve public.davet_dogrulamalari üzerinde
--   anon/authenticated rollerinde kalan TRUNCATE/REFERENCES/TRIGGER
--   ayrıcalıklarını kaldırmak.
--
-- Not (tekrar çalıştırma güvenliği): PostgreSQL REVOKE, ayrıcalık zaten yoksa
-- hata vermez; bu dosya aynı ortamda tekrar çalıştırıldığında no-op davranır.
--
-- Rollback (yalnızca gerektiğinde, elle):
--   grant truncate, references, trigger
--     on table public.denetim_kaydi, public.davet_dogrulamalari
--     to anon, authenticated;
-- ============================================================================

begin;

revoke truncate, references, trigger
  on table public.denetim_kaydi, public.davet_dogrulamalari
  from anon, authenticated;

commit;
