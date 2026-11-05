BEGIN;

-- Missed confirmation deadlines still release a seat and promote the waitlist,
-- but they are no longer attendance blacklist incidents. Remove legacy entries
-- before narrowing the database enum to the two approved incident reasons.
DELETE FROM "registration_blacklist_entries"
WHERE "reason" = 'CONFIRMATION_EXPIRED';

ALTER TYPE "BlacklistReason" RENAME TO "BlacklistReason_old";
CREATE TYPE "BlacklistReason" AS ENUM ('LATE_CANCELLATION', 'NO_CHECK_IN');

ALTER TABLE "registration_blacklist_entries"
  ALTER COLUMN "reason" TYPE "BlacklistReason"
  USING ("reason"::text::"BlacklistReason");

DROP TYPE "BlacklistReason_old";

COMMIT;
