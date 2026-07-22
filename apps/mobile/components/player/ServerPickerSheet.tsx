/**
 * ServerPicker — bottom sheet modal for selecting streaming providers on mobile.
 */

import React from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import type { ProviderDefinition } from '@filmsnaps/shared';

interface ServerPickerSheetProps {
  visible: boolean;
  providers: ProviderDefinition[];
  currentId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  getDisplayName: (p: ProviderDefinition) => string;
}

export function ServerPickerSheet({
  visible,
  providers,
  currentId,
  onSelect,
  onClose,
  getDisplayName,
}: ServerPickerSheetProps) {
  const insets = useSafeAreaInsets();
  const { height: SCREEN_HEIGHT } = Dimensions.get('window');

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View className="flex-1 justify-end bg-black/60">
        <TouchableOpacity className="flex-1" activeOpacity={1} onPress={onClose} />

        <View
          className="bg-zinc-900 rounded-t-3xl"
          style={{ maxHeight: SCREEN_HEIGHT * 0.6, paddingBottom: insets.bottom + 16 }}
        >
          {/* Handle */}
          <View className="items-center pt-3 pb-2">
            <View className="w-10 h-1 rounded-full bg-zinc-600" />
          </View>

          {/* Header */}
          <View className="flex-row items-center justify-between px-6 py-3 border-b border-zinc-800">
            <Text className="text-white text-lg font-bold">Select Server</Text>
            <TouchableOpacity onPress={onClose} activeOpacity={0.7} accessibilityLabel="Close server selection" accessibilityRole="button">
              <Ionicons name="close" size={22} color="#71717a" />
            </TouchableOpacity>
          </View>

          {/* Server list */}
          <ScrollView className="px-4 pt-2" showsVerticalScrollIndicator={false}>
            {providers.map((p) => {
              const isActive = p.id === currentId;
              return (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelect(p.id); }}
                  activeOpacity={0.7}
                  className={`flex-row items-center px-4 py-4 rounded-xl mb-1 ${
                    isActive ? 'bg-primary/10 border border-amber-500/20' : 'bg-zinc-800/40'
                  }`}
                >
                  <View
                    className={`w-10 h-10 rounded-full items-center justify-center mr-4 ${
                      isActive ? 'bg-primary' : 'bg-zinc-700'
                    }`}
                  >
                    {isActive ? (
                      <Ionicons name="checkmark" size={18} color="#000" />
                    ) : (
                      <Ionicons name="server-outline" size={16} color="#71717a" />
                    )}
                  </View>

                  <View className="flex-1">
                    <Text
                      className={`text-base font-semibold ${
                        isActive ? 'text-amber-400' : 'text-zinc-200'
                      }`}
                    >
                      {getDisplayName(p)}
                    </Text>
                    <Text className="text-zinc-600 text-xs mt-0.5">
                      {isActive ? 'Currently active' : 'Tap to switch'}
                    </Text>
                  </View>

                  {isActive && (
                    <View className="w-2 h-2 rounded-full bg-primary" />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
