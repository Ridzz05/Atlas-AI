-- ATLAS AI OS Task Status Integrity Migration
-- Migration: 010_task_status_integrity.sql

-- Older workers could persist the run-only `timed_out` status on tasks. Normalize
-- those rows before enforcing the shared task lifecycle contract.
UPDATE tasks
SET status = 'failed',
    error = COALESCE(error, 'Execution timed out'),
    completed_at = COALESCE(completed_at, NOW()),
    updated_at = NOW()
WHERE status = 'timed_out';

ALTER TABLE tasks
    DROP CONSTRAINT IF EXISTS tasks_status_check;

ALTER TABLE tasks
    ADD CONSTRAINT tasks_status_check
    CHECK (status IN (
        'queued',
        'planning',
        'running',
        'review_pending',
        'approval_pending',
        'completed',
        'failed',
        'cancelled'
    ));
