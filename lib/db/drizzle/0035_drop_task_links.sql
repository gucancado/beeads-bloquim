-- Discards task_links — the directed vínculo is provided by `card_connections`
-- on the canvas (source_card_id → target_card_id). The attachment-inheritance
-- listing now reads dynamically from card_connections + task_attachments,
-- gated by the source task's `status = 'completed'`. See updated section in
-- docs/specs/task-linking-and-attachment-inheritance.md.
--
-- task_attachments stays (still tracks native uploads + manual promotions).
-- The five new enum values on task_activity_type stay too — they're still
-- emitted by the attachment promote/demote/unlink flows, only the
-- link_created / link_removed pair becomes orphan (kept to keep migrations
-- forward-only; removing them from an enum requires recreating the type).

DROP TABLE IF EXISTS "task_links" CASCADE;
