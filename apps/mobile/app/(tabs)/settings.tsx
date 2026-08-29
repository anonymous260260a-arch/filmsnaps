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
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { ForwardIcon } from "../../components/Icons";
import { Ionicons } from "@expo/vector-icons";
import { useSafeNavigation } from "@/lib/navigation";
import { useSettings } from "../../lib/settings";
import { useDownloadList } from "../../lib/download";
import { getProvidersForMode } from "@filmsnaps/shared";
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
      message: `🎬 Watch movies & TV shows free on FilmSnaps\nhttps://filmsnap-pro.netlify.app/download`,
    });
  }, []);

  // ── Providers for default source picker ──
  // Default-server picker reflects the active mode's provider set (Hard Mode
  // Split). In anime mode this includes MegaPlay; in movie/TV mode it excludes
  // anime-only servers.
  const serverProviders = useMemo(
    () => getProvidersForMode(settings.mode),
    [settings.mode],
  );

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
        {/* ── 0. Content Mode (Hard Mode Split) ── */}
        <SectionCard title="Content Mode">
          <View
            className="flex-row items-center px-5 py-3.5"
            style={{ backgroundColor: colors.bgCard }}
          >
            <View
              className="w-9 h-9 rounded-xl items-center justify-center mr-3"
              style={{ backgroundColor: colors.bgTop }}
            >
              <Ionicons
                name="tv-outline"
                size={18}
                color={colors.textSecondary}
              />
            </View>
            <View className="flex-1">
              <Text
                className="text-zinc-200 text-sm font-bold"
                style={{ fontFamily: "Inter_600SemiBold" }}
              >
                {settings.mode === "anime" ? "Anime" : "Movies & TV"}
              </Text>
              <Text className="text-zinc-500 text-xs mt-0.5">
                Switch the whole app between Western media and anime
              </Text>
            </View>
            <View
              className="flex-row rounded-full overflow-hidden border border-zinc-700/40"
              style={{ pointerEvents: "auto" }}
            >
              {(["movie_tv", "anime"] as const).map((m) => {
                const active = settings.mode === m;
                return (
                  <TouchableOpacity
                    key={m}
                    onPress={() => updateSetting("mode", m)}
                    className={`px-3 h-9 items-center justify-center ${active ? "bg-primary" : ""}`}
                    activeOpacity={0.7}
                  >
                    <Text
                      className={`text-xs font-bold uppercase ${
                        active ? "text-black" : "text-zinc-300"
                      }`}
                    >
                      {m === "anime" ? "Anime" : "Movies"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </SectionCard>

        {/* ── 1. Playback ── */}
        <SectionCard title="Playback">
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
            label="Transparency & Security"
            subtitle="Ad blocking, streaming security & how it works"
            color={colors.info}
            onPress={() => nav.push("/transparency")}
            right={
              <ForwardIcon width={16} height={16} color={colors.iconMuted} />
            }
          />
          <Divider />
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
          <Divider />
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

        {/* ── Contribute ── */}
        <SectionCard title="Community">
          <SettingsRow
            icon="logo-github"
            label="GitHub Repository"
            subtitle="View source, report issues, and contribute"
            color={colors.textPrimary}
            onPress={() =>
              Linking.openURL(
                "https://github.com/anonymous260260a-arch/filmsnaps",
              )
            }
            right={
              <Ionicons
                name="open-outline"
                size={14}
                color={colors.textTertiary}
              />
            }
          />
          <Divider />
          <SettingsRow
            icon="globe-outline"
            label="Website"
            subtitle="filmsnap-pro.netlify.app"
            color={colors.info}
            onPress={() => Linking.openURL("https://filmsnap-pro.netlify.app/")}
            right={
              <Ionicons
                name="open-outline"
                size={14}
                color={colors.textTertiary}
              />
            }
          />
        </SectionCard>

        {/* ── Star on GitHub ── */}
        <View
          className="mx-4 mb-6 rounded-xl overflow-hidden"
          style={{
            backgroundColor: colors.bgElevated,
            borderWidth: 0.5,
            borderColor: colors.bgTop,
            padding: 2,
          }}
        >
          <LinearGradient
            colors={["rgba(212,162,55,0.15)", "rgba(212,162,55,0.05)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <View className="items-center py-5">
              <View
                className="w-12 h-12 rounded-full items-center justify-center mb-2"
                style={{ backgroundColor: "rgba(212,162,55,0.18)" }}
              >
                <Ionicons name="star" size={24} color={colors.gold} />
              </View>
              <Text
                className="text-sm font-bold text-center mb-1"
                style={{
                  color: colors.textPrimary,
                  fontFamily: "Inter_600SemiBold",
                }}
              >
                Enjoying FilmSnaps?
              </Text>
              <Text
                className="text-xs text-center mb-3 mx-8"
                style={{ color: colors.textSecondary, lineHeight: 16 }}
              >
                If you use and enjoy FilmSnaps, a GitHub star helps others
                discover the project. It takes one click and means a lot.
              </Text>
              <TouchableOpacity
                onPress={() => {
                  Linking.openURL(
                    "https://github.com/anonymous260260a-arch/filmsnaps",
                  );
                }}
                activeOpacity={0.7}
                className="px-6 py-2 rounded-full"
                style={{
                  backgroundColor: colors.gold,
                }}
              >
                <View className="flex-row items-center">
                  <Ionicons name="star" size={14} color={colors.bg} />
                  <Text
                    className="text-xs font-bold ml-1"
                    style={{ color: colors.bg, fontFamily: "Inter_700Bold" }}
                  >
                    Star on GitHub
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </View>

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
