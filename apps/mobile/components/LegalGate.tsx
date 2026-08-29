/**
 * LegalGate — First-launch welcome screen with legal accordion.
 *
 * Redesigned per expert UX review (Document 02):
 * - Welcome layout with brand icon + value proposition
 * - Accordion-style legal sections (expand on tap, collapse by default)
 * - Ghost "Decline" button with confirmation + dead-end screen
 * - Simplified, clearer copy with strong user-responsibility language
 *
 * Extracted from _layout.tsx for maintainability.
 */

import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  LayoutAnimation,
  Platform,
  UIManager,
  Alert,
  BackHandler,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useSettings } from "../lib/settings";
import { colors } from "../theme/colors";

// Enable LayoutAnimation on Android
if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SECTIONS = [
  {
    key: "content",
    title: "Content Notice",
    body: () => (
      <Text
        className="text-sm leading-7"
        style={{ color: colors.textSecondary }}
      >
        FilmSnaps doesn't host or store any videos. Everything you watch comes
        from third-party services that aren't connected to us. We don't own,
        operate, or have access to their servers, and we have no control over
        what content they make available.
      </Text>
    ),
  },
  {
    key: "about",
    title: "About FilmSnaps",
    body: () => (
      <Text
        className="text-sm leading-7"
        style={{ color: colors.textSecondary }}
      >
        FilmSnaps is a free, open-source project. It's not a commercial
        streaming service — it's built by the community and available for anyone
        to inspect.
      </Text>
    ),
  },
  {
    key: "responsibility",
    title: "Your Responsibility",
    body: () => (
      <View>
        <Text
          className="text-sm leading-7"
          style={{ color: colors.textSecondary }}
        >
          By using FilmSnaps,{" "}
          <Text
            style={{
              fontFamily: "Inter_600SemiBold",
              color: colors.textPrimary,
            }}
          >
            you accept full responsibility
          </Text>{" "}
          for how you use the app. You agree to:
        </Text>
        <BulletItem text="Follow copyright laws where you live" />
        <BulletItem text="Only watch content you have the right to access" />
        <BulletItem text="Don't redistribute downloaded content" />
        <Text
          className="text-sm leading-7 mt-3"
          style={{ color: colors.textSecondary }}
        >
          <Text
            style={{
              fontFamily: "Inter_600SemiBold",
              color: colors.textPrimary,
            }}
          >
            The developers, contributors, and publishers of FilmSnaps are not
            responsible for any loss, damages, or legal issues
          </Text>{" "}
          arising from your use of the app or third-party content. You — the
          user — are solely and entirely responsible.
        </Text>
      </View>
    ),
  },
  {
    key: "warranty",
    title: "No Warranty",
    body: () => (
      <Text
        className="text-sm leading-7"
        style={{ color: colors.textSecondary }}
      >
        This software is provided "as is" with no warranties of any kind.{" "}
        <Text
          style={{ fontFamily: "Inter_600SemiBold", color: colors.textPrimary }}
        >
          The developers, contributors, and publishers are not responsible
        </Text>{" "}
        for any damages or legal issues that may arise from the use of this
        application.
      </Text>
    ),
  },
];

function BulletItem({ text }: { text: string }) {
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

export default function LegalGate() {
  const insets = useSafeAreaInsets();
  const { updateSetting } = useSettings();
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [showingDecline, setShowingDecline] = useState(false);

  const handleAccept = useCallback(() => {
    updateSetting("legalAccepted", true);
  }, [updateSetting]);

  const handleDecline = useCallback(() => {
    Alert.alert(
      "Decline Terms",
      "FilmSnaps requires acceptance of these terms to use. Are you sure you want to decline?",
      [
        { text: "Go Back", style: "cancel" },
        {
          text: "Decline",
          style: "destructive",
          onPress: () => setShowingDecline(true),
        },
      ],
    );
  }, []);

  const handleReviewTerms = useCallback(() => {
    setShowingDecline(false);
  }, []);

  const toggleSection = useCallback((key: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedSection((prev) => (prev === key ? null : key));
  }, []);

  // ── Decline dead-end screen ──
  if (showingDecline) {
    return (
      <View
        className="flex-1 items-center justify-center px-8"
        style={{ backgroundColor: colors.bg }}
      >
        <Image
          source={require("../assets/icon.png")}
          style={{ width: 72, height: 72, borderRadius: 18, marginBottom: 24 }}
          accessibilityLabel="FilmSnaps logo"
        />
        <Text
          style={{
            fontFamily: "PlayfairDisplay_700Bold",
            fontSize: 22,
            color: colors.textPrimary,
            textAlign: "center",
            marginBottom: 12,
          }}
        >
          You've declined the terms of use
        </Text>
        <Text
          className="text-sm leading-7 text-center"
          style={{ color: colors.textSecondary, marginBottom: 32 }}
        >
          You can delete FilmSnaps from your device, or review the terms again
          below.
        </Text>

        <TouchableOpacity
          onPress={handleReviewTerms}
          activeOpacity={0.8}
          className="w-full py-3.5 rounded-xl items-center mb-3"
          style={{ backgroundColor: colors.gold }}
        >
          <Text
            className="text-sm font-bold"
            style={{ color: colors.bg, fontFamily: "Inter_600SemiBold" }}
          >
            Review Terms Again
          </Text>
        </TouchableOpacity>

        {Platform.OS === "android" && (
          <TouchableOpacity
            onPress={() => BackHandler.exitApp()}
            activeOpacity={0.7}
            className="w-full py-3 rounded-xl items-center"
            style={{ backgroundColor: colors.skeletonBg }}
          >
            <Text
              className="text-sm"
              style={{ color: colors.zinc500, fontFamily: "Inter_500Medium" }}
            >
              Exit App
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // ── Main welcome + accordion screen ──
  return (
    <View
      className="flex-1"
      style={{ backgroundColor: colors.bg, paddingTop: insets.top }}
    >
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 160 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Centered brand area */}
        <View className="items-center pt-8 pb-6">
          <Image
            source={require("../assets/icon.png")}
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              marginBottom: 16,
            }}
            accessibilityLabel="FilmSnaps logo"
          />
          <Text
            style={{
              fontFamily: "PlayfairDisplay_700Bold",
              fontSize: 18,
              color: colors.gold,
              textAlign: "center",
              lineHeight: 26,
            }}
          >
            Your personal cinema,
            {"\n"}anywhere.
          </Text>
        </View>

        {/* Gold accent divider */}
        <View
          className="w-12 h-0.5 mx-auto mb-6"
          style={{ backgroundColor: colors.gold }}
        />

        {/* Accordion sections */}
        {SECTIONS.map((section) => {
          const isExpanded = expandedSection === section.key;
          return (
            <View
              key={section.key}
              className="mb-2 rounded-xl overflow-hidden"
              style={{
                borderWidth: 1,
                borderColor: colors.borderSubtle,
              }}
            >
              <TouchableOpacity
                onPress={() => toggleSection(section.key)}
                activeOpacity={0.7}
                className="flex-row items-center justify-between px-4 py-3.5"
                style={{ backgroundColor: colors.bgCard }}
              >
                <Text
                  className="text-sm tracking-wide flex-1 mr-2"
                  style={{
                    color: colors.gold,
                    fontFamily: "Inter_600SemiBold",
                  }}
                >
                  {section.title}
                </Text>
                <Ionicons
                  name={isExpanded ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={colors.gold}
                />
              </TouchableOpacity>
              {isExpanded && (
                <View
                  className="px-4 pt-1 pb-4"
                  style={{ backgroundColor: colors.bgCard }}
                >
                  <section.body />
                </View>
              )}
            </View>
          );
        })}

        {/* Summary line */}
        <Text
          className="text-sm text-center mt-6 leading-6"
          style={{ color: colors.textSecondary }}
        >
          By tapping "I Understand", you accept these terms.
        </Text>
      </ScrollView>

      {/* Fixed bottom: Accept + Decline */}
      <View
        className="absolute bottom-0 left-0 right-0 px-5 pt-4"
        style={{
          backgroundColor: colors.bg,
          paddingBottom: insets.bottom + 16,
        }}
      >
        <TouchableOpacity
          onPress={handleAccept}
          activeOpacity={0.8}
          className="w-full py-3.5 rounded-xl items-center"
          style={{ backgroundColor: colors.gold }}
        >
          <Text
            className="text-sm font-bold"
            style={{ color: colors.bg, fontFamily: "Inter_600SemiBold" }}
          >
            I Understand
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleDecline}
          activeOpacity={0.7}
          className="w-full py-3 items-center"
        >
          <Text
            className="text-sm"
            style={{ color: colors.zinc500, fontFamily: "Inter_400Regular" }}
          >
            Decline
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
