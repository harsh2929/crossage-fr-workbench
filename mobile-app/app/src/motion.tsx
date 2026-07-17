/**
 * Reusable motion + chrome primitives — the app's "alive" layer, built entirely on React Native's
 * `Animated` (no reanimated/gesture-handler/linear-gradient, so it ships reload-only with no native
 * rebuild). Transform/opacity animations use the native driver; only width/layout is JS-driven.
 *
 * Living colour is confined to chrome (headers, hero, buttons, loaders, empty states) — never behind
 * photos. Every loop honours Reduce Motion: when it's on, animations hold a static mid-state so the
 * vivid colour survives but the drift stops (see useReducedMotion / useLoop).
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type AccessibilityRole,
  type AccessibilityState,
  type AccessibilityValue,
  type Insets,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { palette, tint, grad, glowMd, readableText, radius, spring, tintFill, dur } from './theme';
import { Icon } from './Icon';

/** True when the OS "Reduce Motion" setting is on. Drives every loop to hold static. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => mounted && setReduced(!!v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduced(!!v));
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/** True when the OS "Reduce Transparency" setting is on (iOS). Chrome should drop its translucency. */
export function useReduceTransparency(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceTransparencyEnabled?.()
      .then((v) => mounted && setOn(!!v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', (v) => setOn(!!v));
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return on;
}

/** A Pressable that springs its scale down on press-in for tactile feedback, and forwards a11y props. */
export function Springy({
  children,
  onPress,
  onLongPress,
  style,
  pressableStyle,
  disabled,
  hitSlop,
  scaleTo = 0.94,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = 'button',
  accessibilityState,
  accessibilityValue,
  accessibilityActions,
  onAccessibilityAction,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>; // visual style (scales with the content)
  pressableStyle?: StyleProp<ViewStyle>; // layout style on the Pressable (e.g. flex:1)
  disabled?: boolean;
  hitSlop?: number | Insets;
  scaleTo?: number;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  accessibilityValue?: AccessibilityValue;
  accessibilityActions?: ReadonlyArray<AccessibilityActionInfo>;
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) =>
    Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 9 }).start();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      hitSlop={hitSlop}
      style={pressableStyle}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={accessibilityState}
      accessibilityValue={accessibilityValue}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      onPressIn={() => !disabled && to(scaleTo)}
      onPressOut={() => to(1)}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

function useLoop(duration: number, easing = Easing.inOut(Easing.sin)) {
  const a = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) {
      a.setValue(0.5); // hold mid-state: colour stays, drift stops
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 1, duration, easing, useNativeDriver: true }),
        Animated.timing(a, { toValue: 0, duration, easing, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [a, duration, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  return a;
}

/** A soft pulsing accent orb — the "breathing" behind loaders and empty states. */
export function BreathingOrb({ size = 130, color = palette.accent }: { size?: number; color?: string }) {
  const a = useLoop(1700);
  const scale = a.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1.18] });
  const opacity = a.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.5] });
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity,
        transform: [{ scale }],
      }}
    />
  );
}

/** Gently floats its children up and down (for hero glyphs). */
export function FloatingView({
  children,
  amplitude = 6,
  period = 2600,
}: {
  children: React.ReactNode;
  amplitude?: number;
  period?: number;
}) {
  const a = useLoop(period); // default easing is now inOut(sin)
  const translateY = a.interpolate({ inputRange: [0, 1], outputRange: [-amplitude, amplitude] });
  return <Animated.View style={{ transform: [{ translateY }] }}>{children}</Animated.View>;
}

/**
 * A slow living colour wash for a header band — deepened: a flat base tint, three drifting orbs at
 * different depths/speeds, and a stacked fade to the neutral canvas at the bottom so the band melts
 * into the grid below. Confined to `height`; the parent clips.
 */
export function LivingGradient({
  colors = grad.brand,
  height = 190,
  style,
}: {
  colors?: readonly [string, string];
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const a = useLoop(11000);
  const b = useLoop(15000);
  const c = useLoop(9000);
  const t1x = a.interpolate({ inputRange: [0, 1], outputRange: [-50, 70] });
  const t1y = a.interpolate({ inputRange: [0, 1], outputRange: [-20, 30] });
  const t2x = b.interpolate({ inputRange: [0, 1], outputRange: [60, -60] });
  const t3x = c.interpolate({ inputRange: [0, 1], outputRange: [-30, 40] });
  const t3y = c.interpolate({ inputRange: [0, 1], outputRange: [10, -14] });
  return (
    <View
      pointerEvents="none"
      style={[{ position: 'absolute', top: 0, left: 0, right: 0, height, overflow: 'hidden' }, style]}
    >
      <View style={[StyleSheet.absoluteFill, { backgroundColor: tint(colors[0], 0.1) }]} />
      <Animated.View
        style={{
          position: 'absolute',
          top: -110,
          left: -70,
          width: 300,
          height: 300,
          borderRadius: 150,
          backgroundColor: tint(colors[0], 0.55),
          transform: [{ translateX: t1x }, { translateY: t1y }],
        }}
      />
      <Animated.View
        style={{
          position: 'absolute',
          top: -130,
          right: -60,
          width: 280,
          height: 280,
          borderRadius: 140,
          backgroundColor: tint(colors[1], 0.42),
          transform: [{ translateX: t2x }],
        }}
      />
      <Animated.View
        style={{
          position: 'absolute',
          top: height - 120,
          left: height * 0.3,
          width: 220,
          height: 220,
          borderRadius: 110,
          backgroundColor: tint(colors[1], 0.28),
          transform: [{ translateX: t3x }, { translateY: t3y }],
        }}
      />
      {/* stacked fade to the neutral canvas at the bottom edge */}
      {[0.18, 0.4, 0.7, 1].map((f, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: height * f,
            backgroundColor: palette.bg,
            opacity: 0.24, // melt the seam where a header wash meets the grid
          }}
        />
      ))}
    </View>
  );
}

/** A crafted loading state — a breathing accent orb behind a spinner + optional label. */
export function Loader({ label, color = palette.accent }: { label?: string; color?: string }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', minHeight: 120, gap: 14 }}>
      <View style={{ width: 96, height: 96, alignItems: 'center', justifyContent: 'center' }}>
        <BreathingOrb size={96} color={color} />
        <ActivityIndicator color={color} />
      </View>
      {label ? <Text style={{ color: palette.sub, fontSize: 15, textAlign: 'center' }}>{label}</Text> : null}
    </View>
  );
}

/** An animated progress bar (0..1). Width is JS-driven; keep it short-lived. */
export function ProgressBar({
  progress,
  color = palette.accent,
  height = 6,
}: {
  progress: number;
  color?: string;
  height?: number;
}) {
  const w = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(w, {
      toValue: Math.max(0, Math.min(1, progress)),
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progress, w]);
  const width = w.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: tint(color, tintFill.rest), overflow: 'hidden' }}>
      <Animated.View style={{ height, width, borderRadius: height / 2, backgroundColor: color }} />
    </View>
  );
}

/**
 * Reveal — fade + settle instead of a hard cut. Keeps children mounted (so layout is stable) and
 * animates opacity + a small translateY when `visible` flips. Used for viewer chrome, the info-panel
 * swap, and the Library selection bar.
 */
export function Reveal({
  visible,
  children,
  fromTranslateY = 8,
  duration = dur.base,
  style,
}: {
  visible: boolean;
  children: React.ReactNode;
  fromTranslateY?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const a = useRef(new Animated.Value(visible ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) {
      a.setValue(visible ? 1 : 0);
      return;
    }
    Animated.timing(a, {
      toValue: visible ? 1 : 0,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, reduced, a, duration]);
  const translateY = a.interpolate({ inputRange: [0, 1], outputRange: [fromTranslateY, 0] });
  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      // opacity:0 alone leaves the (invisible) children — e.g. a batch action bar's destructive
      // Delete — in VoiceOver's swipe order. Drop them from the a11y tree while hidden, matching the
      // pointerEvents gate. (RN: accessibilityElementsHidden = iOS, importantForAccessibility = Android.)
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      style={[style, { opacity: a, transform: [{ translateY }] }]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * RollingNumber — slides a numeric readout up/out and the new value in when it changes, instead of
 * snapping. The animated Views move (never the text string), so it stays on the native driver.
 * `allowFontScaling` is off to keep the clip height exact (numeric readouts are dense chrome).
 */
export function RollingNumber({
  value,
  fontSize = 15,
  style,
  duration = 260,
}: {
  value: number;
  fontSize?: number;
  style?: StyleProp<TextStyle>;
  duration?: number;
}) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const anim = useRef(new Animated.Value(0)).current;
  const h = Math.ceil(fontSize * 1.25);
  useEffect(() => {
    if (value === display) return;
    if (reduced) {
      setDisplay(value);
      return;
    }
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(
      ({ finished }) => {
        if (finished) {
          setDisplay(value);
          anim.setValue(0);
        }
      },
    );
  }, [value, display, reduced, anim, duration]);

  // tabular-nums keeps digit width fixed so the readout doesn't twitch as 1<->8 slide past
  const textStyle: StyleProp<TextStyle> = [{ fontSize, fontVariant: ['tabular-nums'] as const }, style];
  if (display === value) {
    return (
      <Text allowFontScaling={false} style={textStyle}>
        {String(value)}
      </Text>
    );
  }
  const outT = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -h] });
  const inT = anim.interpolate({ inputRange: [0, 1], outputRange: [h, 0] });
  return (
    <View style={{ height: h, overflow: 'hidden', justifyContent: 'center' }}>
      <Animated.Text
        allowFontScaling={false}
        style={[textStyle, { position: 'absolute', transform: [{ translateY: outT }], opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}
      >
        {String(display)}
      </Animated.Text>
      <Animated.Text
        allowFontScaling={false}
        style={[textStyle, { position: 'absolute', transform: [{ translateY: inT }], opacity: anim }]}
      >
        {String(value)}
      </Animated.Text>
    </View>
  );
}

/**
 * HeartPop — renders the favorite heart (filled/outline) and, when it becomes active, plays a
 * scale-pop + an expanding ring. Fires only on the false→true transition (never on mount).
 */
export function HeartPop({
  active,
  size = 26,
  color = palette.pink,
}: {
  active: boolean;
  size?: number;
  color?: string;
}) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!active || reduced) return;
    scale.setValue(1);
    ring.setValue(0);
    Animated.parallel([
      Animated.sequence([
        Animated.spring(scale, { toValue: 1.35, useNativeDriver: true, ...spring.pop }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, ...spring.settle }),
      ]),
      Animated.timing(ring, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [active, reduced, scale, ring]);
  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.9] });
  const ringOpacity = ring.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: color,
          opacity: ringOpacity,
          transform: [{ scale: ringScale }],
        }}
      />
      <Animated.View style={{ transform: [{ scale }] }}>
        <Icon name={active ? 'heartFill' : 'heart'} size={size} color={active ? color : '#ffffff'} />
      </Animated.View>
    </View>
  );
}

/**
 * Shimmer — a desaturated diagonal sheen sweeping across a neutral placeholder. Used as a cell/cover
 * background so loading tiles breathe instead of sitting as dead squares; a photo paints over it once
 * loaded, so it never adds colour behind a photo. Sizes itself via onLayout.
 */
export function Shimmer({ style }: { style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const [w, setW] = useState(0);
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced || w === 0) return;
    const loop = Animated.loop(
      Animated.timing(a, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, w, a]);
  const translateX = a.interpolate({ inputRange: [0, 1], outputRange: [-w, w] });
  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={[{ overflow: 'hidden', backgroundColor: palette.cell }, style]}
    >
      {w > 0 && !reduced && (
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: w * 0.6,
            backgroundColor: 'rgba(255,255,255,0.06)',
            transform: [{ translateX }, { skewX: '-20deg' }],
          }}
        />
      )}
    </View>
  );
}

/**
 * Scrim — a faked vertical gradient (stacked equal-opacity black bands) anchored to one edge, so text
 * stays legible over a bright photo without a real blur/linear-gradient. Fully neutral — never colour.
 */
export function Scrim({
  edge = 'bottom',
  height = 160,
  maxOpacity = 0.7,
  color = '#000000',
  style,
}: {
  edge?: 'top' | 'bottom';
  height?: number;
  maxOpacity?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const bands = 8;
  const per = maxOpacity / bands;
  const anchor = edge === 'bottom' ? { bottom: 0 as const } : { top: 0 as const };
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, height, ...anchor }, style]}>
      {Array.from({ length: bands }).map((_, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            height: (height * (i + 1)) / bands,
            ...anchor,
            backgroundColor: color,
            opacity: per,
          }}
        />
      ))}
    </View>
  );
}

/**
 * GradientButton — the signature CTA. A faked two-tone gradient fill (base + a translucent accent
 * orb), a coloured glow, a springy press, an auto-contrast label, and a dimmed busy state with an
 * inline spinner. Replaces the app's divergent flat buttons.
 */
export function GradientButton({
  label,
  onPress,
  tone = 'brand',
  busy,
  disabled,
  style,
  accessibilityLabel,
  accessibilityHint,
}: {
  label: string;
  onPress?: () => void;
  tone?: keyof typeof grad;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const [c0, c1] = grad[tone];
  const ink = readableText(c0);
  const inactive = disabled && !busy;
  return (
    <Springy
      onPress={busy || disabled ? undefined : onPress}
      disabled={busy || disabled}
      pressableStyle={style}
      scaleTo={0.97}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!(busy || disabled), busy: !!busy }}
    >
      <View
        style={[
          gbStyles.btn,
          { backgroundColor: c0, opacity: inactive ? 0.5 : 1 },
          !inactive && glowMd(c0),
        ]}
      >
        <View pointerEvents="none" style={gbStyles.clip}>
          <View style={[gbStyles.orb, { backgroundColor: tint(c1, 0.85) }]} />
        </View>
        {busy ? (
          <ActivityIndicator color={ink} />
        ) : (
          <Text maxFontSizeMultiplier={1.4} style={[gbStyles.label, { color: ink }]}>
            {label}
          </Text>
        )}
      </View>
    </Springy>
  );
}

const gbStyles = StyleSheet.create({
  btn: {
    minHeight: 52,
    borderRadius: radius.input,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  clip: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  orb: { position: 'absolute', right: -34, top: -26, width: 170, height: 170, borderRadius: 85 },
  label: { fontSize: 16, fontWeight: '800', letterSpacing: 0.2 },
});

/**
 * useGridEntrance — one Animated.Value that ramps 0→1 once per grid mount (~450ms). Cells interpolate
 * it against a per-index sub-window for a staggered assemble. It completes once, so recycled cells
 * (which get high indices while scrolling) read it already-finished and render at rest — recycle-safe.
 */
export function useGridEntrance(duration = 460): Animated.Value {
  const a = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) {
      a.setValue(1);
      return;
    }
    Animated.timing(a, { toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [a, duration, reduced]);
  return a;
}
