# Always & Forever — To-Do

## ✅ NEW: Online contracts + e-signature — built
Build a contract from the dashboard, send a sign link, client signs online, signed copy
returns to the dashboard. **One-time step before it works:** run `admin/contracts-setup.sql`
in the Supabase SQL editor. Full details in **SETUP-CONTRACTS.md**. (Emails reuse the
`send-email` function below; the flow also works link-by-link without email.)

## ⏳ Contract & confirmation emails — WAITING ON: Colleen's sending email address
**Goal:** email a contract to a client, and make the existing "Send Booking Confirmation" button actually send (right now it only logs).

When Colleen tells you which email address to send **FROM**, do these in order:

### Step 1 — Set up Resend (one-time, ~5 min) — *you*
- [ ] Create a free account at **resend.com** (free tier: 100 emails/day)
- [ ] Create an **API key** (Resend → API Keys → Create) and keep it handy
- [ ] To send from Colleen's own address later, verify the domain in Resend. To start/test, you can send from `onboarding@resend.dev`.

### Step 2 — Have the Claude (Supabase) extension build the email function — *you*
Paste this to the extension:

> Build and deploy a Supabase Edge Function named `send-email`. It should accept a POST JSON body `{ "to": string, "subject": string, "html": string }`, send via the Resend API (`https://api.resend.com/emails`) using a secret named `RESEND_API_KEY`, with a `from` address I'll provide. Return `{ ok: true }` or `{ ok: false, error }`, with CORS enabled for calls from my admin dashboard by an authenticated user. Also tell me how to set the `RESEND_API_KEY` secret and give me the function's invoke name/URL.

- [ ] Set the `RESEND_API_KEY` secret in Supabase (the extension will give you the command)

### Step 3 — Then tell Claude (me) to build the dashboard buttons — *me*
- [ ] "Email contract to client" button → sends a **secure download link** ✅ (decided — link, not attachment)
- [ ] Make the existing "Send Booking Confirmation" button actually send

## 🌐 Milestone 3 — when Colleen's custom domain is connected
- [ ] **Update Supabase Auth URLs for the new domain** so the password-reset email link keeps working. In Supabase → **Authentication → URL Configuration**: set the **Site URL** to the new domain and add `https://NEW-DOMAIN/admin/reset-password.html` to **Redirect 