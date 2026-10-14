// Shared league: sign in, create/join a league, invite co-hosts, see sync status.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, Switch, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useStore } from '../data/store';
import { ApiError, DEFAULT_SERVER, League, Member, prettyCode, publicUrl } from '../sync/api';
import { ago, useSync } from '../sync/SyncContext';
import { Button, Card, Field, Label, Muted, Segmented } from '../ui/components';
import { colors, space } from '../ui/theme';
import type { RootStack } from '../../App';

type Props = NativeStackScreenProps<RootStack, 'League'>;

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

export default function LeagueScreen(_: Props) {
  const sync = useSync();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: space(4), paddingBottom: space(16) }} keyboardShouldPersistTaps="handled">
      {!sync.session ? <AuthForm /> : !sync.session.league ? <ChooseLeague /> : <Connected />}
      {sync.error && !sync.session?.league && (
        <Card style={{ marginTop: space(4), borderColor: colors.danger }}><Text style={{ color: colors.danger }}>{sync.error}</Text></Card>
      )}
    </ScrollView>
  );
}

// ───────────────────────── sign in / create account ─────────────────────────

function AuthForm() {
  const sync = useSync();
  const [mode, setMode] = useState<'in' | 'new'>('in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  const submit = async () => {
    setBusy(true); setErr(undefined);
    try {
      if (mode === 'in') await sync.signIn(email, password, server.trim());
      else await sync.register(name, email, password, invite, server.trim());
    } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  const ok = email.includes('@') && password.length >= (mode === 'new' ? 8 : 1) && (mode === 'in' || name.trim().length > 0);

  return (
    <>
      <Card style={{ marginBottom: space(4) }}>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>Share your league</Text>
        <Muted style={{ marginTop: space(1) }}>
          Sign in to keep your players, events and seasons on mtg-event.com. Co-hosts can run a night from their own phone,
          and players will be able to check standings on the website. Everything still works offline — it catches up when you’re back online.
        </Muted>
      </Card>
      <Segmented options={[{ label: 'Sign in', value: 'in' }, { label: 'Create account', value: 'new' }]} value={mode} onChange={(m) => { setMode(m as 'in' | 'new'); setErr(undefined); }} />
      {mode === 'new' && (<><Label>Your name</Label><Field value={name} onChangeText={setName} placeholder="Brian" autoCapitalize="words" /></>)}
      <Label>Email</Label>
      <Field value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" />
      <Label>Password</Label>
      <Field value={password} onChangeText={setPassword} placeholder={mode === 'new' ? 'At least 8 characters' : ''} secureTextEntry autoCapitalize="none" autoCorrect={false} />
      {mode === 'new' && (
        <>
          <Label>Invite code (if you have one)</Label>
          <Field value={invite} onChangeText={setInvite} placeholder="ABCD-EFGH" autoCapitalize="characters" autoCorrect={false} />
        </>
      )}
      {err && <Text style={{ color: colors.danger, marginTop: space(3) }}>{err}</Text>}
      <Button title={busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Create account'} onPress={submit} disabled={!ok || busy} style={{ marginTop: space(4) }} />
      <Pressable onPress={() => setAdvanced(!advanced)} style={{ marginTop: space(6) }}>
        <Muted style={{ fontSize: 12 }}>{advanced ? '▾' : '▸'} Server</Muted>
      </Pressable>
      {advanced && (
        <>
          <Field value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={{ marginTop: space(2) }} />
          <Muted style={{ fontSize: 12, marginTop: space(1) }}>Leave as {DEFAULT_SERVER} unless you run your own copy of the server.</Muted>
        </>
      )}
    </>
  );
}

// ───────────────────────── pick / create / join a league ─────────────────────────

function useConnect() {
  const sync = useSync();
  const store = useStore();
  /** Ask what to do with data already on this phone, then connect. */
  return useCallback((league: League, isNew: boolean) => {
    const np = store.players.length, ne = store.events.length;
    if (isNew || (np === 0 && ne === 0)) { sync.connect(league, 'merge', isNew); return; }
    Alert.alert(
      `Connect to ${league.name}?`,
      `This phone has ${np} player${np === 1 ? '' : 's'} and ${ne} event${ne === 1 ? '' : 's'}.\n\n` +
      '• Add them to the league — they’re uploaded and combined with what the league already has. Players with the same name will show up twice; merge them from the player page.\n\n' +
      '• Use the league’s data only — this phone’s players and events are removed and replaced with the league’s.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Use league’s data only', style: 'destructive', onPress: () => sync.connect(league, 'replace') },
        { text: 'Add them to the league', onPress: () => sync.connect(league, 'merge') },
      ],
    );
  }, [store.players.length, store.events.length, sync.connect]);
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

function ChooseLeague() {
  const sync = useSync();
  const connect = useConnect();
  const [leagues, setLeagues] = useState<League[] | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [err, setErr] = useState<string>();

  useEffect(() => {
    sync.myLeagues().then(setLeagues).catch((e) => { setLeagues([]); setErr(msg(e)); });
  }, []);

  const effSlug = slugTouched ? slugify(slug) : slugify(name);

  const create = async () => {
    setBusy('create'); setErr(undefined);
    try { const r = await sync.api.createLeague(name.trim(), effSlug); connect(r.league, true); }
    catch (e) { setErr(msg(e)); } finally { setBusy(null); }
  };
  const join = async () => {
    setBusy('join'); setErr(undefined);
    try { const r = await sync.api.acceptInvite(code.trim()); connect(r.league, false); }
    catch (e) { setErr(msg(e)); } finally { setBusy(null); }
  };

  return (
    <>
      <Muted>Signed in as {sync.session?.user.name} ({sync.session?.user.email})</Muted>

      <Label>Your leagues</Label>
      {leagues === null ? <ActivityIndicator color={colors.accent} /> : leagues.length === 0 ? (
        <Muted>You’re not in a league yet. Create one for your store or bar, or join one with an invite code from its owner.</Muted>
      ) : leagues.map((l) => (
        <Pressable key={l.id} onPress={() => connect(l, false)}>
          <Card style={{ marginBottom: space(2), flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>{l.name}</Text>
              <Muted style={{ fontSize: 12 }}>{l.role === 'owner' ? 'Owner' : 'Organizer'} · /{l.slug}</Muted>
            </View>
            <Text style={{ color: colors.accent, fontWeight: '700' }}>Use ›</Text>
          </Card>
        </Pressable>
      ))}

      <Label>Create a league</Label>
      <Card>
        <Field value={name} onChangeText={setName} placeholder="e.g. Tuesday Magic at The Tap Room" autoCapitalize="words" />
        <Muted style={{ fontSize: 12, marginTop: space(3) }}>Web address for players</Muted>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space(1) }}>
          <Muted>mtg-event.com/</Muted>
          <Field value={effSlug} onChangeText={(t) => { setSlug(t); setSlugTouched(true); }} autoCapitalize="none" autoCorrect={false} style={{ flex: 1, marginLeft: space(1) }} placeholder="your-league" />
        </View>
        <Button title={busy === 'create' ? 'Creating…' : 'Create league'} onPress={create} disabled={name.trim().length < 2 || effSlug.length < 3 || !!busy} style={{ marginTop: space(3) }} />
        <Muted style={{ fontSize: 12, marginTop: space(2) }}>Your players, events, legacy stats and seasons on this phone are uploaded to the new league.</Muted>
      </Card>

      <Label>Join with an invite code</Label>
      <Card>
        <Field value={code} onChangeText={setCode} placeholder="ABCD-EFGH" autoCapitalize="characters" autoCorrect={false} />
        <Button title={busy === 'join' ? 'Joining…' : 'Join league'} onPress={join} disabled={code.replace(/[^A-Za-z0-9]/g, '').length !== 8 || !!busy} style={{ marginTop: space(3) }} />
      </Card>

      {err && <Text style={{ color: colors.danger, marginTop: space(3) }}>{err}</Text>}

      <Button title="Sign out" kind="ghost" onPress={sync.signOut} style={{ marginTop: space(8) }} />
    </>
  );
}

// ───────────────────────── connected ─────────────────────────

function Connected() {
  const sync = useSync();
  const s = sync.session!;
  const league = s.league!;
  const owner = league.role === 'owner';
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invite, setInvite] = useState<{ code: string; expiresAt: number; usesLeft: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  const loadMembers = useCallback(() => {
    sync.api.members(league.id).then((r) => setMembers(r.members)).catch(() => setMembers(null));
  }, [league.id, sync.api]);
  useEffect(loadMembers, [loadMembers]);

  const statusText = {
    off: 'Not syncing', idle: `Synced ${ago(s.lastSyncAt)}`, syncing: 'Syncing…',
    offline: 'Offline — will sync when you’re back online', error: 'Sync problem',
  }[sync.status];
  const statusColor = sync.status === 'idle' ? colors.win : sync.status === 'syncing' ? colors.muted : colors.danger;
  const url = publicUrl(s.server, league.slug);

  const makeInvite = async () => {
    setBusy(true); setErr(undefined);
    try { setInvite((await sync.api.createInvite(league.id, 7, 5)).invite); }
    catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  const shareInvite = (code: string) => Share.share({
    message: `Join ${league.name} as an organizer in the MTG Event app.\n\nSign in (or create an account), choose “Join with an invite code” and enter:\n\n${prettyCode(code)}\n\nThe code works for 7 days.`,
  });

  const remove = (m: Member) => Alert.alert(`Remove ${m.name}?`, 'They’ll stop syncing with this league right away. Events they ran stay in the league.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: async () => {
      try { await sync.api.removeMember(league.id, m.id); loadMembers(); } catch (e) { setErr(msg(e)); }
    } },
  ]);

  const togglePublic = async (isPublic: boolean) => {
    try {
      const r = await sync.api.updateLeague(league.id, { isPublic });
      sync.updateLeague({ ...league, isPublic: r.league.isPublic });
    } catch (e) { setErr(msg(e)); }
  };

  const leave = () => Alert.alert(`Leave ${league.name}?`, 'You’ll stop syncing with this league. Everything already on this phone stays here.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Leave', style: 'destructive', onPress: async () => {
      try { await sync.api.removeMember(league.id, s.user.id); sync.disconnect(); } catch (e) { setErr(msg(e)); }
    } },
  ]);

  const disconnect = () => Alert.alert('Stop syncing on this phone?', 'Your data stays on this phone and in the league. You can reconnect any time.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Stop syncing', onPress: sync.disconnect },
  ]);

  return (
    <>
      <Card style={{ borderColor: colors.accent, marginBottom: space(4) }}>
        <Muted style={{ fontSize: 12 }}>SHARED LEAGUE · {owner ? 'OWNER' : 'ORGANIZER'}</Muted>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 20 }}>{league.name}</Text>
        <Muted style={{ marginTop: space(1) }}>Players’ page: {url.replace(/^https?:\/\//, '')} (website coming soon)</Muted>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space(3), gap: space(2) }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: statusColor }} />
          <Text style={{ color: colors.text, flex: 1 }}>{statusText}{sync.pending ? ` · ${sync.pending} change${sync.pending === 1 ? '' : 's'} waiting` : ''}</Text>
        </View>
        {sync.error && <Text style={{ color: colors.danger, marginTop: space(2) }}>{sync.error}</Text>}
        <Button small title="Sync now" kind="secondary" onPress={sync.syncNow} disabled={sync.status === 'syncing'} style={{ marginTop: space(3) }} />
      </Card>

      {owner && (
        <>
          <Label>Co-hosts</Label>
          <Card style={{ marginBottom: space(4) }}>
            <Muted>Give a co-host an invite code. They sign in on their phone, choose “Join with an invite code”, and can then run events and see everything in this league.</Muted>
            {invite ? (
              <View style={{ alignItems: 'center', marginTop: space(4) }}>
                <Text selectable style={{ color: colors.text, fontSize: 32, fontWeight: '800', letterSpacing: 4 }}>{prettyCode(invite.code)}</Text>
                <Muted style={{ fontSize: 12, marginTop: space(1) }}>Works for 7 days · up to {invite.usesLeft} people</Muted>
                <View style={{ flexDirection: 'row', gap: space(2), marginTop: space(3), alignSelf: 'stretch' }}>
                  <Button small title="Share code" onPress={() => shareInvite(invite.code)} style={{ flex: 1 }} />
                  <Button small title="New code" kind="secondary" onPress={makeInvite} disabled={busy} style={{ flex: 1 }} />
                </View>
              </View>
            ) : (
              <Button title={busy ? 'Making code…' : 'Make an invite code'} onPress={makeInvite} disabled={busy} style={{ marginTop: space(3) }} />
            )}
          </Card>
        </>
      )}

      <Label>People in this league</Label>
      <Card style={{ marginBottom: space(4) }}>
        {members === null ? <Muted>Couldn’t load right now.</Muted> : members.map((m, i) => (
          <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space(2), borderTopWidth: i ? 1 : 0, borderColor: colors.border }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{m.name}{m.id === s.user.id ? ' (you)' : ''}</Text>
              <Muted style={{ fontSize: 12 }}>{m.role === 'owner' ? 'Owner' : 'Organizer'} · {m.email}</Muted>
            </View>
            {owner && m.role !== 'owner' && <Button small title="Remove" kind="ghost" onPress={() => remove(m)} />}
          </View>
        ))}
      </Card>

      {owner && (
        <>
          <Label>Players’ website</Label>
          <Card style={{ marginBottom: space(4), flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1, paddingRight: space(3) }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Public page</Text>
              <Muted style={{ fontSize: 12 }}>Anyone with the link can see standings and results. Turn off to hide the page.</Muted>
            </View>
            <Switch value={league.isPublic} onValueChange={togglePublic} trackColor={{ true: colors.accent }} />
          </Card>
        </>
      )}

      {err && <Text style={{ color: colors.danger, marginBottom: space(3) }}>{err}</Text>}

      <View style={{ gap: space(2), marginTop: space(4) }}>
        <Button title="Stop syncing on this phone" kind="secondary" onPress={disconnect} />
        {!owner && <Button title="Leave league" kind="ghost" onPress={leave} />}
        <Button title={`Sign out (${s.user.email})`} kind="ghost" onPress={() => { sync.disconnect(); sync.signOut(); }} />
      </View>
    </>
  );
}
