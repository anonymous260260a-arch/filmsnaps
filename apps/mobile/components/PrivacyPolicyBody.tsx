/**
 * PrivacyPolicyBody — shared scrollable privacy policy content.
 *
 * Used by two hosts:
 *  - `app/privacy.tsx` (full screen route with back header)
 *  - `LegalGate.tsx`   (inline inside the first-launch modal, since the
 *                       modal sits above the Stack and a pushed /privacy
 *                       route would otherwise be hidden behind it)
 */

import React from "react";
import { Text, View, ScrollView, Linking } from "react-native";
import { colors } from "../theme/colors";

const GITHUB = "https://github.com/anonymous260260a-arch/filmsnaps";

export default function PrivacyPolicyBody({
  bottomPadding = 40,
}: {
  bottomPadding?: number;
}) {
  let sectionIndex = 0;

  return (
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: bottomPadding,
      }}
      showsVerticalScrollIndicator={false}
    >
      <View
        className="w-16 h-0.5 mb-5"
        style={{ backgroundColor: colors.gold }}
      />

      <PBody>Last updated: September 2026</PBody>

      <PDivider />
      <PSection num={++sectionIndex} title="The Short Version">
        <PBullet text="FilmSnaps has no accounts — we don't know who you are." />
        <PBullet text="Your watch history, bookmarks, progress, and settings never leave your device." />
        <PBullet text="The Android app can send anonymous usage statistics and crash reports — on by default, off anytime in Settings." />
        <PBullet text="We never collect anything that can identify you: no identifiers, no IP addresses, no search text, no titles by name." />
      </PSection>

      <PDivider />

      <PSection num={++sectionIndex} title="What Stays on Your Device">
        <PBody>
          Watch history and progress, bookmarks, your download list, all
          settings, and downloaded files are stored only on your device and
          are never transmitted to us. Downloads are saved to your device's
          shared Downloads folder — like any file there, they remain after
          you uninstall FilmSnaps.
        </PBody>
      </PSection>

      <PDivider />

      <PSection num={++sectionIndex} title="Anonymous Usage Statistics (Optional)">
        <PBody>
          To know which streaming sources actually work and what to fix, the
          app sends small anonymous events — for example, whether a source
          succeeded or failed, roughly how long it took (rounded), whether
          playback stalled, which features get used, plus app version and
          connection type (Wi‑Fi or cellular). To measure source coverage we
          count the content ID (a TMDB number) of titles you open, in
          aggregate only. No title names, no search text, no URLs, and no
          free text are ever sent.
        </PBody>
        <PBody extraMargin>
          Statistics start after you accept the terms and stay on until you
          turn them off. Turning them off (Settings → Anonymous usage
          statistics) stops all sending immediately and clears anything
          queued.
        </PBody>
      </PSection>

      <PDivider />

      <PSection num={++sectionIndex} title="Crash Reports (Optional — Same Toggle)">
        <PBody>
          When the app crashes, a report — the error type and stack trace,
          with web addresses removed — is sent to Sentry, a third‑party
          crash-reporting service hosted in the United States, so we can fix
          crashes. The same toggle controls this.
        </PBody>
      </PSection>

      <PDivider />

      <PSection num={++sectionIndex} title="What We Never Collect">
        <PBody>
          No names, emails, or accounts (there are none) · no user, device,
          advertising, or session identifiers · no IP addresses (we never
          read or store them) · no search queries · no titles by name · no
          location · no advertising or tracking SDKs.
        </PBody>
      </PSection>

      <PDivider />

      <PSection num={++sectionIndex} title="Who FilmSnaps Connects To">
        <PBullet text="Our servers (Cloudflare): movie/TV metadata lookups (this keeps the TMDB API key off your device), app configuration (source list, announcements, player settings), ad-block filter updates, app update checks, and — if enabled — the anonymous statistics above." />
        <PBullet text="Cloudflare's public speed-test endpoint: only when the app needs to measure your connection (about 4 MB; results cached for a day)." />
        <PBullet text="The streaming source you choose: when you play or download, that provider sees your IP address — exactly as if you opened their site in a browser. We don't control this; a VPN hides it." />
        <PBullet text="Anime metadata (AniList, Kitsu, Shikimori) and subtitle services, when you use those features." />
      </PSection>

      <PDivider />

      <PSection num={++sectionIndex} title="How Long We Keep It">
        <PBody>
          Anonymous statistics are kept for up to 12 months, then deleted
          automatically. Crash reports follow Sentry's standard retention.
          Nothing on our side is linked to you, so there is no profile of
          you to expire.
        </PBody>
      </PSection>

      <PDivider />

      <PSection num={++sectionIndex} title="Your Control">
        <PBody>
          Everything personal to you is already in your hands — history,
          bookmarks, and settings live on your device, and clearing app data
          removes them. Because nothing we collect is linked to you, there
          is nothing of yours on our servers to access, correct, or delete —
          and turning statistics off stops all future collection instantly.
        </PBody>
      </PSection>

      <PDivider />

      <PSection num={++sectionIndex} title="Your Rights (GDPR / CCPA)">
        <PBody>
          These laws protect personal data. Our statistics and crash reports
          contain no identifiers and no IP addresses, so they aren't
          personal data — but if you ever want anything stopped, the
          Settings toggle works immediately, and you can reach us at{" "}
          <PBold>privacy@filmsnaps.app</PBold>.
        </PBody>
      </PSection>

      <PDivider />

      <PSection num={++sectionIndex} title="Children's Privacy">
        <PBody>
          FilmSnaps is not directed at children under 13. We do not knowingly
          collect any information from anyone, let alone children. If you
          believe a child has interacted with our services, please contact us.
        </PBody>
      </PSection>

      <PDivider />

      <PSection num={++sectionIndex} title="Security Research">
        <PBody>
          We welcome responsible disclosure of security vulnerabilities. If
          you discover a weakness in FilmSnaps, please open a security issue
          or pull request at our <PLink url={GITHUB}>GitHub repository</PLink>
          . We aim to acknowledge reports within 72 hours and work with you to
          resolve verified issues. Please do not publicly disclose a
          vulnerability until a fix is available.
        </PBody>
      </PSection>

      <PDivider />

      <PSection num={++sectionIndex} title="Changes to This Policy">
        <PBody>
          We may update this policy from time to time. When we do, we will
          update the "Last updated" date above and note the change in our
          public changelog. Because FilmSnaps is open source, you can also
          review the commit history to see exactly what changed. Continued use
          of the app after a change constitutes acceptance of the updated
          policy.
        </PBody>
      </PSection>

      <PDivider />

      <PSection num={++sectionIndex} title="Contact">
        <PBody>
          If you have questions about this privacy policy, please reach out
          via email at <PBold>privacy@filmsnaps.app</PBold>. For security
          vulnerabilities, please use{" "}
          <PLink url={GITHUB}>GitHub security issues</PLink> instead. See the
          Legal & DMCA page for our open-source license and terms.
        </PBody>
      </PSection>
    </ScrollView>
  );
}

// ── Sub-components ──

function PLink({ url, children }: { url: string; children?: React.ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: "Inter_500Medium",
        color: colors.info,
        textDecorationLine: "underline",
      }}
      onPress={() => Linking.openURL(url).catch(() => {})}
    >
      {children ?? url}
    </Text>
  );
}

function PDivider() {
  return (
    <View
      className="my-1"
      style={{ height: 1, backgroundColor: colors.borderSubtle }}
    />
  );
}

function PSection({
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

function PBody({
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

function PBold({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{ fontFamily: "Inter_600SemiBold", color: colors.textPrimary }}
    >
      {children}
    </Text>
  );
}

function PBullet({ text }: { text: string }) {
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