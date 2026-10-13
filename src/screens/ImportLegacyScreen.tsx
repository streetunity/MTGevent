// Paste in totals from before the app (e.g. MTGevent.com): name, points, events.
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { csvUrl, LegacyOrder, parseLegacy } from '../core/legacy';
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
  const [helpOpen, setHelpOpen] = useState(true);
  const [url, setUrl] = useState(() => store.getSetting<string>('legacyUrl') ?? '');
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchUrl = async () => {
    const target = csvUrl(url);
    setFetching(true);
    setFetchError(null);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20_000);
      const res = await fetch(target, { signal: ctrl.signal, headers: { Accept: 'text/csv,text/plain,*/*' } });
      clearTimeout(timer);
      if (!res.ok) throw new Error(res.status === 401 || res.status === 403 || res.status === 404
        ? `The link returned ${res.status}. If it's a Google Sheet, set sharing to “Anyone with the link”.`
        : `The link returned an error (${res.status}).`);
      const body = await res.text();
      if (body.length > 2_000_000) throw new Error('That file is too large (over 2 MB).');
      if (/^\s*<(!doctype|html)/i.test(body)) throw new Error('That link opened a web page, not a CSV file. For Google Sheets, share as “Anyone with the link” or use File → Share → Publish to web → CSV.');
      setText(body);
      setHelpOpen(false);
      store.setSetting('legacyUrl', url.trim());
    } catch (e: any) {
      const msg = e?.name === 'AbortError' ? 'The link took too long to respond.'
        : /network request failed/i.test(e?.message ?? '') ? 'Couldn’t reach that link. Check the internet connection — and the link must start with https://.'
        : e?.message ?? 'Couldn’t download that link.';
      setFetchError(msg);
    } finally {
      setFetching(false);
    }
  };
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
      <HowToImport open={helpOpen} onToggle={() => setHelpOpen((v) => !v)} />

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

      <Label>From a link (optional)</Label>
      <View style={{ flexDirection: 'row', gap: space(2) }}>
        <Field
          value={url}
          onChangeText={(t) => { setUrl(t); setFetchError(null); }}
          placeholder="https://…/standings.csv or a Google Sheets link"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onSubmitEditing={() => url.trim() && fetchUrl()}
          style={{ flex: 1, fontSize: 14 }}
        />
        <Button title={fetching ? '…' : 'Fetch'} onPress={fetchUrl} disabled={!url.trim() || fetching} />
      </View>
      {fetching && <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), marginTop: space(2) }}><ActivityIndicator color={colors.accent} /><Muted>Downloading…</Muted></View>}
      {fetchError && <Text style={{ color: colors.warn, marginTop: space(2) }}>{fetchError}</Text>}
      <Muted style={{ fontSize: 12, marginTop: space(1) }}>Works with a direct .csv link, a Google Sheet shared as “Anyone with the link”, or a Dropbox link. The file loads into the box below for you to check before importing.</Muted>

      <Label>Data</Label>
      <Field
        value={text}
        onChangeText={(t) => { setText(t); if (t.trim() && !text.trim()) setHelpOpen(false); }}
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

const EXAMPLE = [
  ['Rank', 'Player', 'Events', 'W–L', 'Points', '1st Places'],
  ['1', 'Danny', '10', '21–7', '63', '4'],
  ['2', 'Brian', '11', '21–10', '63', '1'],
  ['3', 'Eric', '9', '17–10', '51', '2'],
];

function HowToImport({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
    <View style={{ flexDirection: 'row', gap: space(2), marginTop: space(2) }}>
      <Text style={{ color: colors.accent, fontWeight: '800', width: 18 }}>{n}.</Text>
      <Text style={{ color: colors.text, flex: 1, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
  const B = ({ children }: { children: React.ReactNode }) => <Text style={{ fontWeight: '800' }}>{children}</Text>;
  return (
    <Card style={{ borderColor: colors.accent }}>
      <Pressable onPress={onToggle} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, flex: 1 }}>ⓘ  How to import</Text>
        <Text style={{ color: colors.accent, fontWeight: '700' }}>{open ? 'Hide' : 'Show'}</Text>
      </Pressable>
      {open && (
        <View>
          <Step n={1}>Copy your old standings table <B>including the header row</B> — from a spreadsheet, Google Sheets, or the MTGevent standings page. Copying keeps the columns separate. Or paste a <B>link to a .csv file</B> (or a shared Google Sheet) and tap Fetch.</Step>
          <Step n={2}>Paste it into the box below. Columns are matched by their header names, in any order:</Step>
          <View style={{ backgroundColor: colors.cardAlt, borderRadius: 8, padding: space(2.5), marginTop: space(2), borderWidth: 1, borderColor: colors.border }}>
            {EXAMPLE.map((row, i) => (
              <View key={i} style={{ flexDirection: 'row' }}>
                {row.map((c, j) => (
                  <Text key={j} numberOfLines={1} style={{
                    color: i === 0 ? colors.accent : colors.text, fontWeight: i === 0 ? '700' : '400',
                    fontFamily: 'monospace', fontSize: 11, flex: j === 1 ? 1.6 : j === 5 ? 1.4 : 1,
                  }}>{c}</Text>
                ))}
              </View>
            ))}
          </View>
          <Muted style={{ fontSize: 12, marginTop: space(1.5) }}>
            Needed: <B>Player</B> plus <B>Points</B> and/or <B>Events</B>. Optional: <B>W–L</B> (or Wins + Losses) and <B>1st Places</B>. Rank and anything else is ignored.
          </Muted>
          <Step n={3}>Check the preview. <B>Names must match your roster exactly</B> (capital letters don’t matter) — anyone shown as “new player” who should match, fix the name in your table first. “Brian StreetUnity” and “Brian” are two different players.</Step>
          <Step n={4}>Tap <B>Import</B>. You can fix any player later from their page → Legacy stats.</Step>
          <Muted style={{ fontSize: 12, marginTop: space(3) }}>
            No header? One player per line also works: <Text style={{ color: colors.text }}>Mike S, 142, 18</Text> (name, points, events).
          </Muted>
        </View>
      )}
    </Card>
  );
}
