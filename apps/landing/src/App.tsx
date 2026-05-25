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
            className="max-w-[20ch] font-display leading-[1.05]"
            style={{ fontSize: "clamp(2.4rem, 5.6vw, 4.8rem)" }}
          >
            An assistant that replies{" "}
            <span className="relative inline-block whitespace-nowrap">
              <span className="relative z-10">as you</span>
              <Highlight />
            </span>{" "}
            on{" "}
            <span className="relative inline-block">
              Telegram
              <Squiggle
                className="!absolute left-0 -bottom-2 text-text"
              />
            </span>
            .
          </h1>
        </Reveal>

        <Reveal delay={2}>
          <p className="mt-7 max-w-[58ch] text-[18px] leading-relaxed text-text-soft">
            Customers DM your personal Telegram handle as they always have —
            Reception answers from your docs in your voice. You see every
            message, you can take over any time, and the bot pings you the
            moment something needs a human.
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
              "No Premium required",
              "Works on your existing handle",
              "60-second setup",
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
              this is your handle, not a bot
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
      t: "Make a bot, drop the token",
      d: "Spin one up in @BotFather, copy the token, paste it in our onboarding chat. Stored encrypted, forgotten when you revoke.",
      icon: <PlaneDoodle />,
    },
    {
      n: "two",
      t: "Enable business mode",
      d: "In @BotFather → your bot → Bot Settings → Business Mode → On. One toggle. We'll remind you.",
      icon: <BoltDoodle />,
    },
    {
      n: "three",
      t: "Add it to your Telegram",
      d: "Telegram → Settings → Telegram Business → Chatbots → add your bot and grant Reply + Read permissions.",
      icon: <LockDoodle />,
    },
    {
      n: "four",
      t: "Go live as yourself",
      d: "Customers DM your handle as always. Reception replies in your voice, escalates to you when it's not sure.",
      icon: <ChatDoodle />,
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
              Four steps. <br className="md:hidden" />
              <span className="relative inline-block">
                About a minute.
                <Squiggle className="!absolute left-0 -bottom-1 text-text" />
              </span>
            </h2>
            <p className="max-w-[40ch] text-[15.5px] text-text-soft md:text-right">
              No code, no Premium, no separate inbox. You stay in your own
              Telegram chat — there's just a brain underneath now.
            </p>
          </div>
        </Reveal>

        <ol className="mt-14 grid grid-cols-1 gap-10 sm:grid-cols-2 md:gap-y-14 md:grid-cols-4 md:gap-x-10">
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
                <h3 className="mt-5 font-display text-[22px] leading-tight md:text-[24px]">
                  {s.t}
                </h3>
                <p className="mt-3 max-w-[36ch] text-[14.5px] leading-relaxed text-text-soft">
                  {s.d}
                </p>

                {/* Doodle arrow between steps on desktop */}
                {i < steps.length - 1 ? (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute -right-6 top-10 hidden text-text/30 anim-wiggle md:block"
                  >
                    <ScribbleArrow className="w-12 h-10 rotate-[-15deg]" />
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
      title: "Speaks as you, not as a bot",
      body: "Connected via Telegram's Business chatbot — customers see your handle, your photo, your replies. Reception is invisible underneath.",
    },
    {
      icon: <Sparkle />,
      title: "Grounded in your docs",
      body: "Every answer is pulled from the files you upload. If the docs don't cover it, Reception says so out loud and pings you to take over.",
    },
    {
      icon: <LockDoodle />,
      title: "You stay in control",
      body: "Every reply lands in your own Telegram chat. Edit, override, or jump in mid-conversation — Reception backs off the instant you type.",
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
    q: "Do I need Telegram Premium?",
    a: "No. Telegram opened the Business chatbot feature to every account, so Reception works on a regular free Telegram account. You also don't need any Premium-only features to send or receive Stars.",
  },
  {
    q: "Wait, customers chat with me directly — not a bot?",
    a: "Right. Your customers DM your personal Telegram handle the same way they always have. Reception connects via Telegram's official chatbot slot, so the replies show up under your own name and avatar. Your bot's handle never appears in the chat.",
  },
  {
    q: "How does it know what to say?",
    a: "Every reply is grounded in the documents you upload — PDFs, FAQs, menus, schedules. If a customer asks something your docs don't cover, Reception declines politely and forwards the message to you with full context so you can answer once and move on.",
  },
  {
    q: "Can I take over a conversation?",
    a: "Any time. The moment you reply in a chat yourself, Reception backs off for that thread. There's also a per-bot kill switch in the Mini App that pauses every reply at once.",
  },
  {
    q: "How is my data handled?",
    a: "Bot tokens are encrypted at rest with AES-GCM. Documents are stored privately to your tenant and never used to train any shared model. Conversations are scoped per Business connection and isolated between owners.",
  },
  {
    q: "What happens after the trial?",
    a: "Replies pause until you subscribe. Your documents and settings stay exactly where they are — re-subscribe and everything picks back up.",
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
