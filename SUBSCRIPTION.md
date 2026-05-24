# Subscriptions — Design Spec

> Locked design for the Telegram Stars-powered subscription system. Captures every decision made during the planning sessions. Implementation work tracks back to this document; if behavior diverges from this spec, update it in the same commit (per the documentation-upkeep rule in `CLAUDE.md`).

**Status: implemented.** Schema, helpers, Inngest registry, cron sweeps, lifecycle handlers, payment surface, quota enforcement, admin commands, and cancel/resume/upgrade flows all landed across commits `7467b64`..`ca24ba4`. See `DOCUMENTATION.md` "Subscriptions" for the operational quick-reference; this file remains the authoritative design spec.

---

## Table of Contents

1. [Overview](#overview)
2. [Plans & Pricing](#plans--pricing)
3. [Trial](#trial)
4. [State Machine](#state-machine)
5. [Subscribe Flow](#subscribe-flow)
6. [Renewal](#renewal)
7. [Cancel & Resume](#cancel--resume)
8. [Upgrade (Pro → Business)](#upgrade-pro--business)
9. [Downgrade (Business → Pro)](#downgrade-business--pro)
10. [Refund](#refund)
11. [Lapse & Grace](#lapse--grace)
12. [Plan-Cap Enforcement](#plan-cap-enforcement)
13. [Over-Quota Reconciliation](#over-quota-reconciliation)
14. [Owner Profile](#owner-profile)
15. [Bans](#bans)
16. [Complimentary Subscriptions](#complimentary-subscriptions)
17. [Notifications](#notifications)
18. [/billing UI](#billing-ui)
19. [Admin Surface](#admin-surface)
20. [Schema Delta](#schema-delta)
21. [Inngest Event Registry](#inngest-event-registry)
22. [Idempotency & Race Handling](#idempotency--race-handling)
23. [Edge Case Catalog](#edge-case-catalog)
24. [Deferred / Open Items](#deferred--open-items)

---

## Overview

Telegram Stars (`XTR`) powers all billing. Owners pay through Telegram's native invoice flow. The bot reads `successful_payment` updates and maintains subscription state in our DB. Owners can only purchase service inside the onboarding bot.

Three tiers: **Trial** (one-shot 7-day, automatic on first bot creation), **Pro**, **Business**. There is **no permanent Free tier** — when an owner's plan ends without an active subscription, all their bots are paused until they pay.

Subscriptions are managed by us via the Bot API methods `createInvoiceLink`, `editUserStarSubscription`, and `refundStarPayment`. Telegram has no native upgrade/downgrade API; we model these by combining cancel + new invoice.

---

## Plans & Pricing

| Plan | Stars / month | Max bots | Max docs / bot | Max messages / period |
|---|---|---|---|---|
| Trial (7 days, one-shot) | 0 | 1 | 3 | 500 (over the full 7d as one bucket) |
| Pro | 300 ⭐ | 3 | 10 | 5,000 |
| Business | 700 ⭐ | 10 | 50 | 50,000 |

- Plans are stars-only for v1. Schema uses an integer `starsPerPeriod` column rather than a neutral `amount` + `currency` pair.
- `subscription_period` is fixed at `2592000` seconds (30 days) — the only value Telegram supports for Stars subscriptions.
- Plan caps are enforced **per owner**, not per tenant. (`tenants.telegram_owner_id` is locked 1:1 via UNIQUE constraint, so per-owner = per-tenant in practice.)

---

## Trial

- **Clock starts** at first bot creation by the owner (`POST /api/bots` succeeds for the first time for that `telegramOwnerId`). Not at `/start`.
- **Duration**: 7 days from start.
- **One-shot, lifetime**. Deleting and recreating bots within or after the trial window does NOT reset the clock. `owners.trial_ends_at` is set once.
- **Caps during trial**: 1 bot, 3 docs/bot, 500 messages across the full 7-day window (a single bucket, no monthly rollover).
- **Welcome DM** on trial start: "🎫 Trial started — 7 days of full access. Subscribe anytime to lock in your plan."
- **Reminders**: DM at T-3d and T-1d.
- **Pay during trial = stack model**: trial keeps running until `trial_ends_at`. Paid period runs in parallel from the moment of payment. Owner gets up to 7d free + 30d paid for one Stars charge. Telegram's auto-renew fires at T+30d from payment. After trial ends, only paid subscription continues.
- **Refund during trial-after-payment**: subscription becomes `lapsed` immediately. Trial is considered consumed regardless of refund outcome.

---

## State Machine

```
                ┌──────────┐
                │ trialing │ ← first bot creation
                └────┬─────┘
                     │ successful_payment  (stack: trial keeps running)
                     ▼
              ┌──────────┐
              │  active  │ ◄────── successful_payment (renewal)
              └────┬─────┘
                   │ owner cancels in our UI
                   ▼
              ┌────────────────────────┐
              │ canceled               │ runs until currentPeriodEnd
              │ (auto-renew disabled)  │ resumable via "Resume" button
              └────┬───────────────────┘
                   │ currentPeriodEnd + 2d grace passes
                   ▼
                ┌────────┐
                │ lapsed │ → all bots over_quota_at = now; owner DM'd
                └────┬───┘
                     │ subscribes again
                     ▼
              ┌──────────┐
              │  active  │
              └──────────┘

  Orthogonal transitions:
    refund → forces status=canceled + auto-cancel auto-renew → lapsed immediately
    trial_ends_at passes WITHOUT payment → lapsed
```

`subscription_status` enum: `trialing` | `active` | `canceled` | `lapsed`.

`subscription_plan` enum: `trial` | `pro` | `business`. There is no `free` value.

**Effective plan** is computed (not stored as the sole truth) from all of an owner's subscription rows:

```ts
function effectivePlan(owner, subs) {
  const live = subs.filter(s =>
    s.status === "active" ||
    (s.status === "canceled" && s.currentPeriodEnd > now())
  );
  if (live.some(s => s.plan === "business")) return "business";
  if (live.some(s => s.plan === "pro")) return "pro";
  if (owner.subscription_status === "trialing" && owner.trial_ends_at > now()) return "trial";
  return "lapsed";
}
```

`owners.current_plan` is a denormalized cache of this. Every billing event recomputes and writes it.

---

## Subscribe Flow

### Entry points

1. **Main-menu button** in onboarding bot — label is **dynamic**:
   - `⭐ Subscribe` when status is `trialing` or `lapsed`
   - `⚙️ Plan & Billing` when status is `active` or `canceled`
2. **`/billing` command** — always available, opens the same surface.

### Plan picker

Two-button side-by-side picker, both plans visible at once with caps and price:

```
⭐ Choose your plan:

Pro — 500⭐/mo
  3 bots, 10 docs/bot, 5k msgs

Business — 2000⭐/mo
  10 bots, 50 docs/bot, 50k msgs

[Subscribe Pro]  [Subscribe Business]
```

### Invoice link

On tap:

1. Generate a nonce (16 random hex chars).
2. Cache `(ownerId, plan) → { nonce, link }` in Redis for 5 minutes (key `invoice:{ownerId}:{plan}`). If owner re-taps inside the window, return the same link to prevent double-tap double-payment.
3. Call `createInvoiceLink({ title, description, payload: "sub:{ownerId}:{plan}:{nonce}", currency: "XTR", prices: [{ label, amount }], subscription_period: 2592000 })`.
4. Send to owner as a clickable button (`InlineKeyboard.url("⭐ Subscribe", link)`).

### `pre_checkout_query`

Must answer within 10 seconds. Validation:

- Payload format matches `sub:{ownerId}:{plan}:{nonce}`.
- Plan is `pro` or `business`.
- Owner exists in `owners` (create row if missing — race protection).
- Owner is not banned.
- Owner is not already subscribed to the **same** plan with `status='active'`.
- Nonce has not been processed yet (check Redis dedup key `nonce-used:{nonce}`, TTL 24h). If present → reject.

On success: mark nonce as in-flight (`SET nonce-pending:{nonce} EX 600`), answer `ok=true`. On any rejection: answer `ok=false` with a short error string.

### `successful_payment` handler

Strictly idempotent on `telegram_payment_charge_id` (UNIQUE constraint in `subscriptions`).

Handler steps:

1. Insert `star_payments` ledger row (raw payload + extracted columns).
2. Fire Inngest event `subscription/started` (if `is_first_recurring`) or `subscription/renewed` (if `is_recurring && !is_first_recurring`).
3. Return 200 OK to Telegram only after the DB writes succeed. If DB is down, throw 500 so Telegram retries.

The Inngest function then performs the heavier work: upserting subscriptions, recomputing effective plan, clearing over_quota_at where it now fits, DM the owner, auto-show `/billing`.

### Cross-account payment

If Owner A shares their invoice link with Owner B (different Telegram ID), and B pays:

- Telegram sends `successful_payment` with `from.id = B` but our payload still says `ownerId = A`.
- **We accept this.** Service is credited to the payload owner (A). Like gifting.

---

## Renewal

- Telegram fires `successful_payment` with `is_recurring=true` (and NOT `is_first_recurring`) every 30 days while the subscription is `active`.
- Handler:
  1. Insert `star_payments` row.
  2. Update `subscriptions.currentPeriodEnd` from the new `subscription_expiration_date`.
  3. Update `owners.lifetimeStarsSpent += amount`, `owners.messagesThisPeriod = 0`, `owners.periodStartedAt = now()`, `owners.subscriptionRenewsAt = currentPeriodEnd`.
  4. **No DM** — Telegram already sends a built-in receipt.
- Counter reset at renewal is the canonical "period boundary" for `messages_this_period`.

---

## Cancel & Resume

### Cancel UX

- Owner taps Cancel button in `/billing`.
- **Single confirmation button** ("Yes, cancel"). No typed phrase.
- Optional cancellation-reason survey AFTER confirm (skippable): "Too expensive / Not using it / Switching tools / Other". Stored on `subscriptions.cancel_reason`.

### Cancel mechanics

- Call `editUserStarSubscription({user_id, telegram_payment_charge_id, is_canceled: true})`.
- Set `subscriptions.canceled_at = now()`, `status = 'canceled'`.
- `currentPeriodEnd` unchanged — subscription benefits continue until then.
- DM: "Cancelled. {plan} continues until {currentPeriodEnd}."
- Fire Inngest `subscription/canceled` event for downstream side effects.

### Resume (undo cancel)

- Before `currentPeriodEnd` passes, owner can tap "Resume subscription" in `/billing`.
- Call `editUserStarSubscription({..., is_canceled: false})`.
- Clear `subscriptions.canceled_at`, `status = 'active'`.
- DM: "Subscription resumed. Auto-renew is back on."

### Cancel race with in-flight renewal

If owner cancels at the same moment Telegram is processing a renewal, a `successful_payment` may arrive seconds after our cancel call:

- **Accept the renewal.** The owner is already charged; refusing would mean lost stars + no service for them.
- Subscription stays `active` for this newly-paid period.
- Auto-renew is now off (because we called `editUserStarSubscription` already).
- Next `currentPeriodEnd` rolls in normally and lapses cleanly without another charge.

### Cancel triggers

`editUserStarSubscription({is_canceled: true})` is called from us (Telegram never auto-cancels) when:

1. Owner taps Cancel in our UI.
2. Owner upgrades Pro → Business (we cancel Pro auto-renew before sending Business invoice — see [Upgrade](#upgrade-pro--business)).
3. Owner is banned by admin.
4. Admin issues a refund (must cancel auto-renew too, otherwise Telegram will charge again at next renewal and we'd loop).

---

## Upgrade (Pro → Business)

**Strategy: service overlap (no money moves besides the new Business charge).**

Telegram doesn't support partial refunds or plan swaps. Three viable strategies were considered; this one wins on simplicity and predictable behavior:

```
Day 0 (upgrade tap):
  - editUserStarSubscription(pro_charge_id, is_canceled=true)
       → Pro auto-renew off, Pro still active until its currentPeriodEnd
  - createInvoiceLink for Business
  - Owner taps invoice button, pays 2000 ⭐
  - successful_payment with is_first_recurring=true fires
  - Insert Business subscriptions row (status='active')
  - Effective plan recomputes: Business wins (higher tier)
  - DM: "✅ Business active. Pro continues alongside until {ProEndDate} (no extra charge)."

Day 0 → Pro currentPeriodEnd: Both subs exist; effective plan = Business.
At Pro currentPeriodEnd: Pro lapses naturally. Business continues.
At Business currentPeriodEnd: Business renews at 2000 ⭐.
```

- Owner pays full Business at the upgrade. The remaining Pro days are delivered as parallel service, not as a refund.
- No `refundStarPayment` calls in this flow. No `currency` math.
- If the upgrade flow fails between `editUserStarSubscription` and `successful_payment` (network glitch, owner abandons invoice), the state is benign: Pro stays canceled with a tail, no Business created, owner can retry. Idempotent.

The upgrade confirmation screen makes this explicit to the owner:

> ⭐ Upgrade to Business — 2000 ⭐/mo
>
> Your current Pro plan continues until {Pro end date} at no extra charge, alongside Business. After that, Business runs solo.
>
> [Confirm upgrade]

---

## Downgrade (Business → Pro)

**Strategy: service overlap, mirrors the Upgrade flow in reverse.** Telegram still has no native swap-to-lower-tier mechanism, but we surface the downsell on the cancel-confirm prompt to catch churners who would otherwise drop off entirely.

```
Day 0 (cancel tap, current plan = Business):
  Cancel-confirm prompt shows three buttons:
    [ Switch to Pro instead · 300⭐/mo ]
    [ Yes, cancel ]
    [ Keep subscription ]
```

When the owner taps **Switch to Pro instead** (`bots/billing.ts:handleDowngradeToPro`):
1. `editUserStarSubscription(business_charge_id, is_canceled=true)` — Business auto-renew off, Business still active until its `currentPeriodEnd`.
2. Flip the Business row to `status='canceled'` in DB.
3. Fire `subscription/canceled` so `notify-owner` + `recomputeEffectivePlan` run.
4. Mint a fresh Pro invoice link (`mintInvoiceLink({ ownerId, plan: 'pro' })`).
5. Send "⭐ Pay 300 Stars" URL button.
6. When the Pro `successful_payment` arrives, the existing payment handler inserts the Pro row.
7. `effectivePlan` precedence (business > pro) keeps reporting **business** until Business's `currentPeriodEnd`; then Pro takes over with its own fresh 30-day clock.

No double billing — Business and Pro coexist as parallel service, mirroring Upgrade.

If the owner ignores the Pro invoice, they end up on the same cancel path they were on before — no penalty.

Owners can still do the fully-manual variant if they prefer:
- Cancel Business outright.
- Wait for Business to expire.
- Subscribe to Pro fresh from a lapsed state.

---

## Refund

### Refund control

- **Admin-only.** No owner self-serve refund button. SaaS operator triggers via the `/refund` admin command.
- Granularity: **full charge only.** `refundStarPayment` doesn't support partial refunds.

### Refund mechanics

`/refund <chargeId>`:

1. Call `refundStarPayment({user_id, telegram_payment_charge_id})`.
2. Call `editUserStarSubscription({..., is_canceled: true})` to stop auto-renew. **This is critical** — if skipped, Telegram will charge again at next renewal and we'd loop.
3. Set `subscriptions.status = 'canceled', canceled_at = now()`.
4. Recompute owner's effective plan immediately. If this was the only active sub → owner becomes `lapsed`, all bots `over_quota_at = now`.
5. Insert `star_payments` row with negative `starsAmount` for audit.
6. Fire `subscription/refunded` Inngest event.
7. DM owner: "Refund issued. Subscription ended."

### Refund window

Telegram's `refundStarPayment` works without an explicit time limit on the bot side, but Telegram support enforces a window (~21 days). Past that, refund must be issued manually via Telegram support.

### Refund during trial-after-payment

If an owner paid mid-trial then is refunded:

- Owner goes to `lapsed` immediately. Trial is considered consumed regardless.
- Consistent with "trial is one-shot, lifetime" rule.
- All bots `over_quota_at = now`.

---

## Lapse & Grace

### Lapse triggers

A subscription transitions to `lapsed` when:

1. Trial expires without payment (`subscription_status='trialing' AND trial_ends_at + 0d < now()`). Trial has no grace.
2. Paid subscription fails to renew (`status='active' AND currentPeriodEnd + 2d < now()` with no new `successful_payment`).
3. Refund (immediate, no grace).
4. Owner banned (immediate, no grace).

### Grace period

- **2 days** after `currentPeriodEnd` for paid subs.
- Tolerates Telegram retry delays and brief network/account issues.
- During grace, subscription is still `status='active'` and bots are NOT yet over-quota. Owner gets a DM at T-3d (before lapse) warning of imminent loss.
- After grace expires, lapse-sweep marks the subscription `lapsed` and fires the `subscription/lapsed` event.

### Lapsed-owner experience

Once an owner enters `lapsed` state:

- All their tenant bots get `over_quota_at = now()`. Bots stop replying to customers.
- Customer messages to paused bots: **silent** (no auto-reply). The bot appears dead from the customer's perspective.
- Webhook ingress at `/webhook/tenant/:id` continues to be received and validated, but the handler short-circuits before any DB write — except for the customer-facing surface staying silent. (For banned owners we drop ingress entirely; see [Bans](#bans).)
- Owner-facing surface:
  - Main menu shows `⭐ Subscribe` as the primary CTA.
  - Bot list shows 🚫 next to every bot with "paused — subscribe to reactivate".
  - Bot creation blocked.
  - Doc upload blocked.
  - Prompt/welcome edits blocked.
  - **Deletions are still allowed** (cleanup OK).
  - `/billing` accessible to subscribe again.

### Re-subscribe after lapse

When a lapsed owner subscribes again, `subscription/started` fires:

1. Insert new `subscriptions` row.
2. Update `owners.current_plan`, `subscription_status='active'`, etc.
3. Call `enforceOwnerQuota(ownerId)`:
   - Clear `over_quota_at` on up to `plan.maxBots` bots.
   - Selection rule: most-recently-active by `max(conversations.last_message_at)`, tiebreak by oldest `tenant_bots.created_at`.
   - Remaining bots (if any beyond cap) keep `over_quota_at` and stay paused.
4. DM owner: "✅ {plan} active. {N} of {M} bots reactivated. Tap a paused bot to swap."

---

## Plan-Cap Enforcement

### Bot creation

- `POST /api/bots` and the onboarding `createBot` conversation both gate on plan caps.
- Order of operations: **quota check first, then Telegram `getMe`**. Avoids burning Telegram API budget on rejected creations.
- If at cap: hard block with upgrade CTA — "Pro allows 3 bots, you have 3. Upgrade to Business for 10, or delete a bot."
- Paused bots (`bot_status='paused'`) DO count toward the cap. A slot is a slot.

### Doc upload

- Doc upload (per-bot) gates on plan's `maxDocsPerBot`.
- If at cap: hard block with message — "10/3 docs — delete some or upgrade to add more."
- Existing docs over the cap (e.g., after a downgrade) keep working for RAG. We only block NEW uploads.

### Message counter

- `owners.messages_this_period` is incremented **before** the AI call. If the AI call throws, decrement back. Doomed calls don't burn quota.
- Check happens after the existing customer rate-limit (10/60s per customer) and before AI.
- On cap exceeded:
  - **Silent customer-side**: bot does not reply.
  - **DM owner once per period**: "You've hit {cap} messages this period. Upgrade or wait until renewal."
- Reset: at subscription period boundary (`successful_payment` of `is_recurring=true` resets the counter and sets `periodStartedAt = now()`).
- For trial owners: counter resets... never. 500 over the full 7-day trial bucket. On trial expiry, the row is no longer relevant — owner is `lapsed`.

### Bot count and doc count denormalization

- `owners.bot_count` and `owners.doc_count` are denormalized counters.
- Updated via atomic SQL on every create/delete:
  ```sql
  update owners set bot_count = bot_count + 1 where telegram_user_id = $1;
  ```
- Reconciliation: weekly Inngest job recomputes from base tables. Drift insurance.

---

## Over-Quota Reconciliation

`tenant_bots.over_quota_at` is a nullable timestamp. Non-null means the bot is paused for plan-cap reasons (distinct from owner-initiated `bot_status='paused'`).

### When `over_quota_at` is set

- All bots when their owner transitions to `lapsed` (trial expiry, renewal failure, refund, ban).
- Excess bots after a downgrade (if the new plan's cap is lower than the old).

### When `over_quota_at` is cleared

- On `subscription/started` after a re-subscribe, via `enforceOwnerQuota`.
- On owner deleting a bot if it frees a slot for an over-quota peer.
- On owner tap-to-swap (manual primary override).

### Behavior while `over_quota_at IS NOT NULL`

- The tenant bot's webhook handler ignores updates entirely. No DB writes, no `business_connection` upsert, no rate-limit increment.
- Implication on resume: `business_connections` row may show stale `is_enabled` / `rights`. Owner may need to remove + re-add the bot to Business to refresh, or simply wait for the next `business_connection` Telegram update.

### Manual primary override

- Owner can tap-to-swap which bot is active when over capacity.
- Bot list shows 🚫 next to over-quota bots.
- Tapping an over-quota bot opens: "This bot is paused because your plan only supports {cap} active bots. Make it active (will pause the current one), or upgrade."
- Tap "Make active" → swap: clear `over_quota_at` on this bot, set it on whichever was active before.

---

## Owner Profile

### Identity columns (captured from `ctx.from`)

| Column | Source | Notes |
|---|---|---|
| `telegram_user_id` | `ctx.from.id` | PK |
| `first_name` | `ctx.from.first_name` | display |
| `last_name` | `ctx.from.last_name` | display |
| `username` | `ctx.from.username` | @handle |
| `language_code` | `ctx.from.language_code` | captured for future i18n; not used in v1 |
| `is_premium` | `ctx.from.is_premium` | captured for analytics; not used in v1 |

### Refresh policy

- Opportunistic upsert on **every owner interaction** with both bots:
  - Middleware in the onboarding bot (runs before session/conversations, after rate limit).
  - Middleware in tenant bots, gated to the owner-side path (`!isBusinessChatUpdate` filter already in place).
- Updates `first_name`, `last_name`, `username`, `language_code`, `is_premium`, `last_active_at` on each touch.
- Failure-tolerant: caught + warn-logged. Profile drift is not blocking.

### Retention

- Owner rows kept **forever**. Useful for re-onboarding history and fraud detection.
- No auto-purge.
- Self-serve account deletion is deferred (see [Deferred](#deferred--open-items)).

---

## Bans

### `owners.is_banned: bool`

- Set by admin via `/ban <ownerId>`. Reversible via `/unban`.
- Side effects of ban:
  1. Cancel all active subscriptions via `editUserStarSubscription({is_canceled: true})`. No automatic refund.
  2. `over_quota_at = now()` on all owner's bots.
  3. Block writes via `/api/*` (POST, PATCH, DELETE return 403).
  4. **Drop webhook ingress** for the banned owner's tenant bots at `/webhook/tenant/:id` — return 200 OK to Telegram but skip all processing. No DB hits, no AI calls, no costs.
  5. GET reads still allowed — banned owners can see what data they have. Useful for dispute / appeal flows.

### Unban

- `/unban <ownerId>` clears `is_banned`.
- Does NOT auto-restore subscriptions; owner must re-subscribe.
- Does NOT clear `over_quota_at`; that's reconciled at the next `subscription/started`.

---

## Complimentary Subscriptions

### `subscriptions.is_complimentary: bool default false`

- Granted via `/grant_comp <ownerId> <plan>` admin command.
- Stored as a regular `subscriptions` row with:
  - `is_complimentary = true`
  - `telegramPaymentChargeId` = synthetic value `"comp:{uuid}"` (we never receive a real charge ID for comps)
  - `currentPeriodEnd` = year 2099 (far-future, so lapse-sweep never picks it up)
  - `starsPerPeriod = 0`
- Behaves identically to a paid subscription for plan-cap purposes.
- Lapse-sweep query filters out `is_complimentary = true OR currentPeriodEnd > now()` — comp rows simply never lapse.
- Admin must manually revoke via DB script if comp should end.

---

## Notifications

All owner-facing DMs route through Inngest `notify/owner` (one function, discriminated by `kind`). Idempotency via Redis dedup key `notify:{kind}:{ownerId}:{periodOrDate}` with 30-day TTL.

Every lifecycle DM ships with an inline keyboard built in `notify-owner.ts:buildDmKeyboard`. Callback buttons reuse the `bot.callbackQuery(CB.*)` handlers already registered in `bots/billing.ts` (same `BOT_TOKEN` = same webhook); URL buttons either point at a pre-minted Stars invoice or deep-link into the Mini App via `t.me/<bot>?startapp=billing`.

| `kind` | When | Throttle | Buttons attached |
|---|---|---|---|
| `trial_started` | When trial begins (first bot created) | once per owner | Subscribe Pro · Subscribe Business · Open Mini App |
| `trial_ending_3d` | T-3d before trial_ends_at | once | Subscribe Pro · Subscribe Business |
| `trial_ending_1d` | T-1d before trial_ends_at | once | Subscribe Pro · Subscribe Business |
| `trial_expired` | At trial lapse | once per lapse | Subscribe Pro · Subscribe Business |
| `subscription_started` | First successful_payment | once per charge | (Pro) Upgrade to Business · Open Mini App |
| `subscription_canceled` | After owner cancels | once per cancel | Resume subscription |
| `subscription_resumed` | After owner resumes | once per resume | Open Mini App |
| `subscription_lapsed` | After lapse-sweep marks lapsed (paid sub) | once per lapse | Subscribe Pro · Subscribe Business |
| `cancel_3d_before_end` | T-3d before canceled sub lapses | once per canceled period | Resume subscription |
| `quota_messages_exceeded` | When `messages_this_period >= cap` | once per period | (Pro only) Upgrade to Business |
| `customer_msg_to_paused_bot` | Customer pinged paused-by-quota bot | once per 24h per bot via Redis `SET NX EX 86400` | **Pre-minted invoice URL** (or Subscribe Pro/Business fallback) |
| `recovery_t3` | T+3d after lapse, derived from MAX(canceled/lapsed sub.currentPeriodEnd) or trialEndsAt | once per lapse anchor | Subscribe Pro · Subscribe Business |
| `recovery_t14` | T+14d after lapse | once per lapse anchor | Subscribe Pro · Subscribe Business |
| `admin_event_summary` | Lapse-sweep / trial-sweep batch summary | per cron tick | none |

Renewal events are **silent** (no DM). Telegram sends its own receipt.

`customer_msg_to_paused_bot` is the highest-intent moment in the lifecycle (a lead is actively trying to reach the owner's bot). `notify-owner` pre-mints a Pro invoice link via `bots/invoice-mint.ts:mintInvoiceLink` and surfaces it as a one-tap `⭐ Reactivate · 300⭐ Pro` URL button. Mint failure falls back to the standard Subscribe callback buttons so the DM is never buttonless.

The "idle bot while paying" nudge (`bot_count = 0` for 7+ days while subscribed) is **not** sent in v1. Owner is in control.

Every DM that surfaces a tier choice also prints `pricingLine()` from `lib/text.ts` — `Pro · 300⭐/mo · 3 bots · 5k msgs` / `Business · 700⭐/mo · 10 bots · 50k msgs` — derived from `PLANS` so any repricing flows through automatically.

---

## /billing UI

Single screen shown for both the main-menu billing button and the `/billing` command.

Layout (active subscriber example):

```
⚙️ Your Plan

Pro — active
Renews on April 5

Usage this period:
  Bots: 2/3
  Documents (largest bot): 7/10
  Messages: 234/5,000

[Upgrade to Business]
[Cancel subscription]
[Manage Stars in Telegram]
```

State variants:

| State | Top line | Action buttons |
|---|---|---|
| `trialing` | "🎫 Trial: 9 days left" | [Subscribe Pro] [Subscribe Business] |
| `active` Pro | "Pro — active. Renews on {date}" | [Upgrade to Business] [Cancel subscription] |
| `active` Business | "Business — active. Renews on {date}" | [Cancel subscription] |
| `canceled` | "Pro — canceled. Ends on {currentPeriodEnd}" | [Resume subscription] |
| `lapsed` | "🚫 No active plan" | [Subscribe Pro] [Subscribe Business] |

The "Manage Stars in Telegram" URL button was dropped — Telegram doesn't expose a stable public stars-management deep link. Cancel and Resume are handled in-bot via `editUserStarSubscription`.

Cancel-confirm prompt offers a **Business → Pro downsell** when the owner is canceling Business — see [Downgrade](#downgrade-business--pro).

Usage stats are shown for all active states. Trial banner is shown only on the `/billing` screen — not on every menu screen (avoiding nag).

Post-payment: `successful_payment` handler DMs the confirmation AND auto-shows the `/billing` screen so the owner sees fresh state immediately.

---

## Admin Surface

Admin commands in the onboarding bot, restricted to `ADMIN_TELEGRAM_USER_ID` env var. Non-admins hitting these get a silent no-op.

| Command | Effect |
|---|---|
| `/owner <id_or_@username>` | Show owner profile, plan, subscriptions list, bot list, usage. Read-only. |
| `/refund <chargeId>` | Refund + cancel auto-renew. See [Refund](#refund). |
| `/grant_comp <ownerId> <pro\|business>` | Create complimentary subscription. |
| `/ban <ownerId>` | Set is_banned = true, cancel all active subs, force-pause all bots. |
| `/unban <ownerId>` | Clear is_banned. Subscriptions stay canceled; owner re-subscribes if they want. |

Admin notifications: bot DMs `ADMIN_TELEGRAM_USER_ID` on key events (new subscription, lapse, refund, ban). Lapse-sweep batch summary is DM'd as a single message per tick rather than one DM per owner.

---

## Schema Delta

New enums:

```sql
create type subscription_plan as enum ('trial', 'pro', 'business');
create type subscription_status as enum ('trialing', 'active', 'canceled', 'lapsed');
```

New table — `owners`:

```ts
export const owners = pgTable("owners", {
  telegramUserId: text("telegram_user_id").primaryKey(),

  // Identity (refreshed every interaction)
  firstName: text("first_name"),
  lastName: text("last_name"),
  username: text("username"),
  languageCode: text("language_code"),
  isPremium: boolean("is_premium"),

  // Billing (denormalized from subscriptions)
  currentPlan: subscriptionPlan("current_plan"),  // nullable when lapsed with no active subs
  subscriptionStatus: subscriptionStatus("subscription_status").notNull().default("trialing"),
  subscriptionRenewsAt: timestamp("subscription_renews_at", { withTimezone: true }),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  lifetimeStarsSpent: integer("lifetime_stars_spent").notNull().default(0),

  // Rollups
  botCount: integer("bot_count").notNull().default(0),
  docCount: integer("doc_count").notNull().default(0),
  messagesThisPeriod: integer("messages_this_period").notNull().default(0),
  periodStartedAt: timestamp("period_started_at", { withTimezone: true }),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).defaultNow().notNull(),

  // Ops
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  notes: text("notes"),
  isBanned: boolean("is_banned").notNull().default(false),
}, (t) => ({
  usernameIdx: index("owners_username_idx").on(t.username),
  planStatusIdx: index("owners_plan_status_idx").on(t.currentPlan, t.subscriptionStatus),
  renewsAtIdx: index("owners_renews_at_idx").on(t.subscriptionRenewsAt),  // lapse sweep
  trialEndsAtIdx: index("owners_trial_ends_at_idx").on(t.trialEndsAt),    // trial sweep
}));
```

New table — `subscriptions`:

```ts
export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerTelegramUserId: text("owner_telegram_user_id")
    .notNull()
    .references(() => owners.telegramUserId, { onDelete: "cascade" }),
  plan: subscriptionPlan("plan").notNull(),
  status: subscriptionStatus("status").notNull().default("active"),
  telegramPaymentChargeId: text("telegram_payment_charge_id").notNull().unique(),
  starsPerPeriod: integer("stars_per_period").notNull(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  isComplimentary: boolean("is_complimentary").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  ownerIdx: index("subscriptions_owner_idx").on(t.ownerTelegramUserId),
  endIdx: index("subscriptions_end_idx").on(t.currentPeriodEnd),
  statusEndIdx: index("subscriptions_status_end_idx").on(t.status, t.currentPeriodEnd),
}));
```

New table — `star_payments` (audit ledger):

```ts
export const starPayments = pgTable("star_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
  ownerTelegramUserId: text("owner_telegram_user_id")
    .notNull()
    .references(() => owners.telegramUserId, { onDelete: "cascade" }),
  starsAmount: integer("stars_amount").notNull(),  // negative for refunds
  isFirstRecurring: boolean("is_first_recurring").notNull().default(false),
  invoicePayload: text("invoice_payload").notNull(),
  rawSuccessfulPayment: jsonb("raw_successful_payment"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  ownerIdx: index("star_payments_owner_idx").on(t.ownerTelegramUserId),
  subIdx: index("star_payments_sub_idx").on(t.subscriptionId),
}));
```

Existing-table mods:

```ts
// tenants — add UNIQUE on telegram_owner_id (lock 1:1 owner-tenant)
alter table tenants add constraint tenants_telegram_owner_id_uq unique (telegram_owner_id);

// tenant_bots — add over_quota_at
alter table tenant_bots add column over_quota_at timestamptz;
```

No migration of existing rows (dev DB can be nuked per current decision).

---

## Inngest Event Registry

All event names + payload shapes typed via Inngest TS SDK schema. Single registry file.

### Cron (scheduler-triggered)

| Function | Schedule | Purpose |
|---|---|---|
| `cron/lapse.sweep` | hourly | Lapse paid subs past grace; fire `subscription/lapsed`. |
| `cron/trial.sweep` | hourly | Lapse trial owners past `trial_ends_at` with no active sub; fire `subscription/lapsed`. |
| `cron/reminder.scan` | daily 10:00 UTC | Find owners crossing notification thresholds; fire `notify/owner`. |
| `cron/usage.reconcile` | weekly | Recompute `owners.bot_count`, `doc_count` from base tables. Drift insurance. |

### Event-driven (handler-triggered)

| Event | Fired from | Function does |
|---|---|---|
| `rag/document.ingest` | bot doc upload (existing) | RAG ingest pipeline. |
| `subscription/started` | `successful_payment` (`is_first_recurring=true`) | Upsert subscription, recompute effective plan, clear over_quota_at where it fits, DM owner. |
| `subscription/renewed` | `successful_payment` (`is_recurring=true`, not first) | Update currentPeriodEnd, reset messagesThisPeriod, lifetimeStarsSpent += amount. |
| `subscription/canceled` | Owner Cancel button | DM owner with end date, schedule cancel_3d_before_end reminder. |
| `subscription/refunded` | `/refund` admin command | Set status='canceled', fire `subscription/lapsed`. |
| `subscription/lapsed` | sweep crons + refund | Force over_quota_at on all owner's bots, set owners.current_plan=null, status='lapsed', DM. |
| `owner/first.bot.created` | first `POST /api/bots` succeeded | Set trial_ends_at, subscription_status='trialing'. DM welcome. |
| `owner/banned` | `/ban` admin command | Cancel all subs, force-pause all bots, block ingress. |
| `bot/over.quota.message` | customer-message handler hitting `over_quota_at != null` | DM owner with 24h throttle. |
| `bot/usage.exceeded` | AI handler hitting `messages_this_period >= cap` | DM owner once per period. |
| `notify/owner` | Various | Discriminated by `kind` (see [Notifications](#notifications)). Single function, multi-purpose. |

### Concurrency / throttling

Functions that DM owners (anything that calls `bot.api.sendMessage`):

```ts
{ concurrency: { limit: 10 }, throttle: { limit: 30, period: "1s" } }
```

Reasoning: Telegram outbound global rate limit is ~30/sec. We don't want a 1000-owner lapse batch to saturate the global outbound and starve real customer replies.

### Hosting

All Inngest functions live in `apps/bot`. New mount point: `/api/inngest` on the bot server. Reasons:

- Functions need grammy `Bot` instances to DM owners. `apps/bot` has the registry; `apps/rag` doesn't.
- `apps/bot` is already kept warm 24/7 for webhooks.
- Single Inngest serve URL per app keeps deployment simple.

---

## Idempotency & Race Handling

### Idempotency keys

| Event | Key | Storage |
|---|---|---|
| `successful_payment` processing | `telegram_payment_charge_id` | UNIQUE constraint on `subscriptions.telegramPaymentChargeId` |
| `star_payments` row insert | (`telegram_payment_charge_id`, `subscription_expiration_date`) | composite check before insert |
| `pre_checkout_query` validation | payload nonce | Redis `nonce-used:{nonce}` TTL 24h |
| Invoice link reuse | `(ownerId, plan)` | Redis `invoice:{ownerId}:{plan}` TTL 5min |
| Notification dedup | `(kind, ownerId, periodOrDate)` | Redis `notify:{kind}:{ownerId}:{periodOrDate}` TTL 30d |
| Paused-bot nudge | `botId` | Redis `over-quota-nudge:{botId}` `SET NX EX 86400` |

### Race scenarios

| Scenario | Resolution |
|---|---|
| Telegram redelivers `successful_payment` after timeout | UNIQUE on `telegram_payment_charge_id` causes second insert to fail; handler returns 200 OK. |
| Two webhook updates arrive concurrently for same owner | Per-chat sequentialize middleware serializes. Counter increments via atomic SQL. |
| Owner cancels exactly when Telegram is renewing | Accept the in-flight renewal, auto-renew is already off, next period lapses cleanly. |
| Owner taps Subscribe twice in 5 minutes | Redis-cached invoice link returns same URL — Telegram client de-dupes on its end. |
| Concurrent `successful_payment` for same owner (different charges) | Each handler recomputes effective plan from scratch via `effectivePlan(owner, subs)`. Eventual consistency wins. |
| Notify dedup race (two handlers send same notification simultaneously) | Redis `SET NX` on the dedup key — only one wins. |
| Inngest function retries after partial failure | Each function structured as discrete `step.run` blocks; completed steps don't re-run on retry. |

---

## Edge Case Catalog

Cases verified during planning. Most are handled defensively without separate ifs.

| Case | Behavior |
|---|---|
| Customer messages paused bot the instant it un-pauses | One message slips through; next message gets the silent treatment correctly. |
| Trial expiry mid-AI-call | Customer gets the in-flight reply; next message blocked. |
| Bot deletion frees a slot under cap | enforceOwnerQuota runs after delete, auto-promotes next-best over-quota bot. |
| Owner deletes Telegram account | `successful_payment` never fires again; lapse-sweep handles eventually. |
| Owner has stale `business_connections` row after long over-quota | On resume, row may be wrong; owner can refresh via permissions panel or just by triggering any `business_connection` update (remove + re-add to Business). |
| Owner pays Business while in Pro trial-stack mode | Effective plan = Business immediately. Counter resets at this payment. Old trial timeline still tracked but irrelevant — Business overrides. |
| Owner pauses bot manually, plan lapses | Bot gets over_quota_at. Bot_status stays paused. On resume, over_quota_at cleared but bot_status stays paused — owner must tap Resume manually. |
| Owner deletes paused-by-quota bot | Allowed. Frees a slot; enforceOwnerQuota promotes next-best. |
| Doc ingest completes after owner lapses | Doc lands in DB. Bot is over-quota, RAG never queries it. On re-subscribe, doc is queryable. |
| Webhook handler crashes between editUserStarSubscription and createInvoiceLink (upgrade flow) | Pro stays canceled. Owner retries Upgrade — we detect Pro is already canceled, skip the editUserStarSubscription call, just send Business invoice. Idempotent. |
| Banned owner's Telegram tries to reach paused bot | Webhook ingress dropped at `/webhook/tenant/:id`. Telegram still gets a 200, but no DB hit, no AI. |
| Comp account currentPeriodEnd reached (year 2099) | Lapse-sweep query uses `< now()`, year 2099 is always future. Never lapses. |
| Owner has multiple stale subscriptions accumulating over years | Indexed queries stay fast. No automated cleanup; rows are small. |
| Owner ID collision between dev/test/prod | Out of scope — separate Telegram bots in separate environments. |

---

## Deferred / Open Items

These were considered but explicitly deferred for v1.

- **Self-serve account deletion** (right-to-be-forgotten). No UI flow today. If anyone asks, handle out-of-band via DB script: cancel all subs, delete all bots (cascade), delete owner row, anonymize `star_payments` ownerTelegramUserId to `"deleted-{uuid}"` (keep amounts for audit).
- **Fiat payments** (Stripe etc.). Schema uses stars-only columns; if added later, we'd add a `currency` column + payment-method discriminator.
- **Internationalized DMs.** `language_code` captured but only English emitted in v1.
- **Yearly billing.** Telegram Stars only supports 30-day `subscription_period`. Not a v1 concern.
- **Plan-tier additions** (Starter, Enterprise). Schema supports more enum values; no immediate plans.
- **Mini-app subscription management surface.** Owner-side subscription management is bot-only for v1. Mini-app can read via existing `/api/*` but no Subscribe button there yet.
- **Owner-impersonation via REST endpoint.** Admin uses `/owner` bot command instead.
- **Per-bot subscriptions** (one sub per bot rather than per owner). Out of scope; we're per-owner forever.
- **Idle-bot-while-paying nudge** (DM owner after 7d at `bot_count=0`). Decided against.
- **Plan-dependent grace period** (Business gets longer grace than Pro). 2 days flat for everyone.

---

## Implementation Plan

Tracking the work into commits (rough order, not binding):

1. Schema migration: `owners`, `subscriptions`, `star_payments`, `tenant_bots.over_quota_at`, `tenants.telegram_owner_id` UNIQUE, new enums.
2. `lib/plans.ts` — plan config constants and `effectivePlan` helper.
3. `lib/owners.ts` — profile upsert, atomic counter helpers, quota checks, `enforceOwnerQuota`.
4. Inngest event registry + schemas + serve mount on `apps/bot`.
5. Cron functions: lapse-sweep, trial-sweep, reminder-scan, usage-reconcile.
6. Subscription lifecycle handlers: `subscription/started`, `/renewed`, `/canceled`, `/refunded`, `/lapsed`.
7. Payment surface in onboarding bot: `/billing` command, plan picker, invoice link creation, `pre_checkout_query`, `successful_payment` handler.
8. Cancel + Resume + Upgrade flows.
9. Quota enforcement: bot create gate, doc upload gate, message counter, over-quota short-circuit.
10. Admin commands: `/owner`, `/refund`, `/grant_comp`, `/ban`, `/unban`.
11. Profile-capture middleware on both bots.
12. Text constants in `lib/text.ts` for all new copy.
13. DOCUMENTATION.md updates: cross-link this spec, add "Billing & Subscriptions" section.

Each commit should include matching tests under TDD where the surface is unit-testable (plans config, effective-plan computation, quota math, idempotency helpers). Integration tests against live Telegram are intentionally out of scope.
