BEGIN;

-- A confirmation offer that times out is recorded as a cancellation even though
-- the attendee never confirmed it. Ordinary confirmed cancellations retain
-- their existing timestamp requirements.
ALTER TABLE "event_registrations"
  DROP CONSTRAINT "registrations_confirmation_check",
  DROP CONSTRAINT "registrations_cancellation_check";

ALTER TABLE "event_registrations"
  ADD CONSTRAINT "registrations_confirmation_check" CHECK (
    (
      (CASE
        WHEN "status" IN ('CONFIRMED', 'LATE_CANCELLATION', 'NO_CHECK_IN')
          THEN "confirmed_at" IS NOT NULL
        WHEN "status" = 'EXCUSED' THEN true
        ELSE "confirmed_at" IS NULL
      END)
      AND (
        "confirmed_at" IS NULL
        OR (
          "approved_at" IS NOT NULL AND "confirmation_deadline" IS NOT NULL
          AND "confirmed_at" >= "approved_at"
          AND "confirmed_at" < "confirmation_deadline"
        )
      )
    ) IS TRUE
  ),
  ADD CONSTRAINT "registrations_cancellation_check" CHECK (
    (
      (CASE
        WHEN "status" IN ('CANCELLED', 'LATE_CANCELLATION')
          THEN "cancelled_at" IS NOT NULL
        WHEN "status" = 'EXCUSED' THEN true
        ELSE "cancelled_at" IS NULL
      END)
      AND (
        "cancelled_at" IS NULL
        OR (
          COALESCE("confirmed_at", "approved_at") IS NOT NULL
          AND "cancelled_at" >= COALESCE("confirmed_at", "approved_at")
        )
      )
    ) IS TRUE
  );

COMMIT;
