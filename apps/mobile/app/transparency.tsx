/**
 * Transparency & Security — explains the streaming threat landscape and the
 * layered protections FilmSnaps applies, plus a FAQ.
 *
 * Content mirrors apps/web/app/transparency. Rendered with plain (open)
 * sections; the FAQ entries are collapsible for readability on mobile.
 *
 * Redesigned for readability: numbered sections, friendlier layer titles,
 * softer bullets, subtle dividers, unified text color.
 */

import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { BackIcon } from "../components/Icons";
import { useSafeNavigation } from "@/lib/navigation";
import { colors } from "../theme/colors";

const GITHUB = "https://github.com/anonymous260260a-arch/filmsnaps";

export default function TransparencyScreen() {
  const nav = useSafeNavigation();
  const insets = useSafeAreaInsets();

  let sectionIndex = 0;

  return (
    <View
      className="flex-1"
      style={{ backgroundColor: colors.bg, paddingTop: insets.top }}
    >
      {/* Header */}
      <View className="px-5 pt-4 pb-2 flex-row items-center">
        <TouchableOpacity
          onPress={() => nav.goBack({ fallback: "/(tabs)" })}
          className="w-9 h-9 rounded-full bg-zinc-800/60 items-center justify-center mr-3"
          activeOpacity={0.7}
        >
          <BackIcon width={20} height={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text
          style={{
            fontFamily: "PlayfairDisplay_700Bold",
            fontSize: 22,
            color: colors.textPrimary,
          }}
        >
          Transparency & Security
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: 40,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View
          className="w-16 h-0.5 mb-5"
          style={{ backgroundColor: colors.gold }}
        />

        <Text
          className="text-sm leading-7 mb-6"
          style={{ color: colors.textSecondary }}
        >
          Last updated: August 2026
        </Text>

        <Text
          className="text-base leading-7 mb-6"
          style={{ color: colors.textSecondary }}
        >
          FilmSnaps is a privacy-first streaming interface. We don't host
          content, we don't track you, and we block the dangerous ads that free
          streaming sites throw at you.
        </Text>

        <Section num={++sectionIndex} title="The Problem We Solve">
          <Body>
            Free streaming sites don't just show annoying ads — they run active
            threats: fake download buttons that install spyware, crypto-mining
            scripts that hijack your CPU, and scam redirects. FilmSnaps acts as
            a <Bold>digital hazmat suit</Bold>, letting you extract the video
            while neutralizing everything else.
          </Body>
          <Body extraMargin>
            This isn't speculation. You can verify our claims by auditing our
            open-source code at <LinkText url={GITHUB}>{GITHUB}</LinkText>.
          </Body>
        </Section>

        <Divider />

        <Section num={++sectionIndex} title="How FilmSnaps Protects You">
          <Body>
            Protection is layered. If one layer misses a threat, the next
            catches it — like a corporate firewall, but running entirely on your
            device.
          </Body>

          <SubSection title="Sandbox — Your Device Stays Sealed">
            <Body>
              The provider's page runs inside a sandboxed WebView, isolating it
              from your device's files, photos, and other apps. Think of it as a
              locked, soundproof glass room inside your house: the provider can
              play their video inside, but they cannot open the door, look
              through the walls, or touch your actual files. While no sandbox is
              theoretically perfect, modern browser sandboxes are extremely
              robust.
            </Body>
          </SubSection>

          <SubSection title="Ad Blocker — Threats Blocked Before Loading">
            <Body>
              Before any ad can load, our blocking engine checks the request
              against a database of known malicious domains — using a fast
              pattern-matching engine (an Aho-Corasick trie) at the network
              level. Because the check happens before the request leaves your
              device, ads and trackers never reach your screen.
            </Body>
          </SubSection>

          <SubSection title="Runtime Guards — Pop-ups & Malware Neutralized">
            <Body>
              We inject scripts into the provider's page that prevent pop-ups,
              intercept malicious code before it runs, and remove ad elements
              from the page. These guards also seal risky browser APIs (like{" "}
              <Bold>window.open</Bold>) that malware abuses to spawn pop-unders.
            </Body>
          </SubSection>

          <SubSection title="Smart Trust — Video Plays, Ads Don't">
            <Body>
              Once we verify a server is delivering actual video content (via
              MIME-type detection), we whitelist it for the session so playback
              is never interrupted by false positives. This keeps the video you
              actually want playing while everything else stays blocked.
            </Body>
          </SubSection>
        </Section>

        <Divider />

        <Section num={++sectionIndex} title="What We Don't Do">
          <Body>To be completely transparent:</Body>
          <Bullet text="We don't host, store, or distribute any video content." />
          <Bullet text="We don't collect analytics, telemetry, or usage data." />
          <Bullet text="We don't show ads and have no advertising partnerships." />
          <Bullet text="We don't modify or re-encode video streams." />
          <Body extraMargin>
            We also don't guarantee that our blocking is 100% effective. Ad
            networks constantly evolve, and sophisticated ads may temporarily
            slip through until we update our rules. If you encounter an ad that
            got past our filters, please report it.
          </Body>
        </Section>

        <Divider />

        <Section num={++sectionIndex} title="Open Source Verification">
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
            <LinkText url={GITHUB}>{GITHUB}</LinkText>.
          </Body>
        </Section>

        <Divider />

        <Section num={++sectionIndex} title="Known Limitations">
          <Bullet text="Our WebView sandbox is strong but not theoretically impenetrable. Zero-day exploits in browser engines are rare but possible — keep your OS updated." />
          <Bullet text="Ad-blocking is a cat-and-mouse game. Some sophisticated ads may temporarily bypass our filters until we update our rules." />
          <Bullet text="We rely on third-party metadata (TMDB) for titles and descriptions. We have no control over TMDB's accuracy or availability." />
          <Bullet text="Offline downloads are stored in your device's shared Downloads folder (Android 10+). They remain on your device after uninstalling FilmSnaps." />
        </Section>

        <Divider />

        <Section num={++sectionIndex} title="Frequently Asked Questions">
          <Body>
            Common questions about privacy, security, and the technology behind
            the scenes.
          </Body>

          <FaqItem question="Why are streaming provider sites so dangerous?">
            <Body>
              Hosting high-definition video is incredibly expensive. To survive,
              third-party providers rely on the darkest corners of the ad-tech
              industry. When you visit these sites in a normal browser, you are
              targeted by <Bold>malvertising</Bold> — fake download buttons that
              install spyware, crypto-jacking scripts that hijack your CPU, and
              aggressive pop-unders. FilmSnaps blocks these not just to clean up
              the screen, but because they are active security threats.
            </Body>
          </FaqItem>

          <FaqItem question="Can streaming providers steal my data or hack my device?">
            <Body>
              The risk is <Bold>extremely low</Bold>. The provider's page runs
              inside a sandboxed WebView — think of it as a locked, soundproof
              glass room inside your house. The provider can play their video
              inside that room, but they cannot open the door, look through the
              walls, or touch your actual files, photos, or passwords. No system
              is 100% secure, however, so we strongly recommend keeping your
              device's operating system up to date.
            </Body>
          </FaqItem>

          <FaqItem question="What can a provider do with my IP address?">
            <Body>
              The provider sees your IP address — just like every website you
              visit in any browser. With just an IP address, they cannot
              identify you personally, cannot access your device, and cannot
              cause you any harm. An IP address only reveals the approximate
              region you're connecting from. FilmSnaps does not share your IP
              with anyone beyond the provider you chose to watch from.
            </Body>
          </FaqItem>

          <FaqItem question="Does FilmSnaps collect my personal data?">
            <Body>
              <Bold>No.</Bold> FilmSnaps does not collect, store, or transmit
              any personal data to external servers. Your watch history,
              watchlist, and settings stay on your device and are removed when
              you uninstall the app. There are no analytics SDKs, no tracking
              pixels, and no telemetry. For full details, see the Privacy
              Policy.
            </Body>
          </FaqItem>

          <FaqItem question="Do you sell my data or share it with advertisers?">
            <Body>
              <Bold>Never.</Bold> FilmSnaps has no advertising, no ad
              partnerships, and no data-sharing agreements. We do not collect
              data to sell, and we do not show ads ourselves. The ad blocking
              technology exists solely to protect you from third-party threats.
              There is no business incentive to collect or share your data.
            </Body>
          </FaqItem>

          <FaqItem question="Can I use a VPN with FilmSnaps?">
            <Body>
              Yes, a VPN works perfectly with FilmSnaps. Using a VPN will change
              the IP address visible to streaming providers, which is highly
              recommended for maximum privacy. The ad blocking system works
              independently of your VPN connection since it runs entirely on
              your device. If you're concerned about IP visibility, use a
              reputable VPN.
            </Body>
          </FaqItem>

          <FaqItem question="Is this legal?">
            <Body>
              FilmSnaps does not host, distribute, or modify copyrighted
              content. The app simply provides a user interface to access
              publicly available embed pages — the same pages you could access
              by visiting the provider directly in any browser. Client-side
              ad-blocking is legal in most jurisdictions. However, copyright
              laws vary by country, and{" "}
              <Bold>
                you are responsible for ensuring your use complies with the
                local laws where you live
              </Bold>
              . See the Legal & DMCA page for details.
            </Body>
          </FaqItem>

          <FaqItem question="How do I verify your privacy claims?">
            <Body>
              Review our <LinkText url={GITHUB}>open-source code</LinkText>.
              Check that we have no analytics SDKs and no tracking pixels, and
              that the only requests our servers receive are{" "}
              <Bold>anonymous metadata lookups</Bold> — a TMDB proxy that keeps
              the API key server-side — which carry no personal data. Verify
              that all of your watch history, watchlist, and settings stay
              stored locally on your device. Our ad-blocking filter lists and
              security architecture are publicly documented in the codebase.
            </Body>
          </FaqItem>
        </Section>

        <Divider />

        <Section num={++sectionIndex} title="Related Pages">
          <Body>
            Read the Privacy Policy for what stays on your device, and the Legal
            & DMCA page for our open-source license and content disclaimer.
          </Body>
        </Section>
      </ScrollView>
    </View>
  );
}

// ── Sub-components ──

function Divider() {
  return (
    <View
      className="my-1"
      style={{ height: 1, backgroundColor: colors.borderSubtle }}
    />
  );
}

function Section({
  num,
  title,
  children,
}: {
  num: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mb-6 mt-2">
      <View className="flex-row items-center mb-3">
        <Text
          className="text-xs mr-2.5"
          style={{ color: colors.textTertiary, fontFamily: "Inter_500Medium" }}
        >
          {String(num).padStart(2, "0")}
        </Text>
        <Text
          className="text-base uppercase tracking-wider"
          style={{ color: colors.gold, fontFamily: "Inter_600SemiBold" }}
        >
          {title}
        </Text>
      </View>
      {children}
    </View>
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
    <View className="mb-4 mt-4">
      <Text
        className="text-sm font-semibold mb-2"
        style={{ color: colors.gold, fontFamily: "Inter_600SemiBold" }}
      >
        {title}
      </Text>
      {children}
    </View>
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
    <Text
      className={`text-sm leading-7 ${extraMargin ? "mt-3" : ""}`}
      style={{ color: colors.textSecondary }}
    >
      {children}
    </Text>
  );
}

function Bold({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{ fontFamily: "Inter_600SemiBold", color: colors.textPrimary }}
    >
      {children}
    </Text>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View className="flex-row items-start mt-2.5">
      <Text className="text-[8px] mt-1.5 mr-3" style={{ color: colors.gold }}>
        ●
      </Text>
      <Text
        className="text-sm leading-6 flex-1"
        style={{ color: colors.textSecondary }}
      >
        {text}
      </Text>
    </View>
  );
}

function LinkText({
  url,
  children,
}: {
  url: string;
  children?: React.ReactNode;
}) {
  return (
    <Text
      style={{
        fontFamily: "Inter_500Medium",
        color: colors.info,
        textDecorationLine: "underline",
      }}
      onPress={() => {
        Linking.openURL(url).catch(() => {});
      }}
    >
      {children ?? url}
    </Text>
  );
}

function FaqItem({
  question,
  children,
}: {
  question: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <View
      className="mb-3 mt-2 rounded-xl overflow-hidden"
      style={{
        backgroundColor: colors.bgCard,
        borderWidth: 1,
        borderColor: colors.borderSubtle,
      }}
    >
      <TouchableOpacity
        onPress={() => setOpen(!open)}
        activeOpacity={0.7}
        className="flex-row items-center px-4 py-3.5"
      >
        <Text
          className="flex-1 text-sm leading-5 pr-2"
          style={{ color: colors.textPrimary, fontFamily: "Inter_500Medium" }}
        >
          {question}
        </Text>
        <Ionicons
          name={open ? "remove-circle-outline" : "add-circle-outline"}
          size={18}
          color={colors.gold}
        />
      </TouchableOpacity>
      {open && (
        <View className="px-4 pb-4 pt-1">
          <View
            className="w-full h-[1px] mb-3"
            style={{ backgroundColor: colors.borderSubtle }}
          />
          {children}
        </View>
      )}
    </View>
  );
}
