/**
 * Shared screen header: a bold large title + optional kicker/meta over a slow living-colour wash.
 * Used by every top-level tab AND every drill-in (via `back`) so the vivid chrome is consistent at
 * every depth. Optional `scrollY` parallaxes the wash and shrinks/dims the title as the grid scrolls
 * (transform + opacity only — header height never animates, which would be JS-driven jank).
 */
import React from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { palette, typography } from './theme';
import { LivingGradient, useReducedMotion } from './motion';
import { Icon } from './Icon';
import { Springy } from './motion';

// Chrome text (kicker / meta / back) reads best in the SOFT sibling of the header's hue — never at
// full saturation over the living gradient. Map a full accent to its soft variant; anything already
// soft, or an unmapped colour, passes through unchanged. This is what makes a cyan Search / magenta
// header render soft-cyan / soft-magenta text instead of the default soft-violet.
const SOFT: Record<string, string> = {
  [palette.accent]: palette.accentSoft,
  [palette.cyan]: palette.cyanSoft,
  [palette.magenta]: palette.magentaSoft,
};

export function ScreenHeader({
  title,
  meta,
  kicker,
  gradient,
  accent = palette.accentSoft,
  right,
  back,
  scrollY,
}: {
  title: string;
  meta?: string;
  kicker?: string;
  gradient?: readonly [string, string];
  accent?: string;
  right?: React.ReactNode;
  back?: { label: string; onPress: () => void };
  scrollY?: Animated.Value;
}) {
  const reduced = useReducedMotion();
  // Soften the chrome-text hue (kicker/meta/back) to match the header's gradient without full saturation.
  const textAccent = SOFT[accent] ?? accent;
  // Honour Reduce Motion: disable scroll-driven shrink/parallax entirely.
  const titleAnim = scrollY && !reduced
    ? {
        opacity: scrollY.interpolate({ inputRange: [0, 90], outputRange: [1, 0.72], extrapolate: 'clamp' as const }),
        transform: [
          { scale: scrollY.interpolate({ inputRange: [0, 90], outputRange: [1, 0.92], extrapolate: 'clamp' as const }) },
          { translateY: scrollY.interpolate({ inputRange: [0, 90], outputRange: [0, -4], extrapolate: 'clamp' as const }) },
        ],
      }
    : undefined;
  const bandParallax = scrollY && !reduced
    ? { transform: [{ translateY: scrollY.interpolate({ inputRange: [0, 140], outputRange: [0, -34], extrapolate: 'clamp' as const }) }] }
    : undefined;

  return (
    <View style={styles.wrap}>
      {gradient ? (
        <Animated.View style={bandParallax}>
          <LivingGradient colors={gradient} height={back ? 150 : 140} />
        </Animated.View>
      ) : null}
      {back ? (
        <Springy
          onPress={back.onPress}
          hitSlop={14}
          pressableStyle={styles.backRow}
          accessibilityLabel={back.label}
          accessibilityHint="Goes back"
        >
          <Icon name="chevron" size={16} color={textAccent} strokeWidth={2} style={styles.backChevron} />
          <Text style={[styles.backText, { color: textAccent }]}>{back.label}</Text>
        </Springy>
      ) : null}
      <View style={styles.row}>
        <Animated.View style={[styles.titleCol, titleAnim]}>
          {kicker ? (
            <Text maxFontSizeMultiplier={1.4} style={[styles.kicker, { color: textAccent }]} numberOfLines={1}>
              {kicker}
            </Text>
          ) : null}
          <Text maxFontSizeMultiplier={1.4} style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {meta ? (
            <Text maxFontSizeMultiplier={1.4} style={[styles.meta, { color: textAccent }]} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </Animated.View>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingBottom: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  titleCol: { flex: 1 },
  right: { paddingBottom: 4, marginLeft: 12 },
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  backChevron: { transform: [{ rotate: '180deg' }] },
  backText: { fontSize: 15, fontWeight: '700', marginLeft: 2 },
  kicker: { ...typography.kicker, marginBottom: 2 },
  title: { ...typography.largeTitle, color: palette.text },
  meta: { ...typography.meta, marginTop: 2, fontVariant: ['tabular-nums'] },
});
