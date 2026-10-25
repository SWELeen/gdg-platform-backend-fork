-- Signup verification with both personal and university emails uses one code
-- shared by both recipients.
ALTER TABLE "email_verification_challenge"
DROP CONSTRAINT "email_verification_challenge_purpose_check";

ALTER TABLE "email_verification_challenge"
ADD CONSTRAINT "email_verification_challenge_purpose_check"
CHECK ("purpose" IN ('UNIVERSITY', 'SHARED_SIGNUP'));
