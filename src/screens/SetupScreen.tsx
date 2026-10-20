// One-screen event setup: title, collapsible settings, and the player list.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { addPlayer, removePlayer, startEvent, updateSettings } from '../core/eventOps';
import { recommendedRounds } from '../core/pairing';
import { EventSettings, Format, TournamentEvent } from '../core/types';
import { norm, useStore } from '../data/store';
import { Button, Card, Chip, Field, Label, Muted, PromptModal, Segmented, Stepper } from '../ui/components';
import { colors, space } from '../ui/theme';
import { makeHistoryPenalty } from '../data/history';
import type { RootStack } from '../../App';

type Props = NativeStackScreenProps<RootStack, 'Setup'>;

const FORMATS: Array<{ label: string; value: Format }> = [
  { label: 'Constructed', value: 'constructed' },
  { label: 'Draft', value: 'draft' },
  { label: 'Sealed', value: 'sealed' },
];

export function settingsSummary(s: EventSettings): string {
  const f = FORMATS.find((x) => x.value === s.format)?.label ?? s.format;
  return `${f} · Swiss · Bo${s.bestOf} · ${s.rounds} rounds · ${s.roundMinutes} min`;
}

export default function SetupScreen({ route, navigation }: Props) {
  const store = useStore();
  const ev = store.getEvent(route.params.eventId);
  const [showSettings, setShowSettings] = useState(false);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const confirmDelete = () =>
    Alert.alert('Delete this event?', 'The event and its player list are removed. Players stay in your roster.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { store.deleteEvent(route.params.eventId); navigation.goBack(); } },
    ]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={confirmDelete} hitSlop={12} style={{ paddingHorizontal: space(1) }}>
          <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 15 }}>Delete</Text>
        </Pressable>
      ),
    });
  });

  // leaving setup with nobody added? quietly throw the empty event away
  const evRef = useRef(ev);
  evRef.current = ev;
  useEffect(() => navigation.addListener('beforeRemove', () => {
    const cur = evRef.current;
    if (cur && cur.status === 'setup' && cur.players.length === 0) store.deleteEvent(cur.id);
  }), [navigation, store.deleteEvent]);

  const suggestions = useMemo(() => {
    const q = norm(name).toLowerCase();
    if (!ev || !q) return [];
    const inEvent = new Set(ev.players.map((p) => p.playerId));
    return store.players.filter((p) => !inEvent.has(p.id) && p.name.toLowerCase().includes(q)).slice(0, 5);
  }, [name, store.players, ev]);

  if (!ev) return null;
  const save = (next: TournamentEvent) => store.saveEvent(next);
  const set = (patch: Partial<EventSettings>) => save(updateSettings(ev, patch));

  const add = (raw: string) => {
    const n = norm(raw);
    if (!n) return;
    const p = store.findOrCreatePlayer(n);
    if (ev.players.some((x) => x.playerId === p.id)) {
      Alert.alert('Already added', `${p.name} is already in this event.`);
    } else save(addPlayer(ev, p.id));
    setName('');
    inputRef.current?.focus();
  };

  const doRename = (id: string, newName: string) => {
    const n = norm(newName);
    const clash = store.players.find((p) => p.id !== id && p.name.toLowerCase() === n.toLowerCase());
    setRenaming(null);
    if (clash) {
      Alert.alert(
        'That player already exists',
        `"${clash.name}" is already in your roster. Merge them into one player? Their history will be combined.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Merge', onPress: () => store.mergePlayers(id, clash.id) },
        ],
      );
      return;
    }
    store.renamePlayer(id, n);
  };

  const start = () => {
    if (ev.players.length < 2) return;
    store.rememberSettings(ev.settings);
    const started = startEvent(ev, { historyPenalty: makeHistoryPenalty(store.events, ev.id) });
    save(started);
    navigation.replace('Event', { eventId: ev.id });
  };

  const rec = recommendedRounds(ev.players.length);
  const s = ev.settings;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: space(4), paddingBottom: space(28) }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => setEditTitle(true)}>
          <Text style={{ color: colors.text, fontSize: 24, fontWeight: '800' }}>{ev.title} <Text style={{ fontSize: 16, color: colors.muted }}>✎</Text></Text>
          <Muted>{new Date(ev.date).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</Muted>
        </Pressable>

        <Pressable onPress={() => setShowSettings((v) => !v)} style={{ marginTop: space(4) }}>
          <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ color: colors.text, flex: 1, fontWeight: '600' }}>{settingsSummary(s)}</Text>
            <Text style={{ color: colors.accent, fontWeight: '700' }}>{showSettings ? 'Done' : 'Edit'}</Text>
          </Card>
        </Pressable>

        {showSettings && (
          <Card style={{ marginTop: space(2) }}>
            <Label>Format</Label>
            <View style={{ flexDirection: 'row', gap: space(2), flexWrap: 'wrap' }}>
              {FORMATS.map((f) => <Chip key={f.value} label={f.label} selected={s.format === f.value} onPress={() => set({ format: f.value })} />)}
            </View>
            <Muted style={{ marginTop: space(1) }}>Commander pods and top cut are coming later.</Muted>

            <Label>Best of</Label>
            <Segmented options={[{ label: 'Best of 1', value: 1 }, { label: 'Best of 3', value: 3 }]} value={s.bestOf} onChange={(v) => set({ bestOf: v as 1 | 3 })} />

            <Label>Rounds</Label>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
              <Stepper value={s.rounds} min={1} max={15} onChange={(n) => set({ rounds: n })} />
              {s.autoRounds ? (
                <Pressable onPress={() => set({ rounds: s.rounds })}>
                  <Muted>Auto for {ev.players.length} players · <Text style={{ color: colors.accent }}>keep {s.rounds}</Text></Muted>
                </Pressable>
              ) : rec !== s.rounds && ev.players.length >= 2 ? (
                <Pressable onPress={() => save({ ...ev, settings: { ...s, autoRounds: true, rounds: rec } })}>
                  <Text style={{ color: colors.accent }}>Use recommended ({rec})</Text>
                </Pressable>
              ) : null}
            </View>

            <Label>Round timer</Label>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), flexWrap: 'wrap' }}>
              <Stepper value={s.roundMinutes} min={5} max={120} step={5} suffix="min" onChange={(n) => set({ roundMinutes: n })} />
              <Muted>warn at</Muted>
              <Stepper value={s.warnMinutes} min={0} max={30} step={5} suffix="min" onChange={(n) => set({ warnMinutes: n })} />
            </View>

            <Label>Scoring</Label>
            <Segmented
              options={[{ label: 'House (per game)', value: 'house' }, { label: 'Official 3/1/0', value: 'official' }]}
              value={s.scoring} onChange={(v) => set({ scoring: v as EventSettings['scoring'] })}
            />
            <Muted style={{ marginTop: space(1) }}>
              {s.scoring === 'house' ? '2-0 = 3 pts · otherwise 1 pt per game won · bye = 3' : 'Win 3 · Draw 1 · Loss 0 · Bye 3'}
            </Muted>

            <Label>Ties</Label>
            <Segmented
              options={[{ label: 'Share place', value: 'shared' }, { label: 'Tiebreakers', value: 'official' }, { label: 'H2H first', value: 'h2h' }]}
              value={s.tiebreak} onChange={(v) => set({ tiebreak: v as EventSettings['tiebreak'] })}
            />

            <Label>Prize spots</Label>
            <Stepper value={s.prizeSpots} min={0} max={32} onChange={(n) => set({ prizeSpots: n })} />
          </Card>
        )}

        <Label>Players ({ev.players.length})</Label>
        <View style={{ flexDirection: 'row', gap: space(2) }}>
          <Field
            ref={inputRef}
            value={name}
            onChangeText={setName}
            placeholder="Type a name…"
            onSubmitEditing={() => add(name)}
            blurOnSubmit={false}
            autoCapitalize="words"
            returnKeyType="done"
            style={{ flex: 1 }}
          />
          <Button title="Add" onPress={() => add(name)} disabled={!norm(name)} />
        </View>
        {suggestions.length > 0 && (
          <Card style={{ marginTop: space(1), paddingVertical: space(1) }}>
            {suggestions.map((p) => (
              <Pressable key={p.id} onPress={() => add(p.name)} style={{ paddingVertical: space(2.5) }}>
                <Text style={{ color: colors.text, fontSize: 16 }}>{p.name} <Text style={{ color: colors.muted, fontSize: 13 }}>· roster</Text></Text>
              </Pressable>
            ))}
          </Card>
        )}

        <View style={{ marginTop: space(3), gap: space(2) }}>
          {ev.players.map((ep, i) => (
            <Card key={ep.playerId} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space(3) }}>
              <Text style={{ color: colors.muted, width: 28 }}>{i + 1}</Text>
              <Pressable style={{ flex: 1 }} onPress={() => setRenaming(ep.playerId)}>
                <Text style={{ color: colors.text, fontSize: 16 }}>{store.nameOf(ep.playerId)}</Text>
              </Pressable>
              <Pressable onPress={() => setRenaming(ep.playerId)} hitSlop={8} style={{ paddingHorizontal: space(2) }}>
                <Text style={{ color: colors.muted, fontSize: 16 }}>✎</Text>
              </Pressable>
              <Pressable onPress={() => save(removePlayer(ev, ep.playerId))} hitSlop={8} style={{ paddingHorizontal: space(2) }}>
                <Text style={{ color: colors.danger, fontSize: 18, fontWeight: '700' }}>✕</Text>
              </Pressable>
            </Card>
          ))}
        </View>
      </ScrollView>

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: space(4), backgroundColor: colors.bg, borderTopWidth: 1, borderColor: colors.border }}>
        <Button
          title={ev.players.length < 2 ? 'Add at least 2 players' : `Start event · ${ev.players.length} players · ${s.rounds} rounds`}
          onPress={start}
          disabled={ev.players.length < 2}
        />
      </View>

      <PromptModal
        visible={renaming !== null}
        title="Rename player"
        initial={renaming ? store.nameOf(renaming) : ''}
        onCancel={() => setRenaming(null)}
        onSubmit={(t) => renaming && doRename(renaming, t)}
      />
      <PromptModal
        visible={editTitle}
        title="Event name"
        initial={ev.title}
        onCancel={() => setEditTitle(false)}
        onSubmit={(t) => { save({ ...ev, title: norm(t), updatedAt: Date.now() }); setEditTitle(false); }}
      />
    </View>
  );
}
