import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { eventResultsFor, headToHead, playerSummaries } from '../data/history';
import { useStore } from '../data/store';
import { Button, Card, Label, Muted, PromptModal } from '../ui/components';
import { colors, space } from '../ui/theme';
import type { RootStack } from '../../App';

type Props = NativeStackScreenProps<RootStack, 'Player'>;

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;

export default function PlayerScreen({ route, navigation }: Props) {
  const store = useStore();
  const id = route.params.playerId;
  const player = store.playersById.get(id);
  const [renaming, setRenaming] = useState(false);
  const [merging, setMerging] = useState(false);
  const s = useMemo(() => playerSummaries(store.events).get(id), [store.events, id]);
  const h2h = useMemo(() => headToHead(store.events, id), [store.events, id]);
  const results = useMemo(() => eventResultsFor(store.events, id), [store.events, id]);

  if (!player) return null;
  const winPct = s && s.matches ? Math.round((s.wins / s.matches) * 100) : 0;
  const gamePct = s && s.gamesWon + s.gamesLost ? Math.round((s.gamesWon / (s.gamesWon + s.gamesLost)) * 100) : 0;

  const Stat = ({ label, value }: { label: string; value: string | number }) => (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800' }}>{value}</Text>
      <Muted style={{ fontSize: 12 }}>{label}</Muted>
    </View>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: space(4), paddingBottom: space(16) }}>
      <Pressable onPress={() => setRenaming(true)}>
        <Text style={{ color: colors.text, fontSize: 26, fontWeight: '800' }}>{player.name} <Text style={{ fontSize: 16, color: colors.muted }}>✎</Text></Text>
      </Pressable>

      <Card style={{ marginTop: space(3), flexDirection: 'row' }}>
        <Stat label="events" value={s?.events ?? 0} />
        <Stat label="record" value={s ? `${s.wins}-${s.losses}` : '0-0'} />
        <Stat label="match win" value={`${winPct}%`} />
        <Stat label="game win" value={`${gamePct}%`} />
      </Card>
      <Card style={{ marginTop: space(2), flexDirection: 'row' }}>
        <Stat label="1st places" value={s?.firsts ?? 0} />
        <Stat label="prize finishes" value={s?.prizeFinishes ?? 0} />
        <Stat label="total points" value={s?.points ?? 0} />
      </Card>

      <Label>Head to head</Label>
      {h2h.length === 0 && <Muted>No matches yet.</Muted>}
      {h2h.map((h) => (
        <Pressable key={h.opponentId} onPress={() => navigation.push('Player', { playerId: h.opponentId })}>
          <Card style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space(2.5), marginBottom: space(1.5) }}>
            <Text style={{ color: colors.text, flex: 1, fontSize: 15 }}>vs {store.nameOf(h.opponentId)}</Text>
            <Text style={{ color: h.wins > h.losses ? colors.win : h.losses > h.wins ? colors.danger : colors.muted, fontWeight: '800' }}>
              {h.wins}-{h.losses}{h.draws ? `-${h.draws}` : ''}
            </Text>
          </Card>
        </Pressable>
      ))}

      <Label>Events</Label>
      {results.map((r) => (
        <Pressable key={r.eventId} onPress={() => navigation.navigate('Event', { eventId: r.eventId })}>
          <Card style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space(2.5), marginBottom: space(1.5) }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 15 }}>{r.title}</Text>
              <Muted style={{ fontSize: 12 }}>{new Date(r.date).toLocaleDateString()} · {r.record} · {r.points} pts</Muted>
            </View>
            <Text style={{ color: r.place <= 4 ? colors.gold : colors.muted, fontWeight: '800' }}>{r.tied ? 'T-' : ''}{ordinal(r.place)} / {r.players}</Text>
          </Card>
        </Pressable>
      ))}

      <Button title="Merge into another player…" kind="ghost" style={{ marginTop: space(6) }} onPress={() => setMerging(true)} />

      <PromptModal visible={renaming} title="Rename player" initial={player.name}
        onCancel={() => setRenaming(false)}
        onSubmit={(t) => {
          const clash = store.players.find((p) => p.id !== id && p.name.toLowerCase() === t.trim().toLowerCase());
          setRenaming(false);
          if (clash) {
            Alert.alert('Name already used', `Merge ${player.name} into ${clash.name}? Their history will be combined.`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Merge', onPress: () => { store.mergePlayers(id, clash.id); navigation.replace('Player', { playerId: clash.id }); } },
            ]);
          } else store.renamePlayer(id, t);
        }} />
      <PromptModal visible={merging} title={`Merge ${player.name} into…`} confirmLabel="Merge"
        extra={<Muted style={{ marginTop: space(2) }}>Type the exact name of the player to keep. All of {player.name}’s results move to them.</Muted>}
        onCancel={() => setMerging(false)}
        onSubmit={(t) => {
          const target = store.players.find((p) => p.id !== id && p.name.toLowerCase() === t.trim().toLowerCase());
          setMerging(false);
          if (!target) { Alert.alert('Not found', `No player named "${t.trim()}".`); return; }
          store.mergePlayers(id, target.id);
          navigation.replace('Player', { playerId: target.id });
        }} />
    </ScrollView>
  );
}
