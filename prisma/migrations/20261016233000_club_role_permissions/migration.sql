BEGIN;

-- Approved club administration only; no event, PR or advisor permissions.
-- Existing-pair collisions fail atomically instead of overwriting local policy.
INSERT INTO "role_permission" ("role_code", "code") VALUES
    ('GROUP_LEADER', 'members.manage'),
    ('GROUP_CO_LEADER', 'members.manage');

COMMIT;
