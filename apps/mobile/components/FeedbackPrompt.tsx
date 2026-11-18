/**
 * In-app rating prompt — the "sometimes when you open the app" modal.
 *
 * No store, no redirect: the stars and the optional note are submitted straight
 * to /api/feedback as a 'rating' row, and the team's answer comes back through
 * the Feedback screen. Shown only when lib/feedbackPrompt.ts says it is due.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import {
  FEEDBACK_MESSAGE_MAX,
  reportPromptOutcome,
  validateFeedback,
} from "../lib/feedback";
import { markPromptRated, markPromptRefused } from "../lib/feedbackPrompt";
import { sendFeedbackDraft } from "../lib/feedbackOutbox";
import { trackFeatureUsed } from "../lib/telemetry/track";

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function FeedbackPrompt({ visible, onClose }: Props) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setRating(0);
    setComment("");
    setSending(false);
    setError(null);
    setSent(false);
  }, [visible]);

  const send = useCallback(async () => {
    if (sending) return;
    const invalid = validateFeedback({
      type: "rating",
      message: comment,
      rating,
    });
    if (invalid) {
      setError(invalid);
      return;
    }
    setSending(true);
    setError(null);
    // Write-ahead outbox: the rating is stored on the device first and only
    // removed once the server accepts it, so closing the app or losing the
    // connection cannot lose the rating.
    const res = await sendFeedbackDraft({
      type: "rating",
      message: comment,
      rating,
    });
    setSending(false);
    if (res.ok || res.queued) {
      trackFeatureUsed("feedback_rate");
      void markPromptRated();
      void reportPromptOutcome("rated");
      setSent(true);
    } else {
      setError(res.error ?? "Something went wrong. Please try again.");
    }
  }, [comment, rating, sending]);

  const dismiss = useCallback(() => {
    void markPromptRefused();
    void reportPromptOutcome("declined");
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={dismiss}
    >
      <KeyboardAvoidingView
        className="flex-1 items-center justify-center px-6"
        style={{ backgroundColor: "rgba(0,0,0,0.78)" }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View
          className="w-full rounded-2xl px-6 py-7"
          style={{
            maxWidth: 360,
            backgroundColor: colors.zincBgFull,
            borderWidth: 1,
            borderColor: colors.zinc800,
          }}
        >
          {sent ? (
            <View className="items-center">
              <Ionicons name="checkmark-circle" size={44} color={colors.gold} />
              <Text
                className="text-center mt-4"
                style={{
                  fontFamily: "PlayfairDisplay_700Bold",
                  fontSize: 22,
                  color: colors.textPrimary,
                }}
              >
                Thank you
              </Text>
              <Text
                className="text-center mt-2 leading-5"
                style={{ color: colors.textSecondary, fontSize: 13.5 }}
              >
                Your rating is saved. If we reply, you'll find it under Settings
                → Feedback.
              </Text>
              <TouchableOpacity
                onPress={onClose}
                className="mt-6 w-full py-3.5 rounded-xl items-center"
                style={{ backgroundColor: colors.gold }}
                activeOpacity={0.7}
              >
                <Text
                  style={{
                    color: colors.bg,
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 15,
                  }}
                >
                  Done
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text
                className="text-center"
                style={{
                  fontFamily: "PlayfairDisplay_700Bold",
                  fontSize: 23,
                  color: colors.textPrimary,
                }}
              >
                How's Filmsnaps?
              </Text>
              <View
                className="flex-row justify-center mt-6"
                accessibilityLabel="Rate the app"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <TouchableOpacity
                    key={n}
                    onPress={() => {
                      setRating(n);
                      if (error) setError(null);
                    }}
                    activeOpacity={0.6}
                    className="px-2 py-1"
                    accessibilityLabel={`${n} star${n > 1 ? "s" : ""}`}
                    accessibilityState={{ selected: rating === n }}
                  >
                    <Ionicons
                      name={n <= rating ? "star" : "star-outline"}
                      size={36}
                      color={n <= rating ? colors.gold : colors.textTertiary}
                    />
                  </TouchableOpacity>
                ))}
              </View>

              {rating > 0 && (
                <>
                  <View
                    className="mt-4 rounded-xl px-4 py-2"
                    style={{
                      backgroundColor: "rgba(255,255,255,0.06)",
                      borderWidth: 1,
                      borderColor: "rgba(255,255,255,0.1)",
                    }}
                  >
                    <TextInput
                      multiline
                      value={comment}
                      onChangeText={(t) => {
                        setComment(t);
                        if (error) setError(null);
                      }}
                      placeholder="Anything you'd like to add? (optional)"
                      placeholderTextColor={colors.textTertiary}
                      maxLength={FEEDBACK_MESSAGE_MAX}
                      style={{
                        color: colors.textPrimary,
                        fontSize: 14,
                        minHeight: 64,
                        textAlignVertical: "top",
                        fontFamily: "Inter_400Regular",
                      }}
                    />
                  </View>

                  {error ? (
                    <Text
                      className="mt-2 text-center"
                      style={{ color: colors.red400, fontSize: 12.5 }}
                    >
                      {error}
                    </Text>
                  ) : null}

                  <TouchableOpacity
                    onPress={send}
                    disabled={sending}
                    className="mt-4 w-full py-3.5 rounded-xl items-center"
                    style={{ backgroundColor: colors.gold }}
                    activeOpacity={0.7}
                    accessibilityLabel="Send rating"
                  >
                    {sending ? (
                      <ActivityIndicator color={colors.bg} size="small" />
                    ) : (
                      <Text
                        style={{
                          color: colors.bg,
                          fontFamily: "Inter_600SemiBold",
                          fontSize: 15,
                        }}
                      >
                        Send
                      </Text>
                    )}
                  </TouchableOpacity>
                </>
              )}

              <TouchableOpacity
                onPress={dismiss}
                className="mt-4 self-center px-4 py-2"
                activeOpacity={0.7}
              >
                <Text style={{ color: colors.textSecondary, fontSize: 13.5 }}>
                  Not now
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
