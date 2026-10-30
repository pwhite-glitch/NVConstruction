# Bot API

A small, scoped server API for the portal bots ("Portal Bot (Peyton)", "(Nishil)", "(Vivek)"). Each bot has its own key. Every change is recorded in history under the bot's name with the note "via Bot API".

- **Base URL:** `https://portal.nv.construction/api/bot/v1`
- **Auth:** `Authorization: Bearer nvb_<key>`. Partners generate, rotate, turn off and revoke keys on **/admin → Bot Access**. A key is shown once, when it's created.
- **Format:** JSON in, JSON out. Errors are `{ "error": "..." }` with a 4xx/5xx status.
- **Permissions:** a bot acts as an office user (role `pm`), and database row-level security applies to every read and write.
- **Rate limit:** 120 requests per minute per key. Over the limit you get `429` with a `Retry-After` header.
- **Pagination:** list endpoints take `limit` (default 50, max 200) and `offset`, and return `next_offset` (`null` on the last page).

| Status | Meaning |
|---|---|
| 400 | Invalid input, or a field that isn't allowed |
| 401 | Missing, wrong, disabled or revoked key |
| 403 | Action not available through the Bot API |
| 404 | Unknown endpoint or record |
| 413 | Attachment too large |
| 429 | Rate limited |
| 503 | Server not configured (`SUPABASE_JWT_SECRET`) |

## Refused

These are not built. Any of them returns `403`:

- Any `DELETE` (and `PUT` / `PATCH`)
- Approvals, and status changes to approved / executed
- Adding billings to draws
- Anything that sends email, notifications or e-signature requests, including notify-sub and Send to subs

Use the portal for these.

---

## GET /

Lists the endpoints this bot can call.

```bash
curl -H "Authorization: Bearer $NVB_KEY" https://portal.nv.construction/api/bot/v1
```
```json
{
  "bot": { "id": "5b1e…", "name": "Portal Bot (Peyton)" },
  "base_url": "/api/bot/v1",
  "endpoints": [{ "method": "GET", "path": "/api/bot/v1/jobs", "description": "Jobs. ?q=search &limit= &offset=" }],
  "refused": ["Any DELETE", "…"]
}
```

## GET /jobs

Optional `q` searches the job number and project name. Newest jobs first.

```bash
curl -H "Authorization: Bearer $NVB_KEY" "https://portal.nv.construction/api/bot/v1/jobs?q=7545&limit=20"
```
```json
{ "data": [{ "id": "8c2f…", "job_number": "7545", "project_name": "Harbor Retail", "status": "active" }], "next_offset": null }
```

## GET /jobs/{id}

One job, with its budget lines.

```bash
curl -H "Authorization: Bearer $NVB_KEY" https://portal.nv.construction/api/bot/v1/jobs/8c2f…
```
```json
{ "data": { "id": "8c2f…", "job_number": "7545", "project_name": "Harbor Retail",
  "budget_lines": [{ "id": "b1…", "cost_code": "04-200", "description": "Masonry", "budget_amount": 30000, "owner_amount": 33000 }] } }
```

## GET /budgets?job_id=

Budget lines for a job, with totals.

```bash
curl -H "Authorization: Bearer $NVB_KEY" "https://portal.nv.construction/api/bot/v1/budgets?job_id=8c2f…"
```
```json
{ "data": [{ "id": "b1…", "cost_code": "04-200", "description": "Masonry", "budget_amount": 30000 }],
  "totals": { "budget_amount": 30000, "owner_amount": 33000 } }
```

## GET /contracts?job_id=

Subcontracts on the job, each with its schedule of values (`sov_lines`).

```bash
curl -H "Authorization: Bearer $NVB_KEY" "https://portal.nv.construction/api/bot/v1/contracts?job_id=8c2f…"
```
```json
{ "data": [{ "id": "c1…", "vendor_name": "J&J Masonry", "contract_value": 25350, "status": "active", "retainage_pct": 10,
  "sov_lines": [{ "id": "l1…", "description": "Block walls", "amount": 25350, "budget_item_id": "b1…" }] }] }
```

## GET /change-orders?job_id=

Sub change orders (`sub_change_orders`, each with its subcontract) and prime (owner) change orders (`prime_change_orders`).

```bash
curl -H "Authorization: Bearer $NVB_KEY" "https://portal.nv.construction/api/bot/v1/change-orders?job_id=8c2f…"
```
```json
{ "sub_change_orders": [{ "id": "co1…", "description": "Extra lintel", "amount": 1200, "status": "pending",
    "subcontracts": { "id": "c1…", "job_id": "8c2f…", "vendor_name": "J&J Masonry" } }],
  "prime_change_orders": [] }
```

## GET /billings?job_id=

Billings on a job, newest first. Takes `limit` and `offset`.

```bash
curl -H "Authorization: Bearer $NVB_KEY" "https://portal.nv.construction/api/bot/v1/billings?job_id=8c2f…&limit=50"
```
```json
{ "data": [{ "id": "bs1…", "company_name": "J&J Masonry", "amount_billed": 12000, "status": "pending", "draw_request_id": null }],
  "next_offset": null }
```

## POST /subcontracts

Creates a subcontract. `status` is `draft` (the default, hidden from the sub) or `active`. Nothing is emailed or sent for signature.

| Field | Required | Notes |
|---|---|---|
| `job_id` | yes | |
| `company_id` or `vendor_name` | one of them | `vendor_name` defaults to the company's name |
| `contract_value` | yes | number ≥ 0 |
| `status` | | `draft` or `active` only |
| `retainage_pct` | | 0–100, default 10 |
| `budget_item_id` | | one budget line on this job |
| `budget_allocations` | | `[{ "budget_item_id", "amount" }]` to split across budget lines on this job |
| `sub_id`, `description`, `onedrive_url`, `start_date`, `special_terms` | | |

Any other field returns `400`.

```bash
curl -X POST -H "Authorization: Bearer $NVB_KEY" -H "Content-Type: application/json" \
  https://portal.nv.construction/api/bot/v1/subcontracts \
  -d '{"job_id":"8c2f…","company_id":"co9…","contract_value":25350,"status":"draft",
       "budget_allocations":[{"budget_item_id":"b1…","amount":25350}]}'
```
```json
{ "ok": true, "id": "c1…", "status": "draft" }
```

## POST /job-companies

Puts a company on a job. This does the same as the Companies tab's "add company": billing stays off unless the company already has billing on for this job, and no email is sent. Calling it again is safe.

```bash
curl -X POST -H "Authorization: Bearer $NVB_KEY" -H "Content-Type: application/json" \
  https://portal.nv.construction/api/bot/v1/job-companies -d '{"job_id":"8c2f…","company_id":"co9…"}'
```
```json
{ "ok": true, "id": "ja1…", "billing_enabled": false }
```
If the company is already on the job: `{ "ok": true, "already_assigned": true }`.

## POST /billings

Creates a billing with status `pending`. It can't be put on a draw: any field with "draw" in its name (`draw_request_id`, …) returns `400`. `status` other than `pending` also returns `400`.

Allowed fields: `job_id` (required), `amount_billed` (required), `sub_id`, `company_name`, `contact_name`, `contact_info`, `retainage_pct`, `retainage_held`, `pct_complete`, `work_description`, `invoice_number`, `invoice_date`, `notes`, `billing_period`.

```bash
curl -X POST -H "Authorization: Bearer $NVB_KEY" -H "Content-Type: application/json" \
  https://portal.nv.construction/api/bot/v1/billings \
  -d '{"job_id":"8c2f…","company_name":"J&J Masonry","amount_billed":12000,"retainage_held":1200,
       "invoice_number":"INV-1042","invoice_date":"2026-10-20","billing_period":"2026-10-01"}'
```
```json
{ "ok": true, "id": "bs1…" }
```

## POST /attachments

Uploads a job document. It is stored in the same place as the job page's Documents section. Send `multipart/form-data` with the fields `file`, `job_id` and `category`. `category` is one of `plans`, `geotech`, `permits`, `specs` or `other` (the default). The maximum size is **4 MB**.

```bash
curl -X POST -H "Authorization: Bearer $NVB_KEY" \
  -F job_id=8c2f… -F category=plans -F file=@"Plans Rev 3.pdf" \
  https://portal.nv.construction/api/bot/v1/attachments
```
```json
{ "ok": true, "id": "d1…", "storage_path": "8c2f…/plans/1761840000000-Plans Rev 3.pdf" }
```

---

## Setup (once)

1. Apply `migrations/036_bot_api_keys.sql`. Run `scripts/bot-api-audit.sql` blocks 1–3 first.
2. Set `SUPABASE_JWT_SECRET` on the server. This is the project's **legacy JWT secret**, from Supabase → Project Settings → JWT Keys (older dashboards: API → JWT Settings).
3. Run `node --env-file=.env.local scripts/create-bot-users.js`.
4. On /admin → Bot Access, generate a key for each bot.

### How a request is authorised

The server hashes the key (sha256) and looks the hash up in `bot_api_keys`; the raw key is never stored. This lookup and the `last_used_at` stamp are the only steps that use the service role. The server then signs a 5-minute Supabase access token for the bot user (HS256, signed with `SUPABASE_JWT_SECRET`). All reads and writes go through a client that uses that token, so row-level security applies as it would for a signed-in user.

Bot users can't sign in to the portal. The auth server bans password sign-in for them, /login signs them out, and the normal `/api` routes refuse them.
