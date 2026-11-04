BEGIN;

INSERT INTO "permission" ("code", "description", "scope", "is_sensitive")
VALUES ('developer_committees.members.assign', 'Assign existing accounts within the six developer committees', 'global', true)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permission" ("role_code", "code") VALUES
    ('DEVELOPER_COMMITTEES_LEADER', 'developer_committees.members.assign')
ON CONFLICT ("role_code", "code") DO NOTHING;

COMMIT;
