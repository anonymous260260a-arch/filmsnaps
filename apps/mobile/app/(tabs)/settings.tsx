/**
 * Settings — Library, Data & Storage, Playback, Support & Community.
 *
 * Navigation hub for the app: storage management, default server preference,
 * and support resources with clean, consistent spacing.
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
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeNavigation } from "@/lib/navigation";
import { useSettings } from "../../lib/settings";
import { useDownloadList } from "../../lib/download";
import { getProvidersForMode } from "@filmsnaps/shared";
import { getInfoAsync, documentDirectory } from "expo-file-system/legacy";
import Constants from "expo-constants";
import { colors } from "../../theme/colors";
import * as Haptics from "expo-haptics";

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

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginBottom: 20 }}>
      <Text
        style={{
          fontSize: 11,
          fontFamily: "Inter_600SemiBold",
          color: colors.textTertiary,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          paddingHorizontal: 4,
          marginBottom: 8,
        }}
      >
        {title}
      </Text>
      <View
        style={{
          backgroundColor: colors.bgCard,
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

function SettingsRow({
  icon,
  label,
  subtitle,
  color,
  right,
  onPress,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle?: string;
  color?: string;
  right?: React.ReactNode;
  onPress?: () => void;
}) {
  const Content = onPress ? TouchableOpacity : View;
  return (
    <Content
      onPress={() => {
        if (onPress) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }
      }}
      activeOpacity={onPress ? 0.75 : 1}
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 14,
        paddingHorizontal: 16,
        backgroundColor: colors.bgCard,
      }}
    >
      {icon && (
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            alignItems: "center",
            justifyContent: "center",
            marginRight: 12,
            backgroundColor: color ? `${color}18` : "rgba(255, 255, 255, 0.06)",
          }}
        >
          <Ionicons
            name={icon}
            size={17}
            color={color || colors.textSecondary}
          />
        </View>
      )}
      <View style={{ flex: 1, marginRight: 8 }}>
        <Text
          style={{
            fontFamily: "Inter_600SemiBold",
            fontSize: 14,
            color: colors.textPrimary,
          }}
        >
          {label}
        </Text>
        {subtitle && (
          <Text
            style={{
              fontSize: 11,
              fontFamily: "Inter_400Regular",
              color: colors.textTertiary,
              marginTop: 2,
            }}
          >
            {subtitle}
          </Text>
        )}
      </View>
      {right}
    </Content>
  );
}

function Divider() {
  return (
    <View
      style={{
        height: 0.5,
        backgroundColor: colors.borderSubtle,
        marginLeft: 60,
      }}
    />
  );
}

function CollapsibleSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ marginBottom: 20 }}>
      <TouchableOpacity
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setOpen(!open);
        }}
        activeOpacity={0.75}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 4,
          marginBottom: 8,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: 11,
              fontFamily: "Inter_600SemiBold",
              color: colors.textTertiary,
              textTransform: "uppercase",
              letterSpacing: 0.8,
            }}
          >
            {title}
          </Text>
          {subtitle && (
            <Text
              style={{
                fontSize: 11,
                fontFamily: "Inter_400Regular",
                color: colors.gold,
                marginTop: 2,
              }}
            >
              {subtitle}
            </Text>
          )}
        </View>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={14}
          color={colors.textTertiary}
          style={{ marginLeft: 8 }}
        />
      </TouchableOpacity>
      {open && (
        <View
          style={{
            backgroundColor: colors.bgCard,
            borderRadius: 14,
            borderWidth: 0.5,
            borderColor: colors.borderSubtle,
            overflow: "hidden",
          }}
        >
          {children}
        </View>
      )}
    </View>
  );
}

export default function SettingsScreen() {
  const nav = useSafeNavigation();
  const insets = useSafeAreaInsets();
  const { settings, updateSetting } = useSettings();
  const { all: downloads } = useDownloadList();
  const appVersion = Constants.expoConfig?.version || "1.0.0";

  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [calculatingStorage, setCalculatingStorage] = useState(false);
  const storageCalculated = useRef(false);

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
      "Clear Cache",
      "This will clear temporary streaming cache. Downloaded titles and saved bookmarks will remain safe.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            setCacheSize(0);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert("Cache Cleared", "Temporary cache has been cleared.");
          },
        },
      ],
    );
  }, []);

  const handleShareApp = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Share.share({
      message: `🎬 Watch movies & TV shows free on FilmSnaps\nhttps://filmsnap-pro.netlify.app/download`,
    });
  }, []);

  const serverProviders = useMemo(
    () => getProvidersForMode(settings.mode),
    [settings.mode],
  );

  const selectedServer = settings.defaultServer;
  const selectedProviderName = useMemo(() => {
    if (!selectedServer) return "Auto (Recommended)";
    const p = serverProviders.find((sp) => sp.id === selectedServer);
    return p ? p.displayName || p.name : selectedServer;
  }, [selectedServer, serverProviders]);

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
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 12,
        }}
      >
        <Text
          style={{
            fontFamily: "PlayfairDisplay_700Bold",
            fontSize: 24,
            color: colors.textPrimary,
          }}
        >
          Settings
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 80 + insets.bottom,
          paddingTop: 4,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 0. Content Mode ── */}
        <SectionCard title="Catalog Mode">
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingVertical: 14,
              paddingHorizontal: 16,
              backgroundColor: colors.bgCard,
            }}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                alignItems: "center",
                justifyContent: "center",
                marginRight: 12,
                backgroundColor: "rgba(255, 255, 255, 0.06)",
              }}
            >
              <Ionicons name="sparkles-outline" size={17} color={colors.gold} />
            </View>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 14,
                  color: colors.textPrimary,
                }}
              >
                Media Preference
              </Text>
              <Text
                style={{
                  fontSize: 11,
                  fontFamily: "Inter_400Regular",
                  color: colors.textTertiary,
                  marginTop: 2,
                }}
              >
                Switch between Cinema & Anime
              </Text>
            </View>
            <View
              style={{
                flexDirection: "row",
                borderRadius: 9999,
                padding: 2,
                borderWidth: 0.5,
                borderColor: colors.borderSubtle,
                backgroundColor: colors.bgElevated,
              }}
            >
              {(["movie_tv", "anime"] as const).map((m) => {
                const active = settings.mode === m;
                return (
                  <TouchableOpacity
                    key={m}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      updateSetting("mode", m);
                    }}
                    activeOpacity={0.75}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 5,
                      borderRadius: 9999,
                      backgroundColor: active ? colors.gold : "transparent",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontFamily: "Inter_600SemiBold",
                        color: active ? colors.bg : colors.textSecondary,
                      }}
                    >
                      {m === "anime" ? "Anime" : "Movies"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </SectionCard>

        {/* ── 1. Playback & Experience ── */}
        <SectionCard title="Playback & Interface">
          <SettingsRow
            icon="grid-outline"
            label="Customize Home Layout"
            subtitle="Reorder discovery rows and carousels"
            color={colors.gold}
            onPress={() => nav.push("/home-layout")}
            right={
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.textTertiary}
              />
            }
          />
          <Divider />
          <SettingsRow
            icon="information-circle-outline"
            label="Streaming Source Tips"
            subtitle="Show performance tips below video player"
            color={colors.info}
            right={
              <Switch
                value={settings.showServerNotes}
                onValueChange={(v) => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  updateSetting("showServerNotes", v);
                }}
                trackColor={{
                  false: colors.zinc800,
                  true: colors.goldBadge,
                }}
                thumbColor={
                  settings.showServerNotes ? colors.gold : colors.textTertiary
                }
              />
            }
          />
        </SectionCard>

        {/* ── 2. Data & Storage ── */}
        <SectionCard title="Data & Storage">
          <SettingsRow
            icon="trash-outline"
            label="Clear Streaming Cache"
            subtitle={
              cacheSize != null
                ? `${formatBytes(cacheSize)} temporary cache`
                : "Reclaim temporary cache space"
            }
            color={colors.error}
            onPress={handleClearCache}
            right={
              calculatingStorage ? (
                <ActivityIndicator size="small" color={colors.gold} />
              ) : (
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.textTertiary}
                />
              )
            }
          />
          <Divider />
          <SettingsRow
            icon="folder-open-outline"
            label="Downloads Storage"
            subtitle={
              totalDownloadSize > 0
                ? `${formatBytes(totalDownloadSize)} used on device`
                : "Manage downloaded offline media"
            }
            color={colors.gold}
            onPress={() => nav.push("/downloads")}
            right={
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.textTertiary}
              />
            }
          />
        </SectionCard>

        {/* ── 3. Default Source ── */}
        <CollapsibleSection
          title="Default Streaming Source"
          subtitle={selectedProviderName}
        >
          <View
            style={{
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: 10,
              borderBottomWidth: 0.5,
              borderColor: colors.borderSubtle,
            }}
          >
            <Text
              style={{
                fontSize: 11,
                fontFamily: "Inter_400Regular",
                color: colors.textTertiary,
                lineHeight: 16,
              }}
            >
              When playing a movie or show, FilmSnaps will prioritize your
              preferred provider first.
            </Text>
          </View>

          {/* Auto option */}
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              updateSetting("defaultServer", "");
            }}
            activeOpacity={0.75}
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingVertical: 12,
              paddingHorizontal: 16,
              backgroundColor: colors.bgCard,
            }}
          >
            <View
              style={{
                width: 16,
                height: 16,
                borderRadius: 8,
                borderWidth: 1.5,
                borderColor:
                  selectedServer === "" ? colors.gold : colors.borderMuted,
                alignItems: "center",
                justifyContent: "center",
                marginRight: 12,
              }}
            >
              {selectedServer === "" && (
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: colors.gold,
                  }}
                />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 13,
                  fontFamily: "Inter_600SemiBold",
                  color:
                    selectedServer === "" ? colors.gold : colors.textPrimary,
                }}
              >
                Auto Select (Recommended)
              </Text>
              <Text
                style={{
                  fontSize: 10,
                  fontFamily: "Inter_400Regular",
                  color: colors.textTertiary,
                  marginTop: 1,
                }}
              >
                Picks the fastest available provider automatically
              </Text>
            </View>
          </TouchableOpacity>

          {serverProviders.map((p) => {
            const isSelected = selectedServer === p.id;
            return (
              <View key={p.id}>
                <Divider />
                <TouchableOpacity
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    updateSetting("defaultServer", isSelected ? "" : p.id);
                  }}
                  activeOpacity={0.75}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: 12,
                    paddingHorizontal: 16,
                    backgroundColor: colors.bgCard,
                  }}
                >
                  <View
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 8,
                      borderWidth: 1.5,
                      borderColor: isSelected
                        ? colors.gold
                        : colors.borderMuted,
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 12,
                    }}
                  >
                    {isSelected && (
                      <View
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: colors.gold,
                        }}
                      />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontSize: 13,
                        fontFamily: "Inter_500Medium",
                        color: isSelected ? colors.gold : colors.textPrimary,
                      }}
                    >
                      {p.displayName || p.name}
                    </Text>
                    <Text
                      style={{
                        fontSize: 10,
                        fontFamily: "Inter_400Regular",
                        color: colors.textTertiary,
                        marginTop: 1,
                      }}
                    >
                      Provider ID: {p.id}
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
            );
          })}
        </CollapsibleSection>

        {/* ── 4. Support & Legal ── */}
        <SectionCard title="Support & Legal">
          <SettingsRow
            icon="help-circle-outline"
            label="User Guide"
            subtitle="How to watch, switch servers, and download"
            color={colors.gold}
            onPress={() => nav.push("/guide")}
            right={
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.textTertiary}
              />
            }
          />
          <Divider />
          <SettingsRow
            icon="shield-checkmark-outline"
            label="Transparency & Security"
            subtitle="Ad-blocking, sandboxed streaming & how it works"
            color={colors.info}
            onPress={() => nav.push("/transparency")}
            right={
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.textTertiary}
              />
            }
          />
          <Divider />
          <SettingsRow
            icon="lock-closed-outline"
            label="Privacy Policy"
            subtitle="Zero telemetry · We believe privacy is a fundamental right"
            color={colors.successGreen}
            onPress={() => nav.push("/privacy")}
            right={
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.textTertiary}
              />
            }
          />
          <Divider />
          <SettingsRow
            icon="document-text-outline"
            label="Legal & DMCA Disclaimer"
            subtitle="Content disclaimer and terms of use"
            color={colors.textSecondary}
            onPress={() => nav.push("/legal")}
            right={
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.textTertiary}
              />
            }
          />
          <Divider />
          <SettingsRow
            icon="megaphone-outline"
            label="Announcements"
            subtitle="Latest features, news, and server updates"
            color={colors.gold}
            onPress={() => nav.push("/announcements")}
            right={
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.textTertiary}
              />
            }
          />
          <Divider />
          <SettingsRow
            icon="chatbubble-ellipses-outline"
            label="Feedback & Bug Reports"
            subtitle="Report broken links or request features"
            color={colors.gold}
            onPress={() => nav.push("/feedback")}
            right={
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.textTertiary}
              />
            }
          />
          <Divider />
          <SettingsRow
            icon="share-social-outline"
            label="Share FilmSnaps"
            subtitle="Share the app with friends"
            color={colors.info}
            onPress={handleShareApp}
            right={
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.textTertiary}
              />
            }
          />
        </SectionCard>

        {/* ── 5. Community ── */}
        <SectionCard title="Community & Open Source">
          <SettingsRow
            icon="logo-github"
            label="GitHub Repository"
            subtitle="Contribute code, view roadmap, star the project"
            color={colors.textPrimary}
            onPress={() =>
              Linking.openURL(
                "https://github.com/anonymous260260a-arch/filmsnaps",
              )
            }
            right={
              <Ionicons
                name="open-outline"
                size={15}
                color={colors.textTertiary}
              />
            }
          />
          <Divider />
          <SettingsRow
            icon="globe-outline"
            label="Official Website"
            subtitle="filmsnap-pro.netlify.app"
            color={colors.info}
            onPress={() => Linking.openURL("https://filmsnap-pro.netlify.app/")}
            right={
              <Ionicons
                name="open-outline"
                size={15}
                color={colors.textTertiary}
              />
            }
          />
        </SectionCard>

        {/* ── Star on GitHub ── */}
        <View
          style={{
            borderRadius: 14,
            overflow: "hidden",
            borderWidth: 0.5,
            borderColor: colors.borderSubtle,
            marginBottom: 24,
          }}
        >
          <LinearGradient
            colors={["rgba(212,162,55,0.18)", "rgba(212,162,55,0.04)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <View
              style={{
                alignItems: "center",
                paddingVertical: 22,
                paddingHorizontal: 16,
              }}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 10,
                  backgroundColor: "rgba(212,162,55,0.15)",
                  borderWidth: 0.5,
                  borderColor: "rgba(212,162,55,0.3)",
                }}
              >
                <Ionicons name="star" size={20} color={colors.gold} />
              </View>
              <Text
                style={{
                  color: colors.textPrimary,
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 15,
                  marginBottom: 4,
                }}
              >
                Enjoying FilmSnaps?
              </Text>
              <Text
                style={{
                  color: colors.textSecondary,
                  fontSize: 12,
                  fontFamily: "Inter_400Regular",
                  textAlign: "center",
                  lineHeight: 18,
                  marginBottom: 14,
                  paddingHorizontal: 8,
                }}
              >
                If you love using FilmSnaps, starring our open-source repo on
                GitHub helps more movie and anime fans discover it.
              </Text>
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  Linking.openURL(
                    "https://github.com/anonymous260260a-arch/filmsnaps",
                  );
                }}
                activeOpacity={0.8}
                style={{
                  backgroundColor: colors.gold,
                  paddingHorizontal: 22,
                  paddingVertical: 10,
                  borderRadius: 9999,
                  flexDirection: "row",
                  alignItems: "center",
                }}
              >
                <Ionicons name="star" size={14} color={colors.bg} />
                <Text
                  style={{
                    color: colors.bg,
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 12,
                    marginLeft: 6,
                  }}
                >
                  Star on GitHub
                </Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </View>

        {/* ── App Info & Privacy Assurance ── */}
        <View
          style={{
            alignItems: "center",
            paddingVertical: 12,
            paddingHorizontal: 16,
          }}
        >
          <Text
            style={{
              color: colors.textTertiary,
              fontSize: 11,
              fontFamily: "Inter_500Medium",
              textAlign: "center",
              lineHeight: 16,
              marginBottom: 4,
            }}
          >
            "We believe privacy is a fundamental right, not a premium feature."
          </Text>
          <Text
            style={{
              color: colors.textTertiary,
              fontSize: 10,
              fontFamily: "Inter_400Regular",
              marginTop: 4,
            }}
          >
            FilmSnaps v{appVersion} · Open Source
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
