// Paste in totals from before the app (e.g. MTGevent.com): name, points, events.
import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LegacyOrder, parseLegacy } from '../core/legacy';
import { useStore } from '../data/store';
import { Button, Card, Field, Label, Muted, Segmented } from '../ui/components';
import { colors, space } from '../ui/theme';
import { legacySummary } from '../data/history';
import type { RootStack } from '../../App';

type Props = NativeStackScreenProps<RootStack, 'ImportLegacy'>;

export default function ImportLegacyScreen({ navigation }: Props) {
  const store = useStore();
  const [text, setText] = useState('');
  const [order, setOrder] = useState<LegacyOrder>('points-events');
  const parsed = useMemo(() => parseLegacy(text, order), [text, order]);
  const byName = useMemo(() => new Map(store.players.map((p) => [p.name.toLowerCase(), p])), [store.players]);

  const doImport = () => {
    const willOverwrite = parsed.rows.filter((r) => byName.get(r.name.toLowerCase())?.legacy).length;
    const go = () => {
      const { updated, created } = store.importLegacy(parsed.rows);
      Alert.alert('Imported', `${updated} existing player${updated === 1 ? '' : 's'} updated, ${created} new player${created === 1 ? '' : 's'} added.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]);
    };
    if (willOverwrite > 0) {
      Alert.alert('Replace legacy totals?', `${willOverwrite} player${willOverwrite === 1 ? ' already has' : 's already have'} legacy totals. Importing will replace them (not add to them).`, [
        { text: 'Cancel', style: 'cancel' }, { text: 'Replace', onPress: go },
      ]);
    } else go();
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: space(4), paddingBottom: space(16) }} keyboardShouldPersistTaps="handled">
      <Muted>
        Paste your standings table including the header row (e.g. Rank · Player · Events · W–L · Points · 1st Places). Columns are matched by name. Without a header, use one line per player like{' '}
        <Text style={{ color: colors.text }}>Mike S, 142, 18</Text> (name, points, events).
      </Muted>

      {text.trim() !== '' && parsed.columns.length === 0 && (
        <>
          <Label>Column order (no header found)</Label>
          <Segmented
            options={[{ label: 'Name · Points · Events', value: 'points-events' }, { label: 'Name · Events · Points', value: 'events-points' }]}
            value={order} onChange={(v) => setOrder(v as LegacyOrder)}
          />
        </>
      )}
      {parsed.columns.length > 0 && (
        <Muted style={{ marginTop: space(3), color: colors.accent }}>
          Header found · reading {parsed.columns.map((c) => ({ name: 'Player', points: 'Points', events: 'Events', record: 'W–L', wins: 'Wins', losses: 'Losses', firsts: '1st Places' } as Record<string, string>)[c]).join(', ')}
        </Muted>
      )}

      <Label>Data</Label>
      <Field
        value={text}
        onChangeText={setText}
        multiline
        placeholder={'Mike S, 142, 18\nJo Ann, 97, 12\nDave, 30, 4'}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ minHeight: 160, textAlignVertical: 'top', fontFamily: 'monospace', fontSize: 14 }}
      />

      {parsed.errors.length > 0 && (
        <Card style={{ marginTop: space(3), borderColor: colors.warn }}>
          <Text style={{ color: colors.warn, fontWeight: '700' }}>Couldn’t read {parsed.errors.length} line{parsed.errors.length === 1 ? '' : 's'}</Text>
          {parsed.errors.slice(0, 5).map((e) => <Muted key={e.line} style={{ fontSize: 12 }}>Line {e.line}: {e.text}</Muted>)}
          <Muted style={{ fontSize: 12, marginTop: space(1) }}>Each line needs a name followed by two numbers.</Muted>
        </Card>
      )}

      {parsed.rows.length > 0 && (
        <>
          <Label>Preview ({parsed.rows.length})</Label>
          <View style={{ gap: space(1.5) }}>
            {parsed.rows.map((r) => {
              const existing = byName.get(r.name.toLowerCase());
              return (
                <Card key={r.name.toLowerCase()} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space(2.5) }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>{r.name}</Text>
                    <Muted style={{ fontSize: 12, color: existing ? colors.accent : colors.muted }}>
                      {existing ? (existing.legacy ? 'matches roster · replaces old legacy totals' : 'matches roster') : 'new player'}
                    </Muted>
                  </View>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, maxWidth: '55%', textAlign: 'right' }}>{legacySummary(r)}</Text>
                </Card>
              );
            })}
          </View>
          <Button title={`Import ${parsed.rows.length} player${parsed.rows.length === 1 ? '' : 's'}`} onPress={doImport} style={{ marginTop: space(4) }} />
        </>
      )}
    </ScrollView>
  );
}
