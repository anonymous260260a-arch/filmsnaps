/**
 * Settings — playback, downloads, streaming source and support.
 *
 * Navigation hub for the app: media preference, storage management, default
 * source, and support resources. Rows are single-line wherever the label is
 * enough, so the page reads as four short groups instead of a wall of cards.
 */

import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Switch,
  Share,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useSafeNavigation } from "@/lib/navigation";
import { useSettings } from "../../lib/settings";
import { useDownloadList } from "../../lib/download";
import { getProvidersForMode, isProviderAvailableOn } from "@filmsnaps/shared";
import { getInfoAsync, documentDirectory } from "expo-file-system/legacy";
import Constants from "expo-constants";
import { colors } from "../../theme/colors";
import { tabBarClearance } from "../../theme/layout";
import * as Haptics from "expo-haptics";
import { LanguagePromptSheet } from "../../components/player/LanguagePromptSheet";
import { SpeedLimitSheet, formatSpeed } from "../../components/SpeedLimitSheet";
import { trackFeatureUsed } from "../../lib/telemetry";
import { useSlotImpression } from "../../hooks/useSlotImpression";
import { AdSlot } from "../../lib/ads";

const GITHUB_URL = "https://github.com/anonymous260260a-arch/filmsnaps";
const WEBSITE_URL = "https://filmsnap-pro.netlify.app/";

// Row geometry — one icon column, one gap, one divider inset everywhere.
const ROW_PADDING_H = 16;
const ICON_BOX = 20;
const ICON_GAP = 12;
const DIVIDER_INSET = ROW_PADDING_H + ICON_BOX + ICON_GAP;

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    sizes.length - 1,
  );
  const val = bytes / Math.pow(k, i);
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${sizes[i]}`;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginBottom: 28 }}>
      <Text
        style={{
          fontSize: 12,
          fontFamily: "Inter_500Medium",
          color: colors.textTertiary,
          letterSpacing: 0.2,
          paddingHorizontal: 4,
          marginBottom: 8,
        }}
      >
        {title}
      </Text>
      <View
        style={{
          backgroundColor: colors.bgSurface,
          borderRadius: 14,
          borderWidth: 0.5,
          borderColor: colors.borderSubtle,
          overflow: "hidden",
        }}
      >
        {children}
      </View>
    </View>
  );
}

function ListRow({
  icon,
  label,
  subtitle,
  value,
  right,
  chevron,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle?: string;
  value?: string;
  right?: React.ReactNode;
  chevron?: boolean;
  onPress?: () => void;
}) {
  const Container: React.ComponentType<any> = onPress ? TouchableOpacity : View;
  return (
    <Container
      onPress={
        onPress
          ? () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
                () => {},
              );
              onPress();
            }
          : undefined
      }
      activeOpacity={onPress ? 0.7 : 1}
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: 52,
        paddingHorizontal: ROW_PADDING_H,
        paddingVertical: 14,
      }}
    >
      <View
        style={{
          width: ICON_BOX,
          alignItems: "center",
          marginRight: ICON_GAP,
        }}
      >
        <Ionicons name={icon} size={18} color={colors.zinc500} />
      </View>

      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontSize: 15,
            lineHeight: 20,
            fontFamily: "Inter_500Medium",
            color: colors.textPrimary,
          }}
        >
          {label}
        </Text>
        {subtitle ? (
          <Text
            style={{
              fontSize: 12,
              lineHeight: 16,
              marginTop: 2,
              fontFamily: "Inter_400Regular",
              color: colors.textTertiary,
            }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          marginLeft: 12,
        }}
      >
        {value ? (
          <Text
            style={{
              fontSize: 13,
              fontFamily: "Inter_400Regular",
              color: colors.textSecondary,
            }}
          >
            {value}
          </Text>
        ) : null}
        {right}
        {chevron ? (
          <Ionicons
            name="chevron-forward"
            size={16}
            color={colors.textTertiary}
          />
        ) : null}
      </View>
    </Container>
  );
}

function Divider() {
  return (
    <View
      style={{
        height: 0.5,
        backgroundColor: colors.borderSubtle,
        marginLeft: DIVIDER_INSET,
      }}
    />
  );
}

function Toggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Switch
      value={value}
      onValueChange={(next) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onChange(next);
      }}
      trackColor={{ false: colors.zinc800, true: colors.gold }}
      thumbColor={value ? colors.bg : colors.zinc400}
      ios_backgroundColor={colors.zinc800}
    />
  );
}

export default function SettingsScreen() {
  const nav = useSafeNavigation();
  const insets = useSafeAreaInsets();
  const { settings, updateSetting } = useSettings();
  const { all: downloads } = useDownloadList();
  const appVersion = Constants.expoConfig?.version || "1.0.0";

  // M1 — impression measurement: candidate footer ad slot (visit-based
  // upper bound — the footer is below the fold until scrolled).
  useSlotImpression("settings_footer", "settings");

  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [calculatingStorage, setCalculatingStorage] = useState(false);
  const storageCalculated = useRef(false);
  const [showLangSheet, setShowLangSheet] = useState(false);
  const [showSpeedSheet, setShowSpeedSheet] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);

  const totalDownloadSize = useMemo(() => {
    return downloads
      .filter((t) => t.status === "completed")
      .reduce((sum, t) => sum + (t.totalBytes || 0), 0);
  }, [downloads]);

  useEffect(() => {
    if (storageCalculated.current || calculatingStorage) return;
    storageCalculated.current = true;
    calculateCacheSize();
  }, []);

  const calculateCacheSize = useCallback(async () => {
    setCalculatingStorage(true);
    try {
      const dir = (documentDirectory ?? "") + "downloads/";
      const info = await getInfoAsync(dir);
      if (info.exists && "size" in info) {
        setCacheSize((info as any).size || null);
      }
    } catch {}
    setCalculatingStorage(false);
  }, []);

  const handleClearCache = useCallback(() => {
    Alert.alert(
      "Clear cache",
      "This clears temporary streaming cache. Downloads and bookmarks stay on your device.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            setCacheSize(0);
            Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Success,
            ).catch(() => {});
            Alert.alert("Cache cleared");
          },
        },
      ],
    );
  }, []);

  const handleShareApp = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Share.share({
      message: `Watch movies and TV shows on FilmSnaps\nhttps://filmsnap-pro.netlify.app/download`,
    });
  }, []);

  const serverProviders = useMemo(
    () =>
      getProvidersForMode(settings.mode).filter((p) =>
        isProviderAvailableOn(p, "mobile"),
      ),
    [settings.mode],
  );

  const selectedServer = settings.defaultServer;
  const speedLimitKBps = settings.downloadSpeedLimitKBps ?? 0;
  const speedLabel = speedLimitKBps > 0 ? formatSpeed(speedLimitKBps) : "Off";
  const selectedProviderName = useMemo(() => {
    if (!selectedServer) return "Automatic";
    const p = serverProviders.find((sp) => sp.id === selectedServer);
    return p ? p.displayName || p.name : selectedServer;
  }, [selectedServer, serverProviders]);

  const analyticsOn = settings.analyticsEnabled !== false;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        paddingTop: insets.top,
      }}
    >
      {/* Header */}
      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: 20,
        }}
      >
        <Text
          style={{
            fontFamily: "PlayfairDisplay_700Bold",
            fontSize: 24,
            lineHeight: 28,
            color: colors.textPrimary,
          }}
        >
          Settings
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: tabBarClearance(insets.bottom),
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Playback ── */}
        <Section title="Playback">
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              minHeight: 52,
              paddingHorizontal: ROW_PADDING_H,
              paddingVertical: 14,
            }}
          >
            <View
              style={{
                width: ICON_BOX,
                alignItems: "center",
                marginRight: ICON_GAP,
              }}
            >
              <Ionicons name="film-outline" size={18} color={colors.zinc500} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 15,
                  lineHeight: 20,
                  fontFamily: "Inter_500Medium",
                  color: colors.textPrimary,
                }}
              >
                Catalog
              </Text>
            </View>
            <View
              style={{
                flexDirection: "row",
                padding: 2,
                borderRadius: 8,
                backgroundColor: colors.white04,
              }}
            >
              {(["movie_tv", "anime"] as const).map((m) => {
                const active = settings.mode === m;
                return (
                  <TouchableOpacity
                    key={m}
                    onPress={() => {
                      Haptics.impactAsync(
                        Haptics.ImpactFeedbackStyle.Light,
                      ).catch(() => {});
                      trackFeatureUsed(
                        m === "anime"
                          ? "mode_toggle_anime"
                          : "mode_toggle_movie_tv",
                        "settings",
                      );
                      updateSetting("mode", m);
                    }}
                    activeOpacity={0.7}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 6,
                      backgroundColor: active ? colors.bgSubtle : "transparent",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        fontFamily: "Inter_500Medium",
                        color: active
                          ? colors.textPrimary
                          : colors.textTertiary,
                      }}
                    >
                      {m === "anime" ? "Anime" : "Movies & TV"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
          <Divider />
          <ListRow
            icon="language-outline"
            label="Audio language"
            value={
              {
                auto: "Auto",
                multi: "Multi audio",
                hindi: "Hindi",
                english: "English",
              }[settings.preferredAudioLanguage ?? "auto"] ?? "Auto"
            }
            chevron
            onPress={() => setShowLangSheet(true)}
          />
          <Divider />
          <ListRow
            icon="grid-outline"
            label="Home layout"
            value="Reorder rows"
            chevron
            onPress={() => nav.push("/home-layout")}
          />
          <Divider />
          <ListRow
            icon="information-circle-outline"
            label="Streaming tips"
            subtitle="Notes below the player"
            right={
              <Toggle
                value={settings.showServerNotes}
                onChange={(v) => updateSetting("showServerNotes", v)}
              />
            }
          />
        </Section>

        {/* ── Downloads ── */}
        <Section title="Downloads">
          <ListRow
            icon="trash-outline"
            label="Clear streaming cache"
            value={
              calculatingStorage
                ? undefined
                : cacheSize != null
                  ? formatBytes(cacheSize)
                  : "Empty"
            }
            right={
              calculatingStorage ? (
                <ActivityIndicator size="small" color={colors.zinc500} />
              ) : undefined
            }
            chevron
            onPress={handleClearCache}
          />
          <Divider />
          <ListRow
            icon="folder-open-outline"
            label="Downloads storage"
            value={
              totalDownloadSize > 0 ? formatBytes(totalDownloadSize) : "Manage"
            }
            chevron
            onPress={() => nav.push("/downloads")}
          />
          <Divider />
          <ListRow
            icon="speedometer-outline"
            label="Speed limit"
            value={speedLabel}
            chevron
            onPress={() => setShowSpeedSheet(true)}
          />
        </Section>

        {/* ── Streaming source ── */}
        <View style={{ marginBottom: 28 }}>
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
                () => {},
              );
              setSourceOpen(!sourceOpen);
            }}
            activeOpacity={0.7}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 4,
              marginBottom: 8,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontFamily: "Inter_500Medium",
                color: colors.textTertiary,
                letterSpacing: 0.2,
              }}
            >
              Streaming source
            </Text>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: "Inter_400Regular",
                  color: colors.textSecondary,
                }}
              >
                {selectedProviderName}
              </Text>
              <Ionicons
                name={sourceOpen ? "chevron-up" : "chevron-down"}
                size={14}
                color={colors.textTertiary}
              />
            </View>
          </TouchableOpacity>

          {sourceOpen && (
            <View
              style={{
                backgroundColor: colors.bgSurface,
                borderRadius: 14,
                borderWidth: 0.5,
                borderColor: colors.borderSubtle,
                overflow: "hidden",
              }}
            >
              <SourceRow
                label="Automatic"
                detail="Fastest available"
                selected={selectedServer === ""}
                onPress={() => updateSetting("defaultServer", "")}
              />
              {serverProviders.map((p) => {
                const isSelected = selectedServer === p.id;
                return (
                  <View key={p.id}>
                    <Divider />
                    <SourceRow
                      label={p.displayName || p.name}
                      selected={isSelected}
                      onPress={() =>
                        updateSetting("defaultServer", isSelected ? "" : p.id)
                      }
                    />
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* ── Support ── */}
        <Section title="Support">
          <ListRow
            icon="help-circle-outline"
            label="User guide"
            chevron
            onPress={() => nav.push("/guide")}
          />
          <Divider />
          <ListRow
            icon="shield-checkmark-outline"
            label="Transparency & security"
            chevron
            onPress={() => nav.push("/transparency")}
          />
          <Divider />
          <ListRow
            icon="lock-closed-outline"
            label="Privacy policy"
            chevron
            onPress={() => nav.push("/privacy")}
          />
          <Divider />
          <ListRow
            icon="document-text-outline"
            label="Legal & DMCA"
            chevron
            onPress={() => nav.push("/legal")}
          />
          <Divider />
          <ListRow
            icon="megaphone-outline"
            label="Announcements"
            chevron
            onPress={() => nav.push("/announcements")}
          />
          <Divider />
          <ListRow
            icon="chatbubble-ellipses-outline"
            label="Feedback & bug reports"
            chevron
            onPress={() => nav.push("/feedback")}
          />
          <Divider />
          {settings.analyticsGrandfathered && (
            <Text
              style={{
                paddingHorizontal: ROW_PADDING_H,
                paddingTop: 14,
                fontSize: 12,
                lineHeight: 18,
                fontFamily: "Inter_400Regular",
                color: colors.textSecondary,
              }}
            >
              Usage statistics are off by default. Turn them back on below.
            </Text>
          )}
          <ListRow
            icon="bar-chart-outline"
            label="Usage statistics"
            subtitle="Anonymous, no personal data"
            right={
              <Toggle
                value={analyticsOn}
                onChange={(v) => updateSetting("analyticsEnabled", v)}
              />
            }
          />
        </Section>

        {/* Support the project */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            backgroundColor: colors.bgSurface,
            borderRadius: 14,
            borderWidth: 0.5,
            borderColor: colors.borderSubtle,
            padding: 16,
            marginBottom: 24,
          }}
        >
          <Ionicons name="star-outline" size={18} color={colors.gold} />
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontSize: 15,
                lineHeight: 20,
                fontFamily: "Inter_500Medium",
                color: colors.textPrimary,
              }}
            >
              Support FilmSnaps
            </Text>
            <Text
              style={{
                fontSize: 12,
                lineHeight: 16,
                marginTop: 2,
                fontFamily: "Inter_400Regular",
                color: colors.textTertiary,
              }}
            >
              Star the repository to help others find it
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
                () => {},
              );
              Linking.openURL(GITHUB_URL);
            }}
            activeOpacity={0.8}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 8,
              backgroundColor: colors.gold,
            }}
          >
            <Text
              style={{
                fontSize: 13,
                fontFamily: "Inter_500Medium",
                color: colors.bg,
              }}
            >
              Star
            </Text>
          </TouchableOpacity>
        </View>

        {/* M2 — candidate footer ad slot (above the app-info footer). */}
        <AdSlot slot="settings_footer" bottomMargin={16} />

        {/* ── Footer ── */}
        <View style={{ alignItems: "center", gap: 12, paddingBottom: 8 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
            }}
          >
            <FooterLink label="Share" onPress={handleShareApp} />
            <Text style={{ color: colors.zinc600 }}>·</Text>
            <FooterLink
              label="GitHub"
              onPress={() => Linking.openURL(GITHUB_URL)}
            />
            <Text style={{ color: colors.zinc600 }}>·</Text>
            <FooterLink
              label="Website"
              onPress={() => Linking.openURL(WEBSITE_URL)}
            />
          </View>
          <Text
            style={{
              color: colors.textTertiary,
              fontSize: 11,
              fontFamily: "Inter_400Regular",
            }}
          >
            FilmSnaps {appVersion} · Open source
          </Text>
        </View>
      </ScrollView>

      {/* Preferred audio language picker (same options as the first-run prompt) */}
      <LanguagePromptSheet
        visible={showLangSheet}
        onClose={() => setShowLangSheet(false)}
        currentValue={settings.preferredAudioLanguage ?? "auto"}
        title="Preferred audio language"
        subtitle="New sources are ranked to match this. Already-playing streams are never interrupted."
        onSelect={(value) => {
          updateSetting("preferredAudioLanguage", value);
          // Answering here means the user has chosen a language — the
          // first-run prompt on the watch page must not reappear.
          updateSetting("hasAnsweredLanguagePrompt", true);
          setShowLangSheet(false);
        }}
      />

      {/* Download speed limit picker — presets + custom value */}
      <SpeedLimitSheet
        visible={showSpeedSheet}
        value={speedLimitKBps}
        onChange={(v) => updateSetting("downloadSpeedLimitKBps", v)}
        onClose={() => setShowSpeedSheet(false)}
      />
    </View>
  );
}

function SourceRow({
  label,
  detail,
  selected,
  onPress,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
      activeOpacity={0.7}
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: 52,
        paddingHorizontal: ROW_PADDING_H,
        paddingVertical: 14,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontSize: 15,
            lineHeight: 20,
            fontFamily: "Inter_500Medium",
            color: colors.textPrimary,
          }}
        >
          {label}
        </Text>
        {detail ? (
          <Text
            style={{
              fontSize: 12,
              lineHeight: 16,
              marginTop: 2,
              fontFamily: "Inter_400Regular",
              color: colors.textTertiary,
            }}
          >
            {detail}
          </Text>
        ) : null}
      </View>
      {selected ? (
        <Ionicons name="checkmark" size={18} color={colors.gold} />
      ) : null}
    </TouchableOpacity>
  );
}

function FooterLink({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text
        style={{
          fontSize: 13,
          fontFamily: "Inter_500Medium",
          color: colors.textSecondary,
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}
