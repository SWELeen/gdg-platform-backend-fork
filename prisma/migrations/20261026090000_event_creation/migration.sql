BEGIN;

-- Event details the create-event form collects. All optional, so existing events are unchanged.
ALTER TABLE "events"
    ADD COLUMN "event_type" VARCHAR(30),
    ADD COLUMN "speakers" TEXT,
    ADD COLUMN "maps_link" VARCHAR(500),
    ADD COLUMN "required_registrant_fields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- PR Leader and Co-Leader may create their committee's events, like DATA.
INSERT INTO "committee_permission" ("committee_id", "committee_role", "code", "applies_to", "include_sub_committees")
SELECT c.committee_id, rule.position, 'events.create', 'own', false
FROM (VALUES ('Leader'), ('Co-Leader')) AS rule(position)
JOIN "committee" c ON c.committee_code = 'PR';

COMMIT;
