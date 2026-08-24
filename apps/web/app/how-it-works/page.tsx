import { Info } from "lucide-react";
import { LegalPageShell } from "@/components/legal/LegalPageShell";
import { JsonLd } from "@/components/JsonLd";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

// ── FAQ data ──
const FAQS: {
  question: string;
  answerText: string;
  answer: React.ReactNode;
}[] = [
  {
    question: "Why are streaming provider sites so dangerous?",
    answerText:
      "Hosting high-definition video for millions of users is incredibly expensive. To survive, third-party providers rely on aggressive, often malicious advertising networks. When you visit these sites in a normal browser, you are targeted by 'malvertising' — fake download buttons that install spyware, crypto-jacking scripts that hijack your CPU, and aggressive pop-unders. FilmSnaps blocks these not just to clean up the screen, but because they are active security threats.",
    answer: (
      <Body>
        Hosting high-definition video is incredibly expensive. To survive,
        third-party providers rely on the darkest corners of the ad-tech
        industry. When you visit these sites in a normal browser, you are
        targeted by <Bold>malvertising</Bold> — fake download buttons that
        install spyware, crypto-jacking scripts that hijack your CPU, and
        aggressive pop-unders. FilmSnaps blocks these not just to clean up the
        screen, but because they are active security threats.
      </Body>
    ),
  },
  {
    question: "Can streaming providers steal my data or hack my device?",
    answerText:
      "Zero percent chance. The provider's page runs inside a sandboxed WebView — think of it as a locked, soundproof glass room inside your house. The provider can play their video inside that room, but they cannot open the door, look through the walls, or touch your actual files, photos, or passwords. When you close the player, the glass room is completely demolished, leaving zero traces behind.",
    answer: (
      <Body>
        <Bold>Zero percent chance.</Bold> The provider&apos;s page runs inside a
        sandboxed WebView — think of it as a locked, soundproof glass room
        inside your house. The provider can play their video inside that room,
        but they cannot open the door, look through the walls, or touch your
        actual files, photos, or passwords. When you close the player, the glass
        room is completely demolished, leaving zero traces behind.
      </Body>
    ),
  },
  {
    question: "What can a provider do with my IP address?",
    answerText:
      "The provider sees your IP address — just like every website you visit in any browser. With just an IP address, they cannot identify you personally, cannot access your device, and cannot cause you any harm. An IP address only reveals the approximate region you're connecting from. FilmSnaps does not share your IP with anyone beyond the provider you chose to watch from.",
    answer: (
      <Body>
        The provider sees your IP address — just like every website you visit in
        any browser. With just an IP address, they cannot identify you
        personally, cannot access your device, and cannot cause you any harm. An
        IP address only reveals the approximate region you&apos;re connecting
        from. FilmSnaps does not share your IP with anyone beyond the provider
        you chose to watch from.
      </Body>
    ),
  },
  {
    question: "Does FilmSnaps collect my personal data?",
    answerText:
      "No. FilmSnaps does not collect, store, or transmit any personal data to external servers. Your watch history, watchlist, and settings stay on your device and are removed when you uninstall the app. There are no analytics SDKs, no tracking pixels, and no telemetry. For full details, see the Privacy Policy.",
    answer: (
      <Body>
        <Bold>No.</Bold> FilmSnaps does not collect, store, or transmit any
        personal data to external servers. Your watch history, watchlist, and
        settings stay on your device and are removed when you uninstall the app.
        There are no analytics SDKs, no tracking pixels, and no telemetry. For
        full details, see the Privacy Policy.
      </Body>
    ),
  },
  {
    question: "Do you sell my data or share it with advertisers?",
    answerText:
      "Never. FilmSnaps has no advertising, no ad partnerships, and no data-sharing agreements. We do not collect data to sell, and we do not show ads ourselves. The ad blocking technology exists solely to protect you from third-party threats. There is no business incentive to collect or share your data.",
    answer: (
      <Body>
        <Bold>Never.</Bold> FilmSnaps has no advertising, no ad partnerships,
        and no data-sharing agreements. We do not collect data to sell, and we
        do not show ads ourselves. The ad blocking technology exists solely to
        protect you from third-party threats. There is no business incentive to
        collect or share your data.
      </Body>
    ),
  },
  {
    question: "Can I use a VPN with FilmSnaps?",
    answerText:
      "Yes, a VPN works perfectly with FilmSnaps. Using a VPN will change the IP address visible to streaming providers, which is highly recommended for maximum privacy. The ad blocking system works independently of your VPN connection since it runs entirely on your device.",
    answer: (
      <Body>
        Yes, a VPN works perfectly with FilmSnaps. Using a VPN will change the
        IP address visible to streaming providers, which is highly recommended
        for maximum privacy. The ad blocking system works independently of your
        VPN connection since it runs entirely on your device.
      </Body>
    ),
  },
  {
    question: "Is this legal?",
    answerText:
      "FilmSnaps does not host, distribute, or modify copyrighted content. The app simply provides a user interface to access publicly available embed pages — the same pages you could access by visiting the provider directly in any browser. The ad blocking is a client-side privacy measure, which has been upheld as legal in numerous jurisdictions.",
    answer: (
      <Body>
        FilmSnaps does not host, distribute, or modify copyrighted content. The
        app simply provides a user interface to access publicly available embed
        pages — the same pages you could access by visiting the provider
        directly in any browser. The ad blocking is a client-side privacy
        measure, which has been upheld as legal in numerous jurisdictions.
      </Body>
    ),
  },
];

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.answerText,
    },
  })),
};

export default function HowItWorksPage() {
  return (
    <>
      <JsonLd data={faqSchema} />
      <LegalPageShell
        title="Transparency & Security"
        subtitle="Why the streaming web is dangerous, and how we engineered a privacy-first vault to navigate it."
        icon={<Info className="h-10 w-10 text-primary" strokeWidth={1.5} />}
      >
        <p className="mb-8 text-base leading-7 text-muted-foreground">
          Everything you need to know about how FilmSnaps sources content,
          neutralizes threats, and protects your privacy — explained with
          absolute transparency.
        </p>

        <Accordion type="single" collapsible className="w-full">
          <SectionItem
            value="reality"
            title="The Reality of Free Streaming (Why We Block)"
          >
            <Body>
              Hosting high-definition video for millions of users is incredibly
              expensive. To survive, third-party streaming providers rely on the
              darkest corners of the advertising industry.
            </Body>
            <Body extraMargin>
              When you visit these sites in a standard browser, you aren't just
              seeing annoying banners. You are navigating a minefield of{" "}
              <Bold>malvertising</Bold> (malicious advertising). Providers are
              often forced to serve aggressive pop-unders, fake "Download"
              buttons that install spyware, crypto-jacking scripts that hijack
              your CPU, and redirects to betting scams.
            </Body>
            <Body extraMargin>
              FilmSnaps doesn't block ads just to make the screen look clean.{" "}
              <Bold>
                We block them because they are active security threats.
              </Bold>{" "}
              Our app acts as a digital hazmat suit, allowing you to extract the
              video you want while neutralizing the hostile environment it lives
              in.
            </Body>
          </SectionItem>

          <SectionItem value="sources" title="Content Sources & The Sandbox">
            <Body>
              FilmSnaps does not host, store, or upload any video content. When
              you watch a movie, the app fetches an embed page from a
              third-party provider. To protect you, this page is loaded inside a{" "}
              <Bold>Sandboxed WebView</Bold>.
            </Body>
            <Body extraMargin>
              Think of the WebView as a locked, soundproof glass room inside
              your house. The provider is allowed to play their video inside
              that room, but they cannot open the door, look through the walls,
              or touch anything in your actual house (your files, photos, or
              passwords). When you close the app, the glass room is completely
              demolished.
            </Body>
            <Bullet text="Zero access to your device storage, contacts, or app data" />
            <Bullet text="Multiple sources available; auto-fallback if one fails" />
            <Bullet text="The environment is destroyed on exit, leaving zero traces" />
          </SectionItem>

          <SectionItem
            value="adblock"
            title="The 5-Layer Security Architecture"
          >
            <Body>
              FilmSnaps blocks threats at multiple layers — similar to how
              enterprise firewalls protect corporate networks. If one layer
              misses a threat, the next catches it.
            </Body>

            <SubSection title="Layer 1: Network-Level Interception">
              <Body>
                Every network request passes through a native, high-speed
                blocking engine before it reaches the internet. It acts as a
                digital bouncer, checking URLs against known malicious domains
                in O(L) time using an Aho-Corasick pattern matcher.
              </Body>
            </SubSection>

            <SubSection title="Layer 2: Cosmetic Element Hiding">
              <Body>
                Some ads are injected by the page's own code. We inject
                counter-CSS rules that instantly hide ad containers, fake
                download buttons, and overlay traps before they can render on
                your screen.
              </Body>
            </SubSection>

            <SubSection title="Layer 3: Runtime Guard Scripts">
              <Body>
                Before the provider's JavaScript can execute, we inject a guard
                script that seizes control of the environment:
              </Body>
              <Bullet text="Seals window.open — popup attempts return null silently" />
              <Bullet text="Intercepts network calls targeting ad domains" />
              <Bullet text="Watches the DOM and instantly removes malicious iframes" />
              <Bullet text="Blocks service workers used for background tracking" />
            </SubSection>

            <SubSection title="Layer 4: Anti-Detection Cloaking">
              <Body>
                Providers try to detect if you are using an ad-blocker. We
                neutralize their detection scripts by forcing ad-related
                variables to always return false, and cloaking our native
                function signatures so their scripts cannot detect our presence.
              </Body>
            </SubSection>

            <SubSection title="Layer 5: Session Trust & Video Allow-listing">
              <Body>
                To ensure the video never breaks, our engine uses "Session
                Trust". Once a server is verified to be serving actual video
                data (via MIME-type detection), it is temporarily whitelisted,
                ensuring your playback is never interrupted by false positives.
              </Body>
            </SubSection>
          </SectionItem>

          <SectionItem
            value="downloads"
            title="Offline Downloads & Local Storage"
          >
            <Body>
              FilmSnaps lets you download movies to watch offline. We believe in
              true ownership of your offline media.
            </Body>
            <Bullet text="Saved to your device's shared Downloads folder (Android 10+)" />
            <Bullet text="Playable in any external app (VLC, MX Player) via the system share sheet" />
            <Bullet text="Files remain on your device even if you uninstall FilmSnaps" />
            <Bullet text="Watch history and settings remain strictly app-private and are wiped on uninstall" />
          </SectionItem>

          <SectionItem value="technical" title="Technical Summary">
            <Body>
              For power users and engineers, here is the stack powering your
              privacy:
            </Body>
            <div className="mt-3 mb-1 overflow-hidden rounded-xl border border-border bg-card">
              <TechRow
                label="Core Engine"
                value="Rust-compiled Aho-Corasick Trie"
                color="text-primary"
              />
              <TechDivider />
              <TechRow
                label="Filter Lists"
                value="EasyList, EasyPrivacy, AdGuard"
                color="text-green-500"
              />
              <TechDivider />
              <TechRow
                label="Injection Layer"
                value="CDP & Document-Start JS"
                color="text-blue-500"
              />
              <TechDivider />
              <TechRow
                label="Update Cadence"
                value="Ed25519 Signed OTA (6h TTL)"
                color="text-pink-500"
              />
            </div>
          </SectionItem>

          <SectionItem value="faq" title="Frequently Asked Questions">
            <Body>
              Common questions about privacy, security, and the technology
              behind the scenes.
            </Body>
            {FAQS.map((faq, i) => (
              <FaqItem key={i} question={faq.question} answer={faq.answer} />
            ))}
          </SectionItem>
        </Accordion>
      </LegalPageShell>
    </>
  );
}

// ── Sub-components ──

function SectionItem({
  value,
  title,
  children,
}: {
  value: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <AccordionItem value={value} className="border-b border-border">
      <AccordionTrigger className="text-base font-semibold text-foreground">
        {title}
      </AccordionTrigger>
      <AccordionContent className="pb-6 text-muted-foreground">
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}

function SubSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 mt-4">
      {/* Used uppercase tracking-wider and text-primary for design system consistency */}
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Body({
  children,
  extraMargin,
}: {
  children: React.ReactNode;
  extraMargin?: boolean;
}) {
  return (
    <p className={`text-sm leading-6 ${extraMargin ? "mt-3" : ""}`}>
      {children}
    </p>
  );
}

function Bold({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-foreground">{children}</strong>;
}

function Bullet({ text }: { text: string }) {
  return (
    <p className="mt-2 flex items-start gap-2.5 text-sm leading-5">
      <span className="mt-1.5 text-[10px] leading-none text-primary">■</span>
      <span>{text}</span>
    </p>
  );
}

function FaqItem({
  question,
  answer,
}: {
  question: string;
  answer: React.ReactNode;
}) {
  return (
    <div className="mb-4 mt-3">
      <p className="text-sm font-semibold leading-5 text-foreground">
        {question}
      </p>
      <div className="mt-2 text-sm text-muted-foreground">{answer}</div>
    </div>
  );
}

function TechRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-center px-4 py-2.5">
      <span
        className={`mr-2.5 h-2 w-2 shrink-0 rounded-full bg-current ${color}`}
      />
      <span className="flex-1 text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-xs font-medium text-foreground">
        {value}
      </span>
    </div>
  );
}

function TechDivider() {
  return <div className="mx-4 h-px bg-white/[0.06]" />;
}
