import React, { useLayoutEffect } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { createEvent, defaultTitle } from '../core/eventOps';
import { TournamentEvent } from '../core/types';
import { computeStandings } from '../core/standings';
import { currentSeason, daysLeft, seasonLabel, seasonRange } from '../core/seasons';
import { useStore } from '../data/store';
import { cancelRoundAlerts } from '../timer/alerts';
import { Button, Card, Muted } from '../ui/components';
import { colors, space } from '../ui/theme';
import type { RootStack } from '../../App';

type Props = NativeStackScreenProps<RootStack, 'Home'>;

export default function HomeScreen({ navigation }: Props) {
  const store = useStore();
  const { events } = store;

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={() => navigation.navigate('Settings')} hitSlop={12} style={{ paddingHorizontal: space(1) }}>
          <Text style={{ color: colors.text, fontSize: 22 }}>⚙</Text>
        </Pressable>
      ),
    });
  }, [navigation]);

  const newEvent = () => {
    const ev = createEvent(defaultTitle(), store.lastSettings() ?? {});
    store.saveEvent(ev);
    navigation.navigate('Setup', { eventId: ev.id });
  };

  const open = (ev: TournamentEvent) =>
    navigation.navigate(ev.status === 'setup' ? 'Setup' : 'Event', { eventId: ev.id });

  const askDelete = (ev: TournamentEvent) =>
    Alert.alert(`Delete “${ev.title}”?`, ev.status === 'setup'
      ? 'This event hasn’t started. Its player list is removed; players stay in your roster.'
      : 'All rounds and results in this event are permanently removed, and players’ stats from it disappear. Players stay in your roster.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { if (ev.status === 'running') cancelRoundAlerts(); store.deleteEvent(ev.id); } },
    ]);

  const live = events.filter((e) => e.status !== 'complete');
  const past = events.filter((e) => e.status === 'complete');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        contentContainerStyle={{ padding: space(4), gap: space(3) }}
        data={[...live, ...past]}
        keyExtractor={(e) => e.id}
        ListHeaderComponent={
          <View style={{ gap: space(3), marginBottom: space(2) }}>
            {(() => {
              const cur = currentSeason(store.seasons);
              if (!cur) return null;
              const left = daysLeft(cur);
              return (
                <Pressable onPress={() => navigation.navigate('Leaderboard')}>
                  <Card style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space(3), borderColor: colors.accent }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>{seasonLabel(cur)}</Text>
                      <Muted style={{ fontSize: 12 }}>{seasonRange(cur)} · {left} day{left === 1 ? '' : 's'} left</Muted>
                    </View>
                    <Text style={{ color: colors.accent, fontWeight: '700' }}>Standings ›</Text>
                  </Card>
                </Pressable>
              );
            })()}
            <Button title="+ New event" onPress={newEvent} />
            <View style={{ flexDirection: 'row', gap: space(3) }}>
              <Button title="Players" kind="secondary" onPress={() => navigation.navigate('Roster')} style={{ flex: 1 }} />
              <Button title="Leaderboard" kind="secondary" onPress={() => navigation.navigate('Leaderboard')} style={{ flex: 1 }} />
            </View>
            {events.length === 0 && <Muted style={{ textAlign: 'center', marginTop: space(8) }}>No events yet. Tap “New event” to get started.</Muted>}
            {events.length > 0 && <Muted style={{ textAlign: 'center', fontSize: 12 }}>Press and hold an event to delete it.</Muted>}
          </View>
        }
        renderItem={({ item, index }) => (
          <>
            {index === live.length && past.length > 0 && <Text style={{ color: colors.muted, fontWeight: '700', marginTop: space(3) }}>PAST EVENTS</Text>}
            <EventRow ev={item} onPress={() => open(item)} onLongPress={() => askDelete(item)} />
          </>
        )}
      />
    </View>
  );
}

function EventRow({ ev, onPress, onLongPress }: { ev: TournamentEvent; onPress: () => void; onLongPress: () => void }) {
  const { nameOf } = useStore();
  const date = new Date(ev.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  let status = '';
  if (ev.status === 'setup') status = 'Setting up';
  else if (ev.status === 'running') {
    const r = ev.rounds[ev.rounds.length - 1];
    status = `Round ${r?.number ?? 1} of ${ev.settings.rounds}${r?.status === 'pairing' ? ' · pairing' : ''}`;
  } else {
    const top = computeStandings(ev, nameOf).rows.filter((r) => r.place === 1).map((r) => nameOf(r.playerId));
    status = top.length ? `Winner: ${top.join(', ')}` : 'Complete';
  }
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={400}>
      <Card style={ev.status === 'running' ? { borderColor: colors.accent } : undefined}>
        <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>{ev.title}</Text>
        <Muted style={{ marginTop: 2 }}>{date} · {ev.players.length} players</Muted>
        <Text style={{ color: ev.status === 'running' ? colors.accent : colors.muted, marginTop: space(1.5), fontWeight: '600' }}>{status}</Text>
      </Card>
    </Pressable>
  );
}
