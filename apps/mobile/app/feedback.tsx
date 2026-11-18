/**
 * Feedback — native screen for bug reports, ideas and questions, with this
 * install's own messages and the team's replies underneath.
 *
 * Ratings live in the occasional in-app prompt (components/FeedbackPrompt).
 * There is no app-store link anywhere in this flow: everything is submitted
 * to our own API and answers come back here. Abuse control (rate limiting,
 * profanity flagging) is entirely server-side.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useSafeNavigation } from "@/lib/navigation";
import { colors } from "../theme/colors";
import {
  fetchMyFeedbackState,
  markRepliesSeen,
  validateFeedback,
  voteOnReply,
  FEEDBACK_MESSAGE_MIN,
  FEEDBACK_MESSAGE_MAX,
  type FeedbackReply,
  type FeedbackType,
} from "../lib/feedback";
import { pendingFeedbackCount, sendFeedbackDraft } from "../lib/feedbackOutbox";
import { trackFeatureUsed } from "../lib/telemetry/track";

const TYPE_META: {
  value: FeedbackType;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { value: "bug", label: "Bug", icon: "bug-outline" },
  { value: "idea", label: "Idea", icon: "bulb-outline" },
  { value: "question", label: "Question", icon: "help-circle-outline" },
];

function typeMeta(type: string) {
  if (type === "rating") {
    return {
      label: "Rating",
      icon: "star-outline" as keyof typeof Ionicons.glyphMap,
    };
  }
  return TYPE_META.find((t) => t.value === type) ?? TYPE_META[0];
}

function shortDate(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    });
  } catch {
    return "";
  }
}

export default function FeedbackScreen() {
  const nav = useSafeNavigation();
  const insets = useSafeAreaInsets();

  const [type, setType] = useState<FeedbackType>("bug");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<"sent" | "queued" | null>(null);
  const [pending, setPending] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submissions, setSubmissions] = useState<FeedbackReply[]>([]);

  const load = useCallback(async () => {
    const state = await fetchMyFeedbackState();
    setSubmissions(state.rows);
    setLoadFailed(!state.ok);
    setPending(await pendingFeedbackCount());
    const newestReply = state.rows.reduce(
      (max, r) =>
        r.repliedTs != null && r.repliedTs > max ? r.repliedTs : max,
      0,
    );
    if (newestReply > 0) void markRepliesSeen(newestReply);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const messageLen = message.trim().length;
  const canSubmit = useMemo(
    () =>
      messageLen >= FEEDBACK_MESSAGE_MIN &&
      messageLen <= FEEDBACK_MESSAGE_MAX &&
      !submitting,
    [messageLen, submitting],
  );

  const onSubmit = useCallback(async () => {
    const validationError = validateFeedback({ type, message });
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    // The outbox stores the draft before it is sent, so nothing is lost if the
    // request fails, hangs or the app is killed mid-send.
    const res = await sendFeedbackDraft({ type, message });
    setSubmitting(false);
    if (res.ok) {
      trackFeatureUsed("feedback_submit");
      setMessage("");
      setNotice("sent");
      void load();
    } else if (res.queued) {
      // Server unreachable or out of its daily write budget — the draft is on
      // the device and is re-sent automatically.
      setPending(res.pending);
      setMessage("");
      setNotice("queued");
      void load();
    } else {
      setError(res.error ?? "Something went wrong. Please try again.");
    }
  }, [type, message, load]);

  const vote = useCallback(
    async (row: FeedbackReply, next: "like" | "dislike") => {
      const value = row.replyVote === next ? null : next;
      setSubmissions((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, replyVote: value } : r)),
      );
      const ok = await voteOnReply(row.id, value);
      if (!ok) {
        setSubmissions((prev) =>
          prev.map((r) =>
            r.id === row.id ? { ...r, replyVote: row.replyVote } : r,
          ),
        );
      }
    },
    [],
  );

  const header = (
    <View
      className="px-5 pt-2 pb-3 flex-row items-center"
      style={{ paddingTop: insets.top + 12 }}
    >
      <TouchableOpacity
        onPress={() => nav.goBack({ fallback: "/(tabs)" })}
        className="w-9 h-9 rounded-full bg-zinc-800/60 items-center justify-center mr-3"
        activeOpacity={0.7}
        accessibilityLabel="Back"
      >
        <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
      </TouchableOpacity>
      <Text
        style={{
          fontFamily: "PlayfairDisplay_700Bold",
          fontSize: 22,
          color: colors.textPrimary,
        }}
      >
        Feedback
      </Text>
    </View>
  );

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View className="flex-1" style={{ paddingTop: insets.top }}>
        {header}
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48 }}
          keyboardShouldPersistTaps="handled"
        >
          {notice && (
            <View style={styles.notice}>
              <Ionicons
                name={
                  notice === "sent"
                    ? "checkmark-circle"
                    : "cloud-offline-outline"
                }
                size={18}
                color={colors.gold}
              />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.noticeTitle}>
                  {notice === "sent" ? "Sent" : "Saved for later"}
                </Text>
                <Text style={styles.noticeText}>
                  {notice === "sent"
                    ? "We review every message and reply here. Check back in a couple of days."
                    : "It's saved on this device and will be sent automatically as soon as we can reach the server — then reviewed, with the reply here."}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setNotice(null)}
                style={styles.noticeClose}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Dismiss"
              >
                <Ionicons name="close" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
          )}

          <Text
            style={{
              color: colors.textTertiary,
              fontSize: 13,
              lineHeight: 19,
              marginBottom: 16,
            }}
          >
            Tell us what broke, what you'd change, or ask anything
          </Text>

          <View style={styles.segmented}>
            {TYPE_META.map((t, i) => {
              const active = type === t.value;
              return (
                <TouchableOpacity
                  key={t.value}
                  onPress={() => setType(t.value)}
                  style={[
                    styles.segment,
                    i === TYPE_META.length - 1 && { marginRight: 0 },
                    active && styles.segmentActive,
                  ]}
                  activeOpacity={0.8}
                  accessibilityLabel={`Feedback type: ${t.label}`}
                  accessibilityState={{ selected: active }}
                >
                  <Ionicons
                    name={t.icon}
                    size={16}
                    color={active ? colors.textPrimary : colors.textTertiary}
                  />
                  <Text
                    style={{
                      marginLeft: 6,
                      color: active ? colors.textPrimary : colors.textSecondary,
                      fontFamily: active
                        ? "Inter_600SemiBold"
                        : "Inter_500Medium",
                      fontSize: 13,
                    }}
                  >
                    {t.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Message</Text>
          <View style={styles.field}>
            <TextInput
              multiline
              value={message}
              onChangeText={(t) => {
                setMessage(t);
                if (error) setError(null);
                if (notice) setNotice(null);
              }}
              placeholder={
                type === "bug"
                  ? "What happened, and what did you expect?"
                  : type === "idea"
                    ? "What would you like to see in Filmsnaps?"
                    : "What's your question?"
              }
              placeholderTextColor={colors.textTertiary}
              maxLength={FEEDBACK_MESSAGE_MAX + 100}
              style={styles.input}
            />
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaHint}>
              {messageLen < FEEDBACK_MESSAGE_MIN
                ? `${FEEDBACK_MESSAGE_MIN - messageLen} more character${
                    FEEDBACK_MESSAGE_MIN - messageLen === 1 ? "" : "s"
                  } needed to send`
                : ""}
            </Text>
            <Text
              style={[
                styles.metaCount,
                messageLen > FEEDBACK_MESSAGE_MAX && { color: "#f87171" },
              ]}
            >
              {messageLen}/{FEEDBACK_MESSAGE_MAX}
            </Text>
          </View>

          {error ? (
            <Text
              style={{
                marginTop: 8,
                color: "#f87171",
                fontSize: 12.5,
                fontFamily: "Inter_500Medium",
              }}
            >
              {error}
            </Text>
          ) : null}

          <TouchableOpacity
            onPress={onSubmit}
            disabled={!canSubmit}
            style={[styles.primary, !canSubmit && styles.primaryDisabled]}
            activeOpacity={0.8}
            accessibilityLabel="Send feedback"
            accessibilityState={{ disabled: !canSubmit }}
          >
            {submitting ? (
              <ActivityIndicator color={colors.bg} size="small" />
            ) : (
              <Text
                style={{
                  color: canSubmit ? colors.bg : colors.textTertiary,
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 15,
                }}
              >
                Send
              </Text>
            )}
          </TouchableOpacity>
          <Text
            style={{
              textAlign: "center",
              marginTop: 12,
              color: colors.textTertiary,
              fontSize: 11.5,
              lineHeight: 17,
            }}
          >
            Anonymous — replies appear on this screen
          </Text>

          {(submissions.length > 0 || pending > 0 || loadFailed) && (
            <View style={{ marginTop: 32 }}>
              <View style={styles.sectionRow}>
                <Text style={styles.sectionTitle}>Your messages</Text>
                {submissions.length > 0 && (
                  <Text style={styles.sectionCount}>{submissions.length}</Text>
                )}
              </View>

              {pending > 0 && (
                <View style={styles.waitingRow}>
                  <View style={styles.waitingDot} />
                  <Text style={styles.waitingText}>
                    {pending} waiting to send
                  </Text>
                </View>
              )}

              {loadFailed && submissions.length === 0 && (
                <Text style={[styles.waitingText, { marginTop: 8 }]}>
                  Couldn't load your messages right now
                </Text>
              )}

              {submissions.map((s) => {
                const meta = typeMeta(s.type);
                return (
                  <View key={s.id} style={styles.card}>
                    <View style={styles.cardHeader}>
                      <View style={styles.cardHeaderLeft}>
                        <Ionicons
                          name={meta.icon}
                          size={14}
                          color={colors.textTertiary}
                        />
                        <Text style={styles.cardType}>{meta.label}</Text>
                        {s.rating != null && (
                          <Text style={styles.cardStars}>
                            {"★".repeat(s.rating)}
                          </Text>
                        )}
                      </View>
                      <Text style={styles.cardDate}>{shortDate(s.ts)}</Text>
                    </View>

                    {s.message.trim() ? (
                      <Text style={styles.cardMessage} numberOfLines={4}>
                        {s.message}
                      </Text>
                    ) : null}

                    {s.reply ? (
                      <View style={styles.replyRow}>
                        <View style={styles.replyRule} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.replyAuthor}>Filmsnaps team</Text>
                          <Text style={styles.replyText}>{s.reply}</Text>

                          <View style={styles.voteRow}>
                            <Text style={styles.votePrompt}>Helpful?</Text>
                            {(["like", "dislike"] as const).map((v) => {
                              const active = s.replyVote === v;
                              const isLike = v === "like";
                              return (
                                <TouchableOpacity
                                  key={v}
                                  onPress={() => void vote(s, v)}
                                  style={[
                                    styles.voteBtn,
                                    active && styles.voteBtnActive,
                                  ]}
                                  activeOpacity={0.75}
                                  hitSlop={{
                                    top: 6,
                                    bottom: 6,
                                    left: 4,
                                    right: 4,
                                  }}
                                  accessibilityLabel={
                                    isLike
                                      ? "Mark reply helpful"
                                      : "Mark reply not helpful"
                                  }
                                  accessibilityState={{ selected: active }}
                                >
                                  <Ionicons
                                    name={
                                      isLike
                                        ? active
                                          ? "thumbs-up"
                                          : "thumbs-up-outline"
                                        : active
                                          ? "thumbs-down"
                                          : "thumbs-down-outline"
                                    }
                                    size={14}
                                    color={
                                      active
                                        ? colors.textPrimary
                                        : colors.textTertiary
                                    }
                                  />
                                  <Text
                                    style={{
                                      marginLeft: 5,
                                      color: active
                                        ? colors.textPrimary
                                        : colors.textTertiary,
                                      fontSize: 11.5,
                                      fontFamily: active
                                        ? "Inter_600SemiBold"
                                        : "Inter_500Medium",
                                    }}
                                  >
                                    {isLike ? "Yes" : "No"}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.waitingRow}>
                        <View style={styles.waitingDot} />
                        <Text style={styles.waitingText}>Awaiting reply</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = {
  notice: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    padding: 12,
    marginBottom: 16,
    borderRadius: 12,
    backgroundColor: "rgba(212,162,55,0.07)",
    borderWidth: 1,
    borderColor: "rgba(212,162,55,0.22)",
  },
  noticeTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  noticeText: {
    marginTop: 2,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  noticeClose: {
    width: 28,
    height: 28,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  segmented: {
    flexDirection: "row" as const,
    padding: 4,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  segment: {
    flex: 1,
    height: 40,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderRadius: 9,
    marginRight: 4,
  },
  segmentActive: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  label: {
    marginTop: 24,
    marginBottom: 8,
    color: colors.textSecondary,
    fontSize: 12.5,
    fontFamily: "Inter_500Medium",
  },
  field: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  input: {
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 22,
    minHeight: 132,
    textAlignVertical: "top" as const,
    fontFamily: "Inter_400Regular",
    padding: 0,
  },
  metaRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginTop: 6,
  },
  metaHint: {
    flex: 1,
    marginRight: 12,
    color: colors.textTertiary,
    fontSize: 11.5,
  },
  metaCount: {
    color: colors.textTertiary,
    fontSize: 11.5,
  },
  primary: {
    marginTop: 20,
    height: 52,
    borderRadius: 12,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: colors.gold,
  },
  primaryDisabled: {
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  sectionRow: {
    flexDirection: "row" as const,
    alignItems: "baseline" as const,
    justifyContent: "space-between" as const,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 13.5,
    fontFamily: "Inter_600SemiBold",
  },
  sectionCount: {
    color: colors.textTertiary,
    fontSize: 12,
  },
  card: {
    marginTop: 12,
    borderRadius: 16,
    padding: 16,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  cardHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  },
  cardHeaderLeft: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
  },
  cardType: {
    marginLeft: 8,
    color: colors.textSecondary,
    fontSize: 12.5,
    fontFamily: "Inter_500Medium",
  },
  cardStars: {
    marginLeft: 8,
    color: colors.gold,
    fontSize: 12,
    letterSpacing: 1,
  },
  cardDate: {
    color: colors.textTertiary,
    fontSize: 11.5,
  },
  cardMessage: {
    marginTop: 10,
    color: colors.textPrimary,
    fontSize: 13.5,
    lineHeight: 20,
  },
  replyRow: {
    flexDirection: "row" as const,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  replyRule: {
    width: 2,
    borderRadius: 1,
    backgroundColor: colors.gold,
    opacity: 0.55,
    marginRight: 12,
  },
  replyAuthor: {
    color: colors.gold,
    fontSize: 11.5,
    fontFamily: "Inter_600SemiBold",
  },
  replyText: {
    marginTop: 4,
    color: colors.textSecondary,
    fontSize: 13.5,
    lineHeight: 20,
  },
  voteRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    marginTop: 12,
  },
  votePrompt: {
    marginRight: 10,
    color: colors.textTertiary,
    fontSize: 11.5,
  },
  voteBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    height: 32,
    paddingHorizontal: 10,
    marginRight: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  voteBtnActive: {
    borderColor: "rgba(212,162,55,0.45)",
    backgroundColor: "rgba(212,162,55,0.12)",
  },
  waitingRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    marginTop: 12,
  },
  waitingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  waitingText: {
    marginLeft: 8,
    color: colors.textTertiary,
    fontSize: 12,
  },
};
