import { useState } from "react";
import { Reveal } from "@/components/Reveal";
import { ChatPreview } from "@/components/ChatPreview";
import { ScrubText } from "@/components/ScrubText";
import { ScrollScale } from "@/components/ScrollScale";
import { HorizontalAccordion } from "@/components/HorizontalAccordion";
import { Marquee } from "@/components/Marquee";
import {
  ArrowRight,
  ArrowUpRight,
  Bolt,
  Check,
  Chevron,
  Doc,
  Github,
  Logo,
  Plane,
  Spark,
  Star,
} from "@/components/Icon";

const BOT_HANDLE = "tgbusinessbot";
const DEEP_LINK = `https://t.me/${BOT_HANDLE}?start=launch`;

export function App() {
  return (
    <main className="atmos relative isolate w-full max-w-full overflow-x-hidden text-ink">
      <Nav />
      <Hero />
      <Trust />
      <Bento />
      <ScrollStory />
      <UseCases />
      <Pricing />
      <Faq />
      <FootCta />
      <Foot />
    </main>
  );
}

/* ============================================================== */
/*  Navigation — floating glass pill                                */
/* ============================================================== */
function Nav() {
  return (
    <nav className="sticky top-4 z-40 mx-auto mt-4 w-fit max-w-[94vw] px-3">
      <div className="glass flex items-center gap-1.5 rounded-full px-2 py-1.5 sm:gap-2">
        <a
          href="#top"
          className="press flex items-center gap-2 rounded-full px-2.5 py-1 text-[14.5px] font-semibold tracking-tight"
        >
          <Logo className="text-ink" />
          <span className="hidden sm:inline">Reception</span>
        </a>
        <span aria-hidden className="hidden h-4 w-px bg-ink/15 sm:block" />
        <NavLink href="#how">How it works</NavLink>
        <NavLink href="#features">Features</NavLink>
        <NavLink href="#pricing">Pricing</NavLink>
        <NavLink href="#faq" className="hidden sm:inline-flex">
          FAQ
        </NavLink>
        <a
          href={DEEP_LINK}
          target="_blank"
          rel="noreferrer"
          className="press group ml-0.5 inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-bg"
        >
          Launch in Telegram
          <span
            aria-hidden
            className="grid size-5 place-items-center rounded-full bg-white/15 transition-transform duration-300 ease-[var(--ease)] group-hover:translate-x-0.5"
          >
            <ArrowUpRight width={11} height={11} />
          </span>
        </a>
      </div>
    </nav>
  );
}

function NavLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      className={`press rounded-full px-2.5 py-1 text-[13px] font-medium text-ink-soft hover:text-ink ${className}`}
    >
      {children}
    </a>
  );
}

/* ============================================================== */
/*  Hero — Artistic Asymmetry (RNG choice)                          */
/* ============================================================== */
function Hero() {
  // Inline typography image — Picsum w/ heavy filter so it never looks
  // like stock photography (per gpt-taste skill).
  const inlineImg = "https://picsum.photos/seed/reception-marble/600/200";

  return (
    <section
      id="top"
      className="relative mx-auto max-w-[1440px] px-5 pt-12 sm:pt-20"
    >
      {/* Floating asset (bottom-right) — anchors the asymmetry */}
      <div className="pointer-events-none absolute right-[-4%] top-[6rem] hidden md:block lg:right-[2%]">
        <ScrollScale className="anim-float-slow">
          <div className="w-[420px] xl:w-[480px]">
            <ChatPreview />
          </div>
        </ScrollScale>
      </div>

      <div className="relative max-w-6xl pb-20 md:pb-40 md:pr-[420px] lg:pr-[440px]">
        <Reveal>
          <span className="inline-flex items-center gap-2 rounded-full bg-ink/[0.05] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-soft ring-1 ring-inset ring-ink/10">
            <span
              aria-hidden
              className="anim-pulse size-1.5 rounded-full"
              style={{ background: "var(--accent)" }}
            />
            Live · open in beta
          </span>
        </Reveal>

        <Reveal delay={1}>
          <h1
            className="mt-6 max-w-6xl font-display font-bold leading-[1.02] tracking-[-0.035em]"
            style={{ fontSize: "clamp(2.6rem, 5.4vw, 5.2rem)" }}
          >
            <span className="block">
              Your Telegram bot, answering
              <span
                aria-hidden
                className="mx-3 hidden h-[0.85em] w-[2.2em] translate-y-[0.18em] rounded-full bg-cover bg-center align-middle ring-1 ring-ink/15 md:inline-block"
                style={{
                  backgroundImage: `url(${inlineImg})`,
                  filter: "saturate(0.9) contrast(1.05)",
                }}
              />
              customers
            </span>
            <span className="block">
              while you sleep.{" "}
              <span className="relative inline-block text-ink-soft">
                <span className="relative z-10">No Premium needed.</span>
                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-1 -z-0 h-3 origin-left"
                  style={{
                    background:
                      "color-mix(in oklch, var(--accent) 32%, transparent)",
                    transform: "skewX(-12deg)",
                  }}
                />
              </span>
            </span>
          </h1>
        </Reveal>

        <Reveal delay={2}>
          <p className="mt-6 max-w-[60ch] text-[17px] leading-relaxed text-ink-soft">
            Reception is an always-on AI assistant for any Telegram bot. Drop
            in your docs, point your <span className="font-mono text-ink">@BotFather</span> token at
            us, and we'll reply to every customer DM in your voice — grounded
            in your own knowledge base, escalating only the ones that need you.
          </p>
        </Reveal>

        <Reveal delay={3}>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href={DEEP_LINK}
              target="_blank"
              rel="noreferrer"
              className="press group inline-flex items-center gap-2 rounded-full bg-ink py-3.5 pl-6 pr-2 text-[15px] font-semibold text-bg shadow-[var(--shadow-island)]"
            >
              Start free 7-day trial
              <span
                aria-hidden
                className="grid size-9 place-items-center rounded-full bg-white/15 transition-transform duration-300 ease-[var(--ease)] group-hover:translate-x-0.5 group-hover:scale-105"
              >
                <ArrowRight />
              </span>
            </a>
            <a
              href="#how"
              className="press inline-flex items-center gap-2 rounded-full px-5 py-3 text-[14.5px] font-semibold text-ink ring-1 ring-inset ring-ink/15 hover:bg-ink/5"
            >
              See it run
              <Chevron className="-rotate-90" />
            </a>
          </div>
        </Reveal>

        <Reveal delay={4}>
          <ul className="mt-8 grid grid-cols-2 gap-2 text-[13px] text-ink-soft sm:flex sm:flex-wrap sm:gap-x-6">
            <li className="flex items-center gap-1.5">
              <Check className="text-[var(--accent-deep)]" /> Works with any
              <span className="font-mono text-ink">@BotFather</span> bot
            </li>
            <li className="flex items-center gap-1.5">
              <Check className="text-[var(--accent-deep)]" /> 60-second setup
            </li>
            <li className="flex items-center gap-1.5">
              <Check className="text-[var(--accent-deep)]" /> Pay in Stars or
              skip
            </li>
            <li className="flex items-center gap-1.5">
              <Check className="text-[var(--accent-deep)]" /> Cancel any time
            </li>
          </ul>
        </Reveal>

        {/* Mobile-only chat preview, anchored below the copy */}
        <Reveal delay={5} className="mt-12 md:hidden">
          <ChatPreview />
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================== */
/*  Trust — kinetic marquee of operator names                       */
/* ============================================================== */
const CUSTOMERS = [
  "Caelum Roastery",
  "Lumen Tailoring",
  "Quirós Realty",
  "Penna Studio",
  "Northbrook Dental",
  "Tellier Yacht Services",
  "Ahonen Skincare",
  "Mira Fennec",
  "Sable & Halverson",
  "Holborn Watchworks",
];
function Trust() {
  return (
    <section className="relative border-y border-line-soft py-7 mt-12 md:mt-0">
      <p className="mb-5 text-center font-mono text-[11px] uppercase tracking-[0.22em] text-ink-muted">
        Quietly running for
      </p>
      <Marquee
        items={CUSTOMERS.map((name) => (
          <span className="flex items-center gap-3 text-[15px] font-semibold tracking-tight text-ink-soft">
            <span aria-hidden className="size-1.5 rounded-full bg-ink/30" />
            {name}
          </span>
        ))}
      />
    </section>
  );
}

/* ============================================================== */
/*  Bento — gapless grid-flow-dense, 5 intentional cards            */
/* ============================================================== */
function Bento() {
  return (
    <section
      id="features"
      className="relative mx-auto max-w-[1320px] px-5 py-28 md:py-40"
    >
      <Reveal>
        <div className="flex flex-col items-start gap-4 md:flex-row md:items-end md:justify-between">
          <h2 className="max-w-[22ch] font-display text-[2.4rem] font-bold leading-[1.02] tracking-[-0.035em] md:text-[3.2rem]">
            An entire support team, hiding inside one bot.
          </h2>
          <p className="max-w-[42ch] text-[15.5px] leading-relaxed text-ink-soft md:text-right">
            Reception sits on top of your existing Telegram bot. Same handle,
            same chat — except now there's a brain behind it, pulled from your
            own docs.
          </p>
        </div>
      </Reveal>

      <div className="mt-12 grid auto-rows-[200px] grid-cols-6 gap-3 md:gap-4 [grid-auto-flow:dense]">
        {/* 1 — wide intelligent triage (4 cols, 2 rows) */}
        <Reveal className="col-span-6 row-span-2 md:col-span-4" delay={1}>
          <BentoCard
            label="Intelligent triage"
            title="Replies that prioritise themselves."
            body="Conversations are auto-sorted by intent — pricing, booking, support — and only the ones you actually need to see get pushed up."
          >
            <TriageList />
          </BentoCard>
        </Reveal>

        {/* 2 — knowledge (2 cols, 2 rows) */}
        <Reveal className="col-span-3 row-span-2 md:col-span-2" delay={2}>
          <BentoCard
            label="Knowledge"
            title="Drops in your real docs."
            body="PDFs, policies, menus, schedules. Embedded and searched on every reply."
          >
            <DocPile />
          </BentoCard>
        </Reveal>

        {/* 3 — live status (2 cols, 2 rows) */}
        <Reveal className="col-span-3 row-span-2 md:col-span-2" delay={3}>
          <BentoCard
            label="Live status"
            title="Always-on. Never paged."
            body="Owner Mini App with usage, caps, and a single kill switch."
          >
            <LiveDot />
          </BentoCard>
        </Reveal>

        {/* 4 — voice (4 cols, 2 rows) */}
        <Reveal className="col-span-6 row-span-2 md:col-span-4" delay={4}>
          <BentoCard
            label="Voice"
            title="Sounds exactly like you."
            body="Set a system prompt, a welcome line, and a tone. Reception matches it across every customer thread."
          >
            <VoicePrompt />
          </BentoCard>
        </Reveal>

        {/* 5 — billing stream (full row) */}
        <Reveal className="col-span-6 row-span-1" delay={5}>
          <BentoCard
            compact
            label="Stars billing"
            title="Pay with Telegram Stars."
            body="Native in-app subscription via the Bot API. No Stripe handoff, no exit to the browser."
          >
            <StarsStream />
          </BentoCard>
        </Reveal>
      </div>
    </section>
  );
}

function BentoCard({
  label,
  title,
  body,
  children,
  compact,
}: {
  label: string;
  title: string;
  body: string;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <article
      className={
        "group relative flex h-full flex-col overflow-hidden rounded-[1.85rem] bg-surface ring-1 ring-line shadow-[var(--shadow-soft)] transition-transform duration-500 ease-[var(--ease)] hover:-translate-y-[2px] " +
        (compact ? "p-6 md:flex-row md:items-center md:gap-8" : "p-6 md:p-7")
      }
    >
      <div className={compact ? "md:max-w-[42ch]" : ""}>
        <div className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
          <span
            aria-hidden
            className="size-1.5 rounded-full"
            style={{ background: "var(--accent)" }}
          />
          {label}
        </div>
        <h3 className="mt-2 max-w-[22ch] font-display text-[20px] font-semibold leading-tight tracking-tight md:text-[22px]">
          {title}
        </h3>
        <p className="mt-2 max-w-[36ch] text-[14px] leading-relaxed text-ink-soft">
          {body}
        </p>
      </div>
      <div className={compact ? "mt-5 grow md:mt-0" : "mt-6 grow"}>
        {children}
      </div>
    </article>
  );
}

/* --- Bento sub-animations ------------------------------------- */

function TriageList() {
  const rows = [
    { tag: "Booking", text: "Can I move my Sunday reservation?", hot: true },
    { tag: "Pricing", text: "Do you do whole-bean wholesale?" },
    { tag: "Support", text: "I think you closed early yesterday." },
    { tag: "Pricing", text: "What's the cost for an espresso fix?" },
    { tag: "Booking", text: "Table for four on Friday at 19:30?" },
  ];
  return (
    <div className="relative rounded-2xl border border-line p-2">
      <ul className="space-y-1.5">
        {rows.map((r, i) => (
          <li
            key={i}
            className="flex items-center gap-3 rounded-xl bg-ink/[0.03] px-3 py-2.5"
          >
            <span
              className={
                "rounded-md px-1.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-wider " +
                (r.hot
                  ? "bg-[color:var(--accent-soft)] text-[var(--accent-deep)]"
                  : "bg-ink/[0.06] text-ink-muted")
              }
            >
              {r.tag}
            </span>
            <span className="truncate text-[13.5px] text-ink-soft">{r.text}</span>
            {r.hot ? (
              <span
                aria-hidden
                className="anim-pulse ml-auto size-1.5 rounded-full"
                style={{ background: "var(--accent)" }}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DocPile() {
  const docs = [
    { name: "menu-q2.pdf", k: "14" },
    { name: "wholesale-rates.pdf", k: "6" },
    { name: "hours.txt", k: "1" },
    { name: "gift-card-faq.md", k: "3" },
  ];
  return (
    <div className="relative flex flex-col gap-2">
      {docs.map((d, i) => (
        <div
          key={d.name}
          className="anim-float-slow flex items-center gap-2.5 rounded-xl border border-line bg-ink/[0.02] px-3 py-2.5"
          style={{ animationDelay: `${i * 0.4}s` }}
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-[var(--accent-deep)]">
            <Doc />
          </span>
          <span className="flex-1 truncate font-mono text-[12px] text-ink">
            {d.name}
          </span>
          <span className="font-mono text-[10.5px] text-ink-muted">{d.k}kb</span>
        </div>
      ))}
    </div>
  );
}

function LiveDot() {
  return (
    <div className="flex h-full flex-col items-start justify-end gap-3">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="anim-pulse relative inline-flex size-2.5 rounded-full"
          style={{ background: "var(--accent)" }}
        />
        <span className="font-mono text-[12.5px] tracking-tight text-ink">
          uptime <span className="text-[var(--accent-deep)]">99.97%</span>
        </span>
      </div>
      <div className="flex items-end gap-1">
        {[14, 22, 18, 26, 21, 28, 24, 30, 26, 32, 28, 36].map((h, i) => (
          <span
            key={i}
            className="block w-2 rounded-[3px] bg-ink/15"
            style={{
              height: h,
              animation: `float-y ${2 + (i % 3) * 0.5}s var(--ease) infinite`,
              animationDelay: `${i * 0.12}s`,
            }}
          />
        ))}
      </div>
      <span className="font-mono text-[10.5px] uppercase tracking-wider text-ink-muted">
        Last 24h · 1,847 replies
      </span>
    </div>
  );
}

function VoicePrompt() {
  return (
    <div className="rounded-2xl border border-line bg-ink/[0.02] p-4">
      <p className="font-mono text-[10.5px] uppercase tracking-wider text-ink-muted">
        System prompt
      </p>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink">
        You are the barista on Telegram for{" "}
        <span className="font-semibold">Caelum Roastery</span>. Warm, brief,
        never apologetic. Hold tables in 30-minute slots between Tue–Sun,
        09:00–18:00. If someone asks about wholesale, route to Mira.
        <span className="anim-caret ml-0.5 inline-block h-3 w-[1.5px] -translate-y-[1px] bg-ink align-middle" />
      </p>
    </div>
  );
}

function StarsStream() {
  const items = [
    "Pro · 300⭐ · +1 month",
    "Business · 700⭐ · +1 month",
    "Receipt 0xA7…2BC",
    "Pro · renewed · 300⭐",
    "Trial · 7d remaining",
    "Business · upgrade · 700⭐",
    "Refund · 300⭐ · returned",
  ];
  return (
    <Marquee
      gap="gap-2"
      items={items.map((s) => (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ink/[0.04] px-3 py-1.5 font-mono text-[11.5px] text-ink">
          <Star width={11} height={11} className="text-[var(--accent-deep)]" />
          {s}
        </span>
      ))}
    />
  );
}

/* ============================================================== */
/*  Scroll Story — GSAP image-scale-fade + scrubbing text reveal     */
/* ============================================================== */
function ScrollStory() {
  return (
    <section id="how" className="relative mx-auto max-w-[1240px] px-5 py-28 md:py-40">
      <div className="mx-auto max-w-3xl text-center">
        <ScrubText
          className="font-display text-[1.75rem] font-semibold leading-[1.25] tracking-[-0.025em] text-ink md:text-[2.4rem]"
          text="Three steps. About a minute. Your customers feel the difference the moment your bot starts replying in your voice — grounded in your real documents, never invented out of thin air."
        />
      </div>

      <div className="mt-20 grid gap-10 md:grid-cols-3 md:gap-6">
        {[
          {
            n: "01",
            t: "Connect any bot",
            d: "Drop the token from @BotFather. Encrypted at rest with AES-GCM and forgotten the moment you revoke it.",
            img: "https://picsum.photos/seed/reception-arch/720/900",
            icon: <Plane />,
          },
          {
            n: "02",
            t: "Load your docs",
            d: "PDFs, menus, FAQs, schedules. Anything a new hire would memorise on day one — pulled into a private index just for your tenant.",
            img: "https://picsum.photos/seed/reception-paper/720/900",
            icon: <Doc />,
          },
          {
            n: "03",
            t: "Go live",
            d: "Customers DM your bot. Reception replies in your voice, books, quotes, escalates. You see usage in the Mini App.",
            img: "https://picsum.photos/seed/reception-lights/720/900",
            icon: <Bolt />,
          },
        ].map((step, i) => (
          <ScrollScale key={step.n}>
            <article className="group relative flex h-full flex-col overflow-hidden rounded-[1.85rem] bg-ink text-bg shadow-[var(--shadow-island)]">
              <div className="relative h-56 overflow-hidden md:h-72">
                <div
                  aria-hidden
                  className="absolute inset-0 transition-transform duration-1000 ease-[var(--ease)] group-hover:scale-105"
                  style={{
                    backgroundImage: `url(${step.img})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    filter:
                      "grayscale(0.92) contrast(1.1) brightness(0.55) saturate(0.6)",
                  }}
                />
                <div
                  aria-hidden
                  className="absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(180deg, rgb(0 0 0 / 0.2) 0%, rgb(0 0 0 / 0.65) 100%)",
                  }}
                />
                <span className="absolute right-5 top-5 font-mono text-[12px] uppercase tracking-[0.22em] text-bg/70">
                  {step.n}
                </span>
                <span className="absolute bottom-5 left-5 grid size-12 place-items-center rounded-2xl text-white"
                  style={{
                    background:
                      "linear-gradient(140deg, color-mix(in oklch, var(--accent) 80%, white) 0%, var(--accent) 60%, var(--accent-deep) 100%)",
                    boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.35)",
                  }}
                >
                  {step.icon}
                </span>
              </div>
              <div className="flex flex-1 flex-col p-6 md:p-7">
                <h3 className="font-display text-[22px] font-semibold leading-tight tracking-tight">
                  {step.t}
                </h3>
                <p className="mt-2 max-w-[44ch] text-[14.5px] leading-relaxed text-bg/75">
                  {step.d}
                </p>
                <div
                  aria-hidden
                  className="mt-auto flex items-center gap-2 pt-6 font-mono text-[11px] uppercase tracking-[0.18em] text-bg/40"
                >
                  step
                  <span
                    aria-hidden
                    className="block h-px w-12 flex-1 bg-bg/20"
                  />
                  {i + 1} of 3
                </div>
              </div>
            </article>
          </ScrollScale>
        ))}
      </div>
    </section>
  );
}

/* ============================================================== */
/*  Use cases — horizontal accordion                                */
/* ============================================================== */
const USE_CASES = [
  {
    id: "studio",
    label: "Studios & salons",
    metric: "9× faster",
    body: "Reception holds tables, takes appointment requests, and quotes prices on the spot — without a 'we'll get back to you'.",
    bgImage: "https://picsum.photos/seed/reception-studio/1200/900",
  },
  {
    id: "creator",
    label: "Creators & coaches",
    metric: "24/7",
    body: "Sell your courses and quote your hourly rate while you're asleep. Hand off only the leads that want a human.",
    bgImage: "https://picsum.photos/seed/reception-creator/1200/900",
  },
  {
    id: "shop",
    label: "Shops & cafés",
    metric: "0 missed DMs",
    body: "Answer hours, menus, allergens, gift-card questions — the things that lose you a customer when nobody picks up.",
    bgImage: "https://picsum.photos/seed/reception-cafe/1200/900",
  },
  {
    id: "ops",
    label: "Ops & support teams",
    metric: "60% deflect",
    body: "Cover the boring 60% of tickets from your docs. Your team only sees the ones with real complexity.",
    bgImage: "https://picsum.photos/seed/reception-ops/1200/900",
  },
];
function UseCases() {
  return (
    <section className="relative mx-auto max-w-[1320px] px-5 py-28 md:py-40">
      <Reveal>
        <div className="flex flex-col items-start gap-3 md:flex-row md:items-end md:justify-between">
          <h2 className="max-w-[22ch] font-display text-[2.4rem] font-bold leading-[1.02] tracking-[-0.035em] md:text-[3.2rem]">
            Built for the people who actually answer the messages.
          </h2>
          <p className="max-w-[42ch] text-[15.5px] leading-relaxed text-ink-soft md:text-right">
            Hover any slice to expand.
          </p>
        </div>
      </Reveal>

      <Reveal delay={1} className="mt-10">
        <HorizontalAccordion panels={USE_CASES} />
      </Reveal>
    </section>
  );
}

/* ============================================================== */
/*  Pricing                                                         */
/* ============================================================== */
const PRO_FEATURES = [
  "Up to 3 bots",
  "10 documents per bot",
  "5,000 replies / month",
  "Owner Mini App + analytics",
];
const BIZ_FEATURES = [
  "Up to 10 bots",
  "50 documents per bot",
  "50,000 replies / month",
  "Priority generation queue",
  "Custom tone presets",
  "Direct line to founders",
];

function Pricing() {
  return (
    <section id="pricing" className="relative mx-auto max-w-[1240px] px-5 py-28 md:py-40">
      <Reveal>
        <div className="flex flex-col items-start gap-4 md:flex-row md:items-end md:justify-between">
          <h2 className="max-w-[20ch] font-display text-[2.4rem] font-bold leading-[1.02] tracking-[-0.035em] md:text-[3.2rem]">
            Pay in Stars. Cancel any time.
          </h2>
          <p className="max-w-[40ch] text-[15px] leading-relaxed text-ink-soft md:text-right">
            7-day free trial on every plan. Trial starts when you launch your
            first bot, not when you sign up.
          </p>
        </div>
      </Reveal>

      <div className="mt-12 grid items-stretch gap-4 md:grid-cols-12 md:gap-6">
        <Reveal className="md:col-span-5" delay={1}>
          <PriceCard
            tier="Pro"
            stars={300}
            blurb="For solo operators and small studios."
            features={PRO_FEATURES}
            cta="Start Pro trial"
          />
        </Reveal>

        <Reveal className="md:col-span-7" delay={2}>
          <PriceCard
            featured
            tier="Business"
            stars={700}
            blurb="For teams handling hundreds of customer chats a week."
            features={BIZ_FEATURES}
            cta="Start Business trial"
          />
        </Reveal>
      </div>

      <Reveal delay={3}>
        <p className="mt-6 text-center font-mono text-[11.5px] uppercase tracking-[0.2em] text-ink-muted">
          Stars are Telegram's native currency · billed monthly via the Bot API
        </p>
      </Reveal>
    </section>
  );
}

function PriceCard({
  tier,
  stars,
  blurb,
  features,
  cta,
  featured,
}: {
  tier: string;
  stars: number;
  blurb: string;
  features: string[];
  cta: string;
  featured?: boolean;
}) {
  return (
    <div
      className={
        "relative flex h-full flex-col overflow-hidden rounded-[2.25rem] p-7 md:p-9 " +
        (featured
          ? "bg-ink text-bg shadow-[var(--shadow-island)]"
          : "bg-surface ring-1 ring-line shadow-[var(--shadow-soft)]")
      }
    >
      {featured ? (
        <div
          aria-hidden
          className="anim-orb absolute -right-16 -top-16 size-56 rounded-full blur-3xl"
          style={{ background: "var(--accent)", opacity: 0.35 }}
        />
      ) : null}

      <div className="relative flex items-center justify-between">
        <span
          className={
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] " +
            (featured ? "bg-white/12 text-bg" : "bg-ink/[0.06] text-ink-muted")
          }
        >
          {tier}
        </span>
        {featured ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-2.5 py-1 text-[11px] font-semibold tracking-tight">
            <Spark width={11} height={11} />
            Best for teams
          </span>
        ) : null}
      </div>

      <div className="relative mt-6 flex items-baseline gap-2">
        <span className="font-display text-[58px] font-bold leading-none tracking-[-0.04em] md:text-[72px]">
          {stars}
        </span>
        <Star
          width={22}
          height={22}
          className={featured ? "text-white" : "text-[var(--accent-deep)]"}
        />
        <span
          className={
            "ml-1 font-mono text-[12.5px] " +
            (featured ? "text-bg/70" : "text-ink-muted")
          }
        >
          / month
        </span>
      </div>

      <p
        className={
          "relative mt-3 max-w-[40ch] text-[14.5px] leading-relaxed " +
          (featured ? "text-bg/80" : "text-ink-soft")
        }
      >
        {blurb}
      </p>

      <ul className="relative mt-6 space-y-2.5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-[14px]">
            <span
              className={
                "mt-[2px] grid size-5 shrink-0 place-items-center rounded-full " +
                (featured
                  ? "bg-white/15 text-bg"
                  : "bg-[color:var(--accent-soft)] text-[var(--accent-deep)]")
              }
            >
              <Check width={12} height={12} />
            </span>
            <span className={featured ? "text-bg/90" : "text-ink"}>{f}</span>
          </li>
        ))}
      </ul>

      <a
        href={DEEP_LINK}
        target="_blank"
        rel="noreferrer"
        className={
          "press group relative mt-8 inline-flex items-center justify-between gap-2 self-stretch rounded-full px-5 py-3.5 text-[14.5px] font-semibold " +
          (featured ? "bg-bg text-ink" : "bg-ink text-bg")
        }
      >
        {cta}
        <span
          aria-hidden
          className={
            "grid size-8 place-items-center rounded-full transition-transform duration-300 ease-[var(--ease)] group-hover:translate-x-0.5 " +
            (featured ? "bg-ink/10" : "bg-white/15")
          }
        >
          <ArrowRight />
        </span>
      </a>
    </div>
  );
}

/* ============================================================== */
/*  FAQ                                                             */
/* ============================================================== */
const FAQS = [
  {
    q: "Do I need a Telegram Premium account?",
    a: "No. Reception works on any Telegram bot you can create through @BotFather, which is free. Telegram Premium is only required if you want the bot to also reply inside your personal Telegram chats via the Telegram Business API — and that's strictly optional.",
  },
  {
    q: "What does it use to answer customers?",
    a: "Every reply is grounded in the documents you upload. If a customer asks something your docs don't cover, Reception says so and (optionally) pings you to take over.",
  },
  {
    q: "How is my data handled?",
    a: "Bot tokens are encrypted at rest with AES-GCM. Documents are stored privately to your tenant — never used to train any shared model. Conversations are scoped per bot and isolated between owners.",
  },
  {
    q: "Can I pause it instantly?",
    a: "Yes. The Mini App has a hard kill switch per bot. Toggling it pauses replies immediately; customer messages are queued, not lost.",
  },
  {
    q: "What happens after the trial?",
    a: "Bots pause until you subscribe. Your documents and settings stay exactly where they are — re-subscribe and everything picks back up where it left off.",
  },
  {
    q: "Is there an API?",
    a: "Not yet — Reception is opinionated and built for non-technical owners first. If you want a managed integration, message us inside the Mini App support thread.",
  },
];

function Faq() {
  return (
    <section id="faq" className="relative mx-auto max-w-[960px] px-5 py-28 md:py-40">
      <Reveal>
        <h2 className="max-w-[20ch] font-display text-[2.4rem] font-bold leading-[1.02] tracking-[-0.035em] md:text-[3.2rem]">
          Answers, before you ask.
        </h2>
      </Reveal>

      <div className="mt-10 divide-y divide-line border-y border-line">
        {FAQS.map((f, i) => (
          <FaqRow key={i} q={f.q} a={f.a} idx={i} />
        ))}
      </div>
    </section>
  );
}

function FaqRow({ q, a, idx }: { q: string; a: string; idx: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Reveal delay={idx + 1}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-6 py-5 text-left"
        aria-expanded={open}
      >
        <span className="font-display text-[18px] font-semibold tracking-tight md:text-[20px]">
          {q}
        </span>
        <span
          aria-hidden
          className={
            "grid size-9 shrink-0 place-items-center rounded-full bg-ink/[0.05] text-ink transition-transform duration-300 ease-[var(--ease)] " +
            (open ? "rotate-180" : "")
          }
        >
          <Chevron />
        </span>
      </button>
      <div
        className={
          "grid overflow-hidden transition-[grid-template-rows,opacity] duration-500 ease-[var(--ease)] " +
          (open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")
        }
      >
        <div className="min-h-0">
          <p className="max-w-[64ch] pb-5 text-[14.5px] leading-relaxed text-ink-soft">
            {a}
          </p>
        </div>
      </div>
    </Reveal>
  );
}

/* ============================================================== */
/*  Footer CTA                                                      */
/* ============================================================== */
function FootCta() {
  const bgImg = "https://picsum.photos/seed/reception-night/1600/900";
  return (
    <section className="relative mx-auto max-w-[1320px] px-5 pb-20">
      <Reveal>
        <div className="relative overflow-hidden rounded-[2.5rem] bg-ink p-8 text-bg md:p-14">
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${bgImg})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              filter: "grayscale(0.9) brightness(0.55)",
              opacity: 0.35,
              mixBlendMode: "luminosity",
            }}
          />
          <div
            aria-hidden
            className="anim-orb pointer-events-none absolute -right-24 -top-24 size-[420px] rounded-full blur-3xl"
            style={{ background: "var(--accent)", opacity: 0.35 }}
          />
          <div className="relative grid items-center gap-8 md:grid-cols-12">
            <div className="md:col-span-7">
              <h2 className="font-display text-[2.4rem] font-bold leading-[1.02] tracking-[-0.03em] md:text-[3.6rem]">
                Stop missing customers.
              </h2>
              <p className="mt-4 max-w-[44ch] text-[15.5px] leading-relaxed text-bg/70">
                Install Reception on a real bot in under a minute. First seven
                days are on us. If it doesn't pull its weight, walk away.
              </p>
            </div>
            <div className="md:col-span-5 md:justify-self-end">
              <a
                href={DEEP_LINK}
                target="_blank"
                rel="noreferrer"
                className="press group inline-flex w-full items-center justify-between gap-3 rounded-full bg-bg px-5 py-4 text-[15.5px] font-semibold text-ink md:w-auto"
              >
                <span className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="grid size-8 place-items-center rounded-full text-white"
                    style={{
                      background:
                        "linear-gradient(140deg, color-mix(in oklch, var(--accent) 80%, white) 0%, var(--accent) 60%, var(--accent-deep) 100%)",
                    }}
                  >
                    <Plane width={14} height={14} />
                  </span>
                  Launch in Telegram
                </span>
                <span
                  aria-hidden
                  className="grid size-9 place-items-center rounded-full bg-ink/10 transition-transform duration-300 ease-[var(--ease)] group-hover:translate-x-0.5 group-hover:scale-105"
                >
                  <ArrowUpRight />
                </span>
              </a>
              <p className="mt-3 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-bg/50 md:text-right">
                No card. No download. Just Stars.
              </p>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ============================================================== */
/*  Foot                                                            */
/* ============================================================== */
function Foot() {
  return (
    <footer className="border-t border-line py-10">
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-6 px-5">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="text-[13px] font-semibold tracking-tight">
            Reception
          </span>
          <span className="hidden font-mono text-[11px] text-ink-muted sm:inline">
            v1.0 · made for Telegram bots
          </span>
        </div>
        <nav className="flex flex-wrap items-center gap-4 text-[13px] text-ink-soft">
          <a href="#features" className="press hover:text-ink">Features</a>
          <a href="#pricing" className="press hover:text-ink">Pricing</a>
          <a href="#faq" className="press hover:text-ink">FAQ</a>
          <a
            href="https://github.com/BraveRam/custom-tg-agent"
            target="_blank"
            rel="noreferrer"
            className="press inline-flex items-center gap-1.5 hover:text-ink"
          >
            <Github />
            Open source
          </a>
        </nav>
        <p className="font-mono text-[11px] text-ink-muted">
          © {new Date().getFullYear()} Reception
        </p>
      </div>
    </footer>
  );
}
