// Shows which phone is running a live event, and lets this phone take over (e.g. the host had to leave).
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { TournamentEvent } from '../core/types';
import { useStore } from '../data/store';
import { Button } from '../ui/components';
import { colors, space } from '../ui/theme';
import { ApiError } from './api';
import { useSync } from './SyncContext';

export default function RunnerBanner({ ev }: { ev: TournamentEvent }) {
  const sync = useSync();
  const league = sync.session?.league;
  const [other, setOther] = useState<string | null>(null);
  const busy = useRef(false);
  const live = !!league && ev.status === 'running';

  const check = async (force = false) => {
    if (!league || busy.current) return;
    busy.current = true;
    try {
      const r = await sync.api.claim(league.id, ev.id, sync.device, force);
      setOther(r.claimed ? null : r.runner);
    } catch (e) {
      // not on the server yet (just started): upload it, the next check will claim it
      if (e instanceof ApiError && e.status === 404) sync.syncNow();
    } finally {
      busy.current = false;
    }
  };

  // claim when opened, re-check every 30 s and when the app comes back to the front
  useEffect(() => {
    if (!live) return;
    check();
    const t = setInterval(() => check(), 30_000);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') check(); });
    return () => { clearInterval(t); sub.remove(); };
  }, [live, ev.id, league?.id]);

  // free the event for others once it's finished
  const prevStatus = useRef(ev.status);
  useEffect(() => {
    if (league && prevStatus.current === 'running' && ev.status === 'complete') {
      sync.api.release(league.id, ev.id, sync.device).catch(() => {});
    }
    prevStatus.current = ev.status;
  }, [ev.status]);

  if (!live || !other) return null;
  return (
    <View style={{ marginHorizontal: space(4), marginTop: space(2), padding: space(3), borderRadius: 12, borderWidth: 1, borderColor: colors.warn, backgroundColor: colors.cardAlt }}>
      <Text style={{ color: colors.warn, fontWeight: '800' }}>Being run on another phone</Text>
      <Text style={{ color: colors.text, marginTop: space(1) }}>
        {other} is running this event. Results entered on two phones at once can overwrite each other — take over only if they’ve stopped.
      </Text>
      <Button small title="Take over this event" onPress={() => check(true)} style={{ marginTop: space(2) }} />
    </View>
  );
}

/** Wrap a screen whose route has { eventId } so the banner shows above it. */
export function withRunnerBanner<P extends { route: { params: { eventId: string } } }>(Screen: React.ComponentType<P>) {
  return function EventWithBanner(props: P) {
    const ev = useStore().getEvent(props.route.params.eventId);
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {ev && <RunnerBanner ev={ev} />}
        <Screen {...props} />
      </View>
    );
  };
}
