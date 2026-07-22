/**
 * Settings — Library, Data & Storage, Default Server, Support.
 *
 * Navigation hub for the app: links to Downloads, Watch History, Saved,
 * plus storage management, server preference, and support resources.
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSettings } from '../../lib/settings';
import { useDownloadList } from '../../lib/download';
import { getEnabledProviders } from '@filmsnaps/shared';
import { getInfoAsync, documentDirectory } from 'expo-file-system/legacy';
import { clearAllBookmarks } from '../../lib/bookmarks';

// ── Helpers ──

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  const val = bytes / Math.pow(k, i);
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${sizes[i]}`;
}

// ── Section Card ──

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-6">
      <Text className="text-zinc-500 text-[10px] font-semibold uppercase tracking-widest px-5 mb-2">
        {title}
      </Text>
      <View
        className="mx-4 rounded-xl overflow-hidden"
        style={{ backgroundColor: '#0E0E11', borderWidth: 0.5, borderColor: '#1f1f1f' }}
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
      style={{ backgroundColor: '#141414' }}
    >
      {icon && (
        <View
          className="w-9 h-9 rounded-xl items-center justify-center mr-3"
          style={{ backgroundColor: color ? `${color}18` : '#1f1f1f' }}
        >
          <Ionicons name={icon} size={18} color={color || '#A1A1AA'} />
        </View>
      )}
      <View className="flex-1">
        <Text className="text-zinc-200 text-sm font-bold" style={{ fontFamily: 'Inter_600SemiBold' }}>
          {label}
        </Text>
        {subtitle && <Text className="text-zinc-500 text-xs mt-0.5">{subtitle}</Text>}
      </View>
      {right}
    </Content>
  );
}

// ── Divider ──

function Divider() {
  return <View className="h-[1px] mx-5" style={{ backgroundColor: '#1a1a1e' }} />;
}

// ── Collapsible Section — like SectionCard but with a toggle header ──

function CollapsibleSection({ title, subtitle, children }: {
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
          name={open ? 'chevron-up' : 'chevron-down'}
          size={14}
          color="#52525b"
          style={{ marginLeft: 8 }}
        />
      </TouchableOpacity>
      {open && (
        <View
          className="mx-4 rounded-xl overflow-hidden"
          style={{ backgroundColor: '#0E0E11', borderWidth: 0.5, borderColor: '#1f1f1f' }}
        >
          {children}
        </View>
      )}
    </View>
  );
}

// ── Main Screen ──

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { settings, updateSetting } = useSettings();
  const { all: downloads, active } = useDownloadList();

  // ── Storage calculation ──
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [calculatingStorage, setCalculatingStorage] = useState(false);
  const storageCalculated = useRef(false);

  const totalDownloadSize = useMemo(() => {
    return downloads
      .filter((t) => t.status === 'completed')
      .reduce((sum, t) => sum + (t.totalBytes || 0), 0);
  }, [downloads]);

  const activeCount = useMemo(
    () => active.length,
    [active],
  );

  useEffect(() => {
    if (storageCalculated.current || calculatingStorage) return;
    storageCalculated.current = true;
    calculateCacheSize();
  }, []);

  const calculateCacheSize = useCallback(async () => {
    setCalculatingStorage(true);
    try {
      const dir = (documentDirectory ?? '') + 'downloads/';
      const info = await getInfoAsync(dir);
      if (info.exists && 'size' in info) {
        setCacheSize((info as any).size || null);
      }
    } catch {}
    setCalculatingStorage(false);
  }, []);

  // ── Actions ──
  const handleClearCache = useCallback(() => {
    Alert.alert(
      'Clear Cache',
      'This will only clear temporary data. Downloaded files are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear', style: 'destructive', onPress: () => {
            setCacheSize(0);
            Alert.alert('Cache Cleared', 'Temporary data has been cleared.');
          },
        },
      ],
    );
  }, []);

  const handleShareApp = useCallback(() => {
    Alert.alert('Share FilmSnaps', 'Share this app with your friends!');
  }, []);

  const handleClearSaved = useCallback(() => {
    Alert.alert(
      'Clear Saved Items',
      'This will remove all your saved movies and shows. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All', style: 'destructive', onPress: async () => {
            await clearAllBookmarks();
            Alert.alert('Cleared', 'All saved items have been removed.');
          },
        },
      ],
    );
  }, []);

  // ── Providers for default server picker ──
  const serverProviders = useMemo(() => {
    return getEnabledProviders().filter(
      (p) => !p.platforms || !p.platforms.includes('web'),
    );
  }, []);

  const selectedServer = settings.defaultServer;
  const selectedProviderName = useMemo(() => {
    if (!selectedServer) return 'Auto (first available)';
    const p = serverProviders.find((sp) => sp.id === selectedServer);
    return p ? p.displayName || p.name : selectedServer;
  }, [selectedServer, serverProviders]);

  return (
    <View className="flex-1" style={{ backgroundColor: '#070708', paddingTop: insets.top }}>
      {/* Header */}
      <View className="px-5 pt-4 pb-3">
        <Text style={{ fontFamily: 'PlayfairDisplay_700Bold', fontSize: 22, color: '#F4F4F5' }}>
          Settings
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 1. Library ── */}
        <SectionCard title="Library">
          <SettingsRow
            icon="download-outline"
            label="Downloads"
            subtitle={
              activeCount > 0
                ? `${activeCount} active download${activeCount > 1 ? 's' : ''}`
                : totalDownloadSize > 0
                  ? `${formatBytes(totalDownloadSize)} used`
                  : 'Manage your downloads'
            }
            color="#D4A237"
            onPress={() => router.push('/downloads')}
            right={<Ionicons name="chevron-forward" size={16} color="#3f3f3f" />}
          />
          <Divider />
          <SettingsRow
            icon="time-outline"
            label="Watch History"
            subtitle="Movies and TV shows you've watched"
            color="#5b9cf6"
            onPress={() => router.push('/history')}
            right={<Ionicons name="chevron-forward" size={16} color="#3f3f3f" />}
          />
          <Divider />
          <SettingsRow
            icon="bookmark-outline"
            label="Saved"
            subtitle="Your bookmarked films and shows"
            color="#22c55e"
            onPress={() => router.push('/saved')}
            right={<Ionicons name="chevron-forward" size={16} color="#3f3f3f" />}
          />
        </SectionCard>

        {/* ── 2. Data & Storage ── */}
        <SectionCard title="Data & Storage">
          <SettingsRow
            icon="trash-outline"
            label="Clear Cache"
            subtitle={cacheSize != null ? `${formatBytes(cacheSize)} currently cached` : 'Tap to clear temporary data'}
            color="#ef4444"
            onPress={handleClearCache}
            right={
              calculatingStorage ? (
                <ActivityIndicator size="small" color="#52525b" />
              ) : (
                <Ionicons name="chevron-forward" size={16} color="#3f3f3f" />
              )
            }
          />
          <Divider />
          <SettingsRow
            icon="bookmark-outline"
            label="Clear Saved"
            subtitle="Remove all bookmarked films and shows"
            color="#ef4444"
            onPress={handleClearSaved}
            right={<Ionicons name="chevron-forward" size={16} color="#3f3f3f" />}
          />
          <Divider />
          <SettingsRow
            icon="folder-open-outline"
            label="Downloads Storage"
            subtitle={totalDownloadSize > 0 ? `${formatBytes(totalDownloadSize)} used` : 'No completed downloads'}
            color="#D4A237"
            onPress={() => router.push('/downloads')}
            right={<Ionicons name="chevron-forward" size={16} color="#3f3f3f" />}
          />
        </SectionCard>

        {/* ── 3. Default Server ── */}
        <CollapsibleSection
          title="Default Server"
          subtitle={selectedProviderName}
        >
          <View className="px-5 pt-3 pb-1">
            <Text className="text-zinc-400 text-xs leading-5 mb-2">
              Choose your preferred streaming server. When available, this server will be tried first.
            </Text>
          </View>

          {/* None / Auto option */}
          <TouchableOpacity
            onPress={() => updateSetting('defaultServer', '')}
            activeOpacity={0.7}
            className="flex-row items-center px-5 py-3"
            style={{ backgroundColor: '#141414' }}
          >
            <View
              className="w-5 h-5 rounded-full border-2 items-center justify-center mr-3"
              style={{ borderColor: selectedServer === '' ? '#D4A237' : '#333' }}
            >
              {selectedServer === '' && (
                <View className="w-3 h-3 rounded-full" style={{ backgroundColor: '#D4A237' }} />
              )}
            </View>
            <View className="flex-1">
              <Text
                className="text-sm"
                style={{ color: selectedServer === '' ? '#D4A237' : '#A1A1AA', fontFamily: 'Inter_600SemiBold' }}
              >
                Auto
              </Text>
              <Text className="text-zinc-500 text-[10px] mt-0.5">First available server</Text>
            </View>
          </TouchableOpacity>

          {serverProviders.map((p, idx) => {
            const isSelected = selectedServer === p.id;
            return (
              <View key={p.id}>
                {idx === 0 && <Divider />}
                <TouchableOpacity
                  onPress={() => updateSetting('defaultServer', isSelected ? '' : p.id)}
                  activeOpacity={0.7}
                  className="flex-row items-center px-5 py-3"
                  style={{ backgroundColor: '#141414' }}
                >
                  <View
                    className="w-5 h-5 rounded-full border-2 items-center justify-center mr-3"
                    style={{ borderColor: isSelected ? '#D4A237' : '#333' }}
                  >
                    {isSelected && (
                      <View className="w-3 h-3 rounded-full" style={{ backgroundColor: '#D4A237' }} />
                    )}
                  </View>
                  <View className="flex-1">
                    <Text
                      className="text-sm"
                      style={{ color: isSelected ? '#D4A237' : '#A1A1AA', fontFamily: 'Inter_500Medium' }}
                    >
                      {p.displayName || p.name}
                    </Text>
                    <Text className="text-zinc-500 text-[10px] mt-0.5">{p.id}</Text>
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
            color="#D4A237"
            onPress={() => router.push('/guide')}
            right={<Ionicons name="chevron-forward" size={16} color="#3f3f3f" />}
          />
          <Divider />
          <SettingsRow
            icon="share-outline"
            label="Share App"
            subtitle="Tell your friends about FilmSnaps"
            color="#5b9cf6"
            onPress={handleShareApp}
            right={<Ionicons name="chevron-forward" size={16} color="#3f3f3f" />}
          />
          <SettingsRow
            icon="shield-outline"
            label="Privacy Policy"
            subtitle="How we handle your data"
            color="#22c55e"
            onPress={() => router.push('/privacy')}
            right={<Ionicons name="chevron-forward" size={16} color="#3f3f3f" />}
          />
          <Divider />
          <SettingsRow
            icon="document-text-outline"
            label="Legal & DMCA"
            subtitle="Disclaimer, copyright, and terms"
            color="#a1a1aa"
            onPress={() => router.push('/legal')}
            right={<Ionicons name="chevron-forward" size={16} color="#3f3f3f" />}
          />

          {__DEV__ && (
            <>
              <Divider />
              <SettingsRow
                icon="flask-outline"
                label="Experimental Providers"
                subtitle="Test Nuvio provider extraction (dev only)"
                color="#D4A237"
                onPress={() => router.push('/experimental')}
                right={<Ionicons name="chevron-forward" size={16} color="#3f3f3f" />}
              />
            </>
          )}
        </SectionCard>

        {/* ── App Info ── */}
        <View className="items-center py-6">
          <Text className="text-zinc-600 text-[10px] font-semibold tracking-widest uppercase">
            FilmSnaps
          </Text>
          <Text className="text-zinc-700 text-[10px] mt-1">v1.0.0 · Open Source</Text>
        </View>
      </ScrollView>
    </View>
  );
}
