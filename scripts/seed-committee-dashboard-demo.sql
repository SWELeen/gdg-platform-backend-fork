-- Local committee dashboard demo data for pgAdmin Query Tool.
-- Run after Docker has applied all Prisma migrations.
-- Safe to run repeatedly: deterministic demo records are reused, and this script
-- never deletes or truncates existing data.

BEGIN;

DO $$
DECLARE
  v_committee RECORD;
  v_leader_person_id INTEGER;
  v_leader_member_id INTEGER;
  v_member_person_id INTEGER;
  v_member_one_id INTEGER;
  v_member_two_id INTEGER;
  v_applicant_person_id INTEGER;
  v_event_upcoming_id INTEGER;
  v_event_past_id INTEGER;
  v_event_draft_id INTEGER;
  v_title TEXT;
  v_email TEXT;
  v_label TEXT;
  v_member_index INTEGER;
  v_status TEXT;
  v_applicant_index INTEGER;
  v_applicant_statuses TEXT[] := ARRAY['PENDING', 'CONFIRMED', 'REJECTED', 'NOT_SELECTED'];
BEGIN
  -- Keep these codes aligned with the committee dashboard routes.
  INSERT INTO committee (committee_code, committee_name)
  VALUES
    ('DATA', 'Data Analysis'),
    ('PR', 'Public Relations'),
    ('CONTENT', 'Content Writing'),
    ('WEB', 'Web Design and Development'),
    ('AUTOMATION', 'Automation'),
    ('AI', 'Artificial Intelligence'),
    ('ROBOTICS', 'Robotics & IoT'),
    ('CYBER', 'Cybersecurity'),
    ('DMD', 'Digital Media and Design')
  ON CONFLICT (committee_code) DO UPDATE
    SET committee_name = EXCLUDED.committee_name;

  -- Shared local leader lets the local dashboard resolve a committee member.
  INSERT INTO person (full_name, email_personal, university, branch, major, bio, is_active)
  VALUES ('GDG Dashboard Demo Leader', 'gdg.dashboard.demo.leader@example.test',
          'University of Jeddah', 'Main Campus', 'Computer Science',
          'Demo leader used only for local committee dashboard testing.', TRUE)
  ON CONFLICT DO NOTHING;
  SELECT person_id INTO STRICT v_leader_person_id
  FROM person WHERE lower(email_personal) = 'gdg.dashboard.demo.leader@example.test'
  ORDER BY person_id LIMIT 1;

  INSERT INTO member (person_id, member_type, join_date, is_active)
  VALUES (v_leader_person_id, 'current', CURRENT_DATE - 180, TRUE)
  ON CONFLICT (person_id) DO UPDATE SET is_active = TRUE
  RETURNING member_id INTO v_leader_member_id;

  FOR v_committee IN
    SELECT committee_id, committee_code, committee_name
    FROM committee
    WHERE committee_code IN ('DATA', 'PR', 'CONTENT', 'WEB', 'AUTOMATION', 'AI', 'ROBOTICS', 'CYBER', 'DMD')
    ORDER BY committee_code
  LOOP
    v_label := v_committee.committee_name;

    INSERT INTO member_committee (member_id, committee_id, role)
    VALUES (v_leader_member_id, v_committee.committee_id, 'Leader')
    ON CONFLICT (member_id, committee_id) DO UPDATE SET role = 'Leader';

    -- Two named members per committee make member lists and task assignment
    -- visibly different when switching between dashboards.
    FOR v_member_index IN 1..2 LOOP
      v_email := 'gdg.dashboard.' || lower(v_committee.committee_code) || '.member' || v_member_index || '@example.test';
      INSERT INTO person (full_name, email_personal, email_university, phone_number,
                          university, branch, major, bio, is_active)
      VALUES (
        v_label || ' Dashboard Member ' || v_member_index,
        v_email,
        'demo.' || lower(v_committee.committee_code) || v_member_index || '@uj.edu.sa',
        '+966500000' || lpad(v_committee.committee_id::TEXT, 3, '0') || v_member_index,
        'University of Jeddah', 'Main Campus', 'Computer Science',
        v_label || ' committee demo member for verifying backend data.', TRUE
      )
      ON CONFLICT DO NOTHING;

      SELECT person_id INTO STRICT v_member_person_id
      FROM person WHERE lower(email_personal) = lower(v_email)
      ORDER BY person_id LIMIT 1;

      INSERT INTO member (person_id, member_type, join_date, is_active)
      VALUES (v_member_person_id, 'current', CURRENT_DATE - (30 + v_member_index), TRUE)
      ON CONFLICT (person_id) DO UPDATE SET is_active = TRUE;

      SELECT member_id INTO STRICT v_member_person_id
      FROM member WHERE person_id = (
        SELECT person_id FROM person WHERE lower(email_personal) = lower(v_email)
        ORDER BY person_id LIMIT 1
      );

      INSERT INTO member_committee (member_id, committee_id, role)
      VALUES (v_member_person_id, v_committee.committee_id, 'Member')
      ON CONFLICT (member_id, committee_id) DO UPDATE SET role = 'Member';

      IF v_member_index = 1 THEN v_member_one_id := v_member_person_id;
      ELSE v_member_two_id := v_member_person_id;
      END IF;
    END LOOP;

    -- Three event states exercise event counts, statuses and registration totals.
    v_title := v_committee.committee_code || ' Dashboard Demo Upcoming Event';
    SELECT event_id INTO v_event_upcoming_id FROM events
    WHERE committee_id = v_committee.committee_id AND name = v_title
    ORDER BY event_id LIMIT 1;
    IF v_event_upcoming_id IS NULL THEN
      INSERT INTO events (name, description, starts_at, ends_at, location, capacity,
                          registration_deadline, confirmation_window_hours, status,
                          created_by_member_id, committee_id, created_at, updated_at)
      VALUES (v_title, 'Upcoming test event for ' || v_label || '.',
              date_trunc('hour', now()) + INTERVAL '7 days',
              date_trunc('hour', now()) + INTERVAL '7 days 2 hours',
              'GDG Dashboard Demo Hall', 80,
              date_trunc('hour', now()) + INTERVAL '6 days', 24, 'published',
              v_leader_member_id, v_committee.committee_id, now(), now())
      RETURNING event_id INTO v_event_upcoming_id;
    END IF;

    v_title := v_committee.committee_code || ' Dashboard Demo Completed Event';
    SELECT event_id INTO v_event_past_id FROM events
    WHERE committee_id = v_committee.committee_id AND name = v_title
    ORDER BY event_id LIMIT 1;
    IF v_event_past_id IS NULL THEN
      INSERT INTO events (name, description, starts_at, ends_at, location, capacity,
                          registration_deadline, confirmation_window_hours, status,
                          created_by_member_id, committee_id, created_at, updated_at)
      VALUES (v_title, 'Completed test event for ' || v_label || '.',
              date_trunc('hour', now()) - INTERVAL '14 days',
              date_trunc('hour', now()) - INTERVAL '14 days' + INTERVAL '2 hours',
              'GDG Dashboard Demo Hall', 60,
              date_trunc('hour', now()) - INTERVAL '15 days', 24, 'completed',
              v_leader_member_id, v_committee.committee_id, now() - INTERVAL '14 days', now())
      RETURNING event_id INTO v_event_past_id;
    END IF;

    v_title := v_committee.committee_code || ' Dashboard Demo Draft Event';
    SELECT event_id INTO v_event_draft_id FROM events
    WHERE committee_id = v_committee.committee_id AND name = v_title
    ORDER BY event_id LIMIT 1;
    IF v_event_draft_id IS NULL THEN
      INSERT INTO events (name, description, starts_at, ends_at, location, capacity,
                          registration_deadline, confirmation_window_hours, status,
                          created_by_member_id, committee_id, created_at, updated_at)
      VALUES (v_title, 'Draft test event for ' || v_label || '.',
              date_trunc('hour', now()) + INTERVAL '21 days',
              date_trunc('hour', now()) + INTERVAL '21 days 2 hours',
              'GDG Dashboard Demo Room', 40,
              date_trunc('hour', now()) + INTERVAL '20 days', 24, 'draft',
              v_leader_member_id, v_committee.committee_id, now(), now())
      RETURNING event_id INTO v_event_draft_id;
    END IF;

    -- Distinct registrants and statuses populate pending, accepted, rejected,
    -- and completed-event check-in counts. Re-running does not duplicate rows.
    FOR v_applicant_index IN 1..4 LOOP
      v_email := 'gdg.dashboard.' || lower(v_committee.committee_code) || '.applicant' || v_applicant_index || '@example.test';
      INSERT INTO person (full_name, email_personal, university, branch, major, is_active)
      VALUES (v_label || ' Dashboard Applicant ' || v_applicant_index,
              v_email, 'University of Jeddah', 'Main Campus', 'Software Engineering', TRUE)
      ON CONFLICT DO NOTHING;
      SELECT person_id INTO STRICT v_applicant_person_id
      FROM person WHERE lower(email_personal) = lower(v_email)
      ORDER BY person_id LIMIT 1;

      v_status := v_applicant_statuses[v_applicant_index];
      INSERT INTO event_registrations (event_id, person_id, status, reviewed_by_member_id,
                                      approved_at, confirmation_deadline, confirmed_at,
                                      checked_in_at, checked_in_by_member_id,
                                      attendance_token_hash, attendance_token_encrypted)
      SELECT v_event_upcoming_id, v_applicant_person_id, v_status::"RegistrationStatus",
             CASE WHEN v_status IN ('CONFIRMED', 'REJECTED', 'NOT_SELECTED') THEN v_leader_member_id END,
             CASE WHEN v_status = 'CONFIRMED' THEN now() END,
             CASE WHEN v_status = 'CONFIRMED' THEN now() + INTERVAL '6 days' END,
             CASE WHEN v_status = 'CONFIRMED' THEN now() END,
             NULL, NULL,
             CASE WHEN v_status = 'CONFIRMED' THEN 'demo-' || md5(v_email) END,
             CASE WHEN v_status = 'CONFIRMED' THEN 'local-demo-encrypted-' || md5(v_email) END
      WHERE NOT EXISTS (
        SELECT 1 FROM event_registrations
        WHERE event_id = v_event_upcoming_id AND person_id = v_applicant_person_id
      );

      IF v_applicant_index = 1 THEN
        INSERT INTO event_registrations (event_id, person_id, status, reviewed_by_member_id,
                                        approved_at, confirmation_deadline, confirmed_at,
                                        checked_in_at, checked_in_by_member_id,
                                        attendance_token_hash, attendance_token_encrypted)
        SELECT v_event_past_id, v_applicant_person_id, 'CONFIRMED', v_leader_member_id,
               now() - INTERVAL '15 days', now() - INTERVAL '14 days', now() - INTERVAL '15 days',
               now() - INTERVAL '14 days', v_leader_member_id,
               'demo-past-' || md5(v_email), 'local-demo-encrypted-past-' || md5(v_email)
        WHERE NOT EXISTS (
          SELECT 1 FROM event_registrations
          WHERE event_id = v_event_past_id AND person_id = v_applicant_person_id
        );
      END IF;
    END LOOP;

    -- One example in each task state, assigned only to this committee's members.
    INSERT INTO committee_task (committee_id, title, description, assigned_member_id,
                                created_by_member_id, due_at, priority, status)
    SELECT v_committee.committee_id, v_committee.committee_code || ' Demo Task - To Do',
           'To-do task for the ' || v_label || ' dashboard.', v_member_one_id,
           v_leader_member_id, now() + INTERVAL '3 days', 'HIGH', 'TODO'
    WHERE NOT EXISTS (SELECT 1 FROM committee_task WHERE committee_id = v_committee.committee_id
                      AND title = v_committee.committee_code || ' Demo Task - To Do');

    INSERT INTO committee_task (committee_id, title, description, assigned_member_id,
                                created_by_member_id, due_at, priority, status)
    SELECT v_committee.committee_id, v_committee.committee_code || ' Demo Task - In Progress',
           'In-progress task for the ' || v_label || ' dashboard.', v_member_two_id,
           v_leader_member_id, now() + INTERVAL '10 days', 'MEDIUM', 'IN_PROGRESS'
    WHERE NOT EXISTS (SELECT 1 FROM committee_task WHERE committee_id = v_committee.committee_id
                      AND title = v_committee.committee_code || ' Demo Task - In Progress');

    INSERT INTO committee_task (committee_id, title, description, assigned_member_id,
                                created_by_member_id, due_at, priority, status)
    SELECT v_committee.committee_id, v_committee.committee_code || ' Demo Task - Completed',
           'Completed task for the ' || v_label || ' dashboard.', v_member_one_id,
           v_leader_member_id, now() - INTERVAL '2 days', 'LOW', 'COMPLETED'
    WHERE NOT EXISTS (SELECT 1 FROM committee_task WHERE committee_id = v_committee.committee_id
                      AND title = v_committee.committee_code || ' Demo Task - Completed');

    -- Current and earlier point entries populate totals, monthly stats, history,
    -- member rankings and recent activity.
    INSERT INTO committee_point_entry (committee_id, member_id, awarded_by_member_id, points_delta, reason)
    SELECT v_committee.committee_id, v_member_one_id, v_leader_member_id, 25,
           v_committee.committee_code || ' demo points - contribution'
    WHERE NOT EXISTS (SELECT 1 FROM committee_point_entry WHERE committee_id = v_committee.committee_id
                      AND member_id = v_member_one_id
                      AND reason = v_committee.committee_code || ' demo points - contribution');

    INSERT INTO committee_point_entry (committee_id, member_id, awarded_by_member_id, points_delta, reason, created_at)
    SELECT v_committee.committee_id, v_member_two_id, v_leader_member_id, 10,
           v_committee.committee_code || ' demo points - teamwork', now() - INTERVAL '10 days'
    WHERE NOT EXISTS (SELECT 1 FROM committee_point_entry WHERE committee_id = v_committee.committee_id
                      AND member_id = v_member_two_id
                      AND reason = v_committee.committee_code || ' demo points - teamwork');
  END LOOP;
END $$;

COMMIT;

-- Verification summary: one row per committee with counts and score totals.
SELECT c.committee_code, c.committee_name,
       count(DISTINCT mc.member_id) AS members,
       count(DISTINCT e.event_id) AS events,
       count(DISTINCT t.task_id) AS tasks,
       count(DISTINCT p.point_entry_id) AS point_entries,
       coalesce(sum(DISTINCT p.points_delta), 0) AS points,
       count(DISTINCT er.registration_id) AS registrations
FROM committee c
LEFT JOIN member_committee mc ON mc.committee_id = c.committee_id
LEFT JOIN events e ON e.committee_id = c.committee_id
  AND e.name LIKE c.committee_code || ' Dashboard Demo %'
LEFT JOIN committee_task t ON t.committee_id = c.committee_id
  AND t.title LIKE c.committee_code || ' Demo Task - %'
LEFT JOIN committee_point_entry p ON p.committee_id = c.committee_id
  AND p.reason LIKE c.committee_code || ' demo points - %'
LEFT JOIN event_registrations er ON er.event_id = e.event_id
WHERE c.committee_code IN ('DATA', 'PR', 'CONTENT', 'WEB', 'AUTOMATION', 'AI', 'ROBOTICS', 'CYBER', 'DMD')
GROUP BY c.committee_id, c.committee_code, c.committee_name
ORDER BY c.committee_code;
