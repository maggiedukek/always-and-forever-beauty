# Online Contracts & E-Signature — Setup

Colleen can now build a contract from the dashboard, send the client a link, and the
client signs it online. The signed copy lands back in her dashboard and she gets an email.

## How it works (the flow)

1. **Dashboard → Contracts → “+ New Contract.”** Colleen picks a client (or types a new
   one), chooses a package and/or à la carte services, sets travel, retainer, and dates.
   Totals calculate automatically.
2. She clicks **Create & Send for Signature.** The contract is saved and a branded email
   with a private signing link goes to the client. (A copy/paste link is always shown too,
   in case she'd rather text it.)
3. The client opens the link → reviews the full contract → **types or draws** their
   signature, checks the agreement box, and submits.
4. The contract is marked **Signed** (with a timestamp + audit trail). Colleen gets an
   email alert, and the signed contract appears in her Contracts panel — **View / Print**
   saves it as a PDF.

## One-time setup — TWO things

### 1. Create the contracts table (required — ~2 min)

Open Supabase → **SQL Editor → New query**, paste the contents of
**`admin/contracts-setup.sql`**, and click **Run**. (Safe to run more than once.)

Until this is done, the dashboard shows “Contracts aren't set up yet.”

### 2. Email sending (shared with booking confirmations)

The signing-link email and the “signed” alert both use the **same `send-email` function**
as the booking confirmations. If that's already set up (see `SETUP-EMAIL.md`), emails just
work. If not, contracts still fully work — Colleen just copies the signing link and sends
it herself, and the dashboard still updates when the client signs.

- The alert goes to **alwaysandforeverbeautycolleen@gmail.com** by default. To change it,
  edit `NOTIFY_EMAIL` near the top of the script in **`sign.html`**.

## Notes

- Signing links are private and unguessable. Anyone with the link can view/sign that one
  contract — same as any e-sign service. Use **Void** in the dashboard to disable a link.
- Typed and drawn e-signatures with a consent checkbox + timestamp are generally valid
  under U.S. law (ESIGN/UETA). This isn't legal advice — if Colleen wants extra assurance
  she can have a lawyer review the contract wording.
- No new storage bucket is needed; signed contracts live in the database and render to PDF
  in the browser.

## To go live

These changes are in the `website` folder. Commit and push so Netlify deploys, then run the
SQL above. New files: `sign.html`, `admin/contracts-setup.sql`. Updated: `admin/dashboard.html`.
