// App settings and data management (clear / delete / reset).
import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useStore } from '../data/store';
import { cancelRoundAlerts } from '../timer/alerts';
import { Button, Card, Field, Label, Muted, Sheet, styles as ui } from '../ui/components';
import { colors, space } from '../ui/theme';
import type { RootStack } from '../../App';

type Props = NativeStackScreenProps<RootStack, 'Settings'>;

export default function SettingsScreen({ navigation }: Props) {
  const store = useStore();
  const [resetOpen, setResetOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const legacyCount = store.players.filter((p) => p.legacy).length;
  const running = store.events.filter((e) => e.status === 'running').length;

  const clearLegacy = () =>
    Alert.alert('Clear legacy stats?', `Removes imported stats from ${legacyCount} player${legacyCount === 1 ? '' : 's'}. Events and players are kept. This can’t be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => store.clearAllLegacy() },
    ]);

  const deleteEvents = () =>
    Alert.alert('Delete all events?', `Deletes ${store.events.length} event${store.events.length === 1 ? '' : 's'}${running ? ` (including ${running} in progress)` : ''} and all their results. Players and legacy stats are kept. This can’t be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { cancelRoundAlerts(); store.deleteAllEvents(); } },
    ]);

  const doReset = () => {
    cancelRoundAlerts();
    store.resetAll();
    setResetOpen(false);
    setTyped('');
    navigation.popToTop();
  };

  const Row = ({ title, desc, button, onPress, disabled }: { title: string; desc: string; button: string; onPress: () => void; disabled?: boolean }) => (
    <Card style={{ marginBottom: space(2) }}>
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>{title}</Text>
      <Muted style={{ marginTop: space(1), marginBottom: space(3) }}>{desc}</Muted>
      <Button title={button} kind="danger" onPress={onPress} disabled={disabled} />
    </Card>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: space(4), paddingBottom: space(16) }}>
      <Label>Your data</Label>
      <Card style={{ marginBottom: space(4), flexDirection: 'row' }}>
        {[[store.players.length, 'players'], [store.events.length, 'events'], [legacyCount, 'with legacy']].map(([n, l]) => (
          <View key={l as string} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800' }}>{n}</Text>
            <Muted style={{ fontSize: 12 }}>{l}</Muted>
          </View>
        ))}
      </Card>

      <Label>Clear data</Label>
      <Row
        title="Clear legacy stats"
        desc="Removes imported stats (points, events, W–L, 1st places) from every player. Events run in the app and the roster stay. Use this before re-importing a corrected table."
        button={legacyCount ? `Clear legacy stats (${legacyCount})` : 'No legacy stats'}
        onPress={clearLegacy}
        disabled={!legacyCount}
      />
      <Row
        title="Delete all events"
        desc="Deletes every event and its results. The player roster and legacy stats stay."
        button={store.events.length ? `Delete all events (${store.events.length})` : 'No events'}
        onPress={deleteEvents}
        disabled={!store.events.length}
      />
      <Row
        title="Reset everything"
        desc="Wipes all players, events, legacy stats and saved settings — the app goes back to brand new."
        button="Reset everything…"
        onPress={() => setResetOpen(true)}
      />

      <Sheet visible={resetOpen} onClose={() => { setResetOpen(false); setTyped(''); }}>
        <Text style={ui.sheetTitle}>Reset everything?</Text>
        <Muted style={{ marginBottom: space(3) }}>
          This permanently deletes {store.players.length} players and {store.events.length} events. Type RESET to confirm.
        </Muted>
        <Field value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} placeholder="RESET" />
        <View style={{ flexDirection: 'row', gap: space(2), marginTop: space(4) }}>
          <Button title="Cancel" kind="secondary" onPress={() => { setResetOpen(false); setTyped(''); }} style={{ flex: 1 }} />
          <Button title="Reset" kind="danger" onPress={doReset} disabled={typed.trim() !== 'RESET'} style={{ flex: 1 }} />
        </View>
      </Sheet>
    </ScrollView>
  );
}
