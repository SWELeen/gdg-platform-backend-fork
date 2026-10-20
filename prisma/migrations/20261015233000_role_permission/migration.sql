BEGIN;

-- Do not drop legacy link IDs on a populated table or infer any assignments.
LOCK TABLE "role_permissions" IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "role_permissions") THEN
        RAISE EXCEPTION 'role_permission_requires_empty_link_table';
    END IF;
END;
$$;

ALTER TABLE "role_permissions" RENAME TO "role_permission";
ALTER TABLE "role_permission" DROP CONSTRAINT "role_permissions_pkey";
DROP INDEX "role_permissions_role_code_code_key";
ALTER TABLE "role_permission" DROP COLUMN "id";
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role_code", "code");
ALTER TABLE "role_permission" RENAME CONSTRAINT "role_permissions_role_code_fkey" TO "role_permission_role_code_fkey";
ALTER TABLE "role_permission" RENAME CONSTRAINT "role_permissions_code_fkey" TO "role_permission_code_fkey";
ALTER INDEX "role_permissions_code_idx" RENAME TO "role_permission_code_idx";

-- No role-permission assignments are seeded.
COMMIT;
