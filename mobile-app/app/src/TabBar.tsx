/**
 * The bottom tab bar. Icons are drawn from plain Views (no icon-library dependency, so no native
 * rebuild) which keeps them crisply tintable for the active/inactive states. Active tab gets the
 * accent colour plus a soft highlight pill behind its glyph.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions } from 'react-native';
import { palette, tint } from './theme';
import { Springy } from './motion';

const SCREEN_W = Dimensions.get('window').width;
const PILL_W = 58;
const PILL_H = 34;

export type Tab = 'library' | 'search' | 'albums' | 'desktop';

function GridIcon({ color }: { color: string }) {
  return (
    <View style={icon.grid}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={[icon.gridDot, { backgroundColor: color }]} />
      ))}
    </View>
  );
}

function SearchIcon({ color }: { color: string }) {
  return (
    <View style={icon.searchWrap}>
      <View style={[icon.lens, { borderColor: color }]} />
      <View style={[icon.handle, { backgroundColor: color }]} />
    </View>
  );
}

function StackIcon({ color }: { color: string }) {
  return (
    <View style={icon.stack}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[icon.bar, { backgroundColor: color }]} />
      ))}
    </View>
  );
}

function DesktopIcon({ color }: { color: string }) {
  return (
    <View style={icon.deskWrap}>
      <View style={[icon.screen, { borderColor: color }]} />
      <View style={[icon.stand, { backgroundColor: color }]} />
    </View>
  );
}

const TABS: { key: Tab; label: string; Icon: React.ComponentType<{ color: string }> }[] = [
  { key: 'library', label: 'Library', Icon: GridIcon },
  { key: 'search', label: 'Search', Icon: SearchIcon },
  { key: 'albums', label: 'Albums', Icon: StackIcon },
  { key: 'desktop', label: 'Desktop', Icon: DesktopIcon },
];

const TAB_W = SCREEN_W / TABS.length;

export function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const idx = Math.max(0, TABS.findIndex((t) => t.key === active));
  const anim = useRef(new Animated.Value(idx)).current;
  useEffect(() => {
    Animated.spring(anim, { toValue: idx, useNativeDriver: true, speed: 18, bounciness: 11 }).start();
  }, [idx, anim]);
  const range = TABS.map((_, i) => i);
  const translateX = anim.interpolate({
    inputRange: range,
    outputRange: range.map((i) => i * TAB_W + (TAB_W - PILL_W) / 2),
  });

  return (
    <View style={styles.bar}>
      <Animated.View style={[styles.pill, { transform: [{ translateX }] }]} />
      {TABS.map(({ key, label, Icon }) => {
        const on = key === active;
        const color = on ? palette.accentSoft : palette.muted;
        return (
          <Springy
            key={key}
            onPress={() => onChange(key)}
            pressableStyle={styles.tab}
            style={styles.tabInner}
            scaleTo={0.86}
            hitSlop={6}
          >
            <View style={styles.iconWrap}>
              <Icon color={color} />
            </View>
            <Text style={[styles.label, { color }]}>{label}</Text>
          </Springy>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: '#0e0e17',
    borderTopColor: tint(palette.accent, 0.2),
    borderTopWidth: 1,
    paddingTop: 10,
    paddingBottom: 28, // clears the home indicator
  },
  pill: {
    position: 'absolute',
    top: 8,
    left: 0,
    width: PILL_W,
    height: PILL_H,
    borderRadius: 14,
    backgroundColor: tint(palette.accent, 0.2),
    borderWidth: 1,
    borderColor: tint(palette.accent, 0.35),
  },
  tab: { flex: 1 },
  tabInner: { alignItems: 'center', gap: 4, paddingTop: 2 },
  iconWrap: { width: 46, height: 30, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11, fontWeight: '700' },
});

const icon = StyleSheet.create({
  grid: { width: 16, height: 16, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  gridDot: { width: 6.5, height: 6.5, borderRadius: 2, marginBottom: 3 },
  searchWrap: { width: 18, height: 18, alignItems: 'flex-start', justifyContent: 'flex-start' },
  lens: { width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  handle: {
    position: 'absolute',
    right: 1,
    bottom: 1,
    width: 6,
    height: 2,
    borderRadius: 1,
    transform: [{ rotate: '45deg' }],
  },
  stack: { width: 16, height: 16, justifyContent: 'center', gap: 3 },
  bar: { width: 16, height: 3, borderRadius: 1.5 },
  deskWrap: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  screen: { width: 17, height: 12, borderRadius: 2.5, borderWidth: 2 },
  stand: { width: 7, height: 2, borderRadius: 1, marginTop: 1.5 },
});
