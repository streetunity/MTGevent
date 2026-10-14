// App settings and data management (clear / delete / reset).
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  addDays, currentSeason, daysLeft, endCurrentSeasonNow, extendSeasons, renameSeason, seasonLabel, seasonRange,
  setSeasonLength, startOfDay, startSeasons,
} from '../core/seasons';
import { useStore } from '../data/store';
import { ago, useSync } from '../sync/SyncContext';
import { cancelRoundAlerts } from '../timer/alerts';
import { Button, Card, Chip, Field, Label, Muted, PromptModal, Sheet, Stepper, styles as ui } from '../ui/components';
import { colors, space } from '../ui/theme';
import type { RootStack } from '../../App';

type Props = NativeStackScreenProps<RootStack, 'Settings'>;

export default function SettingsScreen({ navigation }: Props) {
  const store = useStore();
  const sync = useSync();
  const shared = !!sync.session?.league;
  const everyone = shared ? ' This also removes them from the shared league for everyone.' : '';
  const [resetOpen, setResetOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const legacyCount = store.players.filter((p) => p.legacy).length;
  const running = store.events.filter((e) => e.status === 'running').length;

  const clearLegacy = () =>
    Alert.alert('Clear legacy stats?', `Removes imported stats from ${legacyCount} player${legacyCount === 1 ? '' : 's'}. Events and players are kept.${everyone} This can’t be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => store.clearAllLegacy() },
    ]);

  const deleteEvents = () =>
    Alert.alert('Delete all events?', `Deletes ${store.events.length} event${store.events.length === 1 ? '' : 's'}${running ? ` (including ${running} in progress)` : ''} and all their results. Players and legacy stats are kept.${everyone} This can’t be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { cancelRoundAlerts(); store.deleteAllEvents(); } },
    ]);

  const doReset = () => {
    cancelRoundAlerts();
    const wasSignedIn = !!sync.session;
    sync.disconnect();
    store.resetAll();
    if (wasSignedIn) sync.signOut();
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

      <Label>Shared league</Label>
      <Card style={{ marginBottom: space(4), ...(shared ? { borderColor: colors.accent } : {}) }}>
        {shared ? (
          <>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>{sync.session!.league!.name}</Text>
            <Muted style={{ marginTop: space(1), marginBottom: space(3) }}>
              {sync.status === 'syncing' ? 'Syncing…' : sync.status === 'idle' ? `Synced ${ago(sync.session!.lastSyncAt)}` : sync.status === 'offline' ? 'Offline — will catch up later' : sync.error ?? 'Not syncing'}
            </Muted>
          </>
        ) : (
          <>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>Share with co-hosts and players</Text>
            <Muted style={{ marginTop: space(1), marginBottom: space(3) }}>
              Keep your league on mtg-event.com so another organizer can run a night from their phone, and players can check standings online.
            </Muted>
          </>
        )}
        <Button title={shared ? 'Manage shared league' : sync.session ? 'Choose a league' : 'Set up sharing'} kind={shared ? 'secondary' : 'primary'} onPress={() => navigation.navigate('League')} />
      </Card>

      <Label>Seasons</Label>
      <SeasonsCard />

      <Label>Import</Label>
      <Card style={{ marginBottom: space(4) }}>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>Import legacy stats</Text>
        <Muted style={{ marginTop: space(1), marginBottom: space(3) }}>Bring over points, events, W–L and 1st places from MTGevent, a spreadsheet, or a CSV link.</Muted>
        <Button title="Import legacy stats" onPress={() => navigation.navigate('ImportLegacy')} />
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
        desc={`Wipes all players, events, legacy stats and saved settings on this phone — the app goes back to brand new.${shared ? ' It also signs this phone out of the shared league; the league’s data on the server isn’t touched.' : ''}`}
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

const LENGTHS = [4, 6, 8, 12];
const fmtDate = (ts: number) => new Date(ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

function LengthPicker({ weeks, onChange }: { weeks: number; onChange: (w: number) => void }) {
  return (
    <View style={{ gap: space(2) }}>
      <View style={{ flexDirection: 'row', gap: space(2), flexWrap: 'wrap' }}>
        {LENGTHS.map((w) => <Chip key={w} label={`${w} weeks`} selected={weeks === w} onPress={() => onChange(w)} />)}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
        <Muted>Custom</Muted>
        <Stepper value={weeks} min={1} max={52} suffix="wk" onChange={onChange} />
      </View>
    </View>
  );
}

function SeasonsCard() {
  const store = useStore();
  const s = store.seasons;
  const cur = currentSeason(s);
  const [weeks, setWeeks] = useState(s.weeks || 8);
  const [start, setStart] = useState(() => startOfDay(Date.now()));
  const [renaming, setRenaming] = useState(false);

  // ── not started yet ──
  if (!s.seasons.length) {
    const end = addDays(start, weeks * 7 - 1);
    return (
      <Card style={{ marginBottom: space(4) }}>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>Run your events in seasons</Text>
        <Muted style={{ marginTop: space(1) }}>
          Pick a length and a start date. When a season ends the next one starts automatically, and the leaderboard gets a standings view for each season.
        </Muted>
        <Label>Season length</Label>
        <LengthPicker weeks={weeks} onChange={setWeeks} />
        <Label>Season 1 starts</Label>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
          <Button small title="‹" kind="secondary" onPress={() => setStart(addDays(start, -1))} />
          <Text style={{ color: colors.text, fontWeight: '700', flex: 1, textAlign: 'center' }}>{fmtDate(start)}</Text>
          <Button small title="›" kind="secondary" onPress={() => setStart(addDays(start, 1))} />
        </View>
        <View style={{ flexDirection: 'row', gap: space(2), marginTop: space(2) }}>
          <Button small title="Today" kind="ghost" onPress={() => setStart(startOfDay(Date.now()))} />
          <Button small title="−1 week" kind="ghost" onPress={() => setStart(addDays(start, -7))} />
          <Button small title="+1 week" kind="ghost" onPress={() => setStart(addDays(start, 7))} />
        </View>
        <Muted style={{ fontSize: 12, marginTop: space(2) }}>
          Season 1 runs {fmtDate(start)} – {fmtDate(end)}. A start date in the past is fine — events already in the app that fall inside it will count.
        </Muted>
        <Button title="Start Season 1" onPress={() => store.saveSeasons(startSeasons(start, weeks))} style={{ marginTop: space(3) }} />
      </Card>
    );
  }

  // ── turned off (history kept) ──
  if (!s.enabled) {
    return (
      <Card style={{ marginBottom: space(4) }}>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>Seasons are off</Text>
        <Muted style={{ marginTop: space(1), marginBottom: space(3) }}>
          {s.seasons.length} past season{s.seasons.length === 1 ? '' : 's'} saved. Turning seasons back on continues where you left off.
        </Muted>
        <Button title="Turn seasons back on" onPress={() => store.saveSeasons(extendSeasons({ ...s, enabled: true }))} />
      </Card>
    );
  }

  // ── running ──
  const changeLength = (w: number) => {
    setWeeks(w);
    if (w === s.weeks) return;
    Alert.alert(`Change to ${w}-week seasons?`, cur ? `Future seasons will be ${w} weeks. Should ${seasonLabel(cur)} change too?` : `Future seasons will be ${w} weeks.`, [
      { text: 'Cancel', style: 'cancel', onPress: () => setWeeks(s.weeks) },
      { text: 'Future only', onPress: () => store.saveSeasons(setSeasonLength(s, w, false)) },
      ...(cur ? [{ text: 'Current too', onPress: () => store.saveSeasons(setSeasonLength(s, w, true)) }] : []),
    ]);
  };

  return (
    <Card style={{ marginBottom: space(4), borderColor: colors.accent }}>
      {cur && (
        <>
          <Muted style={{ fontSize: 12 }}>CURRENT SEASON</Muted>
          <Pressable onPress={() => setRenaming(true)}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 20 }}>{seasonLabel(cur)} <Text style={{ color: colors.muted, fontSize: 14 }}>✎</Text></Text>
          </Pressable>
          <Muted>{seasonRange(cur)} · {daysLeft(cur)} day{daysLeft(cur) === 1 ? '' : 's'} left</Muted>
        </>
      )}
      <Label>Season length</Label>
      <LengthPicker weeks={weeks} onChange={changeLength} />
      <View style={{ flexDirection: 'row', gap: space(2), marginTop: space(4) }}>
        {cur && (
          <Button small title="End season now" kind="secondary" style={{ flex: 1 }} onPress={() =>
            Alert.alert(`End ${seasonLabel(cur)} today?`, `${seasonLabel(cur)} closes today and Season ${cur.number + 1} starts now.`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'End season', style: 'destructive', onPress: () => store.saveSeasons(endCurrentSeasonNow(s)) },
            ])} />
        )}
        <Button small title="Turn off seasons" kind="ghost" style={{ flex: 1 }} onPress={() =>
          Alert.alert('Turn off seasons?', 'The leaderboard goes back to month / year / all-time. Past seasons are kept and you can turn this back on later.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Turn off', onPress: () => store.saveSeasons({ ...s, enabled: false }) },
          ])} />
      </View>
      {cur && (
        <PromptModal visible={renaming} title="Season name" initial={cur.name ?? ''} confirmLabel="Save"
          extra={<Muted style={{ marginTop: space(2) }}>e.g. “Winter League”.</Muted>}
          onCancel={() => setRenaming(false)}
          onSubmit={(t) => { store.saveSeasons(renameSeason(s, cur.number, t)); setRenaming(false); }} />
      )}
    </Card>
  );
}
