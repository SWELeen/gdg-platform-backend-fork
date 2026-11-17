-- Preserve shared content and point awards when a member is permanently removed.
ALTER TABLE "events"
  ALTER COLUMN "created_by_member_id" DROP NOT NULL,
  DROP CONSTRAINT "events_created_by_member_id_fkey",
  ADD CONSTRAINT "events_created_by_member_id_fkey"
    FOREIGN KEY ("created_by_member_id") REFERENCES "member"("member_id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "committee_point_entry"
  ALTER COLUMN "awarded_by_member_id" DROP NOT NULL,
  DROP CONSTRAINT "committee_point_entry_awarder_member_fkey",
  ADD CONSTRAINT "committee_point_entry_awarder_member_fkey"
    FOREIGN KEY ("awarded_by_member_id") REFERENCES "member"("member_id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "global_point_entry"
  ALTER COLUMN "awarded_by_member_id" DROP NOT NULL,
  DROP CONSTRAINT "global_point_entry_awarder_fkey",
  ADD CONSTRAINT "global_point_entry_awarder_fkey"
    FOREIGN KEY ("awarded_by_member_id") REFERENCES "member"("member_id") ON DELETE SET NULL ON UPDATE NO ACTION;
