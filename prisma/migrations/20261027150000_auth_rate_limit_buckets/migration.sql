BEGIN;

CREATE TABLE "auth_rate_limit_bucket" (
    "bucket_hash" VARCHAR(64) NOT NULL,
    "window_started_at" TIMESTAMPTZ(6) NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "auth_rate_limit_bucket_pkey" PRIMARY KEY ("bucket_hash"),
    CONSTRAINT "auth_rate_limit_bucket_request_count_check" CHECK ("request_count" > 0)
);

CREATE INDEX "auth_rate_limit_bucket_window_started_at_idx"
  ON "auth_rate_limit_bucket"("window_started_at");

COMMIT;
