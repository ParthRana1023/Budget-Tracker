-- Clean-up (2026-11-22): undo_recurring_post was replaced by deleting the entry directly
-- (the app's Undo); nothing calls it any more.
drop function if exists public.undo_recurring_post(uuid);
