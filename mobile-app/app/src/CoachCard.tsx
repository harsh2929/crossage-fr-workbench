/**
 * CoachCard — the first-run "get started" strip on Library: a dismissible horizontal row of up to two
 * small living-gradient coach cards that point a new user at the app's two non-obvious powers —
 * on-device semantic Search and the desktop uplink. Each card is a vivid chrome band (LivingGradient +
 * icon + title + one-line hint) that taps through to its tab, with a ✕ that dismisses it for good.
 *
 * Dismissal is durable per-card in the encrypted replica's prefs (keys `coach.search` / `coach.desktop`
 * set to '1'), so a card never returns once acknowledged. The desktop card also hides itself once a
 * desktop connection exists — there's nothing left to coach. When every applicable card is gone the
 * whole strip renders nothing, so it costs zero space for returning users.
 *
 * Replica reads/writes are guarded: a prefs/connection hiccup degrades to "show the card" (or an empty
 * strip) rather than throwing into Library's render.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Dimensions } from 'react-native';
import { Springy, LivingGradient } from './motion';
import { Icon, type IconName } from './Icon';
import { palette, grad, glowMd, radius, tint, typography, tintFill, tintBorder, discScrim } from './theme';
import { getPref, setPref, loadDesktopConnection } from './replica';

type Tab = 'library' | 'search' | 'albums' | 'desktop';

interface Coach {
  key: 'search' | 'desktop';
  prefKey: string;
  tab: Tab;
  icon: IconName;
  gradient: readonly [string, string];
  accent: string;
  title: string;
  hint: string;
}

const CARDS: Coach[] = [
  {
    key: 'search',
    prefKey: 'coach.search',
    tab: 'search',
    icon: 'spark',
    gradient: grad.search,
    accent: palette.cyan,
    title: "Search by what's in them",
    hint: 'Find photos by objects, scenes and moments — computed on device.',
  },
  {
    key: 'desktop',
    prefKey: 'coach.desktop',
    tab: 'desktop',
    icon: 'desktop',
    gradient: grad.desktop,
    accent: palette.cyan,
    title: 'Connect your desktop',
    hint: 'Pair to browse your full catalog and recognize the people in it.',
  },
];

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = Math.round(Math.min(SCREEN_W - 72, 360));
// Trimmed 96 → 88: a little vertical budget back for the grid without cramping the two-line hint.
const CARD_H = 88;
const GAP = 12;

/** Read a card's durable dismissal flag; a prefs failure is treated as "not dismissed". */
function isDismissed(prefKey: string): boolean {
  try {
    return getPref(prefKey) === '1';
  } catch {
    return false;
  }
}

/** Whether a desktop is already paired — if so, the desktop coach card has nothing to teach. */
function hasDesktopConnection(): boolean {
  try {
    return loadDesktopConnection() != null;
  } catch {
    return false;
  }
}

function CoachTile({ card, onOpen, onDismiss }: { card: Coach; onOpen: () => void; onDismiss: () => void }) {
  return (
    <View style={[styles.card, glowMd(card.gradient[0])]}>
      <LivingGradient colors={card.gradient} height={CARD_H} />
      {/* Contrast scrim — a light uniform darkening between the living gradient and the text so the
          12pt hint / 16pt title stay AA-legible even over the gradient's bright orbs. The hue stays
          fully visible (this only deepens it); pointerEvents none so the body tap-through is unaffected. */}
      <View pointerEvents="none" style={styles.scrim} />
      {/* Main body taps through to the tab. */}
      <Springy
        onPress={onOpen}
        scaleTo={0.97}
        pressableStyle={styles.body}
        accessibilityLabel={`${card.title}. ${card.hint}`}
        accessibilityHint={`Opens the ${card.tab} tab`}
      >
        <View style={styles.row}>
          <View style={[styles.disc, { backgroundColor: tint(card.accent, tintFill.active), borderColor: tint(card.accent, tintBorder.rest) }]}>
            <Icon name={card.icon} size={20} color="#ffffff" strokeWidth={2} />
          </View>
          <View style={styles.textCol}>
            <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {card.title}
            </Text>
            <Text style={styles.hint} numberOfLines={2} maxFontSizeMultiplier={1.3}>
              {card.hint}
            </Text>
          </View>
        </View>
      </Springy>
      {/* Dismiss ✕ — later sibling, so a corner tap dismisses instead of navigating. Absolute
          positioning goes on the Pressable (pressableStyle); the disc itself is the scaling view. */}
      <Springy
        onPress={onDismiss}
        hitSlop={14}
        scaleTo={0.86}
        pressableStyle={styles.dismissHit}
        style={styles.dismissDisc}
        accessibilityLabel={`Dismiss: ${card.title}`}
        accessibilityHint="Hides this tip"
      >
        <Icon name="close" size={12} color="rgba(255,255,255,0.92)" strokeWidth={2} />
      </Springy>
    </View>
  );
}

export function CoachCard({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  // Seed dismissals from durable prefs once; the desktop card additionally hides when already paired.
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const c of CARDS) if (isDismissed(c.prefKey)) s.add(c.key);
    return s;
  });
  const desktopPaired = useMemo(() => hasDesktopConnection(), []);

  const dismiss = (card: Coach) => {
    try {
      setPref(card.prefKey, '1');
    } catch {
      // Persisting the dismissal failed (rare); still hide it for this session so the tap feels honest.
    }
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(card.key);
      return next;
    });
  };

  const visible = CARDS.filter((c) => {
    if (dismissed.has(c.key)) return false;
    if (c.key === 'desktop' && desktopPaired) return false;
    return true;
  });

  if (visible.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.kicker}>Get started</Text>
      <FlatList
        data={visible}
        horizontal
        keyExtractor={(c) => c.key}
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_W + GAP}
        decelerationRate="fast"
        contentContainerStyle={styles.strip}
        renderItem={({ item }) => (
          <CoachTile card={item} onOpen={() => onNavigate(item.tab)} onDismiss={() => dismiss(item)} />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: 2, paddingBottom: 12 },
  scrim: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.22)' },
  kicker: {
    ...typography.kicker,
    color: palette.accentSoft,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  strip: { paddingHorizontal: 16, gap: GAP },
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: palette.cell,
  },
  body: { flex: 1, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingRight: 40 },
  disc: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  textCol: { flex: 1 },
  title: { color: palette.text, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  hint: { color: 'rgba(255,255,255,0.82)', fontSize: 12, fontWeight: '600', lineHeight: 16, marginTop: 2 },
  dismissHit: { position: 'absolute', top: 8, right: 8 },
  dismissDisc: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: discScrim,
  },
});
