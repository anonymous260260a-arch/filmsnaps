/**
 * Settings — Library, Data & Storage, Default Server, Support.
 *
 * Navigation hub for the app: links to Downloads, Watch History, Saved,
 * plus storage management, server preference, and support resources.
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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ForwardIcon } from "../../components/Icons";
import { Ionicons } from "@expo/vector-icons";
import { useSafeNavigation } from "@/lib/navigation";
import { useSettings } from "../../lib/settings";
import { useDownloadList } from "../../lib/download";
import { getEnabledProviders } from "@filmsnaps/shared";
import { getInfoAsync, documentDirectory } from "expo-file-system/legacy";
import Constants from "expo-constants";
import { colors } from "../../theme/colors";

// ── Helpers ──

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    sizes.length - 1,
  );
  const val = bytes / Math.pow(k, i);
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${sizes[i]}`;
}

// ── Section Card ──

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mb-6">
      <Text className="text-zinc-500 text-[10px] font-semibold uppercase tracking-widest px-5 mb-2">
        {title}
      </Text>
      <View
        className="mx-4 rounded-xl overflow-hidden"
        style={{
          backgroundColor: colors.bgSurface,
          borderWidth: 0.5,
          borderColor: colors.bgTop,
        }}
      >
        {children}
      </View>
    </View>
  );
}

// ── Settings Row ──

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
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      className="flex-row items-center px-5 py-3.5"
      style={{ backgroundColor: colors.bgCard }}
    >
      {icon && (
        <View
          className="w-9 h-9 rounded-xl items-center justify-center mr-3"
          style={{ backgroundColor: color ? `${color}18` : colors.bgTop }}
        >
          <Ionicons
            name={icon}
            size={18}
            color={color || colors.textSecondary}
          />
        </View>
      )}
      <View className="flex-1">
        <Text
          className="text-zinc-200 text-sm font-bold"
          style={{ fontFamily: "Inter_600SemiBold" }}
        >
          {label}
        </Text>
        {subtitle && (
          <Text className="text-zinc-500 text-xs mt-0.5">{subtitle}</Text>
        )}
      </View>
      {right}
    </Content>
  );
}

// ── Divider ──

function Divider() {
  return (
    <View
      className="h-[1px] mx-5"
      style={{ backgroundColor: colors.bgActiveDrag }}
    />
  );
}

// ── Collapsible Section — like SectionCard but with a toggle header ──

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
    <View className="mb-6">
      <TouchableOpacity
        onPress={() => setOpen(!open)}
        activeOpacity={0.7}
        className="flex-row items-center justify-between px-5 mb-2"
      >
        <View className="flex-1">
          <Text className="text-zinc-500 text-[10px] font-semibold uppercase tracking-widest">
            {title}
          </Text>
          {subtitle && (
            <Text className="text-zinc-600 text-[10px] mt-0.5">{subtitle}</Text>
          )}
        </View>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={14}
          color={colors.iconSecondary}
          style={{ marginLeft: 8 }}
        />
      </TouchableOpacity>
      {open && (
        <View
          className="mx-4 rounded-xl overflow-hidden"
          style={{
            backgroundColor: colors.bgSurface,
            borderWidth: 0.5,
            borderColor: colors.bgTop,
          }}
        >
          {children}
        </View>
      )}
    </View>
  );
}

// ── Main Screen ──

export default function SettingsScreen() {
  const nav = useSafeNavigation();
  const insets = useSafeAreaInsets();
  const { settings, updateSetting } = useSettings();
  const { all: downloads, active } = useDownloadList();
  const appVersion = Constants.expoConfig?.version || "1.0.0";

  // ── Storage calculation ──
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [calculatingStorage, setCalculatingStorage] = useState(false);
  const storageCalculated = useRef(false);

  const totalDownloadSize = useMemo(() => {
    return downloads
      .filter((t) => t.status === "completed")
      .reduce((sum, t) => sum + (t.totalBytes || 0), 0);
  }, [downloads]);

  const activeCount = useMemo(() => active.length, [active]);

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

  // ── Actions ──
  const handleClearCache = useCallback(() => {
    Alert.alert(
      "Clear Cache",
      "This will only clear temporary data. Downloaded files are not affected.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            setCacheSize(0);
            Alert.alert("Cache Cleared", "Temporary data has been cleared.");
          },
        },
      ],
    );
  }, []);

  const handleShareApp = useCallback(() => {
    Share.share({
      message: `🎬 Watch movies & TV shows free on FilmSnaps\nhttps://filmsnaps.app`,
    });
  }, []);

  // ── Providers for default source picker ──
  const serverProviders = useMemo(() => {
    return getEnabledProviders().filter(
      (p) => !p.platforms || !p.platforms.includes("web"),
    );
  }, []);

  const selectedServer = settings.defaultServer;
  const selectedProviderName = useMemo(() => {
    if (!selectedServer) return "Auto (first available)";
    const p = serverProviders.find((sp) => sp.id === selectedServer);
    return p ? p.displayName || p.name : selectedServer;
  }, [selectedServer, serverProviders]);

  return (
    <View
      className="flex-1"
      style={{ backgroundColor: colors.bg, paddingTop: insets.top }}
    >
      {/* Header */}
      <View className="px-5 pt-4 pb-3">
        <Text
          style={{
            fontFamily: "PlayfairDisplay_700Bold",
            fontSize: 22,
            color: colors.textPrimary,
          }}
        >
          Settings
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 1. Playback ── */}
        <SectionCard title="Playback">
          <SettingsRow
            icon="videocam-outline"
            label="Default Quality"
            subtitle={
              settings.defaultQuality === "Auto"
                ? "Auto (recommended)"
                : settings.defaultQuality
            }
            color={colors.gold}
            onPress={() => {
              Alert.alert("Default Quality", "Preferred streaming quality", [
                {
                  text: "Auto",
                  onPress: () => updateSetting("defaultQuality", "Auto"),
                },
                {
                  text: "720p",
                  onPress: () => updateSetting("defaultQuality", "720p"),
                },
                {
                  text: "1080p",
                  onPress: () => updateSetting("defaultQuality", "1080p"),
                },
                {
                  text: "4K",
                  onPress: () => updateSetting("defaultQuality", "4K"),
                },
                { text: "Cancel", style: "cancel" },
              ]);
            }}
            right={
              <ForwardIcon width={16} height={16} color={colors.iconMuted} />
            }
          />
          <Divider />
          <SettingsRow
            icon="layers-outline"
            label="Home Layout"
            subtitle="Arrange home page sections"
            color={colors.gold}
            onPress={() => nav.push("/home-layout")}
            right={
              <ForwardIcon width={16} height={16} color={colors.iconMuted} />
            }
          />
          <Divider />
          <SettingsRow
            icon="language-outline"
            label="Subtitle Language"
            subtitle={settings.subtitleLanguage || "English"}
            color={colors.gold}
            onPress={() => {
              Alert.alert("Subtitle Language", "Preferred subtitle language", [
                {
                  text: "English",
                  onPress: () => updateSetting("subtitleLanguage", "English"),
                },
                {
                  text: "Spanish",
                  onPress: () => updateSetting("subtitleLanguage", "Spanish"),
                },
                {
                  text: "French",
                  onPress: () => updateSetting("subtitleLanguage", "French"),
                },
                {
                  text: "German",
                  onPress: () => updateSetting("subtitleLanguage", "German"),
                },
                {
                  text: "Portuguese",
                  onPress: () =>
                    updateSetting("subtitleLanguage", "Portuguese"),
                },
                {
                  text: "Arabic",
                  onPress: () => updateSetting("subtitleLanguage", "Arabic"),
                },
                {
                  text: "Hindi",
                  onPress: () => updateSetting("subtitleLanguage", "Hindi"),
                },
                { text: "Cancel", style: "cancel" },
              ]);
            }}
            right={
              <ForwardIcon width={16} height={16} color={colors.iconMuted} />
            }
          />
          <Divider />
          <SettingsRow
            icon="text-outline"
            label="Subtitle Size"
            subtitle={
              settings.subtitleFontSize === "small"
                ? "Small"
                : settings.subtitleFontSize === "large"
                  ? "Large"
                  : "Medium"
            }
            color={colors.gold}
            onPress={() => {
              Alert.alert("Subtitle Size", "Adjust subtitle text size", [
                {
                  text: "Small",
                  onPress: () => updateSetting("subtitleFontSize", "small"),
                },
                {
                  text: "Medium",
                  onPress: () => updateSetting("subtitleFontSize", "medium"),
                },
                {
                  text: "Large",
                  onPress: () => updateSetting("subtitleFontSize", "large"),
                },
                { text: "Cancel", style: "cancel" },
              ]);
            }}
            right={
              <ForwardIcon width={16} height={16} color={colors.iconMuted} />
            }
          />
          <Divider />
          <SettingsRow
            icon="play-skip-forward-outline"
            label="Auto-play Next"
            subtitle={
              settings.autoPlayNext
                ? "On — automatically play next episode"
                : "Off"
            }
            color={colors.gold}
            right={
              <Switch
                value={settings.autoPlayNext}
                onValueChange={(v) => updateSetting("autoPlayNext", v)}
                trackColor={{
                  false: colors.zinc800,
                  true: "rgba(212,162,55,0.4)",
                }}
                thumbColor={
                  settings.autoPlayNext ? colors.gold : colors.textTertiary
                }
              />
            }
          />
          <Divider />
          <SettingsRow
            icon="information-circle-outline"
            label="Show Source Tips"
            subtitle={
              settings.showServerNotes
                ? "On — usage tips shown below player"
                : "Off"
            }
            color={colors.info}
            right={
              <Switch
                value={settings.showServerNotes}
                onValueChange={(v) => updateSetting("showServerNotes", v)}
                trackColor={{
                  false: colors.zinc800,
                  true: "rgba(59,130,246,0.4)",
                }}
                thumbColor={
                  settings.showServerNotes ? colors.info : colors.textTertiary
                }
              />
            }
          />
        </SectionCard>

        {/* ── 2. Data & Storage ── */}
        <SectionCard title="Data & Storage">
          <SettingsRow
            icon="trash-outline"
            label="Clear Cache"
            subtitle={
              cacheSize != null
                ? `${formatBytes(cacheSize)} currently cached`
                : "Tap to clear temporary data"
            }
            color={colors.error}
            onPress={handleClearCache}
            right={
              calculatingStorage ? (
                <ActivityIndicator size="small" color={colors.textTertiary} />
              ) : (
                <ForwardIcon width={16} height={16} color={colors.iconMuted} />
              )
            }
          />
          <Divider />
          <SettingsRow
            icon="folder-open-outline"
            label="Downloads Storage"
            subtitle={
              totalDownloadSize > 0
                ? `${formatBytes(totalDownloadSize)} used`
                : "No completed downloads"
            }
            color={colors.gold}
            onPress={() => nav.push("/downloads")}
            right={
              <ForwardIcon width={16} height={16} color={colors.iconMuted} />
            }
          />
          <Divider />
          <SettingsRow
            icon="cellular-outline"
            label="Download over Cellular"
            subtitle={
              settings.downloadOverCellular
                ? "Allowed on mobile data"
                : "Wi-Fi only"
            }
            color={colors.gold}
            right={
              <Switch
                value={settings.downloadOverCellular}
                onValueChange={(v) => updateSetting("downloadOverCellular", v)}
                trackColor={{
                  false: colors.zinc800,
                  true: "rgba(212,162,55,0.4)",
                }}
                thumbColor={
                  settings.downloadOverCellular
                    ? colors.gold
                    : colors.textTertiary
                }
              />
            }
          />
          <Divider />
          <SettingsRow
            icon="download-outline"
            label="Download Quality"
            subtitle={
              settings.downloadQuality === "Auto"
                ? "Auto (recommended)"
                : settings.downloadQuality === "720p"
                  ? "720p — smaller files"
                  : settings.downloadQuality === "4K"
                    ? "4K — largest files"
                    : "1080p — balanced"
            }
            color={colors.gold}
            onPress={() => {
              Alert.alert(
                "Download Quality",
                "Preferred quality for downloads",
                [
                  {
                    text: "Auto",
                    onPress: () => updateSetting("downloadQuality", "Auto"),
                  },
                  {
                    text: "720p",
                    onPress: () => updateSetting("downloadQuality", "720p"),
                  },
                  {
                    text: "1080p",
                    onPress: () => updateSetting("downloadQuality", "1080p"),
                  },
                  {
                    text: "4K",
                    onPress: () => updateSetting("downloadQuality", "4K"),
                  },
                  { text: "Cancel", style: "cancel" },
                ],
              );
            }}
            right={
              <ForwardIcon width={16} height={16} color={colors.iconMuted} />
            }
          />
          <Divider />
          <SettingsRow
            icon="speedometer-outline"
            label="Download Speed Limit"
            subtitle={
              settings.downloadSpeedLimit === "full"
                ? "Full speed (unlimited)"
                : settings.downloadSpeedLimit === "balanced"
                  ? "Balanced (~500 KB/s)"
                  : "Slower (~100 KB/s)"
            }
            color={colors.gold}
            onPress={() => {
              Alert.alert(
                "Download Speed",
                "Limit download speed to save bandwidth",
                [
                  {
                    text: "Full (unlimited)",
                    onPress: () => updateSetting("downloadSpeedLimit", "full"),
                  },
                  {
                    text: "Balanced (~500 KB/s)",
                    onPress: () =>
                      updateSetting("downloadSpeedLimit", "balanced"),
                  },
                  {
                    text: "Slower (~100 KB/s)",
                    onPress: () =>
                      updateSetting("downloadSpeedLimit", "slower"),
                  },
                  { text: "Cancel", style: "cancel" },
                ],
              );
            }}
            right={
              <ForwardIcon width={16} height={16} color={colors.iconMuted} />
            }
          />
        </SectionCard>

        {/* ── 3. Default Source ── */}
        <CollapsibleSection
          title="Default Source"
          subtitle={selectedProviderName}
        >
          <View className="px-5 pt-3 pb-1">
            <Text className="text-zinc-400 text-xs leading-5 mb-2">
              Choose your preferred streaming source. When available, this
              source will be tried first.
            </Text>
          </View>

          {/* None / Auto option */}
          <TouchableOpacity
            onPress={() => updateSetting("defaultServer", "")}
            activeOpacity={0.7}
            className="flex-row items-center px-5 py-3"
            style={{ backgroundColor: colors.bgCard }}
          >
            <View
              className="w-5 h-5 rounded-full border-2 items-center justify-center mr-3"
              style={{
                borderColor:
                  selectedServer === "" ? colors.gold : colors.borderMuted,
              }}
            >
              {selectedServer === "" && (
                <View
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: colors.gold }}
                />
              )}
            </View>
            <View className="flex-1">
              <Text
                className="text-sm"
                style={{
                  color:
                    selectedServer === "" ? colors.gold : colors.textSecondary,
                  fontFamily: "Inter_600SemiBold",
                }}
              >
                Auto
              </Text>
              <Text className="text-zinc-500 text-[10px] mt-0.5">
                First available source
              </Text>
            </View>
          </TouchableOpacity>

          {serverProviders.map((p, idx) => {
            const isSelected = selectedServer === p.id;
            return (
              <View key={p.id}>
                {idx === 0 && <Divider />}
                <TouchableOpacity
                  onPress={() =>
                    updateSetting("defaultServer", isSelected ? "" : p.id)
                  }
                  activeOpacity={0.7}
                  className="flex-row items-center px-5 py-3"
                  style={{ backgroundColor: colors.bgCard }}
                >
                  <View
                    className="w-5 h-5 rounded-full border-2 items-center justify-center mr-3"
                    style={{
                      borderColor: isSelected
                        ? colors.gold
                        : colors.borderMuted,
                    }}
                  >
                    {isSelected && (
                      <View
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: colors.gold }}
                      />
                    )}
                  </View>
                  <View className="flex-1">
                    <Text
                      className="text-sm"
                      style={{
                        color: isSelected ? colors.gold : colors.textSecondary,
                        fontFamily: "Inter_500Medium",
                      }}
                    >
                      {p.displayName || p.name}
                    </Text>
                    <Text className="text-zinc-500 text-[10px] mt-0.5">
                      {p.id}
                    </Text>
                  </View>
                </TouchableOpacity>
                {idx < serverProviders.length - 1 && <Divider />}
              </View>
            );
          })}
        </CollapsibleSection>

        {/* ── 4. Support ── */}
        <SectionCard title="Support">
          <SettingsRow
            icon="megaphone-outline"
            label="Announcements"
            subtitle="News, features, and service updates"
            color={colors.gold}
            onPress={() => nav.push("/announcements")}
            right={
              <ForwardIcon width={16} height={16} color={colors.iconMuted} />
            }
          />
          <Divider />
          <SettingsRow
            icon="help-circle-outline"
            label="How to Use"
            subtitle="Guide to watching, downloading, and more"
            color={colors.gold}
            onPress={() => nav.push("/guide")}
            right={
              <ForwardIcon width={16} height={16} color={colors.iconMuted} />
            }
          />
          <Divider />
          <SettingsRow
            icon="information-circle-outline"
            label="How Content Works"
            subtitle="Content sourcing, ad blocking technology & transparency"
            color={colors.info}
            onPress={() => nav.push("/how-it-works")}
            right={
              <ForwardIcon width={16} height={16} color={colors.iconMuted} />
            }
          />
          <Divider />
          <SettingsRow
            icon="bug-outline"
            label="Feedback"
            subtitle="Report bugs, request features, view roadmap"
            color={colors.gold}
            onPress={() => nav.push("/feedback")}
            right={
              <ForwardIcon width={16} height={16} color={colors.iconMuted} />
            }
          />
          <Divider />
          <SettingsRow
            icon="share-outline"
            label="Share App"
            subtitle="Tell your friends about FilmSnaps"
            color={colors.info}
            onPress={handleShareApp}
            right={
              <ForwardIcon width={16} height={16} color={colors.iconMuted} />
            }
          />
          <SettingsRow
            icon="shield-outline"
            label="Privacy Policy"
            subtitle="How we handle your data"
            color={colors.successGreen}
            onPress={() => nav.push("/privacy")}
            right={
              <ForwardIcon width={16} height={16} color={colors.iconMuted} />
            }
          />
          <Divider />
          <SettingsRow
            icon="document-text-outline"
            label="Legal & DMCA"
            subtitle="Disclaimer, copyright, and terms"
            color={colors.textSecondary}
            onPress={() => nav.push("/legal")}
            right={
              <ForwardIcon width={16} height={16} color={colors.iconMuted} />
            }
          />

          {__DEV__ && (
            <>
              <Divider />
              <SettingsRow
                icon="flask-outline"
                label="Experimental Providers"
                subtitle="Test Nuvio provider extraction (dev only)"
                color={colors.gold}
                onPress={() => nav.push("/experimental")}
                right={
                  <ForwardIcon
                    width={16}
                    height={16}
                    color={colors.iconMuted}
                  />
                }
              />
            </>
          )}
        </SectionCard>

        {/* ── App Info ── */}
        <View className="items-center py-6">
          <Text className="text-zinc-600 text-[10px] font-semibold tracking-widest uppercase">
            FilmSnaps
          </Text>
          <Text className="text-zinc-700 text-[10px] mt-1">
            v{appVersion} · Open Source
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
