/**
 * The bottom tab bar. Icons come from the shared Icon vocabulary (grid/search/stack/desktop) so the
 * chrome speaks one hand-drawn language, and the sliding pill is the per-tab colour legend driven from
 * theme.tabHue (library/albums -> violet, search/desktop -> cyan). To keep the hue from snapping as the
 * pill slides, TWO stacked pill layers (violet + cyan, each with its own glow) share the same spring
 * translateX and cross-fade OPACITY toward the active tab's hue — a native-driver-safe colour morph.
 * The active glyph takes its hue, sits over a soft glow disc, and scale-pops on activation. All motion is
 * native-driven Animated and honours Reduce Motion (opacity + slide both snap).
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions, Easing } from 'react-native';
import { BlurView } from 'expo-blur';
import { palette, tint, tabHue, glowSm, glowMd, space, radius, typography, spring, tintFill, tintBorder } from './theme';
import { Springy, useReducedMotion, useReduceTransparency } from './motion';
import { Icon, type IconName } from './Icon';
import { useInsets } from './insets';

const SCREEN_W = Dimensions.get('window').width;
const PILL_W = 58;
const PILL_H = 34;

export type Tab = 'library' | 'collections' | 'search' | 'albums' | 'desktop';

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'library', label: 'Library', icon: 'grid' },
  { key: 'collections', label: 'For You', icon: 'spark' },
  { key: 'search', label: 'Search', icon: 'search' },
  { key: 'albums', label: 'Albums', icon: 'stack' },
  { key: 'desktop', label: 'Desktop', icon: 'desktop' },
];

const TAB_W = SCREEN_W / TABS.length;

// The two hue families the pill morphs between, routed through theme.tabHue (no colour literals).
const VIOLET = tabHue.library; // library + albums
const CYAN = tabHue.search; // search + desktop

/** One tab: hand-drawn glyph + label, coloured by its hue when active, with a glow disc + scale-pop. */
function TabButton({
  tabKey,
  label,
  iconName,
  active,
  onPress,
  reduced,
}: {
  tabKey: Tab;
  label: string;
  iconName: IconName;
  active: boolean;
  onPress: () => void;
  reduced: boolean;
}) {
  const hue = tabHue[tabKey];
  const color = active ? hue : palette.sub;
  const pop = useRef(new Animated.Value(1)).current;
  const mounted = useRef(false);

  useEffect(() => {
    // Pop only on activation transitions, never on first mount.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!active) return;
    if (reduced) {
      pop.setValue(1);
      return;
    }
    pop.setValue(1);
    Animated.sequence([
      Animated.timing(pop, { toValue: 1.18, duration: 130, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(pop, { toValue: 1, duration: 170, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [active, reduced, pop]);

  return (
    <Springy
      onPress={onPress}
      pressableStyle={styles.tab}
      style={styles.tabInner}
      scaleTo={0.86}
      hitSlop={6}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
    >
      <Animated.View style={[styles.iconWrap, { transform: [{ scale: pop }] }]}>
        {active ? (
          <View
            pointerEvents="none"
            style={[styles.glowDisc, { backgroundColor: tint(hue, tintFill.active) }, glowSm(hue)]}
          />
        ) : null}
        <Icon name={iconName} size={22} color={color} strokeWidth={2} />
      </Animated.View>
      <Text maxFontSizeMultiplier={1.2} style={[styles.label, { color }]}>
        {label}
      </Text>
    </Springy>
  );
}

export function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const insets = useInsets();
  const reduced = useReducedMotion();
  // Liquid-Glass material: a real expo-blur backdrop under a translucent scrim, instead of the flat
  // opaque bar. Honours Reduce Transparency — when on, we drop the blur back to the solid colour so the
  // frosted material never fights the accessibility setting (there's nothing left to see through).
  const reduceTransparency = useReduceTransparency();
  const idx = Math.max(0, TABS.findIndex((t) => t.key === active));
  const anim = useRef(new Animated.Value(idx)).current;
  useEffect(() => {
    if (reduced) {
      anim.setValue(idx);
      return;
    }
    Animated.spring(anim, { toValue: idx, useNativeDriver: true, ...spring.slide }).start();
  }, [idx, anim, reduced]);
  const range = TABS.map((_, i) => i);
  const translateX = anim.interpolate({
    inputRange: range,
    outputRange: range.map((i) => i * TAB_W + (TAB_W - PILL_W) / 2),
  });

  // Cross-fade driver: 0 = violet family (library/albums), 1 = cyan family (search/desktop). Springs in
  // lockstep with the translateX slide so the pill's colour morphs as it travels. Opacity is native-safe.
  const activeIsCyan = tabHue[active] === CYAN;
  const hueAnim = useRef(new Animated.Value(activeIsCyan ? 1 : 0)).current;
  useEffect(() => {
    const target = activeIsCyan ? 1 : 0;
    if (reduced) {
      hueAnim.setValue(target);
      return;
    }
    Animated.spring(hueAnim, { toValue: target, useNativeDriver: true, ...spring.slide }).start();
  }, [activeIsCyan, hueAnim, reduced]);
  const violetOpacity = hueAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0], extrapolate: 'clamp' });
  const cyanOpacity = hueAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });

  const hue = tabHue[active];

  return (
    <View
      accessibilityRole="tablist"
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.md), borderTopColor: tint(hue, 0.22) }]}
    >
      {/* Frosted backdrop behind everything (pills/glyphs render over it). Opaque fallback under Reduce
          Transparency. Both are pointerEvents="none" so taps pass through to the tab buttons. */}
      {reduceTransparency ? (
        <View pointerEvents="none" style={[styles.fill, styles.opaqueBar]} />
      ) : (
        <>
          <BlurView pointerEvents="none" tint="dark" intensity={40} style={styles.fill} />
          <View pointerEvents="none" style={[styles.fill, styles.glassScrim]} />
        </>
      )}
      {/* Two stacked pills share translateX; their opacities cross-fade so the hue morphs, never snaps. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.pill,
          { backgroundColor: tint(VIOLET, tintFill.active), borderColor: tint(VIOLET, tintBorder.active), opacity: violetOpacity, transform: [{ translateX }] },
          glowMd(VIOLET),
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.pill,
          { backgroundColor: tint(CYAN, tintFill.active), borderColor: tint(CYAN, tintBorder.active), opacity: cyanOpacity, transform: [{ translateX }] },
          glowMd(CYAN),
        ]}
      />
      {TABS.map((t) => (
        <TabButton
          key={t.key}
          tabKey={t.key}
          label={t.label}
          iconName={t.icon}
          active={t.key === active}
          onPress={() => onChange(t.key)}
          reduced={reduced}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: 8, // seats the glyph flush in the top:8 pill
    // Background is the frosted BlurView layer below; borderTopColor + paddingBottom are set inline
    // (per-tab hue + responsive safe-area inset). The bar stays IN-FLOW (not a floating overlay) so it
    // never covers a screen's bottom-anchored UI (e.g. the Library select-mode action bar).
  },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  opaqueBar: { backgroundColor: palette.barBase },
  // A translucent dark scrim over the blur so the glyph labels stay legible on any backdrop.
  glassScrim: { backgroundColor: 'rgba(14,14,23,0.55)' },
  pill: {
    position: 'absolute',
    top: 8,
    left: 0,
    width: PILL_W,
    height: PILL_H,
    borderRadius: radius.input,
    borderWidth: 1,
    // backgroundColor + borderColor set inline from the active tab hue (colour legend).
  },
  tab: { flex: 1 },
  tabInner: { alignItems: 'center', gap: 4, paddingTop: 2 },
  iconWrap: { width: 46, height: 30, alignItems: 'center', justifyContent: 'center' },
  glowDisc: { position: 'absolute', top: -2, left: 6, width: 34, height: 34, borderRadius: 17 },
  label: { ...typography.caption, fontWeight: '700' }, // caption rung (11/0.2); keep 700, dynamic color inline
});
