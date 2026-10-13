// Running an event: Round (pairings, results, timer) · Standings · Players
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import {
  addExtraRound, addPlayer, addTime, beginRound, clearResult, completeRound, currentRound, dropPlayer,
  finishEarly, pauseTimer, repairCurrent, reportResult, resetTimer, startTimer, swapInCurrent, timerRemainingMs,
  undropPlayer, unreportedCount,
} from '../core/eventOps';
import { rematchIds } from '../core/pairing';
import { isCompleteResult, matchPoints, resultOptions } from '../core/scoring';
import { computeStandings, formatPct, placeLabel } from '../core/standings';
import { Id, Match, Round, TournamentEvent } from '../core/types';
import { makeHistoryPenalty } from '../data/history';
import { norm, useStore } from '../data/store';
import { buzzTimeCalled, buzzWarning, cancelRoundAlerts, scheduleRoundAlerts, setupAlerts } from '../timer/alerts';
import { Button, Card, Muted, PromptModal, Segmented, Sheet, styles as ui } from '../ui/components';
import { colors, space } from '../ui/theme';
import type { RootStack } from '../../App';

type Props = NativeStackScreenProps<RootStack, 'Event'>;
type Tab = 'round' | 'standings' | 'players';

export default function EventScreen({ route, navigation }: Props) {
  const store = useStore();
  const ev = store.getEvent(route.params.eventId);
  const [tab, setTab] = useState<Tab>('round');
  const [viewRound, setViewRound] = useState<number | null>(null);

  useEffect(() => {
    if (ev) navigation.setOptions({ title: ev.title });
  }, [ev?.title]);

  if (!ev) return null;
  const save = (next: TournamentEvent) => store.saveEvent(next);
  const cur = currentRound(ev);
  const shown = viewRound ? ev.rounds.find((r) => r.number === viewRound) ?? cur : cur;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: space(4), paddingBottom: space(2) }}>
        <Segmented
          options={[{ label: 'Round', value: 'round' }, { label: 'Standings', value: 'standings' }, { label: 'Players', value: 'players' }]}
          value={tab} onChange={(t) => setTab(t as Tab)}
        />
      </View>
      {tab === 'round' && shown && (
        <RoundTab ev={ev} round={shown} isCurrent={shown === cur} save={save} onPickRound={setViewRound} />
      )}
      {tab === 'round' && !shown && <Muted style={{ padding: space(4) }}>No rounds.</Muted>}
      {tab === 'standings' && <StandingsTab ev={ev} save={save} />}
      {tab === 'players' && <PlayersTab ev={ev} save={save} />}
    </View>
  );
}

// ───────────────────────── Round tab ─────────────────────────

function RoundTab({ ev, round, isCurrent, save, onPickRound }: {
  ev: TournamentEvent; round: Round; isCurrent: boolean; save: (e: TournamentEvent) => void; onPickRound: (n: number | null) => void;
}) {
  const store = useStore();
  const [selected, setSelected] = useState<Id | null>(null); // first player picked for a swap
  const [reporting, setReporting] = useState<Match | null>(null);
  const rematches = useMemo(() => rematchIds(ev, round.number, round.matches), [ev, round]);
  const pending = unreportedCount(round);
  const penalty = () => ({ historyPenalty: makeHistoryPenalty(store.events, ev.id) });
  const canSwap = isCurrent && round.status !== 'complete';

  const tapPlayer = (id: Id, m: Match) => {
    if (!canSwap) return;
    if (selected === null) { setSelected(id); Haptics.selectionAsync(); return; }
    if (selected === id) { setSelected(null); return; }
    const a = selected; setSelected(null);
    const doSwap = () => save(swapInCurrent(ev, a, id));
    const touchesReported = round.matches.some((x) => x.reported && x.p2 && [x.p1, x.p2].some((p) => p === a || p === id));
    if (touchesReported) {
      Alert.alert('Swap players?', 'One of these matches already has a result. Swapping will clear it.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Swap', style: 'destructive', onPress: doSwap },
      ]);
    } else doSwap();
  };

  const onComplete = () => {
    const last = round.number >= ev.settings.rounds;
    Alert.alert(last ? 'Finish event?' : `End round ${round.number}?`, last ? 'Final standings will be locked in (results can still be edited).' : `Round ${round.number + 1} will be paired.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: last ? 'Finish' : 'Pair next round', onPress: () => { cancelRoundAlerts(); save(completeRound(ev, penalty())); onPickRound(null); } },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space(4), paddingTop: space(1), paddingBottom: space(30), gap: space(3) }}>
      {/* round picker */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(2) }}>
        {ev.rounds.map((r) => (
          <Pressable key={r.number} onPress={() => onPickRound(r === ev.rounds[ev.rounds.length - 1] ? null : r.number)}
            style={[ui.chip, r.number === round.number && ui.chipOn]}>
            <Text style={[ui.chipText, r.number === round.number && { color: colors.text }]}>R{r.number}{r.status === 'complete' ? ' ✓' : ''}</Text>
          </Pressable>
        ))}
        {ev.status !== 'complete' && <Text style={[ui.chipText, { alignSelf: 'center' }]}>of {ev.settings.rounds}</Text>}
      </ScrollView>

      {isCurrent && round.status === 'active' && <TimerCard ev={ev} round={round} save={save} />}

      {round.status === 'pairing' && (
        <Card style={{ borderColor: colors.accent }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>Round {round.number} pairings</Text>
          <Muted style={{ marginTop: space(1) }}>Tap two players to swap them. Re-pair to shuffle again. Start the round when you're happy.</Muted>
          {rematches.size > 0 && <Text style={{ color: colors.warn, marginTop: space(2) }}>⚠ {rematches.size} rematch{rematches.size > 1 ? 'es' : ''} — couldn't avoid with current players, or caused by a swap.</Text>}
          <View style={{ flexDirection: 'row', gap: space(2), marginTop: space(3) }}>
            <Button title="Re-pair" kind="secondary" style={{ flex: 1 }} onPress={() => save(repairCurrent(ev, penalty()))} />
            <Button title="Start round" style={{ flex: 2 }} onPress={() => save(beginRound(ev))} disabled={round.matches.length === 0} />
          </View>
        </Card>
      )}

      {selected && <Text style={{ color: colors.accent, textAlign: 'center' }}>Swapping {store.nameOf(selected)} — tap another player (or tap again to cancel)</Text>}

      {round.matches.map((m) => (
        <MatchCard
          key={m.id} ev={ev} m={m} round={round} selected={selected} rematch={rematches.has(m.id)}
          onTapPlayer={(id) => tapPlayer(id, m)}
          onReport={() => round.status !== 'pairing' && m.p2 && setReporting(m)}
        />
      ))}

      {isCurrent && round.status === 'active' && (
        <View style={{ gap: space(2), marginTop: space(2) }}>
          {pending > 0 && <Text style={{ color: colors.warn, textAlign: 'center', fontWeight: '600' }}>{pending} match{pending > 1 ? 'es' : ''} still need a result</Text>}
          <Button
            title={round.number >= ev.settings.rounds ? 'Finish event' : `End round · pair round ${round.number + 1}`}
            onPress={onComplete} disabled={pending > 0}
          />
        </View>
      )}

      {ev.status === 'complete' && isCurrent && (
        <View style={{ gap: space(2) }}>
          <Card><Text style={{ color: colors.win, fontWeight: '800', textAlign: 'center' }}>Event complete 🏆 — see Standings</Text></Card>
          <Button title="Add an extra round" kind="secondary" onPress={() => save(addExtraRound(ev, penalty()))} />
        </View>
      )}

      {ev.status === 'running' && (
        <Button title="End event early" kind="ghost" onPress={() =>
          Alert.alert('End event now?', 'Unplayed rounds are dropped; standings use results so far.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'End event', style: 'destructive', onPress: () => { cancelRoundAlerts(); save(finishEarly(ev)); } },
          ])} />
      )}

      <ReportSheet ev={ev} match={reporting} onClose={() => setReporting(null)} save={save} />
    </ScrollView>
  );
}

function MatchCard({ ev, m, round, selected, rematch, onTapPlayer, onReport }: {
  ev: TournamentEvent; m: Match; round: Round; selected: Id | null; rematch: boolean;
  onTapPlayer: (id: Id) => void; onReport: () => void;
}) {
  const { nameOf } = useStore();
  const pts = matchPoints(m, ev.settings);
  const PlayerBtn = ({ id, games, win }: { id: Id; games: number; win: boolean }) => (
    <Pressable onPress={() => onTapPlayer(id)} style={{
      flex: 1, padding: space(2.5), borderRadius: 10,
      backgroundColor: selected === id ? colors.accentDim : 'transparent',
      borderWidth: 1, borderColor: selected === id ? colors.accent : 'transparent',
    }}>
      <Text numberOfLines={1} style={{ color: win ? colors.win : colors.text, fontSize: 17, fontWeight: win ? '800' : '600' }}>{nameOf(id)}</Text>
      {m.reported && m.p2 && <Text style={{ color: colors.muted, fontSize: 13 }}>{games} game{games === 1 ? '' : 's'}</Text>}
    </Pressable>
  );

  if (!m.p2) {
    return (
      <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ color: colors.muted, width: 40, fontWeight: '700' }}>BYE</Text>
        <PlayerBtn id={m.p1} games={0} win={false} />
        <Text style={{ color: colors.win, fontWeight: '700' }}>+3</Text>
      </Card>
    );
  }
  const needsResult = round.status === 'active' && !m.reported;
  return (
    <Card style={needsResult ? { borderColor: colors.warn } : rematch ? { borderColor: colors.warn } : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ color: colors.muted, width: 40, fontWeight: '700' }}>T{m.table}</Text>
        <PlayerBtn id={m.p1} games={m.p1Games} win={m.reported && m.p1Games > m.p2Games} />
        <Text style={{ color: colors.muted, marginHorizontal: space(1) }}>vs</Text>
        <PlayerBtn id={m.p2} games={m.p2Games} win={m.reported && m.p2Games > m.p1Games} />
      </View>
      {round.status !== 'pairing' && (
        <Pressable onPress={onReport} style={{ marginTop: space(2), paddingVertical: space(2.5), borderRadius: 10, backgroundColor: m.reported ? colors.cardAlt : colors.accent, alignItems: 'center' }}>
          <Text style={{ color: m.reported ? colors.text : '#04110F', fontWeight: '800', fontSize: 15 }}>
            {m.reported ? `${m.p1Games}–${m.p2Games}  ·  ${pts.p1} / ${pts.p2} pts  ·  edit` : 'Enter result'}
          </Text>
        </Pressable>
      )}
      {rematch && <Text style={{ color: colors.warn, fontSize: 12, marginTop: space(1) }}>Rematch</Text>}
    </Card>
  );
}

function ReportSheet({ ev, match, onClose, save }: { ev: TournamentEvent; match: Match | null; onClose: () => void; save: (e: TournamentEvent) => void }) {
  const { nameOf } = useStore();
  if (!match || !match.p2) return <Sheet visible={false} onClose={onClose}><View /></Sheet>;
  const a = nameOf(match.p1), b = nameOf(match.p2);
  const opts = resultOptions(ev.settings.bestOf);
  const pick = (x: number, y: number) => { save(reportResult(ev, match.id, x, y)); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); onClose(); };
  return (
    <Sheet visible onClose={onClose}>
      <Text style={ui.sheetTitle}>{a} vs {b}</Text>
      <Muted style={{ marginBottom: space(3) }}>Games won ({a} first). Partial scores are for when time is called.</Muted>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
        {opts.map(([x, y]) => {
          const done = isCompleteResult(x, y, ev.settings.bestOf);
          const pts = matchPoints({ ...match, p1Games: x, p2Games: y, reported: true }, ev.settings);
          const winner = x > y ? a : y > x ? b : null;
          return (
            <Pressable key={`${x}-${y}`} onPress={() => pick(x, y)} style={{
              width: '48%', padding: space(3), borderRadius: 12, borderWidth: 1,
              borderColor: done ? colors.accent : colors.border, backgroundColor: done ? colors.accentDim : colors.cardAlt,
            }}>
              <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800' }}>{x} – {y}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
                {done ? `${winner} wins` : 'Time called'} · {pts.p1}/{pts.p2} pts
              </Text>
            </Pressable>
          );
        })}
      </View>
      {match.reported && <Button title="Clear result" kind="ghost" onPress={() => { save(clearResult(ev, match.id)); onClose(); }} style={{ marginTop: space(3) }} />}
    </Sheet>
  );
}

// ───────────────────────── Timer ─────────────────────────

function fmt(ms: number) {
  const neg = ms < 0;
  const s = Math.floor(Math.abs(ms) / 1000);
  const mm = Math.floor(s / 60), ss = s % 60;
  return `${neg ? '+' : ''}${mm}:${ss.toString().padStart(2, '0')}`;
}

function TimerCard({ ev, round, save }: { ev: TournamentEvent; round: Round; save: (e: TournamentEvent) => void }) {
  const [now, setNow] = useState(Date.now());
  const running = !!round.timer.runningSince;
  const remaining = timerRemainingMs(round, now);
  const warnMs = ev.settings.warnMinutes * 60_000;
  const firedWarn = useRef(false);
  const firedTime = useRef(false);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    activateKeepAwakeAsync('round').catch(() => {});
    const sub = AppState.addEventListener('change', () => setNow(Date.now()));
    return () => { clearInterval(t); sub.remove(); deactivateKeepAwake('round'); };
  }, [running]);

  // in-app buzz (the scheduled notification covers the locked/closed case)
  useEffect(() => {
    if (!running) return;
    if (warnMs > 0 && remaining <= warnMs && remaining > warnMs - 3000 && !firedWarn.current) { firedWarn.current = true; buzzWarning(); }
    if (remaining <= 0 && remaining > -3000 && !firedTime.current) { firedTime.current = true; buzzTimeCalled(); }
    if (remaining > warnMs) firedWarn.current = false;
    if (remaining > 0) firedTime.current = false;
  }, [remaining, running]);

  const reschedule = (next: TournamentEvent) => {
    const r = currentRound(next)!;
    if (r.timer.runningSince) {
      scheduleRoundAlerts({ eventTitle: next.title, roundNumber: r.number, remainingMs: timerRemainingMs(r), warnMinutes: next.settings.warnMinutes });
    } else cancelRoundAlerts();
    save(next);
  };

  const start = async () => {
    const ok = await setupAlerts();
    if (!ok) Alert.alert('Notifications are off', 'The on-screen timer still works, but the alarm can’t ring when the phone is locked. Enable notifications for this app in Android settings.');
    reschedule(startTimer(ev));
  };

  const timeUp = remaining <= 0;
  const warn = !timeUp && warnMs > 0 && remaining <= warnMs;
  const color = timeUp ? colors.danger : warn ? colors.warn : colors.text;

  return (
    <Card style={{ alignItems: 'center', borderColor: timeUp ? colors.danger : warn ? colors.warn : colors.border }}>
      <Text style={{ color: colors.muted, fontWeight: '700' }}>ROUND {round.number}{timeUp ? ' · TIME' : ''}</Text>
      <Text style={{ color, fontSize: 64, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{fmt(remaining)}</Text>
      {timeUp && <Text style={{ color: colors.danger, fontWeight: '700', marginBottom: space(2), textAlign: 'center' }}>Time! Finish the current turn, then 5 additional turns.</Text>}
      <View style={{ flexDirection: 'row', gap: space(2), width: '100%' }}>
        {running
          ? <Button title="Pause" kind="secondary" style={{ flex: 1 }} onPress={() => reschedule(pauseTimer(ev))} />
          : <Button title={round.timer.elapsedMs ? 'Resume' : 'Start timer'} style={{ flex: 1 }} onPress={start} />}
        <Button title="+5 min" kind="secondary" onPress={() => reschedule(addTime(ev, 5 * 60_000))} />
        <Button title="−1" kind="secondary" onPress={() => reschedule(addTime(ev, -60_000))} />
        <Button title="Reset" kind="ghost" onPress={() => Alert.alert('Reset timer?', '', [
          { text: 'Cancel', style: 'cancel' }, { text: 'Reset', onPress: () => reschedule(resetTimer(ev)) },
        ])} />
      </View>
    </Card>
  );
}

// ───────────────────────── Standings tab ─────────────────────────

function StandingsTab({ ev, save }: { ev: TournamentEvent; save: (e: TournamentEvent) => void }) {
  const { nameOf } = useStore();
  const st = useMemo(() => computeStandings(ev, nameOf), [ev, nameOf]);
  const showTb = ev.settings.tiebreak !== 'shared';
  return (
    <ScrollView contentContainerStyle={{ padding: space(4), paddingTop: space(1), gap: space(2), paddingBottom: space(20) }}>
      <Muted>
        {ev.settings.scoring === 'house' ? 'House scoring' : 'Official scoring'} · ties: {ev.settings.tiebreak === 'shared' ? 'shared place' : ev.settings.tiebreak === 'h2h' ? 'head-to-head, then tiebreakers' : 'tiebreakers'} · {ev.settings.prizeSpots} prize spots
      </Muted>
      {st.cutoffTie && (
        <Card style={{ borderColor: colors.warn }}>
          <Text style={{ color: colors.warn, fontWeight: '800' }}>Tie at the prize cutoff</Text>
          <Text style={{ color: colors.text, marginTop: space(1) }}>
            {st.cutoffTie.playerIds.map(nameOf).join(', ')} are tied for {st.cutoffTie.place}{st.cutoffTie.place === 1 ? 'st' : st.cutoffTie.place === 2 ? 'nd' : st.cutoffTie.place === 3 ? 'rd' : 'th'} with {st.cutoffTie.spotsLeft} prize{st.cutoffTie.spotsLeft > 1 ? 's' : ''} left.
          </Text>
          <Muted style={{ marginTop: space(1) }}>Settle it your way, or apply tiebreakers:</Muted>
          <View style={{ flexDirection: 'row', gap: space(2), marginTop: space(2) }}>
            {ev.settings.tiebreak !== 'official' && <Button small title="Use tiebreakers" kind="secondary" onPress={() => save({ ...ev, settings: { ...ev.settings, tiebreak: 'official' }, updatedAt: Date.now() })} />}
            <Button small title={`Give ${st.cutoffTie.playerIds.length - st.cutoffTie.spotsLeft} extra prize${st.cutoffTie.playerIds.length - st.cutoffTie.spotsLeft > 1 ? 's' : ''}`} kind="secondary"
              onPress={() => save({ ...ev, settings: { ...ev.settings, prizeSpots: ev.settings.prizeSpots + st.cutoffTie!.playerIds.length - st.cutoffTie!.spotsLeft }, updatedAt: Date.now() })} />
          </View>
        </Card>
      )}
      {st.rows.map((r) => (
        <Card key={r.playerId} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space(3), borderColor: r.inPrizes ? colors.gold : colors.border, opacity: r.dropped ? 0.55 : 1 }}>
          <Text style={{ color: r.inPrizes ? colors.gold : colors.muted, width: 52, fontWeight: '800' }}>{placeLabel(r)}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{nameOf(r.playerId)}{r.dropped ? '  (dropped)' : ''}</Text>
            <Muted style={{ fontSize: 12 }}>
              {r.wins}-{r.losses}{r.draws ? `-${r.draws}` : ''} · games {r.gamesWon}-{r.gamesLost}{r.byes ? ` · ${r.byes} bye` : ''}
              {showTb ? ` · OMW ${formatPct(r.omw)} · GW ${formatPct(r.gwp)} · OGW ${formatPct(r.ogw)}` : ''}
            </Muted>
          </View>
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>{r.points}</Text>
        </Card>
      ))}
    </ScrollView>
  );
}

// ───────────────────────── Players tab ─────────────────────────

function PlayersTab({ ev, save }: { ev: TournamentEvent; save: (e: TournamentEvent) => void }) {
  const store = useStore();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<Id | null>(null);
  const cur = currentRound(ev);

  const drop = (id: Id) => {
    const name = store.nameOf(id);
    const activeMatch = cur?.status === 'active' && cur.matches.find((m) => !m.reported && (m.p1 === id || m.p2 === id));
    const buttons: any[] = [{ text: 'Cancel', style: 'cancel' }];
    if (activeMatch && activeMatch.p2) {
      const oppIsP1 = activeMatch.p2 === id;
      buttons.push({
        text: 'Drop & concede match',
        style: 'destructive',
        onPress: () => save(dropPlayer(reportResult(ev, activeMatch.id, oppIsP1 ? 2 : 0, oppIsP1 ? 0 : 2), id)),
      });
      buttons.push({ text: 'Drop after this round', onPress: () => save(dropPlayer(ev, id)) });
    } else {
      buttons.push({ text: 'Drop', style: 'destructive', onPress: () => save(dropPlayer(ev, id)) });
    }
    Alert.alert(`Drop ${name}?`, 'They stay in the standings but won’t be paired in future rounds.', buttons);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space(4), paddingTop: space(1), gap: space(2), paddingBottom: space(20) }}>
      {ev.status !== 'complete' && <Button title="+ Add late player" kind="secondary" onPress={() => setAdding(true)} />}
      {ev.players.map((p) => {
        const dropped = p.droppedAfterRound !== undefined;
        return (
          <Card key={p.playerId} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space(3), opacity: dropped ? 0.6 : 1 }}>
            <Pressable style={{ flex: 1 }} onPress={() => setRenaming(p.playerId)}>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{store.nameOf(p.playerId)} <Text style={{ color: colors.muted }}>✎</Text></Text>
              <Muted style={{ fontSize: 12 }}>
                {dropped ? `Dropped after round ${p.droppedAfterRound}` : p.joinedRound > 1 ? `Joined round ${p.joinedRound}` : 'Active'}
              </Muted>
            </Pressable>
            {ev.status !== 'complete' && (dropped
              ? <Button small title="Undo drop" kind="secondary" onPress={() => save(undropPlayer(ev, p.playerId))} />
              : <Button small title="Drop" kind="danger" onPress={() => drop(p.playerId)} />)}
          </Card>
        );
      })}
      <PromptModal
        visible={adding} title="Add late player" confirmLabel="Add"
        extra={<Muted style={{ marginTop: space(2) }}>
          {cur?.status === 'pairing' ? 'They’ll be included when this round is re-paired.' : `They’ll start in round ${(cur?.number ?? 0) + 1} with 0 points.`}
        </Muted>}
        onCancel={() => setAdding(false)}
        onSubmit={(t) => {
          const pl = store.findOrCreatePlayer(norm(t));
          let next = addPlayer(ev, pl.id);
          if (cur?.status === 'pairing') next = repairCurrent(next, { historyPenalty: makeHistoryPenalty(store.events, ev.id) });
          save(next);
          setAdding(false);
        }}
      />
      <PromptModal
        visible={renaming !== null} title="Rename player" initial={renaming ? store.nameOf(renaming) : ''}
        onCancel={() => setRenaming(null)}
        onSubmit={(t) => { if (renaming) store.renamePlayer(renaming, t); setRenaming(null); }}
      />
    </ScrollView>
  );
}
