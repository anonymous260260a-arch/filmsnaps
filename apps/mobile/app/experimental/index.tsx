/**
 * Experimental Providers Testing Page
 *
 * Runs Nuvio provider JS bundles inside hidden WebViews to test
 * whether they successfully extract video streams.
 *
 * Workflow:
 *   1. Select one or more providers (checkboxes)
 *   2. Enter a TMDB ID (e.g., "872585" for Oppenheimer)
 *   3. Choose media type (movie/tv), season/episode
 *   4. Tap "Test Selected" — runs each provider in a hidden sandbox
 *   5. View results per provider (stream count, URL, quality)
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProviderSandbox } from '../../components/experimental/ProviderSandbox';
import { EXPERIMENTAL_PROVIDERS } from '../../components/experimental/providerSources';
import type {
  ProviderTestResult,
  ProviderStream,
} from '../../components/experimental/types';

/** Default TMDB IDs for quick testing */
const QUICK_IDS = [
  { label: 'Oppenheimer', id: '872585' },
  { label: 'Interstellar', id: '157336' },
  { label: 'Dark (S1E1)', id: '70523', type: 'tv' as const },
  { label: 'Pushpa 2', id: '1207898' },
  { label: 'RRR', id: '916302' },
];

export default function ExperimentalPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // ── Input state ──
  const [tmdbId, setTmdbId] = useState('872585');
  const [mediaType, setMediaType] = useState<'movie' | 'tv'>('movie');
  const [season, setSeason] = useState('1');
  const [episode, setEpisode] = useState('1');
  const [selectedProviders, setSelectedProviders] = useState<Set<string>>(
    new Set(['dooflix']),
  );
  const [showAdvanced, setShowAdvanced] = useState(true); // auto-expand logs

  // ── Test state ──
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<Record<string, ProviderTestResult>>({});
  const [logs, setLogs] = useState<string[]>([]);
  const resultCountRef = useRef(0);
  const expectedCountRef = useRef(0);

  // ── Timer refs for cleanup ──
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // ── Logs ref for auto-scroll ──
  const logScrollRef = useRef<ScrollView>(null);

  const addLog = useCallback((msg: string) => {
    console.log(`[Experimental] ${msg}`);
    setLogs((prev) => [...prev.slice(-99), msg]);
  }, []);

  // ── Toggle provider selection ──
  const toggleProvider = useCallback((id: string) => {
    setSelectedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Select all / none ──
  const selectAll = useCallback(() => {
    setSelectedProviders(new Set(EXPERIMENTAL_PROVIDERS.map((p) => p.id)));
  }, []);
  const selectNone = useCallback(() => {
    setSelectedProviders(new Set());
  }, []);
  const selectSimple = useCallback(() => {
    setSelectedProviders(
      new Set(
        EXPERIMENTAL_PROVIDERS.filter((p) => p.complexity === 'simple').map(
          (p) => p.id,
        ),
      ),
    );
  }, []);

  // ── Handle sandbox result ──
  const handleResult = useCallback(
    (providerId: string, sandboxResult: any) => {
      if (sandboxResult.type === 'log') {
        const msg = (sandboxResult.args || []).join(' ');
        addLog(`[${providerId}] ${msg}`);
        return; // Logs don't count as completion
      }

      // Only error and result count as completions
      resultCountRef.current += 1;

      setResults((prev) => {
        const current = prev[providerId] || {
          providerId,
          status: 'pending',
          streams: [],
        };

        if (sandboxResult.type === 'error') {
          addLog(
            `[${providerId}] ERROR (${sandboxResult.elapsed}ms): ${sandboxResult.message}`,
          );
          return {
            ...prev,
            [providerId]: {
              ...current,
              status: 'error',
              error: sandboxResult.message,
              elapsed: sandboxResult.elapsed,
            },
          };
        }

        if (sandboxResult.type === 'result') {
          const streams: ProviderStream[] = sandboxResult.streams || [];
          addLog(
            `[${providerId}] DONE (${sandboxResult.elapsed}ms): ${streams.length} streams`,
          );
          return {
            ...prev,
            [providerId]: {
              ...current,
              streams,
              status: streams.length > 0 ? 'success' : 'error',
              error: streams.length === 0 ? 'No streams returned' : undefined,
              elapsed: sandboxResult.elapsed,
            },
          };
        }

        return prev;
      });
    },
    [addLog],
  );

  // ── Run test on all selected providers ──
  const runTest = useCallback(() => {
    if (!tmdbId.trim()) return;

    // Clean up any previous runs first
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    setIsRunning(true);
    resultCountRef.current = 0;
    const selected = EXPERIMENTAL_PROVIDERS.filter((p) =>
      selectedProviders.has(p.id),
    );
    expectedCountRef.current = selected.length;

    // Reset results for selected providers
    const initial: Record<string, ProviderTestResult> = {};
    selected.forEach((p) => {
      initial[p.id] = {
        providerId: p.id,
        status: 'running',
        streams: [],
        startTime: Date.now(),
      };
    });
    setResults(initial);
    setLogs([]);
    addLog(`Starting test for ${selected.length} provider(s)...`);

    // Each provider will complete via handleResult callback.
    // Timeout: if no results within 60s, mark remaining as error.
    timeoutRef.current = setTimeout(() => {
      setResults((prev) => {
        const updated = { ...prev };
        Object.keys(updated).forEach((id) => {
          if (updated[id].status === 'running') {
            updated[id] = { ...updated[id], status: 'error', error: 'Timed out (60s)' };
          }
        });
        return updated;
      });
      setIsRunning(false);
      addLog('Test timed out after 60s');
    }, 60000);

    // Check if all done
    intervalRef.current = setInterval(() => {
      if (resultCountRef.current >= expectedCountRef.current) {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (intervalRef.current) clearInterval(intervalRef.current);
        setIsRunning(false);
        addLog('All providers complete');
      }
    }, 500);
  }, [tmdbId, selectedProviders, addLog]);

  const isTesting = isRunning;

  // ── Clear results ──
  const clearResults = useCallback(() => {
    setResults({});
    setLogs([]);
  }, []);

  // ── Language badge colors ──
  const langColors: Record<string, string> = {
    en: '#22c55e',
    hi: '#f97316',
    hin: '#f97316',
    ta: '#ef4444',
    tam: '#ef4444',
    te: '#a855f7',
    tel: '#a855f7',
    ml: '#06b6d4',
    kn: '#eab308',
    id: '#6366f1',
    pl: '#ec4899',
    ar: '#14b8a6',
  };

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: '#070708' }}>
      <StatusBar barStyle="light-content" />
      <View className="flex-1 px-4 pt-2">
        {/* ── Header ── */}
        <View className="flex-row items-center justify-between mb-4">
          <View className="flex-row items-center">
            <TouchableOpacity
              onPress={() => router.back()}
              className="mr-3 p-1"
              activeOpacity={0.7}
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={22} color="#F4F4F5" />
            </TouchableOpacity>
            <View>
              <Text
                className="text-lg text-white"
                style={{ fontFamily: 'Inter_600SemiBold' }}
              >
                Experimental Providers
              </Text>
              <Text className="text-zinc-500 text-xs">
                Test Nuvio provider extraction
              </Text>
            </View>
          </View>
        </View>

        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        >
          {/* ── TMDB ID Input ── */}
          <View className="mb-4">
            <Text className="text-zinc-400 text-xs mb-1.5 font-medium">
              TMDB ID
            </Text>
            <TextInput
              value={tmdbId}
              onChangeText={setTmdbId}
              placeholder="e.g. 872585"
              placeholderTextColor="#52525b"
              className="bg-zinc-900 text-white rounded-xl px-4 py-3 text-base border border-zinc-800"
              keyboardType="number-pad"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {/* Quick IDs */}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="mt-2"
            >
              {QUICK_IDS.map((q) => (
                <TouchableOpacity
                  key={q.label}
                  onPress={() => {
                    setTmdbId(q.id);
                    if (q.type) setMediaType(q.type);
                  }}
                  className="bg-zinc-900 rounded-lg px-3 py-1.5 mr-2 border border-zinc-800"
                  activeOpacity={0.7}
                >
                  <Text className="text-zinc-400 text-xs">{q.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* ── Media Type + Season/Episode ── */}
          <View className="flex-row items-center gap-3 mb-4">
            <TouchableOpacity
              onPress={() => setMediaType('movie')}
              className={`rounded-lg px-4 py-2 ${
                mediaType === 'movie' ? 'bg-primary' : 'bg-zinc-900'
              }`}
              activeOpacity={0.7}
            >
              <Text
                className={`text-sm font-semibold ${
                  mediaType === 'movie' ? 'text-black' : 'text-zinc-400'
                }`}
              >
                Movie
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setMediaType('tv')}
              className={`rounded-lg px-4 py-2 ${
                mediaType === 'tv' ? 'bg-primary' : 'bg-zinc-900'
              }`}
              activeOpacity={0.7}
            >
              <Text
                className={`text-sm font-semibold ${
                  mediaType === 'tv' ? 'text-black' : 'text-zinc-400'
                }`}
              >
                TV Show
              </Text>
            </TouchableOpacity>

            {mediaType === 'tv' && (
              <View className="flex-row items-center gap-2 flex-1">
                <View className="flex-1">
                  <Text className="text-zinc-500 text-[10px] mb-0.5">S</Text>
                  <TextInput
                    value={season}
                    onChangeText={setSeason}
                    className="bg-zinc-900 text-white rounded-lg px-3 py-2 text-sm border border-zinc-800"
                    keyboardType="number-pad"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-zinc-500 text-[10px] mb-0.5">Ep</Text>
                  <TextInput
                    value={episode}
                    onChangeText={setEpisode}
                    className="bg-zinc-900 text-white rounded-lg px-3 py-2 text-sm border border-zinc-800"
                    keyboardType="number-pad"
                  />
                </View>
              </View>
            )}
          </View>

          {/* ── Provider Selection ── */}
          <View className="mb-4">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-zinc-400 text-xs font-medium">
                Providers ({selectedProviders.size} selected)
              </Text>
              <View className="flex-row gap-2">
                <TouchableOpacity onPress={selectSimple} activeOpacity={0.7}>
                  <Text className="text-zinc-500 text-xs">Simple</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={selectAll} activeOpacity={0.7}>
                  <Text className="text-zinc-500 text-xs">All</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={selectNone} activeOpacity={0.7}>
                  <Text className="text-zinc-500 text-xs">None</Text>
                </TouchableOpacity>
              </View>
            </View>

            {EXPERIMENTAL_PROVIDERS.map((p) => (
              <TouchableOpacity
                key={p.id}
                onPress={() => toggleProvider(p.id)}
                className={`flex-row items-center justify-between rounded-xl px-3 py-2.5 mb-1 border ${
                  selectedProviders.has(p.id)
                    ? 'bg-zinc-800 border-zinc-700'
                    : 'bg-zinc-900/50 border-zinc-800/50'
                }`}
                activeOpacity={0.7}
              >
                <View className="flex-row items-center flex-1">
                  <View
                    className={`w-5 h-5 rounded-md border-2 mr-2.5 items-center justify-center ${
                      selectedProviders.has(p.id)
                        ? 'bg-primary border-primary'
                        : 'border-zinc-600'
                    }`}
                  >
                    {selectedProviders.has(p.id) && (
                      <Ionicons name="checkmark" size={14} color="#000" />
                    )}
                  </View>
                  <View className="flex-1">
                    <Text className="text-white text-sm font-medium">
                      {p.name}
                    </Text>
                    <View className="flex-row items-center mt-0.5">
                      {p.languages.map((lang) => (
                        <View
                          key={lang}
                          className="rounded-sm px-1.5 py-0.5 mr-1"
                          style={{
                            backgroundColor: (langColors[lang] || '#52525b') + '20',
                          }}
                        >
                          <Text
                            className="text-[10px]"
                            style={{ color: langColors[lang] || '#a1a1aa' }}
                          >
                            {lang}
                          </Text>
                        </View>
                      ))}
                      {p.deps.crypto && (
                        <View className="rounded-sm px-1.5 py-0.5 bg-amber-500/20 ml-1">
                          <Text className="text-[10px] text-amber-400">
                            crypto
                          </Text>
                        </View>
                      )}
                      {p.deps.cheerio && (
                        <View className="rounded-sm px-1.5 py-0.5 bg-blue-500/20 ml-1">
                          <Text className="text-[10px] text-blue-400">
                            cheerio
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
                <Text
                  className={`text-[10px] uppercase ${
                    p.complexity === 'simple'
                      ? 'text-green-500'
                      : p.complexity === 'medium'
                        ? 'text-amber-500'
                        : 'text-red-400'
                  }`}
                >
                  {p.complexity}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Run / Clear buttons ── */}
          <View className="flex-row gap-3 mb-4">
            <TouchableOpacity
              onPress={runTest}
              disabled={isTesting || selectedProviders.size === 0 || !tmdbId.trim()}
              className={`flex-1 rounded-xl py-3 items-center flex-row justify-center ${
                isTesting ? 'bg-zinc-800' : 'bg-primary'
              }`}
              activeOpacity={0.8}
            >
              {isTesting ? (
                <ActivityIndicator size="small" color="#d4d4d8" />
              ) : (
                <Ionicons name="play" size={16} color="#000" />
              )}
              <Text
                className={`font-bold text-sm ml-2 ${
                  isTesting ? 'text-zinc-400' : 'text-black'
                }`}
              >
                {isTesting ? 'Testing...' : 'Test Selected'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={clearResults}
              className="bg-zinc-900 rounded-xl py-3 px-4 items-center justify-center border border-zinc-800"
              activeOpacity={0.7}
            >
              <Ionicons name="trash-outline" size={16} color="#a1a1aa" />
            </TouchableOpacity>
          </View>

          {/* ── Results ── */}
          {Object.keys(results).length > 0 && (
            <View className="mb-4">
              <Text className="text-zinc-400 text-xs font-medium mb-2">
                Results
              </Text>

              {EXPERIMENTAL_PROVIDERS.filter((p) => results[p.id]).map(
                (p) => {
                  const r = results[p.id];
                  const isSuccess = r.status === 'success';
                  const isError = r.status === 'error';
                  const isRunning2 = r.status === 'running';

                  return (
                    <View
                      key={p.id}
                      className={`rounded-xl border p-3 mb-2 ${
                        isSuccess
                          ? 'bg-green-950/30 border-green-900/50'
                          : isError
                            ? 'bg-red-950/30 border-red-900/50'
                            : 'bg-zinc-900 border-zinc-800'
                      }`}
                    >
                      {/* Header */}
                      <View className="flex-row items-center justify-between mb-1.5">
                        <View className="flex-row items-center">
                          <Ionicons
                            name={
                              isSuccess
                                ? 'checkmark-circle'
                                : isError
                                  ? 'close-circle'
                                  : 'time-outline'
                            }
                            size={16}
                            color={
                              isSuccess
                                ? '#22c55e'
                                : isError
                                  ? '#ef4444'
                                  : '#a1a1aa'
                            }
                          />
                          <Text className="text-white text-sm font-medium ml-1.5">
                            {p.name}
                          </Text>
                        </View>
                        {r.elapsed != null && (
                          <Text className="text-zinc-500 text-[10px]">
                            {(r.elapsed / 1000).toFixed(1)}s
                          </Text>
                        )}
                      </View>

                      {/* Streams */}
                      {isSuccess && r.streams.length > 0 && (
                        <View className="mt-1">
                          {r.streams
                            .slice(0, 5)
                            .map((stream: ProviderStream, i: number) => (
                              <View
                                key={i}
                                className="bg-black/40 rounded-lg px-3 py-2 mb-1"
                              >
                                <View className="flex-row items-center justify-between">
                                  <Text
                                    className="text-zinc-300 text-xs font-medium flex-1 mr-2"
                                    numberOfLines={1}
                                  >
                                    {stream.quality || 'Auto'}
                                  </Text>
                                  <Text className="text-zinc-500 text-[10px]">
                                    {stream.url?.includes('.m3u8')
                                      ? 'HLS'
                                      : stream.url?.includes('.mp4')
                                        ? 'MP4'
                                        : 'LINK'}
                                  </Text>
                                </View>
                                <Text
                                  className="text-zinc-600 text-[10px] mt-0.5"
                                  numberOfLines={1}
                                >
                                  {stream.url}
                                </Text>
                              </View>
                            ))}
                          {r.streams.length > 5 && (
                            <Text className="text-zinc-600 text-[10px] text-center mt-1">
                              +{r.streams.length - 5} more streams
                            </Text>
                          )}
                        </View>
                      )}

                      {/* Error */}
                      {isError && r.error && (
                        <Text
                          className="text-red-400/80 text-xs mt-1"
                          numberOfLines={3}
                        >
                          {r.error}
                        </Text>
                      )}

                      {/* Running */}
                      {isRunning2 && (
                        <View className="flex-row items-center mt-1">
                          <ActivityIndicator
                            size={10}
                            color="#a1a1aa"
                            style={{ marginRight: 6 }}
                          />
                          <Text className="text-zinc-500 text-xs">
                            Running...
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                },
              )}
            </View>
          )}

          {/* ── Logs ── */}
          {logs.length > 0 && (
            <View className="mb-4">
              <TouchableOpacity
                onPress={() => setShowAdvanced(!showAdvanced)}
                className="flex-row items-center justify-between mb-1"
              >
                <Text className="text-zinc-500 text-xs font-medium">
                  Logs ({logs.length})
                </Text>
                <Ionicons
                  name={showAdvanced ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color="#52525b"
                />
              </TouchableOpacity>
              {showAdvanced && (
                <View className="bg-black rounded-xl p-3 max-h-48">
                  <ScrollView
                    ref={logScrollRef}
                    onContentSizeChange={() =>
                      logScrollRef.current?.scrollToEnd({ animated: true })
                    }
                  >
                    {logs.map((line, i) => (
                      <Text
                        key={i}
                        className="text-zinc-500 text-[10px] font-mono leading-4"
                      >
                        {line}
                      </Text>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>
          )}

          {/* ── Invisible sandbox WebViews (active during test) ── */}
          {isTesting &&
            EXPERIMENTAL_PROVIDERS.filter((p) => selectedProviders.has(p.id))
              .map((p) => (
                <View key={p.id} style={{ height: 0, width: 0 }}>
                  <ProviderSandbox
                    providerId={p.id}
                    tmdbId={tmdbId.trim()}
                    mediaType={mediaType}
                    season={parseInt(season, 10) || 1}
                    episode={parseInt(episode, 10) || 1}
                    onResult={(result) => handleResult(p.id, result)}
                  />
                </View>
              ))}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
