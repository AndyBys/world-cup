-- ===========================================================================
-- HOTFIX: "function gen_salt(unknown) does not exist" when claiming a PIN.
-- Run this WHOLE file in the Supabase SQL editor (Dashboard → SQL → New query).
--
-- Cause: Supabase installs pgcrypto (crypt/gen_salt) in the `extensions` schema,
-- but claim_player/verify_pin were created with `search_path = public`, so those
-- functions weren't visible. Adding `extensions` to the search path fixes it
-- without redefining the function bodies.
-- ===========================================================================

alter function public.verify_pin(text, text)   set search_path = public, extensions;
alter function public.claim_player(text, text) set search_path = public, extensions;

-- Sanity check: this should return a uuid (and set the PIN), not error.
-- select public.claim_player('test-pin-user', '1234');
