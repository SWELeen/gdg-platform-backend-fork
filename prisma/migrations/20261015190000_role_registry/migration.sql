BEGIN;

-- No legacy-role matching or record deletion is authorized.
LOCK TABLE "roles", "role_permissions" IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "roles") OR EXISTS (SELECT 1 FROM "role_permissions") THEN
        RAISE EXCEPTION 'role_registry_requires_empty_role_tables';
    END IF;
END;
$$;

ALTER TABLE "role_permissions" DROP CONSTRAINT "role_permissions_role_id_fkey";
DROP INDEX "role_permissions_role_id_permission_id_key";
ALTER TABLE "role_permissions" DROP COLUMN "role_id";
DROP TABLE "roles";

CREATE TABLE "role" (
    "role_code" TEXT NOT NULL,
    "description" TEXT,
    "is_privileged" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "role_pkey" PRIMARY KEY ("role_code"),
    CONSTRAINT "role_code_check" CHECK ("role_code" ~ '^[A-Z][A-Z_]*$')
);

-- Only the role side of this existing link changes; permission redesign is a later step.
ALTER TABLE "role_permissions" ADD COLUMN "role_code" TEXT NOT NULL;
CREATE UNIQUE INDEX "role_permissions_role_code_permission_id_key" ON "role_permissions"("role_code", "permission_id");
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_code_fkey"
    FOREIGN KEY ("role_code") REFERENCES "role"("role_code") ON DELETE RESTRICT ON UPDATE NO ACTION;

INSERT INTO "role" ("role_code", "description", "is_privileged") VALUES
    ('ADVISOR', 'Club advisor', true),
    ('GROUP_LEADER', 'Club (group) leader', true),
    ('GROUP_CO_LEADER', 'Club (group) co-leader', true);

COMMIT;
