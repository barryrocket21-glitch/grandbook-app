-- Migration 001: Add resi tracking fields to orders
-- Run this in Supabase SQL Editor

ALTER TABLE orders ADD COLUMN IF NOT EXISTS resi TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ekspedisi TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS resi_status TEXT
  CHECK (resi_status IN ('AKTIF', 'DITERIMA', 'PROBLEM', 'RETUR'));

-- Index for resi lookup
CREATE INDEX IF NOT EXISTS idx_orders_resi ON orders(resi) WHERE resi IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_ekspedisi ON orders(ekspedisi) WHERE ekspedisi IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_resi_status ON orders(resi_status) WHERE resi_status IS NOT NULL;
