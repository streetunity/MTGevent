import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { playerSummaries } from '../data/history';
import { useStore } from '../data/store';
import { Card, Muted, Segmented } from '../ui/components';
import { colors, space } from '../ui/theme';
import type { RootStack } from '../../App';

type Props = NativeStackScreenProps<RootStack, 'Leaderboard'>;
type Range = 'month' | 'year' | 'all';
type Sort = 'points' | 'wins' | 'events';

export default function LeaderboardScreen({ navigation }: Props) {
  const { events, nameOf, players } = useStore();
  const [range, setRange] = useState<Range>('year');
  const [sort, setSort] = useState<Sort>('points');

  const rows = useMemo(() => {
    const now = new Date();
    const filter = (e: { date: number }) => {
      const d = new Date(e.date);
      if (range === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      if (range === 'year') return d.getFullYear() === now.getFullYear();
      return true;
    };
    const sums = playerSummaries(events, filter);
    if (range === 'all') {
      // all-time totals include imported legacy points/events
      for (const p of players) {
        if (!p.legacy) continue;
        const s = sums.get(p.id) ?? { playerId: p.id, events: 0, matches: 0, wins: 0, losses: 0, draws: 0, gamesWon: 0, gamesLost: 0, points: 0, firsts: 0, prizeFinishes: 0 };
        sums.set(p.id, { ...s, points: s.points + p.legacy.points, events: s.events + p.legacy.events });
      }
    }
    return [...sums.values()]
      .filter((s) => s.events > 0)
      .sort((a, b) => (sort === 'points' ? b.points - a.points : sort === 'wins' ? b.wins - a.wins : b.events - a.events) || b.points - a.points);
  }, [events, players, range, sort]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: space(4), gap: space(2) }}>
        <Segmented options={[{ label: 'This month', value: 'month' }, { label: 'This year', value: 'year' }, { label: 'All time', value: 'all' }]} value={range} onChange={(v) => setRange(v as Range)} />
        <Segmented options={[{ label: 'Points', value: 'points' }, { label: 'Match wins', value: 'wins' }, { label: 'Attendance', value: 'events' }]} value={sort} onChange={(v) => setSort(v as Sort)} />
      </View>
      {range === 'all' && players.some((p) => p.legacy) && (
        <Muted style={{ paddingHorizontal: space(4), marginBottom: space(2), fontSize: 12 }}>All-time includes imported legacy points and events. Match wins only count events run in the app.</Muted>
      )}
      <FlatList
        contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(10), gap: space(2) }}
        data={rows}
        keyExtractor={(r) => r.playerId}
        ListEmptyComponent={<Muted style={{ textAlign: 'center', marginTop: space(6) }}>No events in this range.</Muted>}
        renderItem={({ item, index }) => (
          <Pressable onPress={() => navigation.navigate('Player', { playerId: item.playerId })}>
            <Card style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space(3) }}>
              <Text style={{ color: index < 4 ? colors.gold : colors.muted, width: 36, fontWeight: '800' }}>{index + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{nameOf(item.playerId)}</Text>
                <Muted style={{ fontSize: 12 }}>{item.events} events · {item.wins}-{item.losses} · {item.firsts}× 1st</Muted>
              </View>
              <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>
                {sort === 'points' ? item.points : sort === 'wins' ? item.wins : item.events}
              </Text>
            </Card>
          </Pressable>
        )}
      />
    </View>
  );
}
