import React from "react";
import { Info } from "lucide-react";
import Link from "next/link";
import { LegalPageShell } from "@/components/legal/LegalPageShell";
import { JsonLd } from "@/components/JsonLd";
import {
  Section,
  SubSection,
  Body,
  Bold,
  Bullet,
} from "@/components/legal/LegalPrimitives";

const GITHUB = "https://github.com/anonymous260260a-arch/filmsnaps";

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
      "The risk is extremely low. The provider's page runs inside a sandboxed WebView — think of it as a locked, soundproof glass room inside your house. The provider can play their video inside that room, but they cannot open the door, look through the walls, or touch your actual files, photos, or passwords. No system is 100% secure, however, so we strongly recommend keeping your device's operating system up to date.",
    answer: (
      <Body>
        The risk is <Bold>extremely low</Bold>. The provider&apos;s page runs
        inside a sandboxed WebView — think of it as a locked, soundproof glass
        room inside your house. The provider can play their video inside that
        room, but they cannot open the door, look through the walls, or touch
        your actual files, photos, or passwords. No system is 100% secure,
        however, so we strongly recommend keeping your device&apos;s operating
        system up to date.
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
        full details, see the{" "}
        <Link
          href="/privacy"
          className="text-primary underline-offset-2 hover:underline"
        >
          Privacy Policy
        </Link>
        .
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
        VPN connection since it runs entirely on your device. If you&apos;re
        concerned about IP visibility, use a reputable VPN.
      </Body>
    ),
  },
  {
    question: "Is this legal?",
    answerText:
      "FilmSnaps does not host, distribute, or modify copyrighted content. The app simply provides a user interface to access publicly available embed pages — the same pages you could access by visiting the provider directly in any browser. Client-side ad-blocking is legal in most jurisdictions. However, copyright laws vary by country, and you are responsible for ensuring your use complies with the local laws where you live.",
    answer: (
      <Body>
        FilmSnaps does not host, distribute, or modify copyrighted content. The
        app simply provides a user interface to access publicly available embed
        pages — the same pages you could access by visiting the provider
        directly in any browser. Client-side ad-blocking is legal in most
        jurisdictions. However, copyright laws vary by country, and{" "}
        <Bold>
          you are responsible for ensuring your use complies with the local laws
          where you live
        </Bold>
        . See the{" "}
        <Link
          href="/legal"
          className="text-primary underline-offset-2 hover:underline"
        >
          Legal &amp; DMCA
        </Link>{" "}
        page for details.
      </Body>
    ),
  },
  {
    question: "How do I verify your privacy claims?",
    answerText:
      "Review our open-source code. Check that we have no analytics SDKs and no tracking pixels, and that the only requests our servers receive are anonymous metadata lookups (a TMDB proxy that keeps the API key server-side) which carry no personal data. Verify that all of your watch history, watchlist, and settings stay stored locally on your device. Our ad-blocking filter lists and security architecture are publicly documented in the codebase.",
    answer: (
      <Body>
        Review our{" "}
        <Link
          href={GITHUB}
          className="text-primary underline-offset-2 hover:underline"
        >
          open-source code
        </Link>
        . Check that we have no analytics SDKs and no tracking pixels, and that
        the only requests our servers receive are{" "}
        <Bold>anonymous metadata lookups</Bold> — a TMDB proxy that keeps the
        API key server-side — which carry no personal data. Verify that all of
        your watch history, watchlist, and settings stay stored locally on your
        device. Our ad-blocking filter lists and security architecture are
        publicly documented in the codebase — see the{" "}
        <Link
          href="/privacy"
          className="text-primary underline-offset-2 hover:underline"
        >
          Privacy Policy
        </Link>{" "}
        for what stays on your device.
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

export default function TransparencyPage() {
  return (
    <>
      <JsonLd data={faqSchema} />
      <LegalPageShell
        title="Transparency & Security"
        subtitle="Why the streaming web is dangerous, and how we engineered a privacy-first bridge to navigate it — explained with absolute transparency."
        icon={<Info className="h-10 w-10 text-primary" strokeWidth={1.5} />}
      >
        <p className="mb-2 text-sm font-medium text-faint">
          Last updated: August 2026
        </p>

        <p className="mb-8 text-base leading-7 text-muted-foreground">
          FilmSnaps is a privacy-first streaming interface that acts as a secure
          bridge between you and third-party video providers. We don&apos;t host
          content. We don&apos;t track you. We protect you from the hostile
          advertising ecosystems that free streaming sites rely on.
        </p>

        <Section title="The Problem We Solve">
          <Body>
            Free streaming sites don&apos;t just show annoying ads. They run a
            hostile advertising ecosystem aimed at your device. FilmSnaps acts
            as a <Bold>digital hazmat suit</Bold>: it lets you extract the video
            you want while neutralizing the dangerous environment it lives in.
          </Body>
          <Body extraMargin>
            When you visit free streaming sites in a normal browser, you&apos;re
            being targeted by <Bold>malvertising</Bold> — not just banners, but
            active threats: fake &quot;Download&quot; buttons that install
            spyware, scripts that secretly mine cryptocurrency using your CPU,
            and pop-ups that redirect you to scam sites.
          </Body>
          <Body extraMargin>
            This isn&apos;t speculation. You can verify our claims by auditing
            our open-source code at{" "}
            <Link
              href={GITHUB}
              className="text-primary underline-offset-2 hover:underline"
            >
              {GITHUB}
            </Link>
            .
          </Body>
        </Section>

        <Section title="How FilmSnaps Protects You">
          <Body>
            Protection is layered. If one layer misses a threat, the next
            catches it — like a corporate firewall, but running entirely on your
            device.
          </Body>

          <SubSection title="Layer 1: Sandboxed Isolation">
            <Body>
              The provider&apos;s page runs inside a sandboxed WebView, which
              isolates it from your device&apos;s files, photos, and other apps.
              Think of it as a locked, soundproof glass room inside your house:
              the provider can play their video inside, but they cannot open the
              door, look through the walls, or touch your actual files. While no
              sandbox is theoretically perfect, modern browser sandboxes are
              extremely robust.
            </Body>
          </SubSection>

          <SubSection title="Layer 2: Network-Level Blocking">
            <Body>
              Before any ad can load, our blocking engine checks the request
              against a database of known malicious domains — using a fast
              pattern-matching engine (an Aho-Corasick trie) at the network
              level. Because the check happens before the request leaves your
              device, ads and trackers never reach your screen.
            </Body>
          </SubSection>

          <SubSection title="Layer 3: Runtime Guards">
            <Body>
              We inject scripts into the provider&apos;s page that prevent
              pop-ups, intercept malicious code before it runs, and remove ad
              elements from the page. These guards also seal risky browser APIs
              (like <Bold>window.open</Bold>) that malware abuses to spawn
              pop-unders.
            </Body>
          </SubSection>

          <SubSection title="Layer 4: Session Trust">
            <Body>
              Once we verify a server is delivering actual video content (via
              MIME-type detection), we whitelist it for the session so playback
              is never interrupted by false positives. This keeps the video you
              actually want playing while everything else stays blocked.
            </Body>
          </SubSection>
        </Section>

        <Section title="What We Don't Do">
          <Bullet text="We don't host, store, or distribute any video content." />
          <Bullet text="We don't collect analytics, telemetry, or usage data." />
          <Bullet text="We don't show ads and have no advertising partnerships." />
          <Bullet text="We don't modify or re-encode video streams." />
          <Body extraMargin>
            We also don&apos;t guarantee that our blocking is 100% effective. Ad
            networks constantly evolve, and sophisticated ads may temporarily
            slip through until we update our rules. If you encounter an ad that
            got past our filters, please report it.
          </Body>
        </Section>

        <Section title="Open Source Verification">
          <Body>
            FilmSnaps is open source. We encourage you to audit our code, verify
            our privacy claims, and contribute improvements. Our ad-blocking
            filter lists are publicly available and updated regularly, and our
            security architecture is documented in the codebase with inline
            comments explaining each protection layer.
          </Body>
          <Body extraMargin>
            If you discover a security vulnerability, please follow responsible
            disclosure practices by opening a security issue or pull request at{" "}
            <Link
              href={GITHUB}
              className="text-primary underline-offset-2 hover:underline"
            >
              {GITHUB}
            </Link>
            .
          </Body>
        </Section>

        <Section title="Known Limitations">
          <Bullet text="Our WebView sandbox is strong but not theoretically impenetrable. Zero-day exploits in browser engines are rare but possible — keep your OS updated." />
          <Bullet text="Ad-blocking is a cat-and-mouse game. Some sophisticated ads may temporarily bypass our filters until we update our rules." />
          <Bullet text="We rely on third-party metadata (TMDB) for titles and descriptions. We have no control over TMDB's accuracy or availability." />
          <Bullet text="Offline downloads are stored in your device's shared Downloads folder (Android 10+). They remain on your device after uninstalling FilmSnaps." />
        </Section>

        <Section title="Frequently Asked Questions">
          <Body>
            Common questions about privacy, security, and the technology behind
            the scenes.
          </Body>
          {FAQS.map((faq, i) => (
            <div key={i} className="mb-4 mt-3">
              <p className="text-sm font-semibold leading-5 text-foreground">
                {faq.question}
              </p>
              <div className="mt-2 text-sm text-muted-foreground">
                {faq.answer}
              </div>
            </div>
          ))}
        </Section>

        <Section title="Related Pages">
          <Body>
            Read the{" "}
            <Link
              href="/privacy"
              className="text-primary underline-offset-2 hover:underline"
            >
              Privacy Policy
            </Link>{" "}
            for what stays on your device, and the{" "}
            <Link
              href="/legal"
              className="text-primary underline-offset-2 hover:underline"
            >
              Legal &amp; DMCA
            </Link>{" "}
            page for our open-source license and content disclaimer.
          </Body>
        </Section>
      </LegalPageShell>
    </>
  );
}
