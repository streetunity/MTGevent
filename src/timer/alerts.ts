// Round timer alarms. These are scheduled as exact local notifications on an
// alarm-priority channel, so they fire on time even with the phone locked or
// the app closed. The on-screen countdown is computed from the stored timer
// state, so killing the app never loses the clock.
import * as Notifications from 'expo-notifications';
import { Platform, Vibration } from 'react-native';

export const CHANNEL_ID = 'round-timer';
const IDS_WARN = 'round-warning';
const IDS_TIME = 'round-time';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function setupAlerts(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Round timer',
      description: 'Time warnings and end-of-round alarm',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 800, 400, 800, 400, 800],
      enableVibrate: true,
      bypassDnd: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.ALARM,
        contentType: Notifications.AndroidAudioContentType.SONIFICATION,
      },
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

/** (Re)schedule the warning + time-called alarms for a round. */
export async function scheduleRoundAlerts(opts: {
  eventTitle: string;
  roundNumber: number;
  remainingMs: number;
  warnMinutes: number;
}) {
  await cancelRoundAlerts();
  const now = Date.now();
  const end = now + opts.remainingMs;
  const warnAt = end - opts.warnMinutes * 60_000;
  if (opts.warnMinutes > 0 && warnAt > now + 1000) {
    await Notifications.scheduleNotificationAsync({
      identifier: IDS_WARN,
      content: {
        title: `${opts.warnMinutes} minutes left`,
        body: `${opts.eventTitle} · Round ${opts.roundNumber}`,
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.MAX,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: warnAt, channelId: CHANNEL_ID },
    });
  }
  if (end > now + 1000) {
    await Notifications.scheduleNotificationAsync({
      identifier: IDS_TIME,
      content: {
        title: '⏰ TIME! Round is over',
        body: `${opts.eventTitle} · Round ${opts.roundNumber} — finish the current turn, then 5 extra turns.`,
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.MAX,
        sticky: false,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: end, channelId: CHANNEL_ID },
    });
  }
}

export async function cancelRoundAlerts() {
  await Promise.all([
    Notifications.cancelScheduledNotificationAsync(IDS_WARN).catch(() => {}),
    Notifications.cancelScheduledNotificationAsync(IDS_TIME).catch(() => {}),
  ]);
}

/** In-app buzz when the clock hits zero while the app is open. */
export function buzzTimeCalled() {
  Vibration.vibrate([0, 800, 400, 800, 400, 800]);
}

export function buzzWarning() {
  Vibration.vibrate([0, 400, 200, 400]);
}
