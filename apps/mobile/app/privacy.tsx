/**
 * Privacy Policy — Full privacy disclosure for FilmSnaps.
 *
 * Explains what data is / isn't collected, how it's stored,
 * and the app's commitment to user privacy.
 *
 * Redesigned for readability: larger section titles, more spacing,
 * numbered sections, subtle dividers, softer bullets, unified text color.
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
import { BackIcon } from "../components/Icons";
import { useSafeNavigation } from "@/lib/navigation";
import { colors } from "../theme/colors";

const GITHUB = "https://github.com/anonymous260260a-arch/filmsnaps";

export default function PrivacyScreen() {
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
          Privacy Policy
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

        <PBody>Last updated: August 2026</PBody>

        <PSection num={++sectionIndex} title="Your Privacy, by Default">
          <PBody>
            We believe privacy is a fundamental right, not a premium feature.
          </PBody>
          <PBody extraMargin>
            FilmSnaps is built with a <PBold>zero-knowledge design</PBold>. We
            don't collect, store, or send any personal data to our servers.
            Everything stays on your device — no accounts, no tracking, no
            exceptions.
          </PBody>
        </PSection>

        <PDivider />

        <PSection
          num={++sectionIndex}
          title="What We Collect: Nothing Personal"
        >
          <PBody>
            The only network requests FilmSnaps makes are anonymous movie and TV
            lookups through our TMDB proxy (so the API key stays off your
            device). These requests carry <PBold>no user ID</PBold>, no watch
            history, and no browsing data.
          </PBody>
          <PBody extraMargin>
            There are no analytics SDKs, no crash reporters, no tracking pixels,
            no cookies, and no device fingerprinting anywhere in the app.
          </PBody>
        </PSection>

        <PDivider />

        <PSection num={++sectionIndex} title="What's Stored on Your Device">
          <PBody>
            The following data lives only on your phone. It never leaves your
            device:
          </PBody>
          <PBullet text="Watch history and progress (for the 'Continue Watching' feature)" />
          <PBullet text="Your personal watchlist and bookmarked titles" />
          <PBullet text="App settings (preferred providers, subtitle defaults, UI preferences)" />
          <PBullet text="Offline downloads (saved to your device's shared media folders)" />
          <PBody extraMargin>
            You can delete any of this at any time through the app's settings,
            or by uninstalling FilmSnaps. Removing the app deletes all locally
            stored data.
          </PBody>
        </PSection>

        <PDivider />

        <PSection num={++sectionIndex} title="When You Stream">
          <PBody>
            When you play a video, your device connects directly to the
            provider's server. That provider may log your IP address as part of
            normal web operations — the same way any website does. FilmSnaps has
            no control over these third-party providers' data practices.
          </PBody>
          <PBody extraMargin>
            We strongly recommend using a <PBold>reputable VPN</PBold> if you'd
            like to keep your IP address private from streaming providers.
          </PBody>
          <PBody extraMargin>
            FilmSnaps also queries public metadata services (such as TMDB) for
            movie and TV information. Those requests are governed by the
            metadata provider's own privacy policy. For details on our security
            architecture, see the Transparency & Security page.
          </PBody>
        </PSection>

        <PDivider />

        <PSection num={++sectionIndex} title="Ad-Blocker Updates">
          <PBody>
            To keep the ad-blocking engine effective, the app periodically
            fetches updated filter rules from a static, public repository. This
            request contains no user identifiers, device IDs, or browsing
            history — it's a simple, anonymous file download. The filter lists
            are cryptographically signed so they can't be tampered with in
            transit.
          </PBody>
        </PSection>

        <PDivider />

        <PSection num={++sectionIndex} title="Your Data, Your Control">
          <PBody>
            Since we collect nothing, there's nothing on our servers to access,
            correct, or delete. All your data lives on your device — clear it in
            Settings, or uninstall the app to remove everything.
          </PBody>
          <PBody extraMargin>
            If you're in a region covered by privacy laws like GDPR or CCPA,
            those laws generally apply to organizations that collect personal
            information. Since we collect none, your practical rights reduce to
            the local-data control described above.
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
    </View>
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
