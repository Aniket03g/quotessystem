# Changes & Updates Report
**Date:** 2026-05-31
**Branch:** backupbeforeclaude

---

## Leads Module

- **Removed dead View Lead modal** — The old inline "View Lead" popup (triggered by the eye icon) was cleaned out of the codebase since it was replaced by the dedicated Lead Detail page; this reduces page weight and eliminates dead code.

- **Row click → Lead Detail navigation** — Clicking anywhere on a lead row now navigates directly to that lead's detail page; the eye icon was converted to a direct link.

- **Stage change popover — scroll behaviour** — Fixed the stage change popup (status badge dropdown on the leads table) so it closes cleanly when the user scrolls the page, preventing it from drifting out of position.

- **Stage popover — markup cleanup** — Rebuilt the stage change popover as a fully dynamic JavaScript element appended to `<body>`, removing the static HTML stub and making it resilient to future layout changes.

---

## Lead Detail Page

- **Pipeline stage track — clipping fix** — The glow ring around the current pipeline stage was being clipped at the top edge; added top padding to the track container so the ring displays fully.

---

## Accounts Module

- **GST duplicate check on Edit Account** — The Add Account page already blocked duplicate GST numbers; that same validation has now been added to Edit Account, preventing an existing account's GST from being changed to one already used by another account.

- **GST duplicate error message** — Simplified the error wording to: *"An account with this GST number already exists: [Account Name]"* — concise and actionable.

---

## UI — Toast Notification System (all pages)

- **Replaced all browser alert/confirm dialogs** — Every native browser popup ("localhost says…") across all pages has been replaced with modern in-page notifications: slide-in toast messages (top-right, auto-dismiss in 3.5 s) for success/error feedback, and a clean custom confirm dialog for destructive actions (delete, mark as lost).

- **Covered pages:** Leads, Lead Detail, Accounts, Account Detail, Contacts, Add Contact, Quotes, Quote Detail, Quote Preview, Add Account, Edit Account, Create Product.

- **Error icon fix on toasts** — Error toasts were showing two ✕ symbols (one icon, one close button); the left icon was corrected to an exclamation-circle so only the close button shows an ✕.

- **Inline form banners → toasts** — Static red/green banners that appeared at the top of form pages (Add Account, Edit Account, Add Contact, Create Product) after submitting have been removed and replaced with the same toast system for a consistent experience.

---

## PDF Generation

- **Product details column — word wrapping** — Long text in the Product Details column was overflowing or cutting words at the column boundary; now wraps at full-word boundaries (no mid-word breaks), expanding the row height as needed.

- **Bold product name rendering fix** — The bold overlay for the product name in the PDF was misaligning when the name was long, causing the word "Conference" to clip and "Brand: [name]" to be partially erased; fixed by computing line breaks at normal font weight (matching autoTable's rendering) and covering the full column width per line.

---

## Code Quality

- **Removed ~350 lines of dead code** — View Lead modal HTML and its associated JavaScript (open/close functions, event listeners, DOM references) fully removed from `leads.astro`.

- **Standardised confirm dialogs** — All destructive confirmations (delete lead, delete account, delete contact, mark as lost, remove product from quote) now use the same custom in-page confirm modal with consistent Cancel / action button styling.
