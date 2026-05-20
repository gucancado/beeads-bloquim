-- Phase A.2 (companion to 0033): one-way trigger that keeps task_attachments
-- in sync whenever the legacy attachments.task_id/kind columns change.
--
-- Purpose: services that still write to the legacy columns (createTaskAttachment,
-- updateTaskAttachmentKind, etc.) don't need to be refactored to dual-write —
-- the trigger handles it.
--
-- Direction: attachments → task_attachments only. Changes that originate in
-- task_attachments (the new task-links service: promote, demote, inheritance
-- cascade) do NOT bubble back to attachments.kind. That's intentional — the
-- legacy kind reflects only the "primary" row of an attachment (the one the
-- user uploaded), and per-link kind divergence is the whole point of the new
-- model.
--
-- Lifecycle: this trigger is dropped together with the legacy columns in the
-- Phase B migration (drop task_id/kind from attachments).

CREATE OR REPLACE FUNCTION sync_task_attachments_from_legacy()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.task_id IS NOT NULL THEN
      INSERT INTO task_attachments (
        task_id, attachment_id, kind, inherited_from_task_id,
        created_by, created_at
      )
      VALUES (
        NEW.task_id,
        NEW.id,
        COALESCE(NEW.kind::text, 'standard')::task_attachment_kind,
        NULL,
        NEW.uploaded_by,
        NEW.created_at
      )
      ON CONFLICT (task_id, attachment_id) DO UPDATE
        SET kind = EXCLUDED.kind;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- We only react to kind changes on the "primary" row (where task_id is
    -- the legacy anchor). Changes to other columns (deleted_at, storage_path,
    -- etc.) are no-ops here. Note: task_id is treated as immutable in
    -- practice; we don't migrate join rows on task_id change.
    IF NEW.task_id IS NOT NULL
       AND NEW.kind IS DISTINCT FROM OLD.kind THEN
      UPDATE task_attachments
      SET kind = NEW.kind::text::task_attachment_kind
      WHERE attachment_id = NEW.id
        AND task_id = NEW.task_id
        AND inherited_from_task_id IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_attachments_sync_task_links ON attachments;

CREATE TRIGGER trg_attachments_sync_task_links
AFTER INSERT OR UPDATE ON attachments
FOR EACH ROW EXECUTE FUNCTION sync_task_attachments_from_legacy();
