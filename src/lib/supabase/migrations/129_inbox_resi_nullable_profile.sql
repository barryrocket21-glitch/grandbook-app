-- =============================================================
-- Migration 129 — inbox_unmatched_resi.source_profile_id nullable
-- =============================================================
-- apply_payout_recon (Brief #17) masukin no-match resi dari file pencairan SPX
-- ke inbox. Payout SPX BUKAN converter profile → source_profile_id NULL. Kolom
-- NOT NULL bikin apply gagal ("null value violates not-null constraint").
-- Fix: izinin NULL (source non-converter). Idempotent.
-- =============================================================
ALTER TABLE public.inbox_unmatched_resi ALTER COLUMN source_profile_id DROP NOT NULL;
