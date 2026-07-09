import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getImageUrl } from '@filmsnaps/shared';
import { ProgressiveImage } from '../../components/ProgressiveImage';
import { MediaCard } from '../../components/MediaCard';
import { usePersonDetails, usePersonCredits } from '../../hooks/useTMDB';

export default function PersonDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const personId = Number(id);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: person, isLoading: loadingPerson } = usePersonDetails(personId);
  const { data: creditsData, isLoading: loadingCredits } = usePersonCredits(personId);

  const credits = (creditsData as any)?.cast ?? [];

  const movieCredits = credits
    .filter((c: any) => c.media_type === 'movie')
    .sort((a: any, b: any) => ((b.release_date || '') > (a.release_date || '') ? 1 : -1));
  const tvCredits = credits
    .filter((c: any) => c.media_type === 'tv')
    .sort((a: any, b: any) => ((b.first_air_date || '') > (a.first_air_date || '') ? 1 : -1));

  if (loadingPerson) {
    return (
      <View className="flex-1 items-center justify-center bg-void" style={{ backgroundColor: '#080808', paddingTop: insets.top }}>
        <ActivityIndicator size="large" color="#e8a020" />
      </View>
    );
  }

  if (!person) {
    return (
      <View className="flex-1 items-center justify-center bg-void px-6" style={{ backgroundColor: '#080808', paddingTop: insets.top }}>
        <View className="w-16 h-16 rounded-full bg-elevated items-center justify-center mb-5">
          <Ionicons name="person-outline" size={32} color="#534f4c" />
        </View>
        <Text className="text-t1 text-lg font-semibold mb-2">Person not found</Text>
        <TouchableOpacity onPress={() => router.back()} className="bg-gold rounded-xl py-3 px-8 mt-4" activeOpacity={0.8}>
          <Text className="text-void font-bold text-base">Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-void" style={{ backgroundColor: '#080808', paddingTop: insets.top }}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Back button */}
        <View className="px-4 pt-2 pb-3">
          <TouchableOpacity onPress={() => router.back()} className="w-9 h-9 rounded-full bg-black/40 items-center justify-center" activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={22} color="#f2ede6" />
          </TouchableOpacity>
        </View>

        {/* Profile header */}
        <View className="items-center px-6 pb-6">
          {person.profile_path ? (
            <ProgressiveImage
              uri={getImageUrl(person.profile_path, 'w185')}
              style={{
                width: 120,
                height: 120,
                borderRadius: 60,
                marginBottom: 16,
                ...Platform.select({
                  ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8 },
                  android: { elevation: 8 },
                }),
              }}
              resizeMode="cover"
            />
          ) : (
            <View style={{ width: 120, height: 120, borderRadius: 60, backgroundColor: '#191919', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <Ionicons name="person-outline" size={48} color="#534f4c" />
            </View>
          )}
          <Text style={{ fontFamily: 'PlayfairDisplay_700Bold', fontSize: 24, color: '#f2ede6', textAlign: 'center' }}>
            {person.name}
          </Text>
          {person.known_for_department && (
            <Text className="text-t3 text-sm mt-1">{person.known_for_department}</Text>
          )}
          {person.birthday && (
            <View className="flex-row items-center mt-2">
              <Ionicons name="calendar-outline" size={13} color="#9b9590" />
              <Text className="text-t3 text-xs ml-1.5">
                {person.birthday}
                {person.deathday ? ` — ${person.deathday}` : ''}
              </Text>
            </View>
          )}
          {person.place_of_birth && (
            <View className="flex-row items-center mt-1">
              <Ionicons name="location-outline" size={13} color="#9b9590" />
              <Text className="text-t3 text-xs ml-1.5">{person.place_of_birth}</Text>
            </View>
          )}
        </View>

        {/* Biography */}
        {person.biography ? (
          <View className="px-6 mb-8">
            <Text style={{ fontFamily: 'PlayfairDisplay_700Bold', fontSize: 18, color: '#f2ede6', marginBottom: 10 }}>
              Biography
            </Text>
            <Text className="text-t2 text-sm leading-5" style={{ lineHeight: 20 }}>
              {person.biography}
            </Text>
          </View>
        ) : null}

        {/* Filmography — Movies */}
        {movieCredits.length > 0 && (
          <View className="mb-8">
            <Text style={{ fontFamily: 'PlayfairDisplay_700Bold', fontSize: 18, color: '#f2ede6', paddingHorizontal: 24, marginBottom: 12 }}>
              Movies
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
              {movieCredits.slice(0, 20).map((credit: any) => (
                <MediaCard
                  key={`m-${credit.id}`}
                  item={{
                    id: credit.id,
                    title: credit.title || credit.name,
                    poster_path: credit.poster_path,
                    vote_average: credit.vote_average,
                    media_type: 'movie',
                  } as any}
                  onPress={(item: any) => router.push(`/movie/${item.id}`)}
                  variant="default"
                />
              ))}
            </ScrollView>
          </View>
        )}

        {/* Filmography — TV */}
        {tvCredits.length > 0 && (
          <View className="mb-8">
            <Text style={{ fontFamily: 'PlayfairDisplay_700Bold', fontSize: 18, color: '#f2ede6', paddingHorizontal: 24, marginBottom: 12 }}>
              TV Shows
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
              {tvCredits.slice(0, 20).map((credit: any) => (
                <MediaCard
                  key={`t-${credit.id}`}
                  item={{
                    id: credit.id,
                    name: credit.name || credit.title,
                    poster_path: credit.poster_path,
                    vote_average: credit.vote_average,
                    media_type: 'tv',
                  } as any}
                  onPress={(item: any) => router.push(`/tv/${item.id}`)}
                  variant="default"
                />
              ))}
            </ScrollView>
          </View>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>
    </View>
  );
}
