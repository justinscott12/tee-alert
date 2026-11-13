import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { setBackgroundWatching } from './src/backgroundTask';
import { COURSE } from './src/foreup';
import {
  CheckResult,
  DEFAULT_WATCH,
  USE_MOCK,
  Watch,
  bookableDates,
  formatMinutes,
  formatSlot,
  loadLastResult,
  loadWatch,
  resetSeen,
  runCheck,
  saveWatch,
  sendTestNotification,
} from './src/watcher';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const POLL_MS = 60_000; // while the app is open
const STEP = 30; // time-window step, minutes
const FIRST_TEE = 7 * 60;
const LAST_TEE = 17 * 60;

const C = {
  bg: '#F4F3EE',
  card: '#FFFFFF',
  ink: '#16211B',
  muted: '#6B746E',
  line: '#E4E2DA',
  green: '#1E4D3A',
  greenSoft: '#E3EDE7',
  sand: '#C8A96A',
  danger: '#B4442F',
};

function openBooking() {
  WebBrowser.openBrowserAsync(COURSE.bookingUrl);
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const [watch, setWatch] = useState<Watch>(DEFAULT_WATCH);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [now, setNow] = useState(Date.now());
  const loaded = useRef(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      setResult(await runCheck());
    } finally {
      setChecking(false);
    }
  }, []);

  // Load saved state once.
  useEffect(() => {
    (async () => {
      const [w, r] = await Promise.all([loadWatch(), loadLastResult()]);
      setWatch(w);
      setResult(r);
      loaded.current = true;
      check();
    })();
  }, [check]);

  // Poll while open + watching; also re-check when returning to the app.
  useEffect(() => {
    if (!watch.enabled) return;
    const id = setInterval(() => AppState.currentState === 'active' && check(), POLL_MS);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [watch.enabled, check]);

  // Tick for "checked 2m ago".
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  /** Any change to criteria resets the baseline, then re-checks. */
  const update = useCallback(
    async (patch: Partial<Watch>) => {
      const next = { ...watch, ...patch };
      setWatch(next);
      await saveWatch(next);
      if (!('enabled' in patch)) await resetSeen();
      check();
    },
    [watch, check],
  );

  const toggleWatching = async () => {
    if (!watch.enabled && !USE_MOCK) {
      const perm = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: true, allowBadge: false },
      });
      if (!perm.granted && perm.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) return;
    }
    const enabled = !watch.enabled;
    await setBackgroundWatching(enabled);
    update({ enabled });
  };

  const toggleDate = (d: string) =>
    update({ dates: watch.dates.includes(d) ? watch.dates.filter((x) => x !== d) : [...watch.dates, d] });

  const newSet = new Set(Object.keys(result?.newSince ?? {}));
  const matches = result?.matches ?? [];
  const noDays = watch.dates.length === 0;

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar style="dark" />
      {USE_MOCK ? null : <NotificationTapHandler />}
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={checking} onRefresh={check} tintColor={C.green} />}
      >
        {/* Header */}
        <View style={s.header}>
          <View style={s.headerTop}>
            <Text style={s.eyebrow}>ST. PETERSBURG · MUNICIPAL</Text>
            <StatusPill enabled={watch.enabled} result={result} now={now} checking={checking} />
          </View>
          <Text style={s.title}>Mangrove Bay</Text>
        </View>

        {/* Watch settings */}
        <View style={s.card}>
          <Label>Days</Label>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
            {bookableDates().map((d) => (
              <DayChip key={d} iso={d} on={watch.dates.includes(d)} onPress={() => toggleDate(d)} />
            ))}
          </ScrollView>

          <View style={s.divider} />

          <Label>Tee time between</Label>
          <View style={s.row}>
            <Stepper
              value={formatMinutes(watch.earliest)}
              onMinus={() => watch.earliest > FIRST_TEE && update({ earliest: watch.earliest - STEP })}
              onPlus={() => watch.earliest + STEP < watch.latest && update({ earliest: watch.earliest + STEP })}
            />
            <Text style={s.and}>and</Text>
            <Stepper
              value={formatMinutes(watch.latest)}
              onMinus={() => watch.latest - STEP > watch.earliest && update({ latest: watch.latest - STEP })}
              onPlus={() => watch.latest < LAST_TEE && update({ latest: watch.latest + STEP })}
            />
          </View>

          <View style={s.divider} />

          <Label>Players</Label>
          <View style={s.segment}>
            {([2, 3, 4] as const).map((n) => (
              <Pressable
                key={n}
                onPress={() => update({ players: n })}
                style={[s.segItem, watch.players === n && s.segItemOn]}
              >
                <Text style={[s.segText, watch.players === n && s.segTextOn]}>{n}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Pressable
          onPress={toggleWatching}
          disabled={noDays && !watch.enabled}
          style={({ pressed }) => [
            s.cta,
            watch.enabled && s.ctaStop,
            noDays && !watch.enabled && { opacity: 0.4 },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={[s.ctaText, watch.enabled && { color: C.green }]}>
            {watch.enabled ? 'Stop watching' : 'Notify me when a time opens'}
          </Text>
        </Pressable>

        {/* Results */}
        <View style={s.sectionHead}>
          <Text style={s.section}>Open right now</Text>
          <Text style={s.count}>{matches.length}</Text>
        </View>

        {result?.error ? <Text style={s.error}>Couldn't reach foreUP: {result.error}</Text> : null}

        {matches.length === 0 ? (
          <View style={[s.card, s.empty]}>
            <Text style={s.emptyTitle}>{noDays ? 'Pick at least one day' : 'Nothing open in your window'}</Text>
            <Text style={s.emptyBody}>
              {watch.enabled
                ? "You'll get a notification the moment one frees up."
                : 'Turn on watching and we’ll ping you when one frees up.'}
            </Text>
          </View>
        ) : (
          <View style={s.card}>
            {matches.map((t, i) => {
              const { day, time } = formatSlot(t);
              return (
                <Pressable
                  key={t.time}
                  onPress={openBooking}
                  style={({ pressed }) => [s.slot, i > 0 && s.slotBorder, pressed && { backgroundColor: C.bg }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.slotTime}>
                      {time}
                      {newSet.has(t.time) ? <Text style={s.newBadge}>  NEW</Text> : null}
                    </Text>
                    <Text style={s.slotMeta}>
                      {day} · {t.spots} spot{t.spots === 1 ? '' : 's'}
                      {t.greenFee ? ` · $${t.greenFee.toFixed(2)}` : ''}
                    </Text>
                  </View>
                  <Text style={s.book}>Book ›</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={s.footer}>
          <Pressable onPress={() => !USE_MOCK && sendTestNotification()} hitSlop={8}>
            <Text style={s.link}>Send a test notification</Text>
          </Pressable>
          <Text style={s.fine}>
            Checks every minute while the app is open. In the background, iOS wakes it roughly every 15+ minutes
            at its own discretion, so keep it open for the fastest alerts.
            {USE_MOCK ? '\n\nWeb preview: showing sample data (foreUP blocks browser requests).' : ''}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------- small components ----------

/** Tapping a notification opens the booking page. Native only. */
function NotificationTapHandler() {
  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const url = lastResponse?.notification.request.content.data?.url;
    if (typeof url === 'string' && lastResponse?.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
      WebBrowser.openBrowserAsync(url);
      Notifications.clearLastNotificationResponseAsync();
    }
  }, [lastResponse]);
  return null;
}

function Label({ children }: { children: string }) {
  return <Text style={s.label}>{children}</Text>;
}

function StatusPill({
  enabled,
  result,
  now,
  checking,
}: {
  enabled: boolean;
  result: CheckResult | null;
  now: number;
  checking: boolean;
}) {
  let text = 'Paused';
  if (checking) text = 'Checking…';
  else if (enabled && result) {
    const mins = Math.floor((now - result.checkedAt) / 60_000);
    text = mins < 1 ? 'Watching · just now' : `Watching · ${mins}m ago`;
  } else if (enabled) text = 'Watching';
  return (
    <View style={[s.pill, enabled && s.pillOn]}>
      <View style={[s.dot, enabled && s.dotOn]} />
      <Text style={[s.pillText, enabled && { color: C.green }]}>{text}</Text>
    </View>
  );
}

function DayChip({ iso, on, onPress }: { iso: string; on: boolean; onPress: () => void }) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const isToday = iso === bookableDates()[0];
  return (
    <Pressable onPress={onPress} style={[s.chip, on && s.chipOn]}>
      <Text style={[s.chipDow, on && s.chipTextOn]}>
        {isToday ? 'Today' : date.toLocaleDateString('en-US', { weekday: 'short' })}
      </Text>
      <Text style={[s.chipDay, on && s.chipTextOn]}>{d}</Text>
    </Pressable>
  );
}

function Stepper({ value, onMinus, onPlus }: { value: string; onMinus: () => void; onPlus: () => void }) {
  return (
    <View style={s.stepper}>
      <Pressable onPress={onMinus} hitSlop={6} style={s.stepBtn}>
        <Text style={s.stepIcon}>−</Text>
      </Pressable>
      <Text style={s.stepValue} numberOfLines={1}>
        {value}
      </Text>
      <Pressable onPress={onPlus} hitSlop={6} style={s.stepBtn}>
        <Text style={s.stepIcon}>+</Text>
      </Pressable>
    </View>
  );
}

// ---------- styles ----------

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 20, paddingBottom: 48, gap: 16 },

  header: { marginTop: 8, marginBottom: 4 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  eyebrow: { fontSize: 11, letterSpacing: 1.4, color: C.muted, fontWeight: '600' },
  title: { fontSize: 34, fontWeight: '700', color: C.ink, letterSpacing: -0.8, marginTop: 2 },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
  },
  pillOn: { backgroundColor: C.greenSoft, borderColor: C.greenSoft },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#B9BDB8' },
  dotOn: { backgroundColor: '#2E9B5F' },
  pillText: { fontSize: 12, fontWeight: '600', color: C.muted },

  card: {
    backgroundColor: C.card,
    borderRadius: 18,
    padding: 16,
    shadowColor: '#1E2A22',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  label: { fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 10 },
  divider: { height: 1, backgroundColor: C.line, marginVertical: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  and: { color: C.muted, fontSize: 13 },

  chips: { gap: 8, paddingRight: 4 },
  chip: {
    width: 54,
    paddingVertical: 10,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: C.bg,
  },
  chipOn: { backgroundColor: C.green },
  chipDow: { fontSize: 11, fontWeight: '600', color: C.muted },
  chipDay: { fontSize: 18, fontWeight: '700', color: C.ink, marginTop: 2 },
  chipTextOn: { color: '#fff' },

  stepper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.bg,
    borderRadius: 12,
    paddingHorizontal: 4,
    height: 44,
  },
  stepBtn: { width: 28, height: 34, alignItems: 'center', justifyContent: 'center' },
  stepIcon: { fontSize: 20, color: C.green, fontWeight: '500' },
  stepValue: { flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '600', color: C.ink, fontVariant: ['tabular-nums'] },

  segment: { flexDirection: 'row', backgroundColor: C.bg, borderRadius: 12, padding: 3 },
  segItem: { flex: 1, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  segItemOn: {
    backgroundColor: C.card,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  segText: { fontSize: 15, fontWeight: '600', color: C.muted },
  segTextOn: { color: C.ink },

  cta: { height: 54, borderRadius: 16, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  ctaStop: { backgroundColor: C.greenSoft },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  section: { fontSize: 20, fontWeight: '700', color: C.ink, letterSpacing: -0.3 },
  count: {
    fontSize: 12,
    fontWeight: '700',
    color: C.green,
    backgroundColor: C.greenSoft,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
  },
  error: { color: C.danger, fontSize: 13 },

  empty: { alignItems: 'center', paddingVertical: 28 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: C.ink },
  emptyBody: { fontSize: 14, color: C.muted, marginTop: 6, textAlign: 'center' },

  slot: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  slotBorder: { borderTopWidth: 1, borderTopColor: C.line },
  slotTime: { fontSize: 17, fontWeight: '700', color: C.ink, fontVariant: ['tabular-nums'] },
  newBadge: { fontSize: 11, fontWeight: '800', color: C.sand, letterSpacing: 0.8 },
  slotMeta: { fontSize: 13, color: C.muted, marginTop: 2 },
  book: { fontSize: 15, fontWeight: '600', color: C.green },

  footer: { alignItems: 'center', gap: 10, marginTop: 8 },
  link: { color: C.green, fontWeight: '600', fontSize: 14 },
  fine: { color: C.muted, fontSize: 12, textAlign: 'center', lineHeight: 17, maxWidth: 320 },
});
