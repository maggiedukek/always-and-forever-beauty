# Booking Confirmation Emails — Setup

The dashboard's **"Send Booking Confirmation"** button and the **Email Log** are fully built.
The only thing left is connecting an email service (**Resend**) so the button actually sends.
These steps need *your* accounts, so they can't be done from inside the chat — but they're quick (~10 min).

When these are done, the button just works. Until then, clicking it shows a friendly error and logs a failed attempt.

---

## What you're setting up

- **Sender (the "From"):** starts as Resend's test sender `onboarding@resend.dev`.
  Brides see emails from "Always & Forever Beauty" but the address is the test one.
- **Reply-to:** `alwaysandforeverbeautycolleen@gmail.com` — replies go straight to Colleen.
  (To use a different address, see "Changing the addresses" below.)
- **Upgrade later (Milestone 3):** once Colleen's custom domain is connected, verify it in
  Resend and switch the "From" to her real branded address.

---

## Step 1 — Resend account + API key (~5 min)

1. Sign up free at **https://resend.com** (free tier = 100 emails/day).
2. Go to **API Keys → Create API Key**. Name it `always-forever`.
3. Copy the key (starts with `re_`). You'll paste it in Step 3. Keep it private.

## Step 2 — Deploy the Edge Function

The function code is already in the repo at `supabase/functions/send-email/index.ts`.
From the `website` folder in a terminal:

```bash
# one-time, if you don't have the CLI yet
npm install -g supabase

supabase login
supabase link --project-ref bikidhccblbhibaniduw
supabase functions deploy send-email
```

> Prefer no terminal? In the Supabase dashboard: **Edge Functions → Deploy a new function**,
> name it exactly `send-email`, and paste the contents of
> `supabase/functions/send-email/index.ts`.

## Step 3 — Add the Resend key as a secret

```bash
supabase secrets set RESEND_API_KEY=re_your_key_here
```

> Or in the dashboard: **Edge Functions → send-email → Secrets** → add
> `RESEND_API_KEY` = your `re_...` key.

## Step 4 — Test it

1. Open the admin dashboard → click any inquiry.
2. Set their status to **Booked** (the button is locked until then).
3. Click **Send Booking Confirmation**.
4. You should see "✓ Confirmation email sent," a new row in the **Email Log**, and the
   email in the recipient's inbox. (Tip: test with your own email first.)

---

## Changing the addresses (optional)

No code edit needed — set these as secrets and redeploy is not required:

```bash
# Show Colleen's real address as the reply-to
supabase secrets set REPLY_TO_EMAIL="her-address@example.com"

# Once her domain is verified in Resend, send FROM her branded address
supabase secrets set FROM_EMAIL="Always & Forever Beauty <colleen@herdomain.com>"
```

Defaults (if you set nothing): From = `onboarding@resend.dev`,
Reply-to = `alwaysandforeverbeautycolleen@gmail.com`.

---

## Troubleshooting

- **"RESEND_API_KEY is not set"** → Step 3 wasn't done, or the secret name is misspelled.
- **Email lands in spam** → expected with the test sender; fixed once a real domain is verified.
- **"Resend rejected the request"** → the recipient address is invalid, or (on the free test
  sender) you're sending to an address Resend doesn't allow yet — verify a domain to send to anyone.
