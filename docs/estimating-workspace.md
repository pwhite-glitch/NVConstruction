# Estimating workspace

## What changed

- Estimating navigation now stays above all section content, with Quick estimates as the default.
- Bid packages open as a single workspace with Plans, Scope, Sub quotes, Compare & price, and Proposal & handoff sections.
- Existing uploads, templates, invitations, quote entry, comparison, award, document generation, and job conversion handlers remain in use.
- Scope items can be edited, linked to an uploaded source, annotated with page/sheet/revision, and saved as draft, question, or reviewed.
- Review annotations are manual estimator records, not electronic signatures or a server-verified audit trail.
- Local AI is explicitly not connected. The new workspace makes no AI requests and has no paid fallback. The pre-existing residential estimate parser is outside this feature's scope and must be handled by the separate cost/security repair.

## Rollout

1. Merge/reconcile the ongoing authorization repairs first. This UI does not repair the previously identified database policies or server routes.
2. Review and apply `supabase/migrations/202609160001_scope_review.sql` in a non-production environment. It only adds a JSON annotation column and a shape check; it does not grant access.
3. Verify staff role/job access to bid packages and their scope items using the repaired policies.
4. Test the workspace against representative test packages and estimates, then deploy after approval. Saving annotations before the migration shows an error and keeps edits available.
5. Roll back the UI if necessary; preserve the additive column to avoid losing review notes.

## Mac mini phase

No local model or worker is connected yet. The future worker should pull authorized drawing-analysis jobs through an authenticated outbound connection, process files locally, and return proposed scope with document version/page references. It must never receive broad database administrator credentials or fall back to a paid provider. Keep proposed items separate until an estimator accepts them. Use durable jobs and progress states so the website does not wait on a long model call. Revisions should create a change review, never overwrite approved wording.

## Acceptance checks

- Open quick estimates, bid packages, pipeline, and archive; top navigation remains accessible.
- Open a package and switch all five sections; previous workflows and values remain available.
- Upload/open a test plan; add a manual scope item or template; save wording, question, source/page/revision; reload and check persistence.
- Check rejected/failed saves preserve edits and successful saves refresh readiness counts.
- Compare multiple quotes and confirm existing amounts and inclusion behavior remain unchanged.
- Use keyboard controls and narrow/mobile layouts.
- Confirm the AI control is disabled and no AI network request occurs.
- Check authorization with test PM/APM accounts and a different company's subcontractor, independently of the visible controls.

## Validation completed

- Next.js production compilation, type/lint stage, and all 86 static pages passed using dummy localhost service credentials.
- Windows blocked Next's subprocess build worker (spawn EPERM). Verification used a temporary configuration with webpackBuildWorker disabled and workerThreads enabled; the original configuration was restored unchanged.
- Run node scripts/verify-estimating.cjs from the repository root after installing dependencies. Six server-rendering checks passed: counts, loading controls, error/retry state, empty state/disabled AI, saved review fields, and missing source warning.
- Visually inspected the rendered scope workspace with synthetic data in a local browser. This is not a live Supabase integration test.
- Database migration, persisted saves, multi-user permissions, uploads, invitations, and financial workflows still require staging acceptance testing. No migration or deployment was performed.
