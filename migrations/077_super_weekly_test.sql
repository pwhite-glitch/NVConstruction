-- Migration 077: weekly superintendent test (prompt 88).
--
-- STATUS: PROPOSED — written, NOT applied. Apply only when Peyton names it.
-- REQUIRES public.profiles and public.get_my_role() (migration 028). The guard below aborts if
-- either is missing.
-- Idempotent (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / DROP POLICY IF EXISTS +
-- CREATE POLICY / seed ON CONFLICT DO NOTHING); one transaction.
--
-- What this adds (all public):
--   super_test_questions    the bank, WITHOUT answers. Seed ids q01..q80; admin-made ids 'qa-' + 8 hex.
--                           Never hard-deleted (attempts reference them): admins deactivate.
--   super_test_answer_keys  correct_index + explanation per question. A SEPARATE table with NO grant
--                           and NO policy for anon / authenticated → only the service role can read
--                           it. This is the answer-key wall.
--   super_test_assignments  the set served to a super for a week (UNIQUE super_id, week_start), so a
--                           reload / another device / a mid-week bank edit never changes the set.
--   super_test_attempts     one submitted attempt per super per week (UNIQUE super_id, week_start;
--                           UNIQUE assignment_id). Score + per-question snapshot in ONE row, so a
--                           submit is a single INSERT and the UNIQUE constraint stops double submits,
--                           even two racing requests. answers = one element per question, in order:
--                           {question_id, category, topic, question, choices, chosen_index,
--                            correct_index, explanation, is_correct} (snapshot at submit time, so
--                           later question edits never change a past result).
--   Week = Monday 00:00 → Sunday 23:59:59 America/Chicago; week_start is that Monday (ISODOW 1).
--   profiles FKs: ON DELETE CASCADE on assignments / attempts (deleting a person is never blocked
--   by their test history); created_by / updated_by ON DELETE SET NULL.
--
-- RLS / grants (defense in depth — the app reads and writes ONLY through /api/super-test/* with the
-- service role, which bypasses RLS):
--   all four: ENABLE RLS; REVOKE ALL FROM anon, authenticated.
--   super_test_answer_keys: nothing else (no GRANT, no POLICY).
--   super_test_questions:   SELECT for principal / admin only (supers can't list the bank).
--   assignments / attempts: SELECT own rows (super_id = auth.uid()) or principal / admin.
--   No INSERT / UPDATE / DELETE policies anywhere.
--   The ('principal', 'admin') lists MIRROR SUPER_TEST_ADMIN_ROLES in lib/super-test.js — change
--   both together (adding 'pm' = that constant + the IN (...) lists below).
--
-- Seed: generated SQL from data/super-test-questions.json by scripts/gen-super-test-seed.js (80
-- questions: 56 braums / 24 general; q01–q10 = Peyton's approved sample week). ON CONFLICT DO
-- NOTHING (not DO UPDATE) so a re-run never overwrites an admin's later edit or reactivates a
-- deactivated question. tests/prompt88-super-weekly-test.test.js checks the block below matches the
-- generator byte-for-byte.
--
-- DEPLOY ORDER — safe in either order. Recommended: apply 077 first, then deploy the prompt 88 code.
--   • 077 first, old code live: harmless (new tables nobody reads).
--   • Code first, before 077: /field shows "Weekly test isn't set up yet" (the API returns
--     migration_required '077') and the dashboard Super Test tab shows the same note. Nothing else
--     in the app changes.
--
-- ROLLBACK (manual; not run by this file):
--   BEGIN;
--   DROP TABLE IF EXISTS public.super_test_attempts;
--   DROP TABLE IF EXISTS public.super_test_assignments;
--   DROP TABLE IF EXISTS public.super_test_answer_keys;
--   DROP TABLE IF EXISTS public.super_test_questions;
--   COMMIT;
--   (Rolling back loses every attempt and any admin-made question. The prompt 88 code tolerates the
--    tables being missing.)

BEGIN;

-- ── 0. Guard: profiles + get_my_role() must exist ───────────────────────────
DO $guard$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'public.profiles is missing';
  END IF;
  IF to_regprocedure('public.get_my_role()') IS NULL THEN
    RAISE EXCEPTION 'public.get_my_role() is missing (apply 028 first)';
  END IF;
END
$guard$;

-- ── 1. Tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.super_test_questions (
  id          text PRIMARY KEY,
  category    text NOT NULL CHECK (category IN ('braums', 'general')),
  topic       text NOT NULL CHECK (topic ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  store       text NULL CHECK (store IS NULL OR length(store) <= 60),
  question    text NOT NULL CHECK (length(btrim(question)) BETWEEN 1 AND 1000),
  choices     jsonb NOT NULL CHECK (jsonb_typeof(choices) = 'array' AND jsonb_array_length(choices) = 4),
  source      text NULL,
  is_sample   boolean NOT NULL DEFAULT false,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by  uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS super_test_questions_active_category
  ON public.super_test_questions (active, category);

CREATE TABLE IF NOT EXISTS public.super_test_answer_keys (
  question_id    text PRIMARY KEY REFERENCES public.super_test_questions(id) ON DELETE CASCADE,
  correct_index  smallint NOT NULL CHECK (correct_index BETWEEN 0 AND 3),
  explanation    text NOT NULL CHECK (length(btrim(explanation)) BETWEEN 1 AND 600),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.super_test_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  super_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_start    date NOT NULL CHECK (EXTRACT(ISODOW FROM week_start) = 1),
  question_ids  text[] NOT NULL CHECK (cardinality(question_ids) BETWEEN 1 AND 20),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT super_test_assignments_super_week_key UNIQUE (super_id, week_start)
);

CREATE TABLE IF NOT EXISTS public.super_test_attempts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id  uuid NOT NULL UNIQUE REFERENCES public.super_test_assignments(id) ON DELETE CASCADE,
  super_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_start     date NOT NULL CHECK (EXTRACT(ISODOW FROM week_start) = 1),
  score          integer NOT NULL,
  total          integer NOT NULL,
  answers        jsonb NOT NULL CHECK (jsonb_typeof(answers) = 'array'),
  submitted_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT super_test_attempts_score_check CHECK (total > 0 AND score BETWEEN 0 AND total),
  CONSTRAINT super_test_attempts_super_week_key UNIQUE (super_id, week_start)
);

CREATE INDEX IF NOT EXISTS super_test_attempts_week_start
  ON public.super_test_attempts (week_start);

-- ── 2. RLS / grants ─────────────────────────────────────────────────────────
ALTER TABLE public.super_test_questions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.super_test_answer_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.super_test_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.super_test_attempts    ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.super_test_questions   FROM anon, authenticated;
REVOKE ALL ON public.super_test_answer_keys FROM anon, authenticated;
REVOKE ALL ON public.super_test_assignments FROM anon, authenticated;
REVOKE ALL ON public.super_test_attempts    FROM anon, authenticated;

-- Answer keys: deliberately nothing more here — service role only.

-- ('principal', 'admin') below mirrors SUPER_TEST_ADMIN_ROLES in lib/super-test.js.
GRANT SELECT ON public.super_test_questions TO authenticated;
DROP POLICY IF EXISTS super_test_questions_admin_select ON public.super_test_questions;
CREATE POLICY super_test_questions_admin_select ON public.super_test_questions
  FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('principal', 'admin'));

GRANT SELECT ON public.super_test_assignments TO authenticated;
DROP POLICY IF EXISTS super_test_assignments_own_or_admin_select ON public.super_test_assignments;
CREATE POLICY super_test_assignments_own_or_admin_select ON public.super_test_assignments
  FOR SELECT TO authenticated
  USING (super_id = auth.uid() OR public.get_my_role() IN ('principal', 'admin'));

GRANT SELECT ON public.super_test_attempts TO authenticated;
DROP POLICY IF EXISTS super_test_attempts_own_or_admin_select ON public.super_test_attempts;
CREATE POLICY super_test_attempts_own_or_admin_select ON public.super_test_attempts
  FOR SELECT TO authenticated
  USING (super_id = auth.uid() OR public.get_my_role() IN ('principal', 'admin'));

-- ── 3. Seed (80 questions + keys) ───────────────────────────────────────────
-- BEGIN GENERATED SEED (scripts/gen-super-test-seed.js)
INSERT INTO public.super_test_questions (id, category, topic, store, question, choices, source, is_sample) VALUES
  ('q01', 'braums', 'owner-furnished-scope', NULL, 'Which of these does Braum''s furnish for us to install?', '["Ansul system","AAON rooftop units","Grease interceptor","Fire alarm"]'::jsonb, 'super-test/approved-sample-and-rules.md sample #1; overview.md §4', true),
  ('q02', 'braums', 'deliveries', NULL, 'What comes on Hotshot #1 from the Braum''s OKC warehouse?', '["Tile, vinyl, rubber base","Drive-thru windows, ice machine condensers, line sets, MDP","Menu boards and signage","Hoods and stainless equipment"]'::jsonb, 'super-test/approved-sample-and-rules.md sample #2; overview.md §4 Hotshot deliveries', true),
  ('q03', 'braums', 'plan-conflicts', 'Conway #7551', 'On Conway the plumbing sheet shows a 1,500-gal grease interceptor but the civil shows 1,000 gal. What do you do?', '["Install 1,000 since civil governs","Install whatever shows up","Stop and get it confirmed with Peyton/architect before ordering or setting","Split the difference"]'::jsonb, 'super-test/approved-sample-and-rules.md sample #3; conway-7551.md Plan-set findings', true),
  ('q04', 'braums', 'geotech-earthwork', NULL, 'The geotech report says strip at least 12" of topsoil, but the dirt sub only planned 6". What do you do?', '["Go with 6\"","Strip 12\" per geotech and tell Peyton right away so cost gets handled","Strip 6\" and add select fill","Ask the testing lab after the pad is built"]'::jsonb, 'super-test/approved-sample-and-rules.md sample #4; littlerock-7543.md Geotech', true),
  ('q05', 'braums', 'plan-conflicts', 'Russellville #7545', 'On Russellville the civil inside the Rev1 building set shows underground 30" HDPE detention, but the 4-30-26 civil shows a pond. Which do you build?', '["HDPE","Pond per 4-30-26 civil","Both","Cheaper one"]'::jsonb, 'super-test/approved-sample-and-rules.md sample #5; russellville-7545.md Specific to this store', true),
  ('q06', 'braums', 'paving-concrete', NULL, 'Per the Crafton paving spec, a panel with a random crack:', '["Seal with Dow 888","Patch","Leave if under 1/8\"","Remove and replace"]'::jsonb, 'super-test/approved-sample-and-rules.md sample #6; overview.md §11 Paving', true),
  ('q07', 'braums', 'sequencing', NULL, 'When should irrigation sleeves go in?', '["After paving","As soon as dirt work is done","During landscaping","Before slab pour only"]'::jsonb, 'super-test/approved-sample-and-rules.md sample #7; overview.md §6', true),
  ('q08', 'general', 'safety-fall', NULL, 'OSHA fall protection height in construction?', '["4 ft","6 ft","10 ft","15 ft"]'::jsonb, 'super-test/approved-sample-and-rules.md sample #8; general practice (OSHA 1926.501)', true),
  ('q09', 'general', 'safety-excavation', NULL, 'Trench depth requiring a protective system unless stable rock?', '["3 ft","4 ft","5 ft","8 ft"]'::jsonb, 'super-test/approved-sample-and-rules.md sample #9; general practice (OSHA 1926.652)', true),
  ('q10', 'general', 'safety-ladders', NULL, 'Extension ladder must extend above the landing:', '["1 ft","2 ft","3 ft","4 ft"]'::jsonb, 'super-test/approved-sample-and-rules.md sample #10; general practice (OSHA 1926.1053)', true),
  ('q11', 'braums', 'owner-furnished-scope', NULL, 'The walk-in cooler/freezer and the refrigeration condensers for a Braum''s arrive. Per the responsibility matrix, how is that split?', '["NV buys and installs them","Braum''s furnishes and installs them with its own crew","Braum''s furnishes them and NV (GC) installs them","The refrigeration sub buys them off the spec"]'::jsonb, 'overview.md §4 Braum''s furnishes, GC installs', false),
  ('q12', 'braums', 'owner-furnished-scope', NULL, 'Which of these is NV''s to furnish AND install on a Braum''s store?', '["Exterior signage","Ansul system and fire alarm","POS and seating","Kitchen hoods"]'::jsonb, 'overview.md §4 GC furnishes and installs', false),
  ('q13', 'braums', 'owner-furnished-scope', NULL, 'Braum''s crews show up to set the hoods and the stainless foodservice equipment. Whose scope is that?', '["The millwork sub sets it","Braum''s furnishes it and our MEP subs set it","NV furnishes and installs it","Braum''s furnishes and installs it"]'::jsonb, 'overview.md §4 Braum''s furnishes and installs', false),
  ('q14', 'braums', 'owner-furnished-scope', NULL, 'Who buys the floor tile, rubber base and wallpaper on a Braum''s job?', '["The flooring sub buys them on his own PO","Braum''s furnishes and installs them","Braum''s furnishes them and NV installs them","NV buys them from the finish schedule"]'::jsonb, 'overview.md §4 Braum''s furnishes, GC installs', false),
  ('q15', 'braums', 'owner-furnished-scope', NULL, 'On a Braum''s store, the parking lot light poles and the automatic front doors are:', '["Furnished by the city","Furnished and installed by NV (GC)","Furnished by Braum''s, installed by NV","Furnished and installed by Braum''s"]'::jsonb, 'overview.md §4 GC furnishes and installs', false),
  ('q16', 'braums', 'deliveries', NULL, 'Hotshot #2 is coming from the Braum''s OKC warehouse. What should you be ready to receive and store?', '["The finishes package: tile, vinyl, grout, millwork, stall doors and rubber base","AAON rooftop units and curbs, which come from the manufacturer, not Hotshot #2","Drive-thru windows, ice-machine condensers, line sets and the MDP from Hotshot #1","Hoods and stainless equipment, which Braum''s own crews set, not Hotshot #2"]'::jsonb, 'overview.md §4 Hotshot deliveries', false),
  ('q17', 'braums', 'submittals', NULL, 'Per the NV Support Manual, which of these need shop drawings on a Braum''s job?', '["Porta potty, dumpster and temp facilities, which aren''t in the shop-drawing list","Rubber base, paint and toilet accessories, which don''t need shop drawings","Metal canopy, NABCO door install and glass storefront, per the Support Manual","Toilet accessories only, with no canopy, doors or storefront drawings"]'::jsonb, 'overview.md §3 Required shop drawings', false),
  ('q18', 'braums', 'scheduling', NULL, 'You''ve just mobilized on a new Braum''s. Which item needs tracking from day one because of its long lead time?', '["Rebar","Porta potties","The AAON rooftop units","Rubber base"]'::jsonb, 'overview.md §5 Long-lead items', false),
  ('q19', 'braums', 'sequencing', NULL, 'In the standard Braum''s schedule template, what comes right after the footings?', '["Roofing","Fire final","The tension (PT) slab","Paving"]'::jsonb, 'overview.md §5 Sequence', false),
  ('q20', 'braums', 'sequencing', NULL, 'The fire final just passed on a Braum''s store. Per the standard schedule, what''s the next step before CO and turnover?', '["Order the RTUs","Final walkthrough with Koty Foran (Braum''s)","Start irrigation sleeves","Pour the tension slab"]'::jsonb, 'overview.md §5 Sequence', false),
  ('q21', 'braums', 'braums-team', NULL, 'You have a question about the post-tensioned slab design on a Braum''s store. Which firm designs it on every set?', '["Crafton Engineering","Tanner Consulting","Stresscon","Reprise Design"]'::jsonb, 'overview.md §2 Prototypes', false),
  ('q22', 'braums', 'framing-trusses', NULL, 'The HVAC sub wants to cut an exhaust fan opening through a roof truss. What does the Kimley-Horn truss review require?', '["Openings go between trusses; don''t cut a truss to make them","Let the roofer decide whether that truss can be cut in the field","Cut through the truss if the exhaust opening looks small enough","Cut the truss and add blocking to frame the exhaust-fan opening"]'::jsonb, 'overview.md §6 Truss review', false),
  ('q23', 'braums', 'framing-trusses', NULL, 'Checking the layout before trusses are ordered, you see the girder truss lands right where the electrical MDP cabinet goes. What do you do?', '["Ignore it and let the electrician work around the girder truss","Cut the girder truss around the cabinet later in the field","Move the MDP wherever it fits after the trusses arrive","Flag it to Peyton and the engineer before the trusses are set"]'::jsonb, 'overview.md §6 Lessons learned', false),
  ('q24', 'braums', 'field-standards', NULL, 'The canopy erector asks how high the canopy columns go. Per the Braum''s lessons learned:', '["Whatever the canopy shop drawing default is","All the way to the top plate","They stop at the soffit","The framer decides in the field"]'::jsonb, 'overview.md §6 Lessons learned', false),
  ('q25', 'braums', 'field-standards', NULL, 'The canopy footings pour in two weeks. What do the lessons learned say about the canopy anchor bolts?', '["Drill and epoxy the anchor bolts after the footings are poured","The concrete sub buys the anchor bolts at the supply house later","Confirm they''re in the canopy bid and on site before the pour","Canopy anchor bolts aren''t needed on a Braum''s store"]'::jsonb, 'overview.md §6 Lessons learned', false),
  ('q26', 'braums', 'sequencing', NULL, 'When does the dumpster gate post go in on a Braum''s?', '["After the final walkthrough","After paving is striped","Whenever the fence sub shows up","With the canopy"]'::jsonb, 'overview.md §6 Lessons learned', false),
  ('q27', 'braums', 'field-standards', NULL, 'Which items do the Braum''s lessons learned say to keep in the job trailer?', '["Ceiling tile and grid for the dining room and restrooms","J-bolts, bollards, 6x6 column bases/hangers and angle iron","Paint, caulk and leftover finish materials from the warehouse","Spare glass and extra storefront parts for the mural"]'::jsonb, 'overview.md §6 Lessons learned', false),
  ('q28', 'braums', 'field-standards', NULL, 'The storefront sub lays out the glass mural and the two drive-thru-side windows sit higher than drive-thru window #2. Per the lessons learned:', '["Delete the two drive-thru-side windows from the mural layout","Leave the two higher windows as drawn on the storefront layout","Lower those two windows to the height of window #2, because of the glass mirror","Raise window #2 to match the two higher drive-thru-side windows, and leave the mural as laid out"]'::jsonb, 'overview.md §6 Lessons learned', false),
  ('q29', 'braums', 'rfis', NULL, 'A sub finds a discrepancy between two MEP sheets before bid day, and nobody has resolved it. Per the general note in every Braum''s MEP set, what''s the smart move?', '["Get an RFI answered before bid day","Build whichever sheet the sub likes","Assume the lesser scope and sort it out later","Wait for the inspector to decide"]'::jsonb, 'overview.md §11 MEP general note', false),
  ('q30', 'braums', 'rfis', 'Little Rock #7543', 'On Little Rock, the geotech report names the site as Lot BR-1B but the civil calls it Lot BR-4R. What''s the right move?', '["Send an RFI so the record confirms the geotech covers this site","Use whichever lot number the dirt sub prefers in the field","Order a new set of borings yourself without sending an RFI","Ignore the lot-name mismatch; it''s just a label on the two reports"]'::jsonb, 'littlerock-7543.md Conflicts to RFI', false),
  ('q31', 'braums', 'plan-conflicts', 'Longview #7530', 'Every other Braum''s set shows an 8" dumpster pad, but the 7530 G-004 sheet shows 6". The concrete sub is about to form it. What do you do?', '["Pour 8\" like the other stores and don''t mention the conflict","Pour 7\" to split the difference between the 6\" and 8\" callouts","Pour 6\" because that''s what this one G-004 sheet shows, and ignore the other sets","Get it confirmed with Peyton/the architect before forming or ordering"]'::jsonb, 'longview-7530.md Specific to this store', false),
  ('q32', 'braums', 'geotech-earthwork', NULL, 'The structural PT2 sheet says "GEOTECHNICAL REPORT: T.B.D." and leaves the select-fill depth blank. The dirt sub is ready to build the pad. What do you do?', '["Get the select-fill depth confirmed from the geotech before building the pad","Use the select-fill depth from the last Braum''s store you built, without checking this report","Let the dirt sub pick a select-fill depth that looks right to him","Skip select fill and build the pad on the existing subgrade as-is"]'::jsonb, 'overview.md §11 Geotech referenced on the structural sheets', false),
  ('q33', 'braums', 'geotech-earthwork', 'Little Rock #7543', 'The geotech warns of possible perched water and says earthwork is best June–September. Your dirt work is slipping into November. What''s the best move?', '["Plan for dewatering and tell Peyton early so it''s scheduled","Stop all work until next June without telling anyone","Add water to the subgrade to help compaction","Keep going and hope it stays dry"]'::jsonb, 'littlerock-7543.md Geotech', false),
  ('q34', 'braums', 'geotech-earthwork', 'Little Rock #7543', 'The geotech defines trench rock as material a CAT 330B with rock teeth can''t remove. The utility sub hits hard ground in a deep trench and wants to call it rock. What do you do?', '["Check the geotech definition, document it, and tell Peyton before any rock claim","Accept the sub''s word and let him bill the hard ground as trench rock without checking the geotech definition","Refuse the rock claim without looking at the material in the trench","Have him switch to a smaller machine and still call it rock"]'::jsonb, 'littlerock-7543.md Geotech', false),
  ('q35', 'braums', 'paving-concrete', 'Little Rock #7543', 'The Little Rock E-101 says to keep parking lot reinforcement 24" from the drive-thru loop sensor. The paving crew is setting rebar in the drive-thru lane. What do you check?', '["That there''s no rebar anywhere in the whole drive-thru lane","That the rebar is held back from the loop sensor as E-101 shows","That the rebar is doubled around the sensor to protect it","Nothing; the loop-sensor installer will deal with the rebar later"]'::jsonb, 'littlerock-7543.md Specific to this store', false),
  ('q36', 'braums', 'store-differences', 'Little Rock #7543', 'You''re moving from Russellville, where the mop basin is recessed into the floor, to Little Rock. Before the slab pour on Little Rock, what do you check?', '["Check with the mop sink vendor only after the slab is poured","Little Rock''s plumbing sheets; the mop basin is surface-mounted","Nothing; every Braum''s mop basin is recessed the same way as Russellville","That Little Rock gets the same recessed basin as Russellville"]'::jsonb, 'littlerock-7543.md M/P; russellville-7545.md A-104/P', false),
  ('q37', 'braums', 'store-differences', 'Little Rock #7543', 'Hotshot #2 brings Little Rock''s LVT and it''s Daltile Elixen (Exotic Teak), not the Van Gogh Merbau you''ve installed on other Braum''s stores. What do you do?', '["Have the flooring sub buy Van Gogh Merbau instead of the Daltile","Check Little Rock''s A-103; this store is specified with Daltile Elixen","Reject the Daltile shipment and send the Hotshot material back to the OKC warehouse","Install the Daltile in the back rooms only, not the dining area"]'::jsonb, 'overview.md §11 LVT; littlerock-7543.md A-103', false),
  ('q38', 'braums', 'store-differences', 'Little Rock #7543', 'Your electrician did the tower on Longview #7516 with neon perimeter lighting and plans the same on Little Rock. What do you tell him?', '["Skip the tower lighting on Little Rock altogether","Let Braum''s signage crew handle the tower lighting later","Neon is standard on Braum''s towers, so go ahead and install it the same way as Longview","Check Little Rock''s A-201; it shows LED pink perimeter lighting, not neon"]'::jsonb, 'littlerock-7543.md A-201; overview.md §11 Tower lighting', false),
  ('q39', 'braums', 'utilities', 'Conway #7551', 'The Conway civil says to remove the existing 8" waterline "after new line is in service." The utility sub wants to demo the old line first to save a trip. What do you do?', '["No. The new line has to be in service first, as the civil says","Let him demo the existing line first so he can save a trip","Demo half of the old line now and the rest after the new one is live","Have the city decide on the day whether the old line can come out first"]'::jsonb, 'conway-7551.md Civil', false),
  ('q40', 'braums', 'utilities', 'Longview #7516', 'The civil shows Delek Logistics pipelines crossing or bounding the site, with a pipeline easement. Before any digging near them, what do you do?', '["Dig carefully with the excavator since the civil shows the lines","Nothing else is needed if the plans already show the pipeline depth","Hand dig near the easement without calling in a locate","Call 811 and coordinate with the pipeline owner before excavating"]'::jsonb, 'longview-7516-eastman.md Specific to this store; general practice (811)', false),
  ('q41', 'braums', 'site-landscape', 'Longview #7516', 'The landscape plan says a 1:1 slope is "NOT SUITABLE FOR TREE PLANTING – CONCRETE SLOPE WALL." The landscaper wants to plant trees there anyway. You:', '["Let him plant trees on the 1:1 slope even though the plan says it''s not suitable","Lay sod on the 1:1 slope and skip both the wall and the trees","Build the concrete slope wall per L1; no trees on that slope","Plant the trees on that slope and skip the concrete wall"]'::jsonb, 'longview-7516-eastman.md Specific to this store', false),
  ('q42', 'braums', 'utilities', 'Russellville #7545', 'While sawcutting for the ARDOT driveway on Russellville, your sub chips an existing ARDOT structure. Per the civil:', '["Leave the damaged ARDOT structure; it''s their problem to fix later","Sawcut along neat lines and repair any damage as directed by ARDOT","Wait for the final inspection to bring up the damage to the ARDOT structure","Patch the chipped structure with whatever repair material is on site"]'::jsonb, 'russellville-7545.md ARDOT right-of-way work', false),
  ('q43', 'braums', 'paving-concrete', 'Anna #7488', 'The Anna civil (Kimley-Horn) is ready for paving. What does it require from the contractor before the paving is laid out?', '["A light-pole photometric study, but no pavement jointing plan","A pavement jointing plan, with panels no larger than 15''×15''","A paint-color submittal for the parking-lot striping only","Nothing beyond the civil sheets already in the job folder"]'::jsonb, 'anna-7488.md C-200/C-201 paving', false),
  ('q44', 'braums', 'paving-concrete', 'Anna #7488', 'On Anna the fire lane paving is a different mix and rebar spacing than the standard-duty section. The batch ticket for the fire lane pour shows the standard mix. What do you do?', '["Add more rebar and still pour the standard-duty mix in the fire lane","Stop and check C-600; the fire lane uses a stronger mix and tighter rebar","Pour it anyway, since both sections are shown as 6-inch paving on the civil","Pour the standard mix now and test the pavement later"]'::jsonb, 'anna-7488.md C-600 pavement', false),
  ('q45', 'braums', 'paving-concrete', NULL, 'The paving sub wants to use a different joint sealant than Dow 888 because his supplier has it in stock. Under the Crafton paving spec:', '["Fine if it''s the same color","Fine if it''s a polyurethane","No. The spec says Dow 888 with \"NO ALTERNATES\"","Fine if the sub warrants it"]'::jsonb, 'overview.md §11 Paving', false),
  ('q46', 'braums', 'plan-revisions', 'Conway #7551', 'Conway Rev 3 reissued the full electrical set with new sheet numbers (E-101A…E-700). Your electrician is still working off sheets numbered E-001… What do you do?', '["Get him on the current Rev 3 set and pull the old sheets","Have him mix both sets","Let him finish from the old sheets","Wait for the inspector to catch it"]'::jsonb, 'conway-7551.md Revision history', false),
  ('q47', 'braums', 'store-differences', NULL, 'Your electrician''s last Braum''s had the older 18 kW water heater. The new store is a "new generation" set (like Conway Rev3, Russellville or Little Rock). How should he wire WH-1?', '["Leave the water-heater circuit for Braum''s crews to figure out","Wire it the same way as the last store''s 18 kW water heater, without checking this set","Whatever amperage the water heater''s shipping box happens to say","Per this job''s electrical and plumbing sheets; newer sets use a 24 kW WH-1"]'::jsonb, 'overview.md §11 generation split', false),
  ('q48', 'braums', 'plan-revisions', 'Longview #7468', 'The only civil set in the job folder is marked as an interim-review set, not for construction. The dirt sub wants to start grading from it. You:', '["Grade only the parking lot from the interim set, not the building pad","Let him start grading; an interim-review set is close enough to build from","Hold off on grading and get the issued-for-construction civil first","Use the landscape plan for site grades instead of waiting on an issued civil"]'::jsonb, 'longview-7468-westloop.md Civil', false),
  ('q49', 'braums', 'inspections', 'Longview #7468', 'The city''s Final Approved Plan Report says "Notes … must be addressed in field." What do you do with it?', '["Only read the city notes if a later inspection actually fails","File the report and assume the architect is responsible for every city note in it","Hand it to the PM and don''t follow up on the field notes yourself","Read the city''s review notes and handle each one in the field before inspections"]'::jsonb, 'longview-7468-westloop.md Plan-set findings', false),
  ('q50', 'braums', 'plan-conflicts', 'Longview #7530', 'The 7530 drainage sheet says detention is not proposed, but the SWPPP boilerplate still mentions a pond. What do you build?', '["Build half a pond to split the difference between the two documents","Ask the dirt sub to decide whether the site gets a pond","Follow the civil drainage plan (no detention) and get the SWPPP wording confirmed","Build a detention pond anyway so the SWPPP boilerplate is matched, and ignore the civil"]'::jsonb, 'longview-7530.md Drainage', false),
  ('q51', 'braums', 'sub-coordination', 'Tyler', 'On the Tyler job, J2 is moving the existing fire vault and double check and tying in the fire line. Who disconnects and reconnects inside the building?', '["The sprinkler contractor","Braum''s","The electrician","J2"]'::jsonb, 'tyler-relocation.md J2 Construction Services', false),
  ('q52', 'braums', 'safety-fire', 'Tyler', 'On Tyler the fire line will be out of service while the vault is moved, and J2''s scope excludes fire watch. What do you need to do?', '["Nothing; J2 handles fire watch even though their proposal excludes it","Nothing; the building is still standing, so a fire watch isn''t needed","Plan a fire watch with Peyton before the line goes out of service","Tell the store about the fire-line shutdown after the work is already done"]'::jsonb, 'tyler-relocation.md J2 Excludes; general practice', false),
  ('q53', 'braums', 'sub-coordination', 'Tyler', 'KFI is relocating the pylon sign on Tyler. Their scope excludes stone removal at the base and the underground circuit. Before KFI shows up:', '["Make sure another crew is covering the stone removal and the underground circuit","Remove the stone and pull the circuit after the sign has already been reset","KFI will handle the stone and the circuit anyway, even though they excluded them","Leave the stone on and let KFI try to work around the base"]'::jsonb, 'tyler-relocation.md KFI Signs', false),
  ('q54', 'braums', 'change-management', 'Atoka', 'On Atoka, NV is the concrete sub. The GC asks your crew to haul in gravel base. Per NV''s proposal:', '["Gravel is excluded, so flag it to Peyton before doing the extra work","Do the gravel work now and only mention it at the end of the job","Do it because hauling gravel is just part of the concrete scope on this job","Refuse the request and leave the site without telling Peyton"]'::jsonb, 'atoka-ok.md Concrete bid', false),
  ('q55', 'braums', 'geotech-earthwork', NULL, 'The testing lab says an area of the building pad is unsuitable soil. What do you do?', '["Stop, document the lab/geotech recommendation, and tell Peyton before undercutting","Proof-roll the same area again until the lab finally passes it","Cover the unsuitable area with select fill and keep moving without telling Peyton or the lab","Leave the unsuitable soil for the slab sub to deal with later"]'::jsonb, 'overview.md §7 Recurring scope problems #1', false),
  ('q56', 'braums', 'change-management', NULL, 'Mid-job, the city''s utility reviewer requires the sanitary sewer to be upsized with a new manhole. What do you do?', '["Get the revised design in writing, tell Peyton, and don''t install the old size","Install the original size because that''s what''s on the bid plans, and ignore the city","Wait until the final inspection to deal with the city''s sewer comment","Upsize the sewer on your own and don''t tell Peyton or the city"]'::jsonb, 'overview.md §7 #3 City utility comments', false),
  ('q57', 'braums', 'submittals', 'Longview #7516', 'Fire protection is a deferred submittal on the building set. The sprinkler sub wants to start rough-in next week. What do you check first?', '["That the ceiling grid is already in before any sprinkler rough-in starts","That the deferred fire protection submittal is approved before work starts","That the fire alarm system is completely finished before sprinkler rough-in","Nothing; the building permit already covers a deferred fire-protection submittal"]'::jsonb, 'longview-7516-eastman.md G-001 deferred submittals', false),
  ('q58', 'braums', 'inspections', 'Little Rock #7543', 'The plumber sets the floor sink with the indirect waste pipe running down into it. The Little Rock plumbing sheet calls for a 2" air gap at the floor sink. What do you do?', '["Wait for the health inspector to decide whether the air gap matters","Leave it as set; the floor sink drains fine without an air gap","Have him correct it so the required 2-inch air gap is in place","Caulk the gap so the waste pipe looks tight in the floor sink"]'::jsonb, 'littlerock-7543.md M/P', false),
  ('q59', 'braums', 'site-protection', 'Anna #7488', 'The Anna demo plan says the existing fire hydrant and power pole remain. The demo sub''s excavator is working right next to them. What do you do?', '["Protect them and make sure the operator knows they stay","Nothing unless he hits one","Let him remove them; they''re in the way","Have the city move them"]'::jsonb, 'anna-7488.md C-100 demo', false),
  ('q60', 'general', 'daily-reports', NULL, 'It rained out today. Which is the best daily report entry?', '["Just the word \"Rain,\" with no start/stop times, crews sent home, missed work, or photos","Nothing in today''s report, because no work happened once it started raining","Rain start and stop times, crews sent home, work that couldn''t happen, and photos","A short note in next week''s report, after you''ve forgotten the times"]'::jsonb, 'general practice', false),
  ('q61', 'general', 'daily-reports', NULL, 'Why should weather impacts go in the daily report the same day they happen?', '["They don''t matter if you still expect the job to finish on time","Only the PM''s notes count, so the daily report can be written later","They''re the record that backs up time extensions and delay disputes later","The owner never reads daily reports, so a same-day written record isn''t needed"]'::jsonb, 'general practice', false),
  ('q62', 'general', 'inspections', NULL, 'Before you call for a city inspection, what should you do?', '["Let the sub call the inspector whenever he says he''s ready, without walking it yourself","Wait for the inspector to show up, find the problems, and tell you what''s wrong","Walk it yourself and confirm the work is complete and matches the plans","Call the city and hope it passes without walking the work first"]'::jsonb, 'general practice', false),
  ('q63', 'general', 'inspections', NULL, 'The inspector fails the underground plumbing. What''s next?', '["Correct the items and get it re-inspected and passed before covering","Backfill the underground and plan to fix the failed items later","Pour the slab over the failed work and argue with the inspector later","Call a different inspector and hope they pass the same work"]'::jsonb, 'general practice', false),
  ('q64', 'general', 'inspections', NULL, 'The concrete crew wants to pour over the underground plumbing before its inspection, to make the schedule. You:', '["Hold the pour until the inspection passes","Pour half","Take photos and pour","Let them pour; it''s probably fine"]'::jsonb, 'general practice', false),
  ('q65', 'general', 'scheduling', NULL, 'What''s a two-week lookahead mainly used for?', '["Replacing the master schedule with a new baseline every two weeks","Lining up subs, deliveries and inspections for the next two weeks","Tracking last month''s completed work for the closeout book","Billing the owner for work already in place this period"]'::jsonb, 'general practice', false),
  ('q66', 'general', 'scheduling', NULL, 'An activity on the critical path slips 3 days. What happens to the finish date if nothing changes?', '["It moves earlier","Only the next activity is affected","It slips about 3 days unless you recover the time","Nothing; there''s float"]'::jsonb, 'general practice', false),
  ('q67', 'general', 'change-management', NULL, 'The owner''s rep tells you on site to have a sub add work that isn''t in the plans. What do you do?', '["Get it in writing and route it through the PM before the work starts","Ignore the owner''s rep and don''t mention it to the PM","Do the added work now and sort out the paperwork at closeout","Tell the sub to go ahead on the verbal direction alone, with no written change"]'::jsonb, 'general practice', false),
  ('q68', 'general', 'rfis', NULL, 'Two sheets conflict and you''re not sure what to build. What''s the best RFI?', '["A phone call to the architect with no written RFI or record","Just writing \"Plans are wrong, please fix,\" with no sheet references, photos, or proposed answer","Wait, then build whichever conflicting detail is easier in the field","One that cites both sheets, includes photos if helpful, and proposes a solution"]'::jsonb, 'general practice', false),
  ('q69', 'general', 'safety-general', NULL, 'You see a worker on site without a hard hat or safety glasses where they''re required. What do you do?', '["Write it down for the PM later","Ignore it if he''s a sub''s worker","Stop and correct it right away","Mention it at next week''s toolbox talk"]'::jsonb, 'general practice', false),
  ('q70', 'general', 'safety-excavation', NULL, 'When does OSHA require a competent person to inspect an open trench?', '["Daily before work, and after rain or other events that add hazards","Once when the trench is first dug, and not again after that","Weekly, or whenever the superintendent happens to be back on site","Only after a cave-in or some other accident has already happened on the site"]'::jsonb, 'general practice (OSHA 1926.651(k))', false),
  ('q71', 'general', 'safety-excavation', NULL, 'How far back from the trench edge must spoil piles and equipment be kept?', '["Right at the edge is fine if it''s compacted","At least 2 feet","6 inches","It doesn''t matter in clay"]'::jsonb, 'general practice (OSHA 1926.651(j)(2))', false),
  ('q72', 'general', 'safety-excavation', NULL, 'A trench is 4 feet deep or more. What does OSHA require for getting in and out?', '["A ladder, ramp or other way out within 25 feet of lateral travel","Climbing out on the shoring or trench box is good enough for OSHA","Nothing at all as long as the trench is still under 5 feet deep","A rope only, with no ladder or ramp in the trench"]'::jsonb, 'general practice (OSHA 1926.651(c)(2))', false),
  ('q73', 'general', 'safety-electrical', NULL, 'What''s the right setup for extension cords and temporary power on a jobsite?', '["Taped-up cords are fine","GFCI only when it''s raining","Any cord, as long as it reaches","GFCI-protected and inspected for damage"]'::jsonb, 'general practice (OSHA 1926.404)', false),
  ('q74', 'general', 'safety-fire', NULL, 'A sub is about to weld near combustible material. What should happen first?', '["Spray the area with water once and start welding right away","Nothing extra is required if the welding is happening outdoors","Move or shield the combustibles, have an extinguisher, and set a fire watch","Weld as fast as possible so the heat doesn''t have time to spread to the combustibles"]'::jsonb, 'general practice', false),
  ('q75', 'general', 'quality', NULL, 'Before a slab pour, which check matters most?', '["That the pump truck is clean, even if the rebar and barrier aren''t checked","That the finish crew is on time, with no check of embeds or the vapor barrier","That the sub has lunch lined up before anyone checks the forms","Under-slab inspected, rebar/PT and embeds per plan, vapor barrier intact"]'::jsonb, 'general practice', false),
  ('q76', 'general', 'safety-general', NULL, 'A worker has a near miss: a dropped tool barely misses someone below. What do you do?', '["Joke about it and get everyone back to work with no follow-up","Report it, find out why it happened and fix the cause","Fire the worker on the spot and leave it at that, with no review of the cause","Nothing, because nobody got hurt this time"]'::jsonb, 'general practice', false),
  ('q77', 'general', 'safety-general', NULL, 'A worker is injured on site. What comes first?', '["Get them care, secure the scene, then notify the PM/safety and document it","Have them keep working if they can still walk on their own","Wait until the end of the day to tell anyone about the injury","Finish the pour first, then deal with the injured worker after the truck leaves"]'::jsonb, 'general practice', false),
  ('q78', 'general', 'utilities', NULL, 'Before any digging on a site, what has to happen?', '["Call 811 and wait for utilities to be located and marked","Dig slowly and hope you can see any utilities in time","Look for manhole covers and then start digging around them","Ask the neighbor whether they remember any buried lines on the site"]'::jsonb, 'general practice (811)', false),
  ('q79', 'general', 'submittals', NULL, 'A sub shows up with a different product than the approved submittal. What do you do?', '["Install it anyway because it looks the same as the approved product","Install it now and tell the PM about the substitution later","Don''t install it until the substitution is approved in writing","Let the city inspector decide on the spot whether the substitute is fine"]'::jsonb, 'general practice', false),
  ('q80', 'general', 'deliveries', NULL, 'A delivery shows up with a damaged crate. What should you do before signing?', '["Sign the ticket and throw it away so there''s no record of the damage","Refuse to look at the crate or the packing list at all","Sign the ticket now and try to sort out the damage later","Check it against the packing list and note the damage on the ticket"]'::jsonb, 'general practice', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.super_test_answer_keys (question_id, correct_index, explanation) VALUES
  ('q01', 1, 'RTUs and curbs (AAON) are Braum''s-furnished and GC-installed. Ansul, the grease trap and fire alarm are ours to furnish and install.'),
  ('q02', 1, 'Hotshot #1 brings the drive-thru windows, ice-machine condensers, line sets and the MDP. Hotshot #2 is the finishes (tile, vinyl, base, millwork and so on).'),
  ('q03', 2, 'Two sheets disagree on a major item, so get the size confirmed in writing before anything is ordered or set. Conway''s P-002 Rev 3 shows GT-1500 while its civil still shows 1,000 gal.'),
  ('q04', 1, 'The geotech governs the pad, so strip what it requires. Tell Peyton right away so the extra work is handled before it''s done, not after.'),
  ('q05', 1, 'The latest issued civil governs. The 4-30-26 civil shows a detention pond and no underground system.'),
  ('q06', 3, 'Crafton''s standard says randomly cracked panels must be removed and replaced. Sealing or patching isn''t allowed.'),
  ('q07', 1, 'The Support Manual''s lessons learned say install irrigation sleeves as soon as dirt work is done, before paving makes it hard.'),
  ('q08', 1, 'In construction, OSHA requires fall protection at 6 feet or more above a lower level.'),
  ('q09', 2, 'Trenches 5 feet deep or more need a protective system (sloping, shoring or a trench box) unless they''re entirely in stable rock.'),
  ('q10', 2, 'A ladder used to reach an upper landing must extend at least 3 feet above it so workers have something to hold getting on and off.'),
  ('q11', 2, 'On the G-002 matrix the walk-in cooler/freezer and refrigeration condensers are Braum''s-furnished, GC-installed, so we receive, protect and install them.'),
  ('q12', 1, 'Ansul, the grease trap, sprinkler and fire alarm are GC furnish-and-install. Hoods, POS, seating and signage are Braum''s furnish-and-install.'),
  ('q13', 3, 'Hoods and all foodservice/stainless equipment are Braum''s furnish-and-install. Our job is to have the space, rough-ins and access ready.'),
  ('q14', 2, 'Flooring/tile, rubber base and wallpaper are Braum''s-furnished, GC-installed. They come from the OKC warehouse, so don''t let a sub order them.'),
  ('q15', 1, 'Light poles and auto front doors are on the GC furnish-and-install list, so they''re ours to buy, schedule and install.'),
  ('q16', 0, 'Hotshot #2 is the finishes package. Plan dry, secure storage for it; Hotshot #1 is the windows, condensers, line sets and MDP.'),
  ('q17', 2, 'The Support Manual lists the metal canopy, NABCO door install and glass storefront as required shop drawings, so don''t let those trades build before theirs are approved.'),
  ('q18', 2, 'AAON RTUs are a long-lead item on the Braum''s schedule template (along with NABCO doors and interior lighting), so they can drive the dry-in-to-start-up dates.'),
  ('q19', 2, 'The template runs mobilize, then footings, then the tension slab about four weeks later.'),
  ('q20', 1, 'The template goes fire final, then a final walkthrough with Koty, then CO and turnover.'),
  ('q21', 2, 'Every Braum''s set has a PT slab designed by Stresscon. Reprise is the architect, Tanner the landscape designer and Crafton a civil engineer.'),
  ('q22', 0, 'Mechanical openings (exhaust fan, RTU, condenser) go between trusses, and openings over 2 ft o.c. need a prefab girder truss. Never field-cut a truss.'),
  ('q23', 3, 'This exact conflict happened on Clarksville, and the girder truss moved back to clear the MDP cabinet. Catch it before the trusses are built.'),
  ('q24', 1, 'The Support Manual says canopy columns go all the way to the top plate. Make sure the erector has that before fabrication.'),
  ('q25', 2, 'Canopy anchor bolts must be in the canopy bid and mailed to the site. Check they''re there before you form and pour.'),
  ('q26', 3, 'The lessons learned say install the dumpster gate post with the canopy.'),
  ('q27', 1, 'Keep J-bolts, bollards, 6x6 column bases/hangers and the angle iron (curb at the fridge-box unloading area) in the trailer so they don''t walk off or get lost.'),
  ('q28', 2, 'The lessons learned say lower the 2 drive-thru-side windows of the glass mural to the height of window #2, because of the glass mirror.'),
  ('q29', 0, 'The MEP general note says an unresolved discrepancy means including the most work, with no extra compensation later. That''s why RFIs go in before bid day.'),
  ('q30', 0, 'A lot mismatch between the geotech and the civil is a listed conflict to RFI. Get it confirmed in writing rather than assume.'),
  ('q31', 3, 'A store sheet that differs from every other set is a conflict to confirm before you build. Don''t pick one yourself.'),
  ('q32', 0, 'On several stores the foundation design wasn''t tied to a geotech report at permit, which is a CO and redesign risk. Get the depth confirmed before the pad goes in.'),
  ('q33', 0, 'The Little Rock geotech says to plan on dewatering outside the June–September window. Raise it early so it''s planned, not a surprise.'),
  ('q34', 0, 'Rock is defined by the equipment that can''t remove it. Verify against that definition and document it before anything is agreed.'),
  ('q35', 1, 'The electrical sheet calls for a clear zone between the reinforcement and the drive-thru loop sensor. Check it before the pour, because it can''t be fixed after.'),
  ('q36', 1, 'Little Rock''s mop basin is surface-mounted while Russellville''s is recessed. Don''t carry one store''s details to the next without checking.'),
  ('q37', 1, 'Little Rock is the only store not on Van Gogh Merbau. Check the store''s own finish plan before rejecting owner-furnished material.'),
  ('q38', 3, '7516 shows neon but Little Rock shows LED pink. Build each store from its own elevations.'),
  ('q39', 0, 'The civil sequence keeps water service running: new line in service, then remove the old one.'),
  ('q40', 3, 'Pipelines in an easement need locates and coordination with the operator before anyone digs. Plan depths aren''t enough.'),
  ('q41', 2, 'L1 calls that slope a concrete slope wall, not a planting area. Build what the sheet shows.'),
  ('q42', 1, 'The civil says sawcut ARDOT structures along neat lines and repair any damage as directed by ARDOT. Report it and get ARDOT''s direction.'),
  ('q43', 1, 'The Anna civil requires the contractor to submit a pavement jointing plan. Get it approved before forming.'),
  ('q44', 1, 'C-600 calls out a stronger mix and tighter rebar for the fire lane than standard-duty. Don''t place the wrong mix.'),
  ('q45', 2, 'Crafton''s paving standard says Dow 888 sealant with no alternates. A substitute needs written approval, and the spec says none.'),
  ('q46', 0, 'Rev 3 replaced the whole electrical set, so the old-numbered sheets are superseded. Everyone builds from the current revision.'),
  ('q47', 3, 'The generation split changes WH-1 (24 kW on the new sets vs 18 kW on the old), so the circuit differs. Build from this store''s sheets.'),
  ('q48', 2, 'Never build from a set marked not for construction. Get the issued civil first.'),
  ('q49', 3, 'The city told us those notes are ours to handle in the field, so the inspector will look for them.'),
  ('q50', 2, 'The civil drainage design governs what gets built. The SWPPP text is boilerplate that should be confirmed or corrected.'),
  ('q51', 0, 'J2''s proposal says the sprinkler contractor must disconnect and reconnect inside the building, so schedule them together.'),
  ('q52', 2, 'An impaired fire system needs a fire watch, and J2 excluded it. Someone has to cover it before the shutdown.'),
  ('q53', 0, 'Exclusions are scope gaps. Cover them with another crew before the sub mobilizes, or KFI shows up to a sign it can''t move.'),
  ('q54', 0, 'The proposal excludes surveying, dirt work, underground utilities and gravel. Extra work gets agreed through Peyton first.'),
  ('q55', 0, 'Unsuitable soil and undercut are a recurring Braum''s change. Document it and get it handled through Peyton before the work is done.'),
  ('q56', 0, 'City utility comments are a recurring source of Braum''s changes (7516 upsized its sewer to 8" with a manhole). Get it documented before building.'),
  ('q57', 1, 'A deferred submittal still has to be approved before that work is built, or it can fail inspection.'),
  ('q58', 2, 'The sheet calls for an air gap at the floor sink, so a pipe into the sink is wrong. Fix it before inspection.'),
  ('q59', 0, 'Items marked to remain are ours to protect. Damage turns into delay and repair work.'),
  ('q60', 2, 'Specific, same-day weather records back up weather-day time extensions and delay claims.'),
  ('q61', 2, 'Daily reports written at the time are the evidence for weather days and disputes. Memories months later aren''t.'),
  ('q62', 2, 'A pre-inspection walk catches problems before they become failed inspections and lost days.'),
  ('q63', 0, 'Failed work stays exposed until it''s corrected and passes re-inspection.'),
  ('q64', 0, 'Covering uninspected work can force tear-out. Hold until it passes.'),
  ('q65', 1, 'A short-interval lookahead turns the master schedule into what each crew needs to do, and when, over the next two weeks.'),
  ('q66', 2, 'Critical-path activities have no float, so any delay pushes the finish unless you recover it.'),
  ('q67', 0, 'Verbal scope changes need documentation and PM approval first, or they turn into unpaid work and disputes.'),
  ('q68', 3, 'A clear RFI with references and a proposed answer gets a faster, documented response.'),
  ('q69', 2, 'PPE problems get fixed on the spot. The super owns site safety for everyone, including subs'' crews.'),
  ('q70', 0, 'Excavations are inspected by a competent person daily before work starts and after rain or anything else that changes conditions.'),
  ('q71', 1, 'OSHA requires spoil and equipment to be kept at least 2 feet from the edge of an excavation, or retained.'),
  ('q72', 0, 'Trenches 4 feet or deeper need a means of egress within 25 feet of lateral travel for workers.'),
  ('q73', 3, 'Construction temporary power needs GFCI protection, and damaged cords come out of service.'),
  ('q74', 2, 'Hot work needs combustibles cleared or protected, an extinguisher on hand and someone watching for fire.'),
  ('q75', 3, 'Once concrete is placed, what''s under and in it can''t be fixed cheaply, so check it before the trucks come.'),
  ('q76', 1, 'Near misses show you hazards before someone gets hurt. Fix the cause.'),
  ('q77', 0, 'Care first, then secure the area, notify right away and document it while it''s fresh.'),
  ('q78', 0, 'Locates come first. Digging without them risks strikes, injuries and outages.'),
  ('q79', 2, 'Only approved products get installed. Substitutions go back through the PM for approval.'),
  ('q80', 3, 'Damage noted on the ticket at delivery is what makes a claim possible. A clean signature makes it hard.')
ON CONFLICT (question_id) DO NOTHING;
-- END GENERATED SEED

COMMIT;
