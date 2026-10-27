BEGIN;

DO $seed$
DECLARE
    r RECORD;
    existing_person person%ROWTYPE;
    existing_member member%ROWTYPE;
    existing_committee committee%ROWTYPE;
    existing_role member_role%ROWTYPE;
    v_person_id INTEGER;
    v_member_id INTEGER;
    v_parent_id INTEGER;
    v_committee_id INTEGER;
    v_position TEXT;
    v_skill_id INTEGER;
    wanted_skill TEXT;
    i INTEGER;
BEGIN
    -- Serialize only this optional fixture; never change existing rows to make it fit.
    PERFORM pg_advisory_xact_lock(hashtext('gdg.optional-local-development-seed'));

    FOR r IN SELECT * FROM (VALUES
        ('DEV', 'Developers', NULL::TEXT),
        ('DATA', 'Data Analysis', 'DEV'),
        ('PM', 'Project Management', NULL::TEXT),
        ('PR', 'Public Relations', NULL::TEXT),
        ('WEB', 'Web Development', 'DEV'),
        ('CYBER', 'Cybersecurity', 'DEV')
    ) AS fixture(code, name, parent_code)
    LOOP
        v_parent_id := NULL;
        IF r.parent_code IS NOT NULL THEN
            SELECT committee_id INTO v_parent_id FROM committee WHERE committee_code = r.parent_code FOR KEY SHARE;
            IF NOT FOUND THEN RAISE EXCEPTION 'development_seed_missing_parent'; END IF;
        END IF;
        SELECT * INTO existing_committee FROM committee WHERE committee_code = r.code FOR UPDATE;
        IF FOUND THEN
            IF existing_committee.committee_name IS DISTINCT FROM r.name
               OR existing_committee.parent_committee_id IS DISTINCT FROM v_parent_id THEN
                RAISE EXCEPTION 'development_seed_conflict_committee';
            END IF;
        ELSE
            IF EXISTS (SELECT 1 FROM committee WHERE committee_name = r.name) THEN
                RAISE EXCEPTION 'development_seed_conflict_committee';
            END IF;
            INSERT INTO committee(committee_code, committee_name, parent_committee_id) VALUES (r.code, r.name, v_parent_id);
        END IF;
    END LOOP;

    FOR r IN SELECT * FROM (VALUES
        ('Ammar Babaset', 'babaset99@gmail.com', 'current',
         ARRAY['WEB', 'PM'], ARRAY['Leader', 'Member'],
         ARRAY['Project Planning & Scheduling', 'Team Leadership & Task Distribution', 'Effective Communication Skills'], NULL::TEXT),
        ('Leen Alghamdi', 'LeenAlghamdi@gmail.com', 'current',
         ARRAY[]::TEXT[], ARRAY[]::TEXT[],
         ARRAY['Team Leadership & Task Distribution', 'Critical Thinking & Decision Making', 'Reporting & Progress Tracking'], 'GROUP_LEADER'),
        ('Abdullah Misar', 'AbdullahMisar@gmail.com', 'current',
         ARRAY['WEB'], ARRAY['Member'],
         ARRAY['Team Leadership & Task Distribution', 'Using Management Tools (Trello, Notion, ClickUp)', 'Effective Communication Skills'], 'DEVELOPER_COMMITTEES_LEADER'),
        ('Mohmmad Alamri', 'MohmmadAlamri@gmail.com', 'alumni',
         ARRAY['CYBER', 'PR'], ARRAY['Member', 'Member'],
         ARRAY['Critical Thinking & Decision Making', 'Quality Assurance & Attention to Detail', 'Research & Analysis'], NULL::TEXT),
        ('Sara Alqahtani', 'sara.alqahtani@example.test', 'current',
         ARRAY['WEB', 'PM'], ARRAY['Co-Leader', 'Member'],
         ARRAY['Time Management & Organization', 'Project Planning & Scheduling', 'Effective Communication Skills'], NULL::TEXT),
        ('Noura Demo', 'data.leader@example.test', 'current',
         ARRAY['DATA'], ARRAY['Leader'], ARRAY[]::TEXT[], NULL::TEXT),
        ('Faisal Demo', 'data.coleader@example.test', 'current',
         ARRAY['DATA'], ARRAY['Co-Leader'], ARRAY[]::TEXT[], NULL::TEXT),
        ('Hala Demo', 'data.member@example.test', 'current',
         ARRAY['DATA'], ARRAY['Member'], ARRAY[]::TEXT[], NULL::TEXT),
        ('Omar Demo', 'club.coleader@example.test', 'current',
         ARRAY[]::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], 'GROUP_CO_LEADER'),
        ('Rania Demo', 'club.advisor@example.test', 'current',
         ARRAY[]::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], 'ADVISOR')
    ) AS fixture(full_name, email, member_type, committees, positions, skills, global_role)
    LOOP
        SELECT * INTO existing_person FROM person
            WHERE lower(btrim(email_personal)) = lower(btrim(r.email)) FOR UPDATE;
        IF FOUND THEN
            IF existing_person.full_name IS DISTINCT FROM r.full_name
               OR NOT existing_person.is_active OR existing_person.auth_user_id IS NOT NULL THEN
                RAISE EXCEPTION 'development_seed_conflict_person';
            END IF;
            v_person_id := existing_person.person_id;
        ELSE
            INSERT INTO person(full_name, email_personal) VALUES (r.full_name, r.email) RETURNING person_id INTO v_person_id;
        END IF;

        SELECT * INTO existing_member FROM member WHERE person_id = v_person_id FOR UPDATE;
        IF FOUND THEN
            IF existing_member.member_type IS DISTINCT FROM r.member_type OR NOT existing_member.is_active THEN
                RAISE EXCEPTION 'development_seed_conflict_member';
            END IF;
            v_member_id := existing_member.member_id;
        ELSE
            INSERT INTO member(person_id, member_type) VALUES (v_person_id, r.member_type) RETURNING member_id INTO v_member_id;
        END IF;

        FOR i IN 1..coalesce(array_length(r.committees, 1), 0) LOOP
            SELECT committee_id INTO v_committee_id FROM committee WHERE committee_code = r.committees[i];
            IF NOT FOUND THEN RAISE EXCEPTION 'development_seed_missing_committee'; END IF;
            SELECT role INTO v_position FROM member_committee WHERE member_id = v_member_id AND committee_id = v_committee_id FOR UPDATE;
            IF FOUND THEN
                IF v_position IS DISTINCT FROM r.positions[i] THEN RAISE EXCEPTION 'development_seed_conflict_position'; END IF;
            ELSE
                INSERT INTO member_committee(member_id, committee_id, role) VALUES (v_member_id, v_committee_id, r.positions[i]);
            END IF;
        END LOOP;

        IF r.global_role IS NOT NULL THEN
            PERFORM 1 FROM role WHERE role_code = r.global_role;
            IF NOT FOUND THEN RAISE EXCEPTION 'development_seed_missing_role'; END IF;
            SELECT * INTO existing_role FROM member_role
                WHERE member_id = v_member_id AND role_code = r.global_role AND ends_on IS NULL FOR UPDATE;
            IF FOUND THEN
                IF existing_role.starts_on IS NOT NULL OR existing_role.assigned_by IS NOT NULL OR existing_role.notes IS NOT NULL THEN
                    RAISE EXCEPTION 'development_seed_conflict_role';
                END IF;
            ELSE
                INSERT INTO member_role(member_id, role_code) VALUES (v_member_id, r.global_role);
            END IF;
        END IF;

        FOREACH wanted_skill IN ARRAY r.skills LOOP
            SELECT skill_id INTO v_skill_id FROM skill WHERE skill_name = wanted_skill;
            IF NOT FOUND THEN RAISE EXCEPTION 'development_seed_missing_skill'; END IF;
            INSERT INTO member_skill(member_id, skill_id)
                SELECT v_member_id, v_skill_id
                WHERE NOT EXISTS (SELECT 1 FROM member_skill WHERE member_id = v_member_id AND skill_id = v_skill_id)
                ON CONFLICT (member_id, skill_id) DO NOTHING;
        END LOOP;
    END LOOP;
END
$seed$;

COMMIT;
