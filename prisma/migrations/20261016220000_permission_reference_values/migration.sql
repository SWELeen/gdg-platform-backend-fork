BEGIN;

-- User-approved production reference definitions only; no role/member grants.
-- Code collisions fail the transaction; never overwrite existing local metadata.
INSERT INTO "permission" ("code", "description", "scope", "grant_permission", "is_sensitive") VALUES
    ('accounts.lock_temp', 'Lock an account temporarily (1–72 h)', 'global', NULL, false),
    ('accounts.suspend', 'Suspend an account (longer than 72 h)', 'global', NULL, false),
    ('announcements.manage', 'Write announcements', 'global', NULL, false),
    ('applications.decide', 'Accept / reject committee applications (inside the window)', 'committee', NULL, false),
    ('attendance.record', 'Scan QR codes / record attendance', 'event', NULL, false),
    ('audit.export', 'Export a month of the audit log', 'global', NULL, true),
    ('audit.view', 'View the audit log', 'global', NULL, true),
    ('campus_id.view', 'See university IDs collected for an on-campus workshop', 'event', NULL, true),
    ('capacity.approve_club', 'Approve more places (club side)', 'global', NULL, false),
    ('capacity.approve_dev', 'Approve more places (Development side)', 'global', NULL, false),
    ('capacity.request', 'Ask for more places in a published workshop', 'event', NULL, false),
    ('changes.approve_club', 'Approve DBA change requests (club leader slot)', 'global', NULL, false),
    ('changes.approve_cyber', 'Approve DBA change requests (Cyber leader slot) and bulk data access', 'global', NULL, false),
    ('changes.approve_data', 'Approve DBA change requests (Data leader slot)', 'global', NULL, false),
    ('changes.review_emergency', 'Review emergency DBA changes afterwards', 'global', NULL, false),
    ('contacts.view', 'See phone numbers of accepted registrants (purpose required)', 'event', NULL, true),
    ('decisions.any_time', 'Decide applications / registrations outside the review window', 'global', NULL, false),
    ('events.create', 'Create workshops (and manage the ones you created)', 'global', 'grants.events_create', false),
    ('events.manage_all', 'Manage every workshop', 'global', NULL, false),
    ('grants.data_task', 'Give Data Committee members temporary access for a data task', 'global', NULL, false),
    ('grants.events_create', 'Give temporary "create workshops" permission', 'global', NULL, false),
    ('grants.review', 'Give temporary "review registrations" permission', 'global', NULL, false),
    ('incidents.excuse', 'Accept an excuse for an attendance incident', 'event', NULL, false),
    ('links.approve', 'Approve requests to link an account to a member', 'committee', NULL, false),
    ('members.manage', 'Add / change members, committees and non-leader committee roles', 'global', NULL, false),
    ('members.view_contacts', 'See contact details of a committee''s members', 'committee', 'grants.data_task', true),
    ('registrants.view', 'See registrants'' names and answers (no phones)', 'event', 'grants.data_task', true),
    ('registrations.review', 'Accept / waitlist / reject registrations (inside the window)', 'event', 'grants.review', false),
    ('staff.assign', 'Assign workshop organizers and PR staff', 'event', NULL, false),
    ('windows.manage', 'Open review windows', 'global', NULL, false);

COMMIT;
