-- Migration 053: itemized owner payments on AIA pay apps (prompt 58, item 1).
--
-- STATUS: PROPOSED — written, NOT applied. Does not depend on 042 or 044–052
-- being applied.
--
-- What this does (additive; safe to re-run):
--   1. New table aia_payment_entries: one row per check / wire the client
--      owner pays NV against an aia_applications row (amount, received_on,
--      reference). Entries are voided (voided_at / voided_by / void_reason),
--      never deleted, so an earlier payment's date is never wiped.
--      RLS is ENABLED with NO policies: only the service role (the
--      /api/aia-payments route, Owner + PM only) can read or write it.
--   2. Backfill: every app that already has amount_received > 0 and no
--      entries gets one "Recorded before itemized payments" entry with that
--      amount and the date part of payment_received_at, so the synced total
--      below equals what was stored before. Apps marked payment_received with
--      no amount are left alone (the cash outlook keeps flagging them).
--   3. Sync trigger: after any insert/update on aia_payment_entries the
--      summary columns on aia_applications are recomputed from the live
--      (non-voided) entries — amount_received = sum (NULL when 0),
--      payment_received = sum > 0, payment_received_at = latest received_on
--      at 12:00 UTC. Keeps them consistent if a write ever bypasses the
--      record / void functions below.
--   5. record_aia_payment / void_aia_payment (SECURITY DEFINER, service_role
--      only): lock the aia_applications row, carry over a legacy single
--      payment, refuse drafts and a stale expected total, write the entry,
--      and recalculate the summary from the live ledger — all in one
--      transaction. /api/aia-payments calls only these to write.
--   4. Guard trigger on aia_applications: browser (authenticated) sessions
--      may no longer set payment_received / amount_received /
--      payment_received_at. Office roles keep 038's FOR ALL policy for every
--      other column. Only service_role / postgres / supabase_admin (the
--      route, the sync trigger, migrations) can change those three columns.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS aia_applications_payment_columns_guard ON public.aia_applications;
--   DROP FUNCTION IF EXISTS public.guard_aia_payment_columns();
--   DROP TRIGGER IF EXISTS aia_payment_entries_sync ON public.aia_payment_entries;
--   DROP FUNCTION IF EXISTS public.sync_aia_payment_summary();
--   DROP TABLE IF EXISTS public.aia_payment_entries;
--   (aia_applications summary columns keep their last synced values.)

BEGIN;

-- ── 1. Table ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.aia_payment_entries (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   uuid        NOT NULL REFERENCES public.aia_applications(id) ON DELETE CASCADE,
  job_id           uuid        REFERENCES public.jobs(id) ON DELETE CASCADE,
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  received_on      date,
  reference        text        CHECK (reference IS NULL OR char_length(reference) <= 120),
  recorded_by      uuid,
  recorded_by_name text,
  voided_at        timestamptz,
  voided_by        uuid,
  voided_by_name   text,
  void_reason      text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aia_payment_entries_app_idx ON public.aia_payment_entries (application_id);
CREATE INDEX IF NOT EXISTS aia_payment_entries_job_idx ON public.aia_payment_entries (job_id, received_on);

ALTER TABLE public.aia_payment_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aia_payment_entries FROM anon, authenticated;
-- No policies on purpose: service role only.

COMMENT ON TABLE public.aia_payment_entries IS 'PROPOSED (053): itemized client-owner payments on AIA pay apps. Written only by /api/aia-payments (service role). aia_applications.amount_received / payment_received / payment_received_at are a synced summary of the non-voided rows.';

-- ── 2. Backfill existing single payments ─────────────────────────────────────
INSERT INTO public.aia_payment_entries (application_id, job_id, amount, received_on, reference)
SELECT a.id, a.job_id, round(a.amount_received::numeric, 2), (a.payment_received_at AT TIME ZONE 'America/Chicago')::date,
       'Recorded before itemized payments'
  FROM public.aia_applications a
 WHERE coalesce(a.amount_received, 0) > 0
   AND NOT EXISTS (SELECT 1 FROM public.aia_payment_entries e WHERE e.application_id = a.id);

-- ── 4 (defined first). Guard: only trusted roles change the summary columns ──
CREATE OR REPLACE FUNCTION public.guard_aia_payment_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF coalesce(NEW.payment_received, false) OR NEW.amount_received IS NOT NULL OR NEW.payment_received_at IS NOT NULL THEN
      RAISE EXCEPTION 'aia_payment_server_only: owner payments are recorded through the app (Record Payment)'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.payment_received IS DISTINCT FROM OLD.payment_received
     OR NEW.amount_received IS DISTINCT FROM OLD.amount_received
     OR NEW.payment_received_at IS DISTINCT FROM OLD.payment_received_at THEN
    RAISE EXCEPTION 'aia_payment_server_only: owner payments are recorded through the app (Record Payment)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION public.guard_aia_payment_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS aia_applications_payment_columns_guard ON public.aia_applications;
CREATE TRIGGER aia_applications_payment_columns_guard
  BEFORE INSERT OR UPDATE ON public.aia_applications
  FOR EACH ROW EXECUTE FUNCTION public.guard_aia_payment_columns();

-- ── 3. Sync summary columns from live entries ────────────────────────────────
-- SECURITY DEFINER so the update runs as the owner (passes the guard above).
CREATE OR REPLACE FUNCTION public.sync_aia_payment_summary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app uuid := coalesce(NEW.application_id, OLD.application_id);
  v_total numeric;
  v_latest date;
BEGIN
  SELECT coalesce(sum(amount), 0), max(received_on) INTO v_total, v_latest
    FROM public.aia_payment_entries
   WHERE application_id = v_app AND voided_at IS NULL;
  UPDATE public.aia_applications
     SET amount_received     = CASE WHEN v_total > 0 THEN v_total END,
         payment_received    = v_total > 0,
         payment_received_at = CASE WHEN v_total > 0 AND v_latest IS NOT NULL THEN (v_latest::timestamp + interval '12 hours') AT TIME ZONE 'UTC' END
   WHERE id = v_app;
  RETURN NULL;
END
$$;

REVOKE EXECUTE ON FUNCTION public.sync_aia_payment_summary() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS aia_payment_entries_sync ON public.aia_payment_entries;
CREATE TRIGGER aia_payment_entries_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.aia_payment_entries
  FOR EACH ROW EXECUTE FUNCTION public.sync_aia_payment_summary();

-- Re-sync the backfilled apps once (same values; makes payment_received_at
-- noon-of-date so the route and trigger agree).
UPDATE public.aia_payment_entries SET reference = reference
 WHERE reference = 'Recorded before itemized payments' AND voided_at IS NULL;

-- ── 5. Atomic record / void (called by /api/aia-payments) ───────────────────
-- Each call is ONE transaction that locks the aia_applications row
-- (SELECT … FOR UPDATE), so two payments / voids on the same app are
-- serialized. The summary columns are recalculated from the live ledger
-- inside that same transaction (aia_payment_recalc below; the AFTER trigger
-- computes the same values). The route never writes amount_received /
-- payment_received / payment_received_at itself.
--
-- Errors (message tokens the route maps):
--   aia_payment_not_found        app / entry does not exist
--   aia_payment_draft            app is not submitted / certified
--   aia_payment_ledger_changed   live total ≠ p_expected_received (someone
--                                else recorded or voided first; nothing written)
--   aia_payment_already_voided   entry already voided
--
-- Rollback (in addition to the list at the top):
--   DROP FUNCTION IF EXISTS public.record_aia_payment(uuid, numeric, date, text, uuid, text, numeric);
--   DROP FUNCTION IF EXISTS public.void_aia_payment(uuid, uuid, text, text);
--   DROP FUNCTION IF EXISTS public.aia_payment_recalc(uuid);

-- Recalculate and store the summary for one app from its live entries.
-- Returns the stored values. Caller must already hold the app row lock.
CREATE OR REPLACE FUNCTION public.aia_payment_recalc(p_application_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total  numeric;
  v_latest date;
  v_app    public.aia_applications%ROWTYPE;
BEGIN
  SELECT coalesce(sum(amount), 0), max(received_on) INTO v_total, v_latest
    FROM public.aia_payment_entries
   WHERE application_id = p_application_id AND voided_at IS NULL;
  UPDATE public.aia_applications
     SET amount_received     = CASE WHEN v_total > 0 THEN v_total END,
         payment_received    = v_total > 0,
         payment_received_at = CASE WHEN v_total > 0 AND v_latest IS NOT NULL THEN (v_latest::timestamp + interval '12 hours') AT TIME ZONE 'UTC' END
   WHERE id = p_application_id
  RETURNING * INTO v_app;
  RETURN jsonb_build_object(
    'total',               v_total,
    'amount_received',     v_app.amount_received,
    'payment_received',    coalesce(v_app.payment_received, false),
    'payment_received_at', v_app.payment_received_at
  );
END
$$;

REVOKE EXECUTE ON FUNCTION public.aia_payment_recalc(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_aia_payment(
  p_application_id    uuid,
  p_amount            numeric,
  p_received_on       date,
  p_reference         text,
  p_recorded_by       uuid,
  p_recorded_by_name  text,
  p_expected_received numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app      public.aia_applications%ROWTYPE;
  v_live     numeric;
  v_entry    public.aia_payment_entries%ROWTYPE;
  v_summary  jsonb;
BEGIN
  -- 1. Lock the parent app: every record / void on it waits here.
  SELECT * INTO v_app FROM public.aia_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'aia_payment_not_found: pay app % not found', p_application_id USING ERRCODE = 'P0002';
  END IF;
  IF coalesce(v_app.status, '') NOT IN ('submitted', 'certified') THEN
    RAISE EXCEPTION 'aia_payment_draft: payments can only be recorded on a submitted or certified application' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'aia_payment_invalid_amount: amount must be more than 0' USING ERRCODE = '22023';
  END IF;

  -- 2. Legacy carry-over: no entries yet but a pre-053 single amount on the
  --    app → insert it first (same row the backfill / legacySeedEntry makes).
  IF NOT EXISTS (SELECT 1 FROM public.aia_payment_entries WHERE application_id = v_app.id)
     AND coalesce(v_app.amount_received, 0) > 0 THEN
    INSERT INTO public.aia_payment_entries (application_id, job_id, amount, received_on, reference)
    VALUES (v_app.id, v_app.job_id, round(v_app.amount_received::numeric, 2),
            (v_app.payment_received_at AT TIME ZONE 'America/Chicago')::date,
            'Recorded before itemized payments');
  END IF;

  -- 3. The caller computed "remaining" from p_expected_received. If the live
  --    ledger moved since then, refuse (the whole transaction rolls back,
  --    including any carry-over row above).
  SELECT coalesce(sum(amount), 0) INTO v_live
    FROM public.aia_payment_entries
   WHERE application_id = v_app.id AND voided_at IS NULL;
  IF p_expected_received IS NULL OR abs(v_live - p_expected_received) > 0.005 THEN
    RAISE EXCEPTION 'aia_payment_ledger_changed: live total % differs from expected %', v_live, p_expected_received
      USING ERRCODE = '40001';
  END IF;

  -- 4. Insert the new entry.
  INSERT INTO public.aia_payment_entries
    (application_id, job_id, amount, received_on, reference, recorded_by, recorded_by_name)
  VALUES
    (v_app.id, v_app.job_id, round(p_amount, 2), p_received_on, nullif(trim(p_reference), ''), p_recorded_by, p_recorded_by_name)
  RETURNING * INTO v_entry;

  -- 5. Summary from the live ledger, same transaction, still under the lock.
  v_summary := public.aia_payment_recalc(v_app.id);
  RETURN v_summary || jsonb_build_object('previous_total', v_live, 'entry', to_jsonb(v_entry));
END
$$;

CREATE OR REPLACE FUNCTION public.void_aia_payment(
  p_entry_id       uuid,
  p_voided_by      uuid,
  p_voided_by_name text,
  p_reason         text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app_id  uuid;
  v_entry   public.aia_payment_entries%ROWTYPE;
  v_prev    numeric;
BEGIN
  SELECT application_id INTO v_app_id FROM public.aia_payment_entries WHERE id = p_entry_id;
  IF v_app_id IS NULL THEN
    RAISE EXCEPTION 'aia_payment_not_found: payment % not found', p_entry_id USING ERRCODE = 'P0002';
  END IF;
  -- Lock the parent app first (same order as record_aia_payment), then the entry.
  PERFORM 1 FROM public.aia_applications WHERE id = v_app_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'aia_payment_not_found: pay app % not found', v_app_id USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_entry FROM public.aia_payment_entries WHERE id = p_entry_id FOR UPDATE;
  IF v_entry.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'aia_payment_already_voided: payment % is already voided', p_entry_id USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'aia_payment_void_reason_required: say why this payment is being voided' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(sum(amount), 0) INTO v_prev
    FROM public.aia_payment_entries
   WHERE application_id = v_app_id AND voided_at IS NULL;

  UPDATE public.aia_payment_entries
     SET voided_at = now(), voided_by = p_voided_by, voided_by_name = p_voided_by_name,
         void_reason = left(trim(p_reason), 200)
   WHERE id = p_entry_id;

  RETURN public.aia_payment_recalc(v_app_id) || jsonb_build_object('previous_total', v_prev);
END
$$;

REVOKE EXECUTE ON FUNCTION public.record_aia_payment(uuid, numeric, date, text, uuid, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.void_aia_payment(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_aia_payment(uuid, numeric, date, text, uuid, text, numeric) TO service_role;
GRANT  EXECUTE ON FUNCTION public.void_aia_payment(uuid, uuid, text, text) TO service_role;

COMMIT;
