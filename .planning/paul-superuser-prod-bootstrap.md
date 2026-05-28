# Paul superuser — prod bootstrap runbook

After the PR for this branch merges and Render finishes its auto-deploy, run these steps in **prod** to flip Paul into superuser mode.

## Step 1 — Verify prod schema has the new columns

```sql
-- gpnet_only column on organizations
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'organizations' AND column_name = 'gpnet_only';

-- imap_mailbox_state table (only matters if you're also activating the IMAP poller)
SELECT to_regclass('public.imap_mailbox_state');
```

**Expected:** both queries return a row. If either is empty, Render's deploy did NOT run `npm run db:push` — apply it manually:

```sql
ALTER TABLE organizations ADD COLUMN gpnet_only boolean DEFAULT false NOT NULL;

CREATE TABLE imap_mailbox_state (
  mailbox       varchar PRIMARY KEY NOT NULL,
  uid_validity  bigint NOT NULL,
  last_seen_uid bigint NOT NULL,
  last_polled_at timestamp,
  last_error_at  timestamp,
  last_error    text,
  created_at    timestamp DEFAULT now() NOT NULL,
  updated_at    timestamp DEFAULT now() NOT NULL
);
```

## Step 2 — Verify Paul's user exists in prod

```sql
SELECT id, email, role, organization_id
  FROM users
  WHERE email = 'paul.hopcraft@gmail.com';
```

**Expected:** one row, `role = 'admin'`, an `organization_id` value.

If missing, register via the normal signup flow at app.preventli.ai or invite via `/api/auth/register` — don't seed by hand unless you understand the password-hash format.

## Step 3 — Note Paul's home org id

```sql
SELECT o.id, o.name, o.slug, o.gpnet_only
  FROM organizations o
  WHERE o.id = (SELECT organization_id FROM users WHERE email = 'paul.hopcraft@gmail.com');
```

Save the `id`. This is **Paul's home org**, and turning its `gpnet_only` ON is what flips Paul into superuser/GPNet-side-admin mode.

## Step 4 — Bootstrap: flip Paul's home org to gpnet_only=true

```sql
UPDATE organizations
  SET gpnet_only = true
  WHERE id = '<paul-home-org-id-from-step-3>';
```

**Expected:** `UPDATE 1`.

After this, every login by Paul resolves `homeOrgIsGpnetOnly=true`, which:
- Sees every org regardless of `gpnet_only` (the storage-layer curtain skips him)
- Sees the gpnetOnly Switch on `/admin/companies/new` and `/admin/companies/:id`
- Creates new orgs that default to `gpnet_only=true` (the new server-side default)
- Can flip `gpnet_only` on any existing org (visible→hidden or hidden→visible)

## Step 5 — E2E smoke test (5 min)

1. **Logout, log back in as Paul.** Visit `/api/auth/me` in the browser — confirm `user.homeOrgIsGpnetOnly === true`.
2. **Go to `/admin/companies/new`.** Fill in a test org (e.g. `gpnet-pilot-test`). Confirm the `GPNet-Only Visibility` switch is rendered AND pre-toggled to ON. Submit.
3. **Open the new org in the list.** Confirm `gpnetOnly = true` on the row.
4. **Logout, log in as a Preventli-side admin** (e.g. Lisa's account). Visit `/admin/companies`. The new `gpnet-pilot-test` org should be **absent** from the list. Visit `/admin/companies/<test-org-id>` directly — should 404.
5. **Logout, log back in as Paul.** Edit `gpnet-pilot-test`, flip the switch OFF. Save.
6. **Log back in as Lisa.** Refresh `/admin/companies`. The org should now **appear** in her list.

If any of those 6 steps fail, capture the failing request/response and check:
- `homeOrgIsGpnetOnly` on `/api/auth/me`
- The actual DB value of `organizations.gpnet_only`
- Server logs for `gpnetOnly` related warnings

## Step 6 — Optional cleanup of the test org

```sql
DELETE FROM organizations WHERE slug = 'gpnet-pilot-test';
```
