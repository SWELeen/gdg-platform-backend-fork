BEGIN;

-- Leaders and co-leaders may add members to their own committee dashboards.
INSERT INTO "committee_permission" (
    "committee_id", "committee_role", "code", "applies_to", "include_sub_committees"
) VALUES
    (NULL, 'Leader', 'members.manage', 'own', false),
    (NULL, 'Co-Leader', 'members.manage', 'own', false)
ON CONFLICT DO NOTHING;

COMMIT;
