import { useState } from "react";
import { Reveal } from "@/components/Reveal";
import { ChatPreview } from "@/components/ChatPreview";
import {
  ArrowRightDoodle,
  ArrowUpRightDoodle,
  BoltDoodle,
  ChatDoodle,
  CheckDoodle,
  ChevronDoodle,
  DoodleLogo,
  DocDoodle,
  HeartDoodle,
  Highlight,
  LockDoodle,
  PlaneDoodle,
  ScribbleArrow,
  ScribbleCircle,
  Sparkle,
  Squiggle,
  StarDoodle,
} from "@/components/Doodle";

const BOT_HANDLE = "tgbusinessbot";
const DEEP_LINK = `https://t.me/${BOT_HANDLE}?start=launch`;

export function App() {
  return (
    <main className="relative w-full max-w-full overflow-x-hidden text-text">
      <Nav />
      <Hero />
      <HowItWorks />
      <Features />
      <Pricing />
      <Faq />
      <FootCta />
      <Foot />
    </main>
  );
}

/* ============================================================== */
/*  Nav                                                             */
/* ============================================================== */
function Nav() {
  return (
    <nav className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-3 px-5 pt-6">
      <a
        href="#top"
        className="press flex items-center gap-2 font-display text-[22px] leading-none"
        aria-label="Reception home"
      >
        <DoodleLogo className="text-text" />
        <span>Reception</span>
      </a>
      <div className="hidden items-center gap-6 font-mono text-[14px] text-text-soft md:flex">
        <a href="#how" className="press hover:text-text">How</a>
        <a href="#features" className="press hover:text-text">What</a>
        <a href="#pricing" className="press hover:text-text">Pricing</a>
        <a href="#faq" className="press hover:text-text">FAQ</a>
      </div>
      <a
        href={DEEP_LINK}
        target="_blank"
        rel="noreferrer"
        className="btn-sketch btn-sketch--primary !py-2 !px-4 !text-[15px]"
      >
        Launch
        <ArrowUpRightDoodle />
      </a>
    </nav>
  );
}

/* ============================================================== */
/*  Hero                                                            */
/* ============================================================== */
function Hero() {
  return (
    <section
      id="top"
      className="relative mx-auto grid w-full max-w-[1200px] grid-cols-1 items-center gap-12 px-5 pb-16 pt-20 md:grid-cols-12 md:pt-28 md:pb-24"
    >
      <div className="md:col-span-7">
        <Reveal delay={1}>
          <h1
            className="max-w-[18ch] font-display leading-[1.05]"
            style={{ fontSize: "clamp(2.4rem, 5.6vw, 4.8rem)" }}
          >
            Your Telegram bot, replying to{" "}
            <span className="relative inline-block whitespace-nowrap">
              <span className="relative z-10">customers</span>
              <Highlight />
            </span>{" "}
            while you{" "}
            <span className="relative inline-block">
              sleep
              <Squiggle
                className="!absolute left-0 -bottom-2 text-text"
              />
            </span>
            .
          </h1>
        </Reveal>

        <Reveal delay={2}>
          <p className="mt-7 max-w-[58ch] text-[18px] leading-relaxed text-text-soft">
            Drop in a BotFather token, upload your docs, and Reception answers
            every customer DM in your voice. No Telegram Premium, no Stripe,
            no code.
          </p>
        </Reveal>

        <Reveal delay={3}>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <a
              href={DEEP_LINK}
              target="_blank"
              rel="noreferrer"
              className="btn-sketch btn-sketch--primary"
            >
              Start 7-day free trial
              <ArrowRightDoodle className="size-4" />
            </a>
            <a href="#how" className="btn-sketch">
              See how it works
              <ChevronDoodle className="-rotate-90" />
            </a>
          </div>
        </Reveal>

        <Reveal delay={4}>
          <ul className="mt-8 grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-[13px] text-text-soft sm:flex sm:flex-wrap">
            {[
              "Any @BotFather bot",
              "60-second setup",
              "Pay in Stars",
              "Cancel any time",
            ].map((it) => (
              <li key={it} className="flex items-center gap-2">
                <CheckDoodle className="text-success" />
                {it}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>

      <div className="md:col-span-5">
        <Reveal delay={2}>
          <div className="relative">
            <ChatPreview />
            <div
              aria-hidden
              className="absolute -left-10 -top-12 hidden text-text/35 anim-wiggle md:block"
            >
              <ScribbleArrow direction="down-right" className="w-20 h-16" />
            </div>
            <p
              aria-hidden
              className="absolute -left-2 -top-16 hidden -rotate-6 font-display text-[18px] text-text-soft md:block"
            >
              answers in your voice
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================== */
/*  How it works                                                    */
/* ============================================================== */
function HowItWorks() {
  const steps = [
    {
      n: "one",
      t: "Connect your bot",
      d: "Drop the token from @BotFather. Stored encrypted, forgotten the moment you revoke it.",
      icon: <PlaneDoodle />,
    },
    {
      n: "two",
      t: "Upload your docs",
      d: "PDFs, FAQs, menus, schedules. Anything a new hire would memorise on day one.",
      icon: <DocDoodle />,
    },
    {
      n: "three",
      t: "Go live",
      d: "Customers DM your bot. Reception replies in your voice, books, quotes, escalates.",
      icon: <BoltDoodle />,
    },
  ];

  return (
    <section
      id="how"
      className="relative border-y-2 border-text bg-surface paper-rule py-24 md:py-32"
    >
      <div className="mx-auto max-w-[1200px] px-5">
        <Reveal>
          <div className="flex flex-col items-start gap-4 md:flex-row md:items-end md:justify-between">
            <h2 className="font-display text-[36px] leading-tight md:text-[48px]">
              Three steps. <br className="md:hidden" />
              <span className="relative inline-block">
                About a minute.
                <Squiggle className="!absolute left-0 -bottom-1 text-text" />
              </span>
            </h2>
            <p className="max-w-[40ch] text-[15.5px] text-text-soft md:text-right">
              No code, no installation. Open the bot in Telegram and you're set
              before your coffee cools.
            </p>
          </div>
        </Reveal>

        <ol className="mt-14 grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-12">
          {steps.map((s, i) => (
            <Reveal key={s.n} delay={i + 1}>
              <li className="relative">
                <div className="flex items-center gap-3 font-mono text-[13px] uppercase tracking-[0.18em] text-text-muted">
                  Step {s.n}
                  <span aria-hidden className="block h-px w-10 bg-text/20" />
                </div>
                <div className="mt-5 inline-flex size-14 items-center justify-center rounded-2xl bg-text text-paper [&_svg]:size-6">
                  {s.icon}
                </div>
                <h3 className="mt-5 font-display text-[28px] leading-tight">
                  {s.t}
                </h3>
                <p className="mt-3 max-w-[36ch] text-[15px] leading-relaxed text-text-soft">
                  {s.d}
                </p>

                {/* Doodle arrow connector between steps (desktop only) */}
                {i < steps.length - 1 ? (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute -right-8 top-12 hidden text-text/35 anim-wiggle md:block"
                  >
                    <ScribbleArrow className="w-14 h-12 rotate-[-15deg]" />
                  </div>
                ) : null}
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ============================================================== */
/*  Features — 3 clean cards                                        */
/* ============================================================== */
function Features() {
  const items = [
    {
      icon: <ChatDoodle />,
      title: "Replies grounded in your docs",
      body: "Every answer is pulled from the files you upload. If the docs don't cover it, Reception says so and pings you.",
    },
    {
      icon: <Sparkle />,
      title: "Sounds exactly like you",
      body: "Set a tone, a welcome line, a system prompt. Warm and chatty or terse and precise — your call.",
    },
    {
      icon: <LockDoodle />,
      title: "Your data, locked down",
      body: "Bot tokens encrypted at rest. Docs scoped to your tenant. Never used to train any shared model.",
    },
  ];

  return (
    <section id="features" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-[1200px] px-5">
        <Reveal>
          <h2 className="max-w-[20ch] font-display text-[36px] leading-tight md:text-[48px]">
            What it{" "}
            <span className="relative inline-block">
              actually
              <Highlight />
            </span>{" "}
            does.
          </h2>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
          {items.map((it, i) => (
            <Reveal key={it.title} delay={i + 1}>
              <article className="card-sketch flex h-full flex-col">
                <div className="inline-flex size-12 items-center justify-center rounded-2xl bg-primary text-text [&_svg]:size-6">
                  {it.icon}
                </div>
                <h3 className="mt-5 font-display text-[24px] leading-tight">
                  {it.title}
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-text-soft">
                  {it.body}
                </p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================== */
/*  Pricing                                                         */
/* ============================================================== */
const PRO = ["Up to 3 bots", "10 docs per bot", "5,000 replies / month", "Owner Mini App"];
const BIZ = [
  "Up to 10 bots",
  "50 docs per bot",
  "50,000 replies / month",
  "Priority queue",
  "Custom tone presets",
  "Direct line to founders",
];

function Pricing() {
  return (
    <section
      id="pricing"
      className="relative border-y-2 border-text bg-surface py-24 md:py-32"
    >
      <div className="mx-auto max-w-[1200px] px-5">
        <Reveal>
          <div className="flex flex-col items-start gap-4 md:flex-row md:items-end md:justify-between">
            <h2 className="max-w-[18ch] font-display text-[36px] leading-tight md:text-[48px]">
              Pay in Stars.
              <br />
              <span className="relative inline-block">
                Cancel any time.
                <Squiggle className="!absolute left-0 -bottom-1 text-text" />
              </span>
            </h2>
            <p className="max-w-[40ch] text-[15.5px] text-text-soft md:text-right">
              7-day trial on every plan. Trial starts when you launch your first
              bot — not when you sign up.
            </p>
          </div>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2">
          <Reveal delay={1}>
            <PriceCard
              tier="Pro"
              stars={300}
              blurb="For solo operators and small studios."
              features={PRO}
              cta="Start Pro trial"
            />
          </Reveal>
          <Reveal delay={2}>
            <PriceCard
              featured
              tier="Business"
              stars={700}
              blurb="For teams handling hundreds of chats a week."
              features={BIZ}
              cta="Start Business trial"
            />
          </Reveal>
        </div>

        <p className="mt-8 text-center font-mono text-[12px] uppercase tracking-[0.18em] text-text-muted">
          Stars are Telegram's native currency · billed monthly via the Bot API
        </p>
      </div>
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
        "card-sketch relative flex h-full flex-col " +
        (featured ? "!bg-text !text-paper" : "")
      }
    >
      <div className="flex items-center justify-between">
        <span
          className={
            "chip " +
            (featured
              ? "!bg-paper/15 !text-paper"
              : "")
          }
        >
          {tier}
        </span>
        {featured ? (
          <span className="chip !bg-paper/15 !text-paper">
            <HeartDoodle />
            Best for teams
          </span>
        ) : null}
      </div>

      <div className="mt-7 flex items-baseline gap-2">
        <span className="font-display text-[64px] leading-none md:text-[72px]">
          {stars}
        </span>
        <StarDoodle
          className={featured ? "text-paper" : "text-primary-ink"}
        />
        <span
          className={
            "ml-1 font-mono text-[13px] " +
            (featured ? "text-paper/65" : "text-text-muted")
          }
        >
          / month
        </span>
      </div>

      <p
        className={
          "mt-3 max-w-[40ch] text-[15px] leading-relaxed " +
          (featured ? "text-paper/80" : "text-text-soft")
        }
      >
        {blurb}
      </p>

      <ul className="mt-7 space-y-3">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-3 text-[15px]">
            <CheckDoodle
              className={
                featured
                  ? "text-paper mt-1 size-4 shrink-0"
                  : "text-success mt-1 size-4 shrink-0"
              }
            />
            <span className={featured ? "text-paper/90" : "text-text"}>
              {f}
            </span>
          </li>
        ))}
      </ul>

      <a
        href={DEEP_LINK}
        target="_blank"
        rel="noreferrer"
        className={
          "btn-sketch mt-8 w-full justify-center " +
          (featured ? "!bg-paper !text-text" : "btn-sketch--accent")
        }
      >
        {cta}
        <ArrowRightDoodle />
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
    a: "No. Reception works on any Telegram bot you create through @BotFather — which is completely free. Telegram Premium is only needed if you also want the bot to reply inside your personal Telegram chats via the Business API, and that's strictly optional.",
  },
  {
    q: "What does it use to answer customers?",
    a: "Every reply is grounded in the documents you upload. If a customer asks something your docs don't cover, Reception says so and (optionally) pings you to take over.",
  },
  {
    q: "How is my data handled?",
    a: "Bot tokens are encrypted at rest with AES-GCM. Documents are stored privately to your tenant — never used to train any shared model.",
  },
  {
    q: "Can I pause it instantly?",
    a: "Yes. The Mini App has a kill switch per bot. Toggle it and replies pause immediately; customer messages are queued, not lost.",
  },
  {
    q: "What happens after the trial?",
    a: "Bots pause until you subscribe. Your documents and settings stay exactly where they are — re-subscribe and everything picks back up.",
  },
  {
    q: "Is there an API?",
    a: "Not yet. Reception is opinionated and built for non-technical owners first. If you want a managed integration, message us inside the Mini App.",
  },
];

function Faq() {
  return (
    <section id="faq" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-[900px] px-5">
        <Reveal>
          <h2 className="font-display text-[36px] leading-tight md:text-[48px]">
            Questions, answered.
          </h2>
        </Reveal>

        <div className="mt-10 divide-y-2 divide-text border-y-2 border-text">
          {FAQS.map((f, i) => (
            <FaqRow key={i} q={f.q} a={f.a} idx={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FaqRow({ q, a, idx }: { q: string; a: string; idx: number }) {
  const [open, setOpen] = useState(false);
  const id = `faq-${idx}`;
  return (
    <Reveal delay={idx + 1}>
      <h3>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={id}
          className="flex w-full items-center justify-between gap-6 py-5 text-left"
        >
          <span className="font-display text-[20px] leading-tight md:text-[22px]">
            {q}
          </span>
          <span
            aria-hidden
            className={
              "grid size-9 shrink-0 place-items-center rounded-full bg-text text-paper transition-transform duration-300 ease-[var(--ease)] " +
              (open ? "rotate-180" : "")
            }
          >
            <ChevronDoodle />
          </span>
        </button>
      </h3>
      <div
        id={id}
        className={
          "grid overflow-hidden transition-[grid-template-rows,opacity] duration-500 ease-[var(--ease)] " +
          (open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")
        }
      >
        <div className="min-h-0">
          <p className="max-w-[64ch] pb-6 text-[15px] leading-relaxed text-text-soft">
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
  return (
    <section className="relative py-20 md:py-28">
      <div className="mx-auto max-w-[1200px] px-5">
        <Reveal>
          <div className="card-sketch !bg-text !text-paper relative overflow-hidden !p-10 md:!p-16">
            <div
              aria-hidden
              className="absolute right-10 top-8 hidden text-paper/35 anim-wiggle md:block"
            >
              <ScribbleCircle className="w-24 h-24" />
            </div>
            <div className="grid items-center gap-8 md:grid-cols-12">
              <div className="md:col-span-7">
                <h2
                  className="font-display leading-[1.05]"
                  style={{ fontSize: "clamp(2rem, 4.6vw, 3.6rem)" }}
                >
                  Stop missing customers.
                </h2>
                <p className="mt-4 max-w-[44ch] text-[16px] leading-relaxed text-paper/70">
                  Install Reception on a real bot in under a minute. First seven
                  days are on us. If it doesn't pull its weight — walk away.
                </p>
              </div>
              <div className="md:col-span-5 md:justify-self-end">
                <a
                  href={DEEP_LINK}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-sketch !bg-paper !text-text"
                >
                  Launch in Telegram
                  <ArrowUpRightDoodle />
                </a>
                <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-paper/55">
                  No card. No download.
                </p>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================== */
/*  Foot                                                            */
/* ============================================================== */
function Foot() {
  return (
    <footer className="border-t-2 border-text py-8">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-6 px-5">
        <div className="flex items-center gap-3">
          <DoodleLogo className="size-7" />
          <span className="font-display text-[18px] leading-none">
            Reception
          </span>
          <span className="hidden font-mono text-[11px] text-text-muted sm:inline">
            made for Telegram bots
          </span>
        </div>
        <nav className="flex flex-wrap items-center gap-4 font-mono text-[13px] text-text-soft">
          <a href="#features" className="press hover:text-text">Features</a>
          <a href="#pricing" className="press hover:text-text">Pricing</a>
          <a href="#faq" className="press hover:text-text">FAQ</a>
          <a
            href="https://github.com/BraveRam/custom-tg-agent"
            target="_blank"
            rel="noreferrer"
            className="press hover:text-text"
          >
            GitHub
          </a>
        </nav>
        <p className="font-mono text-[11px] text-text-muted">
          © {new Date().getFullYear()} Reception
        </p>
      </div>
    </footer>
  );
}
