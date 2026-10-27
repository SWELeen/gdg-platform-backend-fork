BEGIN;

-- University email is optional profile data, so it must not reserve an address.
DROP INDEX IF EXISTS "uq_person_email_university";
DROP INDEX IF EXISTS "signup_verification_email_university_key";

-- Keep personal email identities unique while allowing old university identity
-- rows to coexist with a personal address that happens to match one.
ALTER TABLE "person_email_identity"
  DROP CONSTRAINT IF EXISTS "person_email_identity_email_key";
CREATE UNIQUE INDEX "person_email_identity_personal_email_key"
  ON "person_email_identity"("email")
  WHERE "kind" = 'PERSONAL';

COMMIT;
