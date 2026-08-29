/**
 * Legal & DMCA — Disclaimer page accessible from Settings.
 *
 * Note: The first-time legal gate is handled inline in _layout.tsx
 * (LegalGate component). This screen is only shown from Settings
 * after the user has already accepted.
 *
 * Redesigned for readability: larger section titles, more spacing,
 * numbered sections, subtle dividers, softer bullets, unified text color.
 * Stronger emphasis on user responsibility / developer non-liability.
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

export default function LegalScreen() {
  const nav = useSafeNavigation();
  const insets = useSafeAreaInsets();

  let sectionIndex = 0;

  return (
    <View
      className="flex-1"
      style={{ backgroundColor: colors.bg, paddingTop: insets.top }}
    >
      {/* Header with back button */}
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
          Legal & DMCA
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
          className="text-sm font-medium mb-6"
          style={{ color: colors.textTertiary }}
        >
          Last updated: August 2026
        </Text>

        <Section num={++sectionIndex} title="What FilmSnaps Is">
          <Body>
            FilmSnaps is an <Bold>open-source</Bold> app that helps you browse
            movie and TV information (from TMDB) and watch content from
            third-party providers — the same sites you could open in any
            browser. We strip out malicious ads so you can watch safely.
          </Body>
          <Body extraMargin>
            We do not scrape, index, or store any media files. We act solely as
            a bridge between your device and external sources. The full source
            code is publicly available at{" "}
            <LinkText url={GITHUB}>{GITHUB}</LinkText>, so anyone can inspect
            exactly how it works.
          </Body>
        </Section>

        <Divider />

        <Section num={++sectionIndex} title="We Don't Host Content">
          <Body>
            All videos you watch are hosted on third-party servers we don't own
            or control. FilmSnaps <Bold>never</Bold> uploads, stores, or
            distributes media files. We have no say over what content these
            providers make available, and we do not curate, review, or endorse
            it.
          </Body>
        </Section>

        <Divider />

        <Section num={++sectionIndex} title="Copyright & DMCA">
          <Body>
            FilmSnaps respects intellectual property. Because we don't host any
            content, <Bold>we cannot remove or block specific videos</Bold>.
            We're not a search engine, host, or distributor — we're a
            client-side interface.
          </Body>
          <Body extraMargin>
            If you're a copyright holder and believe your content is being
            hosted without authorization, here's what to do:
          </Body>
          <Bullet text="Find the actual hosting provider from the embed URL the content is served from." />
          <Bullet text="Send your DMCA takedown notice directly to that provider, following their published process." />
          <Bullet text="If a search engine still indexes it, submit a removal request to that search engine." />
          <Body extraMargin>
            FilmSnaps is not the appropriate recipient for DMCA notices
            regarding third-party media. Please direct all such notices to the
            parties above.
          </Body>
        </Section>

        <Divider />

        <Section num={++sectionIndex} title="Your Responsibility">
          <Body>
            By using FilmSnaps, <Bold>you accept full responsibility</Bold> for
            how you use the app. You agree to:
          </Body>
          <Bullet text="Follow all copyright laws in your country and jurisdiction." />
          <Bullet text="Only access and stream content you have the legal right to view." />
          <Bullet text="Accept full liability for any copyright infringement resulting from your use of third-party providers." />
          <Body extraMargin>
            You agree to <Bold>indemnify and hold harmless</Bold> the
            developers, contributors, and publishers of FilmSnaps from any
            claims, damages, losses, liabilities, costs, or legal expenses
            (including attorneys' fees) arising from your use of the app or your
            access to third-party content.
          </Body>
          <Body extraMargin>
            In plain terms:{" "}
            <Bold>
              the developers, contributors, and publishers of FilmSnaps bear no
              responsibility whatsoever for how you choose to use this
              application. You — the user — are solely and entirely responsible.
            </Bold>
          </Body>
        </Section>

        <Divider />

        <Section num={++sectionIndex} title="No Warranties">
          <Body>
            FilmSnaps is provided on an <Bold>"as is" and "as available"</Bold>{" "}
            basis with no warranties of any kind — express or implied —
            including merchantability, fitness for a particular purpose, or
            non-infringement.{" "}
            <Bold>
              The developers, contributors, and publishers are not responsible
              for any damages, data loss, or legal issues
            </Bold>{" "}
            that may arise from your use of the app or the third-party services
            it connects to.
          </Body>
        </Section>

        <Divider />

        <Section num={++sectionIndex} title="Liability Limits">
          <Body>
            To the maximum extent permitted by law,{" "}
            <Bold>
              the developers, contributors, and publishers of FilmSnaps shall
              not be liable
            </Bold>{" "}
            for any indirect, incidental, special, consequential, or punitive
            damages — including loss of profits, data, goodwill, or business
            interruption — arising from your use of, or inability to use, the
            application, even if advised of the possibility of such damages.
          </Body>
        </Section>

        <Divider />

        <Section num={++sectionIndex} title="Open-Source License (GPL-3.0)">
          <Body>
            FilmSnaps is released under the{" "}
            <Bold>GNU General Public License v3.0 (GPL-3.0)</Bold> — a free,
            copyleft license. You are free to use, study, modify, and
            redistribute the software, provided that any distribution of the
            software or a derivative work is also made available under the
            GPL-3.0 and that the complete corresponding source code is provided.
            The full license text is available in the repository at{" "}
            <LinkText url={GITHUB}>{GITHUB}</LinkText>. For details on the
            security architecture this license protects, see the Transparency &
            Security page.
          </Body>
        </Section>

        <Divider />

        <Section num={++sectionIndex} title="Abuse Reports">
          <Body>
            While we cannot remove content from third-party servers, if you
            discover that a specific third-party provider integrated into our
            app is exclusively dedicated to hosting malicious software or
            illegal content, you may report the provider integration to{" "}
            <Bold>abuse@filmsnaps.app</Bold>. We reserve the right to remove
            access to specific third-party APIs at our sole discretion.
          </Body>
          <Body extraMargin>
            Please note that we do not review or act on copyright complaints —
            those must be directed to the actual hosting providers as described
            in the DMCA section above.
          </Body>
        </Section>

        <Divider />

        <Section num={++sectionIndex} title="Your Local Laws Apply">
          <Body>
            FilmSnaps makes no representation that the application is
            appropriate or lawful in every country or territory.{" "}
            <Bold>
              You are responsible for complying with the laws of your own
              country or jurisdiction.
            </Bold>{" "}
            If any provision of these terms is held to be unenforceable, the
            remaining provisions shall remain in full force and effect.
          </Body>
        </Section>

        <Divider />

        <Section num={++sectionIndex} title="Changes to These Terms">
          <Body>
            We may update these terms from time to time. When we do, we will
            update the "Last updated" date above and note the change in our
            public changelog. Your continued use of FilmSnaps after any changes
            constitutes acceptance of the updated terms.
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
      onPress={() => Linking.openURL(url).catch(() => {})}
    >
      {children ?? url}
    </Text>
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
