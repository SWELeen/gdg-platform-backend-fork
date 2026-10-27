-- The club's 11 committees: four club committees and the developer committees,
-- which are grouped under DEV. Codes are the stable identifiers; names follow
-- the public website. Committees outside this list are left untouched.
CREATE TEMPORARY TABLE "wanted_committee" (
    "code" VARCHAR(20) PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL,
    "parent_code" VARCHAR(20)
);

INSERT INTO "wanted_committee" ("code", "name", "parent_code") VALUES
    ('PM', 'Project Management', NULL),
    ('PR', 'Public Relations', NULL),
    ('CONTENT', 'Content Writing', NULL),
    ('DMD', 'Digital Media and Design', NULL),
    ('DEV', 'Developers', NULL),
    ('WEB', 'Web Development', 'DEV'),
    ('DATA', 'Data Analysis', 'DEV'),
    ('AI', 'Artificial Intelligence', 'DEV'),
    ('ROBOTICS', 'Robotics & IoT', 'DEV'),
    ('CYBER', 'Cybersecurity', 'DEV'),
    ('AUTOMATION', 'Automation', 'DEV');

-- Stop instead of renaming over a committee that already uses one of the names.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "committee" c
        JOIN "wanted_committee" w ON w."name" = c."committee_name"
        WHERE c."committee_code" <> w."code"
    ) THEN
        RAISE EXCEPTION 'committee_catalog_name_taken';
    END IF;
END;
$$;

UPDATE "committee" c
SET "committee_name" = w."name"
FROM "wanted_committee" w
WHERE c."committee_code" = w."code"
  AND c."committee_name" <> w."name";

INSERT INTO "committee" ("committee_code", "committee_name")
SELECT w."code", w."name"
FROM "wanted_committee" w
WHERE NOT EXISTS (SELECT 1 FROM "committee" c WHERE c."committee_code" = w."code");

UPDATE "committee" c
SET "parent_committee_id" = p."committee_id"
FROM "wanted_committee" w
LEFT JOIN "committee" p ON p."committee_code" = w."parent_code"
WHERE c."committee_code" = w."code"
  AND c."parent_committee_id" IS DISTINCT FROM p."committee_id";

-- Committee leadership decides its own membership applications. DEV is only a
-- grouping, so it gets no application permission of its own.
INSERT INTO "committee_permission" ("committee_id", "committee_role", "code", "applies_to", "include_sub_committees")
SELECT c."committee_id", r."committee_role", 'applications.decide', 'own', false
FROM "committee" c
JOIN "wanted_committee" w ON w."code" = c."committee_code"
CROSS JOIN (VALUES ('Leader'), ('Co-Leader')) AS r("committee_role")
WHERE w."code" <> 'DEV'
ON CONFLICT DO NOTHING;

DROP TABLE "wanted_committee";
