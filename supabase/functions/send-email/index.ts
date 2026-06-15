// Always & Forever Beauty — booking confirmation email sender
// Supabase Edge Function that sends email through the Resend API.
//
// ── One-time setup (see SETUP-EMAIL.md for the full walkthrough) ──────────────
//   1. supabase functions deploy send-email
//   2. supabase secrets set RESEND_API_KEY=re_your_key_here
//   (optional overrides — only if you want to change the sender later)
//   3. supabase secrets set FROM_EMAIL="Always & Forever Beauty <onboarding@resend.dev>"
//   4. supabase secrets set REPLY_TO_EMAIL="alwaysandforeverbeautycolleen@gmail.com"
// ─────────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

// Until Colleen's custom domain is verified in Resend (Milestone 3), emails are
// sent from Resend's shared test sender. Replies still go to her real inbox.
const FROM_EMAIL =
  Deno.env.get("FROM_EMAIL") ?? "Always & Forever Beauty <onboarding@resend.dev>";

// Where bride replies land. Safe to be any address — no verification needed.
const REPLY_TO_EMAIL =
  Deno.env.get("REPLY_TO_EMAIL") ?? "alwaysandforeverbeautycolleen@gmail.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  // Browser pre-flight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!RESEND_API_KEY) {
      return json(
        {
          ok: false,
          error:
            "RESEND_API_KEY is not set. Run: supabase secrets set RESEND_API_KEY=re_xxx",
        },
        500,
      );
    }

    const { to, subject, html, replyTo } = await req.json();

    if (!to || !subject || !html) {
      return json(
        { ok: false, error: "Missing field: 'to', 'subject', and 'html' are all required." },
        400,
      );
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject,
        html,
        reply_to: replyTo || REPLY_TO_EMAIL,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return json(
        { ok: false, error: data?.message || "Resend rejected the request." },
        502,
      );
    }

    return json({ ok: true, id: data?.id ?? null });
  } catch (err) {
    return json({ ok: false, error: String(err?.message || err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
