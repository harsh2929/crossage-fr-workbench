/**
 * Settings — the app's account/settings surface (Apple Photos hangs its settings off the avatar menu;
 * we surface a proper Settings screen from the Albums tab). All on-device: reset the first-run tips,
 * clear the recent-search history, jump to the iOS photo-permission screen, and read the live
 * accessibility state. No cloud, no telemetry.
 */
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, ScrollView, StyleSheet, Linking, AppState, Alert, Platform, PixelRatio } from 'react-native';
import { usePermissions, presentPermissionsPickerAsync } from 'expo-media-library';
import { palette, radius, grad, typography, hairline, space } from './theme';
import { Icon } from './Icon';
import { Springy, LivingGradient, useReducedMotion, useReduceTransparency } from './motion';
import { getPref, setPref, clearSearchHistory, recentSearches, clearPrefsByPrefix } from './replica';
import { toast } from './Toast';
import { useInsets } from './insets';

function Row({
  label,
  value,
  onPress,
  danger,
  destructiveHint,
  checked,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  destructiveHint?: string;
  checked?: boolean;
}) {
  const body = (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, danger && { color: palette.danger }]}>{label}</Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {onPress ? <Icon name="chevron" size={14} color={palette.muted} style={styles.rowChevron} /> : null}
    </View>
  );
  return onPress ? (
    <Springy
      onPress={onPress}
      pressableStyle={styles.rowPress}
      accessibilityLabel={label}
      accessibilityHint={destructiveHint}
      accessibilityRole={checked === undefined ? 'button' : 'switch'}
      accessibilityState={checked === undefined ? undefined : { checked }}
      accessibilityValue={checked === undefined && value ? { text: value } : undefined}
    >
      {body}
    </Springy>
  ) : (
    <View style={styles.rowPress} accessible accessibilityLabel={value ? label + ', ' + value : label}>
      {body}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

export function SettingsScreen({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useInsets();
  const [permission, , getPermission] = usePermissions();
  const reducedMotion = useReducedMotion();
  const reduceTransparency = useReduceTransparency();
  const [recentCount, setRecentCount] = useState(0);
  // Live Dynamic Type factor: iOS scales every RN <Text> by this unless a cap opts out. 1.0 = default,
  // >1 = the user enlarged text (incl. the accessibility "Larger Text" sizes). Read like the toggles below.
  const [fontScale, setFontScale] = useState(() => PixelRatio.getFontScale());
  // Master "Show Featured Content" switch (Apple's Settings ▸ Photos toggle). ON unless explicitly '0'.
  // When off, Memories + Featured Photos are suppressed everywhere (Library strip + the For You tab).
  const [featuredOn, setFeaturedOn] = useState(() => getPref('features.featuredContent') !== '0');

  useEffect(() => {
    if (!visible) return;
    try {
      setRecentCount(recentSearches(50).length);
    } catch {
      setRecentCount(0);
    }
    setFontScale(PixelRatio.getFontScale()); // re-read the text-size setting each time the panel opens
    getPermission?.().catch(() => {}); // refresh the permission status each time the panel opens
  }, [visible, getPermission]);

  // Permissions AND the text-size setting can change while we're in iOS Settings — re-read them when the
  // app returns to foreground so both status rows stay honest.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        getPermission?.().catch(() => {});
        setFontScale(PixelRatio.getFontScale());
      }
    });
    return () => sub.remove();
  }, [getPermission]);

  // Photo-library access level. NOTE: iOS's *restricted* status (a Screen Time / MDM lock) is not
  // surfaced — expo-media-library's native layer maps PHAuthorizationStatus.restricted to "denied", so
  // a 3rd-party app has no JS signal to distinguish it from a plain denial (see gap 331, blocked).
  const access =
    permission?.accessPrivileges === 'all'
      ? 'Full'
      : permission?.accessPrivileges === 'limited'
        ? 'Limited'
        : permission?.granted
          ? 'Granted'
          : 'None';

  // Round to one decimal for a readable badge (e.g. 1.3×). The accessibility sizes go well past 2×.
  const roundedScale = Math.round(fontScale * 10) / 10;
  const largerText =
    roundedScale > 1 ? `${roundedScale}× (following iOS)` : roundedScale < 1 ? `${roundedScale}× (smaller)` : 'Default';
  // Notes carry a fixed lineHeight for their look at 1×; scale it with the font so lines don't overlap or
  // clip once the user enlarges text (RN doesn't auto-scale a numeric lineHeight the way it scales fontSize).
  const noteStyle = [styles.note, { lineHeight: 17 * fontScale }];

  const resetTips = () => {
    try {
      setPref('coach.search', '');
      setPref('coach.desktop', '');
      toast({ text: 'Tips reset — they’ll show again on Library', tone: 'brand' });
    } catch {
      /* prefs unavailable */
    }
  };
  const clearHistory = () => {
    try {
      clearSearchHistory();
      setRecentCount(0);
      toast({ text: 'Recent searches cleared', tone: 'brand' });
    } catch {
      /* history unavailable */
    }
  };
  // Flip the master Featured-Content switch. The screens that render Memories/Featured read this pref in
  // render, so the change takes on their next render (they remount on tab switch) — no plumbing needed.
  const toggleFeatured = () => {
    const next = !featuredOn;
    setFeaturedOn(next);
    try {
      setPref('features.featuredContent', next ? '1' : '0');
      toast({ text: next ? 'Featured Content on' : 'Featured Content off', tone: 'brand' });
    } catch {
      /* prefs unavailable — keep the in-memory toggle so this session stays consistent */
    }
  };

  // Reset every app-local Memories override — custom titles/subtitles/covers, manual reorder, hidden
  // photos, and the chosen photo mix — all of which live under the "memory." pref namespace. Memories
  // themselves are recomputed each launch, so wiping just the overrides IS the reset. (There's no
  // People/Pets suggestion data on device to reset.) Confirmed first because it's destructive.
  const resetMemories = () => {
    const run = () => {
      try {
        const removed = clearPrefsByPrefix('memory.');
        toast({
          text: removed > 0 ? 'Suggested Memories reset' : 'No Memory customizations to reset',
          tone: 'brand',
        });
      } catch {
        toast({ text: 'Couldn’t reset Memories', tone: 'danger' });
      }
    };
    // Alert with a destructive action button is the iOS confirm pattern (see AlbumsScreen); on other
    // platforms just run it so the affordance still works.
    if (Platform.OS === 'ios') {
      Alert.alert(
        'Reset Suggested Memories',
        'This clears your custom Memory titles, covers, order, and hidden photos. Memories rebuild automatically.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Reset', style: 'destructive', onPress: run },
        ],
      );
    } else {
      run();
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root} accessibilityViewIsModal onAccessibilityEscape={onClose}>
        <View style={styles.header}>
          <LivingGradient colors={grad.brand} height={130} />
          <View style={[styles.headerRow, { paddingTop: insets.top + 8 }]}>
            <Springy onPress={onClose} hitSlop={16} pressableStyle={styles.back} accessibilityLabel="Close settings">
              <Icon name="chevron" size={16} color={palette.accentSoft} style={{ transform: [{ rotate: '180deg' }] }} />
              <Text style={styles.backText}>Done</Text>
            </Springy>
          </View>
          <Text style={styles.title} accessibilityRole="header">Settings</Text>
        </View>

        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}>
          <Section title="Tips & Suggestions">
            <Row label="Reset tips" destructiveHint="Shows the get-started tips again" onPress={resetTips} />
            <Row label="Clear recent searches" value={recentCount > 0 ? String(recentCount) : undefined} onPress={clearHistory} />
            <Row
              label="Reset Suggested Memories"
              destructiveHint="Clears your Memory titles, covers, order, and hidden photos"
              onPress={resetMemories}
            />
            <Text style={noteStyle}>
              Resetting only clears your own Memory edits — the Memories themselves rebuild automatically each launch.
            </Text>
          </Section>

          <Section title="Featured Content">
            <Row
              label="Show Featured Content"
              value={featuredOn ? 'On' : 'Off'}
              onPress={toggleFeatured}
              checked={featuredOn}
              destructiveHint="Turns Memories and Featured Photos on or off across the app"
            />
            <Text style={noteStyle}>
              The master switch for Memories and Featured Photos. Turn it off to hide the For You tab’s
              suggestions and the Library’s Memories strip — everything stays on your device either way.
            </Text>
          </Section>

          <Section title="Photo Access">
            <Row label="Library access" value={access} />
            {permission?.accessPrivileges === 'limited' ? (
              // iOS Limited Library: let the user add more photos to the app-visible selection without
              // leaving the app (PHPhotoLibrary limited-library picker), then refresh the access badge.
              <Row
                label="Select more photos…"
                destructiveHint="Choose which photos Vintrace can access"
                onPress={() => {
                  presentPermissionsPickerAsync()
                    .then(() => getPermission?.())
                    .catch(() => {});
                }}
              />
            ) : null}
            <Row label="Open iOS Settings" onPress={() => Linking.openSettings().catch(() => {})} />
          </Section>

          <Section title="Accessibility">
            <Row label="Reduce Motion" value={reducedMotion ? 'On' : 'Off'} />
            <Row label="Reduce Transparency" value={reduceTransparency ? 'On' : 'Off'} />
            <Row label="Larger Text" value={largerText} />
            <Text style={noteStyle}>
              These follow your iOS settings — including text size. The app respects them automatically, so this
              screen scales with your Larger Text setting.
            </Text>
          </Section>

          <Section title="About">
            <Row label="Vintrace Mobile" value="0.1" />
            <Row label="Data" value="On-device · offline" />
            <Text style={noteStyle}>
              Your library, search index, and favorites stay on this device. Face recognition is computed by your
              paired desktop, never in the cloud.
            </Text>
          </Section>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  header: { paddingHorizontal: 16, paddingBottom: 12, overflow: 'hidden' },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.sm },
  backText: { ...typography.body, fontWeight: '700', color: palette.accentSoft },
  title: { color: palette.text, ...typography.largeTitle },

  scroll: { padding: 16, gap: 4 },
  section: { marginBottom: 20 },
  sectionTitle: {
    color: palette.sub,
    ...typography.kicker,
    marginLeft: space.sm,
    marginBottom: 8,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: hairline,
    overflow: 'hidden',
  },
  rowPress: { borderBottomColor: hairline, borderBottomWidth: StyleSheet.hairlineWidth },
  // paddingVertical + minHeight (no fixed height): rows grow with scaled text instead of clipping it.
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 16, paddingVertical: space.md },
  rowLabel: { color: palette.text, ...typography.body, flex: 1 },
  // flexShrink + right-align lets a longer status value (e.g. the Larger Text badge) wrap instead of overflowing.
  rowValue: { color: palette.sub, ...typography.body, flexShrink: 1, textAlign: 'right', marginLeft: 8 },
  rowChevron: { marginLeft: 8 },
  // lineHeight is applied inline (scaled by the live font factor); it's omitted here so it never caps growth.
  note: { color: palette.sub, ...typography.meta, paddingHorizontal: 16, paddingVertical: 12 },
});
