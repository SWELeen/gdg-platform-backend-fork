BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "permission" WHERE "code" = 'events.create') THEN
        RAISE EXCEPTION 'pr_event_create_permission_definition_missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "committee" WHERE "committee_code" = 'PR') THEN
        RAISE EXCEPTION 'pr_committee_missing';
    END IF;
END;
$$;

-- Committee permissions attach to the assigned committee role, so existing and
-- future PR Leaders/Co-Leaders receive the same event rights automatically.
INSERT INTO "committee_permission" (
    "committee_id", "committee_role", "code", "applies_to", "include_sub_committees"
)
SELECT c."committee_id", r."committee_role", 'events.create', 'own', false
FROM "committee" c
CROSS JOIN (VALUES ('Leader'), ('Co-Leader')) AS r("committee_role")
WHERE c."committee_code" = 'PR'
ON CONFLICT DO NOTHING;

COMMIT;