import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { currentSeason, daysLeft, Season, seasonLabel, seasonRange } from '../core/seasons';
import { legacyInRange, playerSummaries, withLegacy } from '../data/history';
import { useStore } from '../data/store';
import { Card, Muted, Segmented, styles as ui } from '../ui/components';
import { colors, space } from '../ui/theme';
import type { RootStack } from '../../App';

type Props = NativeStackScreenProps<RootStack, 'Leaderboard'>;
type Range = 'season' | 'month' | 'year' | 'all';
type Sort = 'points' | 'wins' | 'events';

export default function LeaderboardScreen({ navigation }: Props) {
  const { events, nameOf, players, seasons } = useStore();
  const cur = currentSeason(seasons);
  const [range, setRange] = useState<Range>(cur ? 'season' : 'year');
  const [sort, setSort] = useState<Sort>('points');
  const [picked, setPicked] = useState<number | null>(null); // season number; null = current
  const season: Season | undefined = range === 'season'
    ? (picked ? seasons.seasons.find((s) => s.number === picked) : cur)
    : undefined;
  const effRange: Range = range === 'season' && !season ? 'year' : range;

  const rows = useMemo(() => {
    const now = new Date();
    const filter = (e: { date: number }) => {
      const d = new Date(e.date);
      if (effRange === 'season') return !!season && e.date >= season.start && e.date < season.end;
      if (effRange === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      if (effRange === 'year') return d.getFullYear() === now.getFullYear();
      return true;
    };
    const sums = playerSummaries(events, filter);
    // imported legacy stats count in all-time, and in "this year" when tagged with this year
    for (const p of players) {
      if (!p.legacy || !legacyInRange(p.legacy, effRange, now)) continue;
      sums.set(p.id, withLegacy(sums.get(p.id), p.id, p.legacy));
    }
    return [...sums.values()]
      .filter((s) => s.events > 0)
      .sort((a, b) => (sort === 'points' ? b.points - a.points : sort === 'wins' ? b.wins - a.wins : b.events - a.events) || b.points - a.points);
  }, [events, players, effRange, season, sort]);

  const seasonsNewestFirst = [...seasons.seasons].reverse();
  const isPast = !!season && season.end <= Date.now();
  const champs = isPast && rows.length ? rows.filter((r) => r.points === rows[0].points).map((r) => nameOf(r.playerId)) : [];

  const rangeOptions = seasons.enabled && seasons.seasons.length
    ? [{ label: 'Season', value: 'season' }, { label: 'This year', value: 'year' }, { label: 'All time', value: 'all' }]
    : [{ label: 'This month', value: 'month' }, { label: 'This year', value: 'year' }, { label: 'All time', value: 'all' }];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: space(4), gap: space(2) }}>
        <Segmented options={rangeOptions} value={range} onChange={(v) => { setRange(v as Range); setPicked(null); }} />
        <Segmented options={[{ label: 'Points', value: 'points' }, { label: 'Match wins', value: 'wins' }, { label: 'Attendance', value: 'events' }]} value={sort} onChange={(v) => setSort(v as Sort)} />
        {range === 'season' && seasons.seasons.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(2) }}>
            {seasonsNewestFirst.map((s) => {
              const on = s.number === (season?.number ?? -1);
              return (
                <Pressable key={s.number} onPress={() => setPicked(s === cur ? null : s.number)} style={[ui.chip, on && ui.chipOn]}>
                  <Text style={[ui.chipText, on && { color: colors.text }]}>{seasonLabel(s)}{s === cur ? ' · now' : ''}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        {season && (
          <Card style={{ paddingVertical: space(3), borderColor: isPast ? colors.gold : colors.accent }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>{seasonLabel(season)}</Text>
            <Muted style={{ fontSize: 12 }}>
              {seasonRange(season)} · {isPast ? 'finished' : `${daysLeft(season)} day${daysLeft(season) === 1 ? '' : 's'} left`}
            </Muted>
            {isPast && champs.length > 0 && <Text style={{ color: colors.gold, fontWeight: '800', marginTop: space(1) }}>🏆 Champion{champs.length > 1 ? 's' : ''}: {champs.join(', ')}</Text>}
          </Card>
        )}
      </View>
      {effRange !== 'month' && effRange !== 'season' && players.some((p) => p.legacy && legacyInRange(p.legacy, effRange)) && (
        <Muted style={{ paddingHorizontal: space(4), marginBottom: space(2), fontSize: 12 }}>Includes imported legacy stats{effRange === 'year' ? ` from ${new Date().getFullYear()}` : ''}.</Muted>
      )}
      {effRange === 'month' && players.some((p) => p.legacy) && (
        <Muted style={{ paddingHorizontal: space(4), marginBottom: space(2), fontSize: 12 }}>Legacy stats aren’t dated by month, so this view only counts events run in the app.</Muted>
      )}
      <FlatList
        contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(10), gap: space(2) }}
        data={rows}
        keyExtractor={(r) => r.playerId}
        ListEmptyComponent={<Muted style={{ textAlign: 'center', marginTop: space(6) }}>{effRange === 'season' ? 'No events yet this season.' : 'No events in this range.'}</Muted>}
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
