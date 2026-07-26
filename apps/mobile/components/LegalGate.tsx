/**
 * LegalGate — First-launch welcome screen with legal accordion.
 *
 * Redesigned per expert UX review (Document 02):
 * - Welcome layout with brand icon + value proposition
 * - Accordion-style legal sections (expand on tap, collapse by default)
 * - Ghost "Decline" button with confirmation + dead-end screen
 * - Revised legal copy (removed "educational purposes" language)
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
      <Text className="text-sm leading-6" style={{ color: "#D4D4D8" }}>
        FilmSnaps does{" "}
        <Text style={{ fontFamily: "Inter_600SemiBold", color: "#F4F4F5" }}>
          not
        </Text>{" "}
        host, store, upload, or manage any video content, files, or media. All
        content accessed through this application is hosted by third-party
        services that are not affiliated with us.
      </Text>
    ),
  },
  {
    key: "affiliation",
    title: "No Affiliation",
    body: () => (
      <Text className="text-sm leading-6" style={{ color: "#D4D4D8" }}>
        We do not own, operate, or have any access to the servers that host the
        content you stream or download through this app. We do not control what
        content is available, how it is stored, or who has access to it. Any
        legal concerns regarding specific content must be directed to the actual
        content hosters and uploaders.
      </Text>
    ),
  },
  {
    key: "about",
    title: "About This Project",
    body: () => (
      <Text className="text-sm leading-6" style={{ color: "#D4D4D8" }}>
        FilmSnaps is an independent project and is not a commercial streaming
        service. It demonstrates open-source software development and modern
        mobile application architecture.
      </Text>
    ),
  },
  {
    key: "responsibility",
    title: "User Responsibility",
    body: () => (
      <View>
        <Text className="text-sm leading-6" style={{ color: "#D4D4D8" }}>
          As a user of this application, you are responsible for:
        </Text>
        <View className="flex-row items-start mt-2">
          <Text
            className="text-[10px] mt-1.5 mr-2.5"
            style={{ color: "#D4A237" }}
          >
            ■
          </Text>
          <Text
            className="text-sm leading-5 flex-1"
            style={{ color: "#D4D4D8" }}
          >
            Ensuring your use complies with local laws in your jurisdiction
          </Text>
        </View>
        <View className="flex-row items-start mt-2">
          <Text
            className="text-[10px] mt-1.5 mr-2.5"
            style={{ color: "#D4A237" }}
          >
            ■
          </Text>
          <Text
            className="text-sm leading-5 flex-1"
            style={{ color: "#D4D4D8" }}
          >
            Using the app only for accessing content you have the legal right to
            access
          </Text>
        </View>
        <View className="flex-row items-start mt-2">
          <Text
            className="text-[10px] mt-1.5 mr-2.5"
            style={{ color: "#D4A237" }}
          >
            ■
          </Text>
          <Text
            className="text-sm leading-5 flex-1"
            style={{ color: "#D4D4D8" }}
          >
            Not redistributing downloaded content or using it for commercial
            purposes
          </Text>
        </View>
      </View>
    ),
  },
  {
    key: "warranty",
    title: "No Warranty",
    body: () => (
      <Text className="text-sm leading-6" style={{ color: "#D4D4D8" }}>
        This software is provided "as is" without warranty of any kind. The
        developers and contributors are not responsible for any damages or legal
        issues that may arise from the use of this application.
      </Text>
    ),
  },
];

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
        style={{ backgroundColor: "#070708" }}
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
            color: "#F4F4F5",
            textAlign: "center",
            marginBottom: 12,
          }}
        >
          You've declined the terms of use
        </Text>
        <Text
          className="text-sm leading-6 text-center"
          style={{ color: "#A1A1AA", marginBottom: 32 }}
        >
          You can delete FilmSnaps from your device, or review the terms again
          below.
        </Text>

        <TouchableOpacity
          onPress={handleReviewTerms}
          activeOpacity={0.8}
          className="w-full py-3.5 rounded-xl items-center mb-3"
          style={{ backgroundColor: "#D4A237" }}
        >
          <Text
            className="text-sm font-bold"
            style={{ color: "#070708", fontFamily: "Inter_600SemiBold" }}
          >
            Review Terms Again
          </Text>
        </TouchableOpacity>

        {Platform.OS === "android" && (
          <TouchableOpacity
            onPress={() => BackHandler.exitApp()}
            activeOpacity={0.7}
            className="w-full py-3 rounded-xl items-center"
            style={{ backgroundColor: "#1C1C20" }}
          >
            <Text
              className="text-sm"
              style={{ color: "#71717A", fontFamily: "Inter_500Medium" }}
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
      style={{ backgroundColor: "#070708", paddingTop: insets.top }}
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
              color: "#D4A237",
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
          style={{ backgroundColor: "#D4A237" }}
        />

        {/* Accordion sections */}
        {SECTIONS.map((section) => {
          const isExpanded = expandedSection === section.key;
          return (
            <View key={section.key} className="mb-2 rounded-xl overflow-hidden">
              <TouchableOpacity
                onPress={() => toggleSection(section.key)}
                activeOpacity={0.7}
                className="flex-row items-center justify-between px-4 py-3.5"
                style={{ backgroundColor: "#0E0E11" }}
              >
                <Text
                  className="text-sm font-semibold"
                  style={{
                    color: "#D4A237",
                    fontFamily: "Inter_600SemiBold",
                  }}
                >
                  {section.title}
                </Text>
                <Ionicons
                  name={isExpanded ? "chevron-up" : "chevron-down"}
                  size={16}
                  color="#D4A237"
                />
              </TouchableOpacity>
              {isExpanded && (
                <View
                  className="px-4 py-3"
                  style={{ backgroundColor: "#0E0E11" }}
                >
                  <section.body />
                </View>
              )}
            </View>
          );
        })}

        {/* Summary line */}
        <Text
          className="text-xs text-center mt-6"
          style={{ color: "#A1A1AA", lineHeight: 18 }}
        >
          By continuing, you acknowledge and accept the above terms.
        </Text>
      </ScrollView>

      {/* Fixed bottom: Accept + Decline */}
      <View
        className="absolute bottom-0 left-0 right-0 px-5 pt-4"
        style={{
          backgroundColor: "#070708",
          paddingBottom: insets.bottom + 16,
        }}
      >
        <TouchableOpacity
          onPress={handleAccept}
          activeOpacity={0.8}
          className="w-full py-3.5 rounded-xl items-center"
          style={{ backgroundColor: "#D4A237" }}
        >
          <Text
            className="text-sm font-bold"
            style={{ color: "#070708", fontFamily: "Inter_600SemiBold" }}
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
            style={{ color: "#71717A", fontFamily: "Inter_400Regular" }}
          >
            Decline
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
