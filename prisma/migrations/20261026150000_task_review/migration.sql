BEGIN;

-- Members mark their own task done as PENDING_REVIEW; a committee leader then confirms it as COMPLETED.
-- Only widens the allowed values; no existing task changes.
ALTER TABLE "committee_task" DROP CONSTRAINT "committee_task_status_check";
ALTER TABLE "committee_task" ADD CONSTRAINT "committee_task_status_check"
    CHECK ("status" IN ('TODO', 'IN_PROGRESS', 'PENDING_REVIEW', 'COMPLETED'));

COMMIT;
