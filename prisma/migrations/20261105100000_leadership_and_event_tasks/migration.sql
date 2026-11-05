BEGIN;

-- Tasks may be assigned across committee boundaries, but remain scoped so each
-- leadership tier can manage only the work it created.
ALTER TABLE "committee_task"
    DROP CONSTRAINT "committee_task_assignee_committee_fkey",
    DROP CONSTRAINT "committee_task_creator_committee_fkey",
    ADD COLUMN "task_scope" TEXT NOT NULL DEFAULT 'COMMITTEE',
    ADD COLUMN "event_id" INTEGER;

ALTER TABLE "committee_task"
    ADD CONSTRAINT "committee_task_assignee_member_fkey"
        FOREIGN KEY ("assigned_member_id") REFERENCES "member"("member_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    ADD CONSTRAINT "committee_task_creator_member_fkey"
        FOREIGN KEY ("created_by_member_id") REFERENCES "member"("member_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    ADD CONSTRAINT "committee_task_event_fkey"
        FOREIGN KEY ("event_id") REFERENCES "events"("event_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    ADD CONSTRAINT "committee_task_scope_check"
        CHECK ("task_scope" IN ('COMMITTEE', 'CLUB', 'DEVELOPER_COMMITTEES', 'EVENT')),
    ADD CONSTRAINT "committee_task_event_scope_check"
        CHECK (("task_scope" = 'EVENT') = ("event_id" IS NOT NULL));

CREATE INDEX "committee_task_event_status_due_idx" ON "committee_task"("event_id", "status", "due_at");
CREATE INDEX "committee_task_scope_status_due_idx" ON "committee_task"("task_scope", "status", "due_at");

INSERT INTO "permission" ("code", "description", "scope", "is_sensitive") VALUES
    ('club.tasks.manage', 'Assign and review tasks for committee leadership', 'global', true),
    ('developer_committees.tasks.manage', 'Assign and review tasks for developer committee leadership', 'global', true)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permission" ("role_code", "code") VALUES
    ('GROUP_LEADER', 'club.tasks.manage'),
    ('GROUP_CO_LEADER', 'club.tasks.manage'),
    ('DEVELOPER_COMMITTEES_LEADER', 'developer_committees.tasks.manage')
ON CONFLICT ("role_code", "code") DO NOTHING;

COMMIT;
