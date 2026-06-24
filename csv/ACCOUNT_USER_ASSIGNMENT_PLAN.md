# Plan: Assign Accounts to System Users

## Goal
Connect NocoDB Accounts (in "Accounts Duplicate" table) to system users (stored in SQLite, `proxy/internal/db/sqlite.go`), using a new CSV that lists each account and the name of the person assigned to it.

## Why this design
- Users live in SQLite, not NocoDB — NocoDB Link fields only work between two NocoDB tables, so there's no native relational link possible.
- The proxy already uses **email** as the cross-system identity key (JWT `sub` claim is email; `Lead Created By` field already stores the creator's email the same way).
- So: add a plain field `Assigned User Email` on Accounts Duplicate, store the assigned user's email there (not a NocoDB Link). The proxy can later filter "show only my accounts" for non-admins by comparing JWT email against this field — same pattern already scaffolded (commented out) in `proxy/internal/middleware/authorize.go` for `created_by`.

## The core problem
The new CSV has the assigned person's **name** (e.g. "Rahul Sharma"), not their email. There's no automatic link between a name and a system user — we have to build the lookup ourselves:

1. Pull the list of system users from SQLite (name + email).
2. Build a name → email lookup table from that list.
3. For each CSV row, resolve the assigned person's name to their email via this lookup.
4. Match the CSV row to the existing NocoDB account (key TBD — likely GST No, since that's unique and was the dedupe key in the original bulk import; Account Name as fallback if GST is missing/blank).
5. PATCH the matched NocoDB account record with `Assigned User Email`.

If a name in the CSV doesn't exactly match any existing system user's name (typo, nickname, or no login yet), it gets flagged in a report — never silently guessed.

## Decided
- Store the assignee's **email** on Accounts Duplicate (field: `Assigned User Email`), not the SQLite numeric ID — consistent with `Lead Created By` / `Shared Via` convention, human-readable directly in NocoDB UI.
- Exact (case-insensitive) name matching against system users, not fuzzy matching — too risky to mis-assign accounts to the wrong person.

## Sequencing (agreed with user 2026-06-23)
**Create all the relevant system users FIRST, before running the assignment script.** This avoids the lookup table having gaps.

Steps to execute tomorrow:
1. User provides the CSV (path or pasted rows).
2. Extract the distinct list of assigned-person names from the CSV.
3. Compare against current system users (`GetAllUsers` / admin users list) — figure out who already has a login and who's missing.
4. For anyone missing: user supplies an email for them (CSV likely only has name, not email) → create their user account via the existing admin "create user" flow (sends them a credentials email, per `feature_email_quotes` memory).
5. Once everyone exists, write/run the matching script:
   - Build name→email lookup from system users.
   - Match each CSV row to its existing NocoDB account.
   - PATCH `Assigned User Email` on the matched account.
   - Output a report: accounts updated, names unmatched, accounts unmatched.
6. (Separate follow-up, not yet built) Add the `Assigned User Email` field to NocoDB if it doesn't already exist, and wire up an assign-dropdown in the Accounts UI + proxy-side filtering for non-admins.

## Still open / to confirm tomorrow
- Exact CSV structure (columns, file location).
- Matching key for existing accounts: GST No vs Account Name vs both with fallback.
- Whether `Assigned User Email` field needs to be created in NocoDB (via meta API) or user will add it manually.

## Resume point
Waiting on user to finish creating system users for everyone named in the CSV. Once done, provide the CSV and we proceed from step 2 above.
