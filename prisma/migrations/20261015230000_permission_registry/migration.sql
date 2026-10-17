BEGIN;

-- No legacy permission mapping or record deletion is authorized.
LOCK TABLE "permissions", "role_permissions" IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "permissions") OR EXISTS (SELECT 1 FROM "role_permissions") THEN
        RAISE EXCEPTION 'permission_registry_requires_empty_permission_tables';
    END IF;
END;
$$;

ALTER TABLE "role_permissions" DROP CONSTRAINT "role_permissions_permission_id_fkey";
DROP INDEX "role_permissions_role_code_permission_id_key";
DROP INDEX "role_permissions_permission_id_idx";
ALTER TABLE "role_permissions" DROP COLUMN "permission_id";
DROP TABLE "permissions";

CREATE TABLE "permission" (
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "grant_permission" TEXT,
    "is_sensitive" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "permission_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "permission_code_check" CHECK ("code" ~ '^[a-z_]+[.][a-z_]+$'),
    CONSTRAINT "permission_scope_check" CHECK ("scope" IN ('global', 'event', 'committee')),
    CONSTRAINT "permission_grant_permission_fkey" FOREIGN KEY ("grant_permission") REFERENCES "permission"("code") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- Adapt only the required permission reference; final link-table shape is a later step.
ALTER TABLE "role_permissions" ADD COLUMN "code" TEXT NOT NULL;
CREATE UNIQUE INDEX "role_permissions_role_code_code_key" ON "role_permissions"("role_code", "code");
CREATE INDEX "role_permissions_code_idx" ON "role_permissions"("code");
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_code_fkey"
    FOREIGN KEY ("code") REFERENCES "permission"("code") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Permission definitions and their distribution require separate approval.
COMMIT;
