/**
 * Dev harness for SubtitleSync native module.
 *
 * Tests extractAsync against a URI, displays signal invariants + bin stats.
 * Accessible from the experimental page.
 */
import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../../theme/colors";
import { useSafeNavigation } from "@/lib/navigation";
import {
  extractAsync,
  onExtractProgress,
  cancel,
  type ExtractResult,
} from "expo-subtitle-sync";

const TEST_URIS = [
  {
    label: "Big Buck Bunny (local-ish)",
    uri: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
  },
  {
    label: "Sintel trailer",
    uri: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
  },
];

export default function SubtitleSyncTestScreen() {
  const insets = useSafeAreaInsets();
  const { goBack } = useSafeNavigation();
  const [uri, setUri] = useState(TEST_URIS[0].uri);
  const [fromSec, setFromSec] = useState("0");
  const [toSec, setToSec] = useState("30");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    const unsub = onExtractProgress((p) => setProgress(p));
    return unsub;
  }, []);

  const runExtract = useCallback(async () => {
    setRunning(true);
    setProgress(0);
    setResult(null);
    setError(null);
    try {
      const r: ExtractResult = await extractAsync(uri, {
        fromSec: parseFloat(fromSec) || 0,
        toSec: parseFloat(toSec) || 30,
      });
      if (r.ok) {
        // Validate §1.3 invariants
        const expectedBins = Math.ceil(((r.endSec - r.startSec) * 16000) / 160);
        const decodedBytes = atob(r.signalB64);
        const expectedBytes = Math.ceil(r.bins / 8);
        const binMatch = Math.abs(r.bins - expectedBins) <= 1;
        const byteMatch = decodedBytes.length === expectedBytes;

        setResult(
          `OK ✓\n` +
            `start: ${r.startSec.toFixed(3)}s\n` +
            `end: ${r.endSec.toFixed(3)}s\n` +
            `duration: ${(r.endSec - r.startSec).toFixed(3)}s\n` +
            `bins: ${r.bins} (expected ≈${expectedBins}) ${binMatch ? "✓" : "✗ MISMATCH"}\n` +
            `bytes: ${decodedBytes.length} (expected ${expectedBytes}) ${byteMatch ? "✓" : "✗ MISMATCH"}\n` +
            `signalB64 length: ${r.signalB64.length}`,
        );
      } else {
        setError(`code: ${r.code}\nmessage: ${r.message}`);
      }
    } catch (e: any) {
      setError(`Exception: ${e?.message ?? e}`);
    } finally {
      setRunning(false);
      setProgress(0);
    }
  }, [uri, fromSec, toSec]);

  return (
    <SafeAreaView style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>SubtitleSync Test</Text>
      </View>

      <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
        {/* Quick picks */}
        <Text style={styles.label}>Quick URI:</Text>
        <View style={styles.row}>
          {TEST_URIS.map((t) => (
            <TouchableOpacity
              key={t.label}
              style={[styles.pill, uri === t.uri && styles.pillActive]}
              onPress={() => setUri(t.uri)}
            >
              <Text
                style={[
                  styles.pillText,
                  uri === t.uri && styles.pillTextActive,
                ]}
              >
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* URI */}
        <Text style={styles.label}>URI:</Text>
        <TextInput
          style={styles.input}
          value={uri}
          onChangeText={setUri}
          placeholder="file:// or https://..."
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
        />

        {/* Window */}
        <View style={styles.row}>
          <View style={styles.halfField}>
            <Text style={styles.label}>fromSec:</Text>
            <TextInput
              style={styles.input}
              value={fromSec}
              onChangeText={setFromSec}
              keyboardType="numeric"
              placeholderTextColor={colors.textSecondary}
            />
          </View>
          <View style={styles.halfField}>
            <Text style={styles.label}>toSec:</Text>
            <TextInput
              style={styles.input}
              value={toSec}
              onChangeText={setToSec}
              keyboardType="numeric"
              placeholderTextColor={colors.textSecondary}
            />
          </View>
        </View>

        {/* Run */}
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.btn, running && styles.btnDisabled]}
            onPress={runExtract}
            disabled={running}
          >
            {running ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Ionicons name="play" size={18} color="#fff" />
            )}
            <Text style={styles.btnText}>
              {running ? "Running..." : "Extract"}
            </Text>
          </TouchableOpacity>
          {running && (
            <TouchableOpacity
              style={[styles.btn, styles.btnDanger]}
              onPress={cancel}
            >
              <Ionicons name="close" size={18} color="#fff" />
              <Text style={styles.btnText}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Progress */}
        {running && (
          <View style={styles.progressWrap}>
            <View
              style={[styles.progressBar, { width: `${progress * 100}%` }]}
            />
            <Text style={styles.progressText}>
              {(progress * 100).toFixed(0)}%
            </Text>
          </View>
        )}

        {/* Result */}
        {result && (
          <View style={styles.resultBox}>
            <Text style={styles.resultText}>{result}</Text>
          </View>
        )}

        {/* Error */}
        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { marginRight: 12 },
  headerTitle: { fontSize: 18, fontWeight: "600", color: colors.textPrimary },
  content: { flex: 1, padding: 16 },
  label: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 4,
    marginTop: 12,
  },
  input: {
    backgroundColor: colors.bgElevated,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
  },
  row: { flexDirection: "row", gap: 8, marginTop: 8 },
  halfField: { flex: 1 },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  pillText: { fontSize: 12, color: colors.textSecondary },
  pillTextActive: { color: "#000", fontWeight: "600" },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.gold,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 16,
  },
  btnDisabled: { opacity: 0.5 },
  btnDanger: { backgroundColor: "#e74c3c" },
  btnText: { color: "#000", fontWeight: "600", fontSize: 14 },
  progressWrap: {
    marginTop: 12,
    height: 28,
    borderRadius: 6,
    backgroundColor: colors.bgElevated,
    overflow: "hidden",
    justifyContent: "center",
  },
  progressBar: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.gold,
    borderRadius: 6,
    opacity: 0.3,
  },
  progressText: {
    textAlign: "center",
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "600",
  },
  resultBox: {
    marginTop: 16,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "rgba(46,204,113,0.1)",
    borderWidth: 1,
    borderColor: "rgba(46,204,113,0.3)",
  },
  resultText: { color: "#2ecc71", fontFamily: "monospace", fontSize: 13 },
  errorBox: {
    marginTop: 16,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "rgba(231,76,60,0.1)",
    borderWidth: 1,
    borderColor: "rgba(231,76,60,0.3)",
  },
  errorText: { color: "#e74c3c", fontFamily: "monospace", fontSize: 13 },
});
