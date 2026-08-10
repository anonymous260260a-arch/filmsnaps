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
// Single source of truth for the Frequently Asked Questions section. Each FAQ
// has an `answerText` (plain text, used for the FAQPage JSON-LD) and `answer`
// (the rich JSX rendered in the accordion). NOTE: Radix renders closed
// accordion items with children: false, so the answer text is NOT in the HTML
// until the item is opened — the FAQPage schema below is what guarantees the
// answers exist in markup for search engines and AI crawlers.
const FAQS: {
  question: string;
  answerText: string;
  answer: React.ReactNode;
}[] = [
  {
    question: "Can streaming providers steal my data or hack my device?",
    answerText:
      "Zero percent chance. The provider's page runs inside a sandboxed WebView — a stripped-down browser that has no access to your device's storage, file system, contacts, apps, or any other personal data. It cannot execute code outside that WebView, cannot read app state, and cannot install anything on your device. The WebView is destroyed completely when you leave the player, leaving zero traces behind. All the provider sees is a standard HTTP request for their embed page — exactly what a normal browser would send. They have no way to reach into the app or your device.",
    answer: (
      <Body>
        <Bold>Zero percent chance.</Bold> The provider&apos;s page runs inside a
        sandboxed WebView — a stripped-down browser that has no access to your
        device&apos;s storage, file system, contacts, apps, or any other
        personal data. It cannot execute code outside that WebView, cannot read
        app state, and cannot install anything on your device. The WebView is
        destroyed completely when you leave the player, leaving zero traces
        behind. All the provider sees is a standard HTTP request for their embed
        page — exactly what a normal browser would send. They have no way to
        reach into the app or your device.
      </Body>
    ),
  },
  {
    question: "What can a provider do with my IP address?",
    answerText:
      "The provider sees your IP address — just like every website you visit in any browser. With just an IP address, they cannot identify you personally, cannot access your device, and cannot cause you any harm. An IP address only reveals the approximate region you're connecting from (usually the city level) and the name of your internet service provider. This is the same information any website gets when you visit it. FilmSnaps does not share your IP with anyone beyond the provider you chose to watch from.",
    answer: (
      <Body>
        The provider sees your IP address — just like every website you visit in
        any browser. With just an IP address, they cannot identify you
        personally, cannot access your device, and cannot cause you any harm. An
        IP address only reveals the approximate region you&apos;re connecting
        from (usually the city level) and the name of your internet service
        provider. This is the same information any website gets when you visit
        it. FilmSnaps does not share your IP with anyone beyond the provider you
        chose to watch from.
      </Body>
    ),
  },
  {
    question: "Does FilmSnaps collect my personal data?",
    answerText:
      "No. FilmSnaps does not collect, store, or transmit any personal data to external servers. Everything — your watch history, saved content, downloads, and settings — stays on your device. There are no analytics SDKs, no tracking pixels, and no telemetry. For full details, see the Privacy Policy in Settings.",
    answer: (
      <Body>
        <Bold>No.</Bold> FilmSnaps does not collect, store, or transmit any
        personal data to external servers. Everything — your watch history,
        saved content, downloads, and settings — stays on your device. There are
        no analytics SDKs, no tracking pixels, and no telemetry. For full
        details, see the Privacy Policy in Settings.
      </Body>
    ),
  },
  {
    question: "Can the app get malware from a provider's page?",
    answerText:
      "No. The WebView is sandboxed at the operating system level. A webpage inside a WebView cannot install software, modify system files, or access other apps. It is one of the most locked-down environments a web page can run in. Additionally, the guard scripts block known malicious patterns, popups, and redirect attempts before they can execute. Between the OS sandbox and the app's security layers, there is no realistic path for malware to reach your device through streaming.",
    answer: (
      <Body>
        <Bold>No.</Bold> The WebView is sandboxed at the operating system level.
        A webpage inside a WebView cannot install software, modify system files,
        or access other apps. It is one of the most locked-down environments a
        web page can run in. Additionally, the guard scripts block known
        malicious patterns, popups, and redirect attempts before they can
        execute. Between the OS sandbox and the app&apos;s security layers,
        there is no realistic path for malware to reach your device through
        streaming.
      </Body>
    ),
  },
  {
    question:
      "What happens if a provider's page has a virus or malicious script?",
    answerText:
      "Malicious scripts inside a WebView are contained by the same sandbox that isolates legitimate content. JavaScript in a WebView cannot access the file system, read app data, make network requests outside the browser context, or exploit the host app. Furthermore, the guard scripts actively block common exploit techniques: popups are sealed, redirects are intercepted, and known script injection patterns are neutralised. Even in the worst case (a fully compromised embed page), the attacker gains nothing — they are trapped inside a browser view with no escape route to the device.",
    answer: (
      <Body>
        Malicious scripts inside a WebView are contained by the same sandbox
        that isolates legitimate content. JavaScript in a WebView cannot access
        the file system, read app data, make network requests outside the
        browser context, or exploit the host app. Furthermore, the guard scripts
        actively block common exploit techniques: popups are sealed, redirects
        are intercepted, and known script injection patterns are neutralised.
        Even in the worst case (a fully compromised embed page), the attacker
        gains nothing — they are trapped inside a browser view with no escape
        route to the device.
      </Body>
    ),
  },
  {
    question: "Do you sell my data or share it with advertisers?",
    answerText:
      "Never. FilmSnaps has no advertising, no ad partnerships, and no data-sharing agreements. We do not collect data to sell, and we do not show ads ourselves. The ad blocking technology exists solely to clean up the third-party provider pages — not to replace their ads with our own. There is no business incentive to collect or share your data.",
    answer: (
      <Body>
        <Bold>Never.</Bold> FilmSnaps has no advertising, no ad partnerships,
        and no data-sharing agreements. We do not collect data to sell, and we
        do not show ads ourselves. The ad blocking technology exists solely to
        clean up the third-party provider pages — not to replace their ads with
        our own. There is no business incentive to collect or share your data.
      </Body>
    ),
  },
  {
    question: "Why do I sometimes see a brief popup before it gets blocked?",
    answerText:
      "The ad blocking layers work at different speeds. Network-level blocking (Layer 1) stops requests before they leave the device — these ads never load at all. But some ads are injected by the page's own JavaScript after the page loads (same-origin). These require the DOM observer (Layer 3) to detect and remove them, which can take a few hundred milliseconds. You might see a flash of an ad container before it is removed. This is harmless and does not mean the ad was fully rendered or tracked.",
    answer: (
      <Body>
        The ad blocking layers work at different speeds. Network-level blocking
        (Layer 1) stops requests before they leave the device — these ads never
        load at all. But some ads are injected by the page&apos;s own JavaScript
        after the page loads (same-origin). These require the DOM observer
        (Layer 3) to detect and remove them, which can take a few hundred
        milliseconds. You might see a flash of an ad container before it is
        removed. This is harmless and does not mean the ad was fully rendered or
        tracked.
      </Body>
    ),
  },
  {
    question: "Can I use a VPN with FilmSnaps?",
    answerText:
      "Yes, a VPN works fine with FilmSnaps. Using a VPN will change the IP address visible to streaming providers, which can be useful if you want additional privacy or need to access region-specific content. The ad blocking system works independently of your VPN connection since it runs entirely on your device at the network request layer.",
    answer: (
      <Body>
        Yes, a VPN works fine with FilmSnaps. Using a VPN will change the IP
        address visible to streaming providers, which can be useful if you want
        additional privacy or need to access region-specific content. The ad
        blocking system works independently of your VPN connection since it runs
        entirely on your device at the network request layer.
      </Body>
    ),
  },
  {
    question: "How often are the ad blocklists updated?",
    answerText:
      "The app checks for updated blocklist configurations on startup and refreshes them every 6 hours while the app is running. Filter lists are compiled from EasyList, EasyPrivacy, and AdGuard — which are updated by their respective communities daily. The app also maintains custom provider-specific rules that are updated as providers change their layouts.",
    answer: (
      <Body>
        The app checks for updated blocklist configurations on startup and
        refreshes them every 6 hours while the app is running. Filter lists are
        compiled from EasyList, EasyPrivacy, and AdGuard — which are updated by
        their respective communities daily. The app also maintains custom
        provider-specific rules that are updated as providers change their
        layouts.
      </Body>
    ),
  },
  {
    question: "Is this legal?",
    answerText:
      "FilmSnaps does not host, distribute, or modify copyrighted content. The app simply provides a user interface to access publicly available embed pages — the same pages you could access by visiting the provider directly in any browser. The ad blocking is a client-side privacy measure, which has been upheld as legal in numerous jurisdictions (similar to AdBlock Plus, uBlock Origin, and Brave Browser's built-in blocking). For more details, see the Legal & DMCA page in Settings.",
    answer: (
      <Body>
        FilmSnaps does not host, distribute, or modify copyrighted content. The
        app simply provides a user interface to access publicly available embed
        pages — the same pages you could access by visiting the provider
        directly in any browser. The ad blocking is a client-side privacy
        measure, which has been upheld as legal in numerous jurisdictions
        (similar to AdBlock Plus, uBlock Origin, and Brave Browser&apos;s
        built-in blocking). For more details, see the Legal &amp; DMCA page in
        Settings.
      </Body>
    ),
  },
];

// FAQPage structured data — guarantees the answers are present in markup even
// though closed accordion items render children: false in the HTML.
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
        title="How Content Works"
        subtitle="Content sourcing, ad blocking technology & transparency"
        icon={<Info className="h-10 w-10 text-amber-500" strokeWidth={1.5} />}
      >
        <p className="mb-8 text-sm leading-6 text-zinc-400">
          Everything you need to know about how FilmSnaps sources content,
          blocks ads, and protects your privacy — explained transparently.
        </p>

        <Accordion type="single" collapsible className="w-full">
          <SectionItem value="sources" title="Content Sources">
            <Body>
              FilmSnaps does not host, store, or upload any video content. When
              you watch a movie or TV show, the app fetches an embed page from a
              third-party streaming provider whose servers are independent and
              unrelated to us.
            </Body>
            <Bullet text="Multiple sources (providers) are available for most titles" />
            <Bullet text="If one source fails, the app automatically tries the next available" />
            <Bullet text="You can set a default source in Settings → Default Source" />
            <Bullet text="Providers are community-curated and may change over time" />
          </SectionItem>

          <SectionItem value="streaming" title="How Streaming Works">
            <Body>
              When you press &quot;Watch&quot;, the app loads the
              provider&apos;s embed page inside a sandboxed WebView — a
              dedicated browser view that is isolated from the rest of the app.
              The WebView:
            </Body>
            <Bullet text="Renders only the provider's video player interface" />
            <Bullet text="Has no access to your device data, cookies, or app storage" />
            <Bullet text="Is destroyed when you leave the player, leaving no traces" />
            <Bullet text="Supports fullscreen playback, subtitles, and audio track selection" />
          </SectionItem>

          <SectionItem value="adblock" title="Ad Blocking Technology">
            <Body>
              FilmSnaps blocks ads and trackers at multiple layers — similar to
              how Brave Browser blocks unwanted content before it can load. The
              system is layered so that even if one layer misses something, the
              next catches it.
            </Body>

            <SubSection title="Layer 1: Network-Level Blocking (Brave-Style)">
              <Body>
                Every network request made by the WebView passes through a
                native ad-blocking engine before it reaches the network. This
                engine:
              </Body>
              <Bullet text="Maintains a list of known ad, tracker, and popup domains compiled from EasyList, EasyPrivacy, and AdGuard filter lists" />
              <Bullet text="Uses an Aho-Corasick pattern matcher for fast lookups — checks every URL in O(L) time regardless of list size" />
              <Bullet text="Keeps a session-based trust list: once a host serves real video content, all its future requests bypass blocking for that session" />
              <Bullet text="Supports allow-list exceptions so that video CDNs and required player assets are never blocked" />
            </SubSection>

            <SubSection title="Layer 2: Cosmetic Filtering">
              <Body>
                Some ads are injected by the page&apos;s own JavaScript and
                cannot be blocked at the network level. For these, the app
                injects CSS rules that hide ad containers, popup overlays, and
                banner elements — they are never rendered on screen.
              </Body>
            </SubSection>

            <SubSection title="Layer 3: Runtime Guard Scripts">
              <Body>
                When the WebView loads a provider page, the app injects a
                comprehensive guard script before any page code runs. This
                script:
              </Body>
              <Bullet text="Seals window.open — popup attempts return null silently" />
              <Bullet text="Intercepts fetch and XMLHttpRequest calls targeting ad domains" />
              <Bullet text="Watches for new DOM elements and removes ad iframes the moment they appear" />
              <Bullet text="Blocks service worker registration used for ad injection" />
              <Bullet text="Prevents anti-adblock detection that some providers use to detect ad blockers" />
            </SubSection>

            <SubSection title="Layer 4: Anti-Anti-Adblock Scriptlets">
              <Body>
                Some providers run scripts that detect ad blockers and either
                break the player or show nag screens. The app neutralises these
                by:
              </Body>
              <Bullet text="Forcing ad-related JavaScript variables (adsEnabled, canShowAds, etc.) to always return false" />
              <Bullet text="Aborting scripts that try to read popup or ad variables" />
              <Bullet text="Preventing visibility-change and focus/blur listeners that detect popup blocking" />
              <Bullet text="Cloaking native function signatures so that providers cannot detect our monkey-patches" />
            </SubSection>

            <SubSection title="Layer 5: Provider-Specific Rules">
              <Body>
                Each streaming provider has unique ad patterns. The app
                maintains per-provider blocking rules, custom CSS selectors, and
                known ad URL patterns that are updated regularly to adapt to
                changes in provider layouts.
              </Body>
            </SubSection>
          </SectionItem>

          <SectionItem value="ads" title="How Likely Are You to See Ads?">
            <Body>
              The ad blocking system is designed to catch the vast majority of
              ads before they load. Most users will see a clean, ad-free
              experience 99%+ of the time. However:
            </Body>

            <SubSection title="What Gets Blocked">
              <Bullet text="Popups and popunders — completely blocked" />
              <Bullet text="Banner ads and overlay ads — hidden via CSS or removed from DOM" />
              <Bullet text="Video pre-roll / mid-roll ads — blocked at network level when served from known ad CDNs" />
              <Bullet text="Analytics and tracking scripts — prevented from loading" />
              <Bullet text="Crypto miners — blocked at domain level" />
              <Bullet text="Redirect attempts to ad landing pages — intercepted at the native layer" />
            </SubSection>

            <SubSection title="What Might Slip Through">
              <Body>In rare circumstances, you may still encounter an ad:</Body>
              <Bullet text="Ads served from the same CDN as the video content (server-side ad insertion) cannot be distinguished from legitimate video — blocking them would block the video too" />
              <Bullet text="Newly deployed ad domains not yet in our blocklists — these are added as we identify them" />
              <Bullet text="Ads injected via first-party JavaScript that load from the provider's own domain (same-origin ads)" />
              <Bullet text="Provider layouts can change, temporarily breaking CSS hiding rules until we update them" />
            </SubSection>

            <SubSection title="What We Do When Something Slips Through">
              <Body>
                The blocklist configuration is updated regularly. The app checks
                for updated blocking rules on startup and fetches the latest
                patterns from our configuration server. We also welcome reports
                of missed ads so we can add them to the blocklist.
              </Body>
            </SubSection>
          </SectionItem>

          <SectionItem value="notes" title="Important Notes">
            <Body>
              <Bold>No content is modified or re-encoded.</Bold> The app simply
              requests the same embed page that any browser would load, and
              strips out the unwanted elements before they affect your
              experience.
            </Body>
            <Body extraMargin>
              <Bold>This is not a VPN or proxy.</Bold> The ad blocking happens
              entirely on your device. Your IP address is still visible to the
              streaming provider when you watch content.
            </Body>
            <Body extraMargin>
              <Bold>No user data is sent to any ad-blocking service.</Bold> The
              blocklist is fetched as a static JSON file. No information about
              your browsing or watching activity is transmitted.
            </Body>
            <Body extraMargin>
              <Bold>Providers can change at any time.</Bold> If a provider
              updates their page layout, the player may temporarily break or
              show ads until the app&apos;s rules are updated accordingly.
            </Body>
          </SectionItem>

          <SectionItem value="technical" title="Technical Summary">
            <Body>FilmSnaps uses a layered defence model:</Body>
            <div className="mt-3 mb-1 overflow-hidden rounded-xl border border-zinc-800 bg-[#121218]">
              <TechRow
                label="Native engine"
                value="Aho-Corasick pattern matching"
                color="#D4A237"
              />
              <TechDivider />
              <TechRow
                label="Filter lists"
                value="EasyList, EasyPrivacy, AdGuard, custom"
                color="#22c55e"
              />
              <TechDivider />
              <TechRow
                label="Cosmetic CSS"
                value="Per-provider element hiding"
                color="#3b82f6"
              />
              <TechDivider />
              <TechRow
                label="Guard JS"
                value="15-layer runtime protection"
                color="#a78bfa"
              />
              <TechDivider />
              <TechRow
                label="Session trust"
                value="Auto-allow video CDNs"
                color="#f59e0b"
              />
              <TechDivider />
              <TechRow
                label="Update cadence"
                value="On-startup + 6-hour TTL"
                color="#ec4899"
              />
            </div>
          </SectionItem>

          <SectionItem value="faq" title="Frequently Asked Questions">
            <Body>
              Common questions about how FilmSnaps works, your privacy, and the
              technology behind the scenes.
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
    <AccordionItem value={value} className="border-b border-zinc-800">
      <AccordionTrigger className="text-sm font-semibold text-zinc-100">
        {title}
      </AccordionTrigger>
      <AccordionContent className="pb-4 text-zinc-400">
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
    <div className="mb-4 mt-3">
      <h3 className="mb-2 text-xs font-semibold text-[#D4A237]">{title}</h3>
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
  return <strong className="font-semibold text-zinc-200">{children}</strong>;
}

function Bullet({ text }: { text: string }) {
  return (
    <p className="mt-2 flex items-start gap-2.5 text-sm leading-5">
      <span className="mt-1.5 text-[10px] leading-none text-[#D4A237]">■</span>
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
    <div className="mb-3 mt-2">
      <p className="text-sm font-semibold leading-5 text-zinc-200">
        {question}
      </p>
      <div className="mt-2">{answer}</div>
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
        className="mr-2.5 h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="flex-1 text-xs text-zinc-400">{label}</span>
      <span className="text-right text-xs text-zinc-100">{value}</span>
    </div>
  );
}

function TechDivider() {
  return <div className="mx-4 h-px bg-white/[0.06]" />;
}
