import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { playerSummaries } from '../data/history';
import { useStore } from '../data/store';
import { Button, Card, Field, Muted } from '../ui/components';
import { colors, space } from '../ui/theme';
import type { RootStack } from '../../App';

type Props = NativeStackScreenProps<RootStack, 'Roster'>;

export default function RosterScreen({ navigation }: Props) {
  const { players, events } = useStore();
  const [q, setQ] = useState('');
  const sums = useMemo(() => playerSummaries(events), [events]);
  const list = players.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        contentContainerStyle={{ padding: space(4), gap: space(2) }}
        data={list}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={
          <View style={{ gap: space(2), marginBottom: space(2) }}>
            <Button title="Import legacy stats" kind="secondary" onPress={() => navigation.navigate('ImportLegacy')} />
            <Field value={q} onChangeText={setQ} placeholder={`Search ${players.length} players…`} />
          </View>
        }
        ListEmptyComponent={<Muted style={{ textAlign: 'center', marginTop: space(6) }}>Players are added to the roster when you add them to an event.</Muted>}
        renderItem={({ item }) => {
          const s = sums.get(item.id);
          return (
            <Pressable onPress={() => navigation.navigate('Player', { playerId: item.id })}>
              <Card style={{ paddingVertical: space(3) }}>
                <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{item.name}</Text>
                <Muted style={{ fontSize: 13 }}>
                  {s ? `${s.events} event${s.events === 1 ? '' : 's'} · ${s.wins}-${s.losses}${s.draws ? `-${s.draws}` : ''}${s.firsts ? ` · ${s.firsts}× 1st` : ''}` : 'No events in app yet'}
                  {item.legacy ? ` · legacy ${item.legacy.points} pts / ${item.legacy.events} ev` : ''}
                </Muted>
              </Card>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
