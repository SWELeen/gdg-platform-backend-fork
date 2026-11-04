BEGIN;

-- Ordinary PR members use the standard member dashboard and assigned tasks.
-- Registration visibility and review stay limited to PR Leaders/Co-Leaders.
DELETE FROM "committee_permission" cp
USING "committee" c
WHERE cp."committee_id" = c."committee_id"
  AND c."committee_code" = 'PR'
  AND cp."committee_role" = 'Member'
  AND cp."code" IN ('registrants.view', 'registrations.review');

COMMIT;
