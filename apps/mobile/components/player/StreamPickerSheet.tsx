/**
 * StreamPickerSheet — bottom sheet for switching between stream sources.
 *
 * Designed for a 2-second decision, not data parsing:
 *  - one line per source: quality · languages · size, probe status icon leading
 *  - "Best for you" marks the selector's recommendation (gold left edge)
 *  - warning badges only when they change a decision: CAM, Download-only,
 *    Last used
 *  - codec / CDN / provider jargon omitted — the ranking already accounted
 *    for it, so the user never needs to
 *  - live probe status: ✓ verified / ? unverified / ✕ failed (confirmed only)
 */

import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../theme/colors";
import {
  parseLinkLanguages,
  getLanguageSection,
  isCamPrint,
  type LinkLanguage,
  type PreferredLanguage,
} from "../../lib/streamSelector";
import type { ProbeOutcome } from "../../lib/streamValidator";
import type { StreamLink } from "./streamTypes";

interface StreamPickerSheetProps {
  visible: boolean;
  links: StreamLink[];
  activeIndex: number;
  /** Probe outcome per link index (from the player's live probing). */
  linkStatuses?: Record<number, ProbeOutcome>;
  /** Index of the selector's recommended source. */
  recommendedIndex?: number;
  /** Index of the source that worked last time for this title. */
  lastUsedIndex?: number;
  /** User's preferred audio language — drives the section grouping. */
  preferredLanguage?: PreferredLanguage;
  /** Re-probe every source (clears cached verdicts first). */
  onRetest?: () => void;
  onSelect: (index: number) => void;
  onClose: () => void;
}

type LanguageFilter = "all" | LinkLanguage;

type PickerRow =
  | { kind: "header"; key: string; label: string }
  | { kind: "link"; key: string; link: StreamLink; index: number };

const LANGUAGE_CHIP_LABEL: Record<LanguageFilter, string> = {
  all: "All",
  multi: "Multi",
  hindi: "Hindi",
  english: "English",
};

function statusIcon(outcome: ProbeOutcome | undefined): {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
} {
  switch (outcome) {
    case "valid":
      return {
        name: "checkmark-circle",
        color: "#4ade80",
        label: "Verified working",
      };
    case "dead":
      return { name: "close-circle", color: "#f87171", label: "Failed" };
    default:
      return {
        name: "help-circle-outline",
        color: "#9ca3af",
        label: "Not checked yet",
      };
  }
}

/** Languages reduced to what the user actually cares about, e.g. "Hindi · Multi". */
function compactLanguageLabel(
  langs: LinkLanguage[],
  preferred: PreferredLanguage,
): string {
  if (langs.length === 0) return "";
  const order: LinkLanguage[] = [];
  if (preferred === "hindi" || preferred === "english") order.push(preferred);
  if (langs.includes("multi")) order.push("multi");
  if (langs.includes("hindi")) order.push("hindi");
  if (langs.includes("english")) order.push("english");
  const labels: string[] = [];
  for (const lang of order) {
    if (!langs.includes(lang)) continue;
    const label =
      lang === "multi" ? "Multi" : lang === "hindi" ? "Hindi" : "English";
    if (!labels.includes(label)) labels.push(label);
  }
  return labels.slice(0, 2).join(" · ");
}

/** "18.99GB" / 20391014400 bytes → "17.7 GB" / "812 MB" — one clean number. */
function formatSizeHuman(link: StreamLink): string | null {
  const bytes = link._meta?.sizeBytes;
  if (typeof bytes === "number" && bytes > 0) {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
  }
  const raw = link.size?.trim();
  if (!raw) return null;
  const m = raw.match(/([\d.]+)\s*(GB|MB|KB)/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  const unit = m[2].toUpperCase();
  if (unit === "GB") return `${n.toFixed(1)} GB`;
  if (unit === "MB") return `${Math.round(n)} MB`;
  return `${Math.round(n)} KB`;
}

export function StreamPickerSheet({
  visible,
  links,
  activeIndex,
  linkStatuses = {},
  recommendedIndex,
  lastUsedIndex,
  preferredLanguage = "auto",
  onRetest,
  onSelect,
  onClose,
}: StreamPickerSheetProps) {
  const [languageFilter, setLanguageFilter] = useState<LanguageFilter>("all");

  // Language chips only for languages actually present in the list
  const availableLanguages = useMemo(() => {
    const set = new Set<LinkLanguage>();
    links.forEach((l) =>
      parseLinkLanguages(l.name).forEach((lang) => set.add(lang)),
    );
    return Array.from(set);
  }, [links]);

  // Rows with language section headers (links arrive ranked from the selector).
  // Confirmed-failed links sink to the very end under their own section — they
  // stay selectable (probe verdicts can be wrong) but never clutter the top.
  const rows = useMemo<PickerRow[]>(() => {
    const matching = links
      .map((link, index) => ({ link, index }))
      .filter(
        ({ link }) =>
          languageFilter === "all" ||
          parseLinkLanguages(link.name).includes(
            languageFilter as LinkLanguage,
          ),
      );

    const out: PickerRow[] = [];
    const dead: PickerRow[] = [];
    let lastSection: string | null = null;
    for (const { link, index } of matching) {
      if (linkStatuses[index] === "dead") {
        dead.push({ kind: "link", key: `${link.id}-${link.url}`, link, index });
        continue;
      }
      const section = getLanguageSection(link, preferredLanguage);
      if (section !== lastSection) {
        out.push({ kind: "header", key: `h-${section}`, label: section });
        lastSection = section;
      }
      out.push({ kind: "link", key: `${link.id}-${link.url}`, link, index });
    }
    if (dead.length > 0) {
      out.push({ kind: "header", key: "h-failed", label: "Failed" });
      out.push(...dead);
    }
    return out;
  }, [links, languageFilter, preferredLanguage, linkStatuses]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerTitle}>Sources</Text>
            </View>
            <View style={styles.headerActions}>
              {onRetest && (
                <TouchableOpacity
                  onPress={onRetest}
                  style={styles.retestButton}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Re-test all sources"
                >
                  <Ionicons name="refresh" size={18} color={colors.gold} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={onClose}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Close source picker"
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Language filter chips */}
          {availableLanguages.length > 0 && (
            <View style={styles.chipRow}>
              {(["all", ...availableLanguages] as LanguageFilter[]).map(
                (lang) => {
                  const isActive = languageFilter === lang;
                  return (
                    <TouchableOpacity
                      key={lang}
                      style={[styles.chip, isActive && styles.chipActive]}
                      onPress={() => setLanguageFilter(lang)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Filter by ${LANGUAGE_CHIP_LABEL[lang]} language`}
                      accessibilityState={{ selected: isActive }}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          isActive && styles.chipTextActive,
                        ]}
                      >
                        {LANGUAGE_CHIP_LABEL[lang]}
                      </Text>
                    </TouchableOpacity>
                  );
                },
              )}
            </View>
          )}

          {/* Stream list with language sections */}
          <FlatList
            data={rows}
            keyExtractor={(item) => item.key}
            renderItem={({ item }) => {
              if (item.kind === "header") {
                return (
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionHeaderText}>{item.label}</Text>
                  </View>
                );
              }
              const { link, index } = item;
              const isActive = index === activeIndex;
              const isRecommended = index === recommendedIndex;
              const meta = link._meta;
              const outcome = linkStatuses[index];
              const status = statusIcon(outcome);
              const failed = outcome === "dead";
              const langLabel = compactLanguageLabel(
                parseLinkLanguages(link.name),
                preferredLanguage,
              );
              const sizeLabel = formatSizeHuman(link);
              const hasBadges =
                isRecommended ||
                index === lastUsedIndex ||
                isCamPrint(link) ||
                meta?.isDownloadOnly;
              return (
                <TouchableOpacity
                  style={[
                    styles.streamItem,
                    isActive && styles.streamActive,
                    failed && styles.streamFailed,
                    isRecommended && !isActive && styles.streamRecommended,
                  ]}
                  onPress={() => {
                    onSelect(index);
                    onClose();
                  }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`${failed ? "Failed source. " : ""}${isRecommended ? "Best match. " : ""}Source ${index + 1}: ${link.quality}${langLabel ? `, ${langLabel}` : ""}${sizeLabel ? `, ${sizeLabel}` : ""}, ${status.label}`}
                >
                  {/* Leading probe status — the scan column */}
                  <View style={styles.statusLeading}>
                    <Ionicons
                      name={status.name}
                      size={16}
                      color={status.color}
                    />
                  </View>

                  {/* Main line: quality · languages … size */}
                  <View style={styles.streamMain}>
                    <View style={styles.streamTopRow}>
                      <Text style={styles.streamQuality}>{link.quality}</Text>
                      {langLabel ? (
                        <Text style={styles.streamLang} numberOfLines={1}>
                          {langLabel}
                        </Text>
                      ) : null}
                      {sizeLabel ? (
                        <Text style={styles.streamSize}>{sizeLabel}</Text>
                      ) : null}
                    </View>

                    {/* Warning badges only — informational jargon lives in the ranking */}
                    {hasBadges && (
                      <View style={styles.streamBadges}>
                        {isRecommended && (
                          <View style={[styles.badge, styles.badgeRecommended]}>
                            <Ionicons
                              name="star"
                              size={11}
                              color={colors.gold}
                            />
                            <Text
                              style={[
                                styles.badgeText,
                                styles.badgeTextRecommended,
                              ]}
                            >
                              Best for you
                            </Text>
                          </View>
                        )}
                        {index === lastUsedIndex && (
                          <View style={[styles.badge, styles.badgeLastUsed]}>
                            <Ionicons
                              name="time-outline"
                              size={11}
                              color="#5b9cf6"
                            />
                            <Text
                              style={[
                                styles.badgeText,
                                styles.badgeTextLastUsed,
                              ]}
                            >
                              Last used
                            </Text>
                          </View>
                        )}
                        {isCamPrint(link) && (
                          <View style={[styles.badge, styles.badgeCam]}>
                            <Text
                              style={[styles.badgeText, styles.badgeTextCam]}
                            >
                              CAM
                            </Text>
                          </View>
                        )}
                        {meta?.isDownloadOnly && (
                          <View style={[styles.badge, styles.badgeDownload]}>
                            <Text
                              style={[
                                styles.badgeText,
                                styles.badgeTextDownload,
                              ]}
                            >
                              Download only
                            </Text>
                          </View>
                        )}
                      </View>
                    )}
                  </View>

                  {/* Active indicator */}
                  {isActive && (
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color={colors.gold}
                      style={styles.checkIcon}
                    />
                  )}
                </TouchableOpacity>
              );
            }}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>
                  No sources match this language.
                </Text>
              </View>
            }
          />
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "68%",
    paddingBottom: 32,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.zinc800,
  },
  headerTitleWrap: {
    flex: 1,
    gap: 2,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "700",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  retestButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(212,162,55,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  chipRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: "transparent",
    minHeight: 32,
    justifyContent: "center",
  },
  chipActive: {
    backgroundColor: "rgba(212,162,55,0.15)",
    borderColor: "rgba(212,162,55,0.5)",
  },
  chipText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  chipTextActive: {
    color: colors.gold,
  },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 6,
    backgroundColor: colors.bgSubtle,
  },
  sectionHeaderText: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  badgeCam: {
    backgroundColor: "rgba(239,68,68,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
  },
  badgeTextCam: {
    color: "#f87171",
  },
  streamItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  streamActive: {
    backgroundColor: colors.goldBadge,
  },
  streamFailed: {
    backgroundColor: "rgba(239,68,68,0.09)",
    borderLeftWidth: 3,
    borderLeftColor: "#f87171",
  },
  streamTopRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  streamQuality: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "600",
  },
  streamLang: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "500",
    flexShrink: 1,
  },
  streamSize: {
    color: colors.textTertiary,
    fontSize: 13,
    marginLeft: "auto",
  },
  statusLeading: {
    width: 26,
    alignItems: "center",
    marginRight: 4,
  },
  streamMain: {
    flex: 1,
  },
  streamRecommended: {
    borderLeftWidth: 3,
    borderLeftColor: "rgba(212,162,55,0.55)",
  },
  streamBadges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeRecommended: {
    backgroundColor: "rgba(212,162,55,0.15)",
    borderColor: "rgba(212,162,55,0.4)",
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  badgeDownload: {
    backgroundColor: "rgba(251,146,60,0.15)",
  },
  badgeText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: "600",
  },
  badgeTextDownload: {
    color: "#fb923c",
  },
  badgeTextRecommended: {
    color: colors.gold,
  },
  badgeLastUsed: {
    backgroundColor: "rgba(91,156,246,0.15)",
    borderColor: "rgba(91,156,246,0.3)",
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  badgeTextLastUsed: {
    color: "#5b9cf6",
  },
  checkIcon: {
    marginLeft: 8,
  },
  separator: {
    height: 1,
    backgroundColor: colors.zinc800,
    marginHorizontal: 20,
  },
  emptyWrap: {
    paddingVertical: 32,
    alignItems: "center",
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
});
