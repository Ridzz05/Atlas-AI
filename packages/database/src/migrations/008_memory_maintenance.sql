-- ATLAS AI OS Memory Maintenance Migration
-- Migration: 008_memory_maintenance.sql

CREATE INDEX IF NOT EXISTS idx_memory_items_expiry_lifecycle
    ON memory_items (expires_at, status, updated_at)
    WHERE expires_at IS NOT NULL;
