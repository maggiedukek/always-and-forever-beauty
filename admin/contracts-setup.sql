-- =====================================================================
-- Always & Forever Beauty — e-signature contracts
-- Run this ONCE in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE.
-- =====================================================================

-- 1) The contracts table -------------------------------------------------
create table if not exists public.contracts (
  id                uuid primary key default gen_random_uuid(),
  token             text unique not null,          -- random, goes in the signing link
  client_name       text not null,
  client_email      text,
  client_phone      text,
  wedding_date      date,
  venue             text,
  start_time        text,
  package_name      text,
  package_price     numeric,
  line_items        jsonb default '[]'::jsonb,      -- [{name, qty, price, total}]
  subtotal          numeric,
  travel_fee        numeric,
  total             numeric,
  retainer          numeric,
  balance           numeric,
  balance_due_date  date,
  no_changes_date   date,
  notes             text,
  contract_html     text,                           -- frozen snapshot shown to the signer
  status            text not null default 'sent',   -- sent | signed | void
  signer_name       text,
  signature_type    text,                           -- typed | drawn
  signature_data    text,                           -- typed name, or PNG data URL
  consent           boolean default false,
  signed_at         timestamptz,
  signer_ip         text,
  signer_user_agent text,
  created_at        timestamptz not null default now()
);

-- 2) Row-level security --------------------------------------------------
alter table public.contracts enable row level security;

-- The owner (signed in to the dashboard) can do everything.
drop policy if exists "contracts_owner_all" on public.contracts;
create policy "contracts_owner_all" on public.contracts
  for all to authenticated using (true) with check (true);

-- Anonymous visitors get NO direct table access. The public signing page
-- reaches a single contract only through the two functions below.

-- 3) Public read of ONE contract by its token (for the signing page) -----
--    Note: signature_data is intentionally NOT returned.
create or replace function public.get_contract_by_token(p_token text)
returns table (
  client_name text, client_email text, wedding_date date, venue text, start_time text,
  package_name text, package_price numeric, line_items jsonb,
  subtotal numeric, travel_fee numeric, total numeric, retainer numeric, balance numeric,
  balance_due_date date, no_changes_date date, notes text, contract_html text,
  status text, signer_name text, signed_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select client_name, client_email, wedding_date, venue, start_time,
         package_name, package_price, line_items,
         subtotal, travel_fee, total, retainer, balance,
         balance_due_date, no_changes_date, notes, contract_html,
         status, signer_name, signed_at
  from public.contracts
  where token = p_token
  limit 1;
$$;

-- 4) Public sign action — only works while status is still 'sent' --------
create or replace function public.sign_contract(
  p_token          text,
  p_signer_name    text,
  p_signature_type text,
  p_signature_data text,
  p_consent        boolean,
  p_user_agent     text default null,
  p_ip             text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from public.contracts where token = p_token;
  if v_status is null then
    return 'not_found';
  end if;
  if v_status <> 'sent' then
    return 'already_' || v_status;       -- already signed or voided
  end if;
  if coalesce(p_consent, false) = false or coalesce(btrim(p_signer_name), '') = '' then
    return 'invalid';
  end if;

  update public.contracts set
    status            = 'signed',
    signer_name       = p_signer_name,
    signature_type    = p_signature_type,
    signature_data    = p_signature_data,
    consent           = true,
    signed_at         = now(),
    signer_user_agent = p_user_agent,
    signer_ip         = p_ip
  where token = p_token;

  return 'signed';
end;
$$;

-- 5) Let the public signing page call those two functions ----------------
grant execute on function public.get_contract_by_token(text) to anon, authenticated;
grant execute on function public.sign_contract(text, text, text, text, boolean, text, text) to anon, authenticated;

-- Done. The dashboard writes contracts as the signed-in owner; the signing
-- page reads/signs one contract through the functions above using its token.
