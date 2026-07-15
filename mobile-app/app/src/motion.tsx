/**
 * Reusable motion primitives — the app's "alive" layer, built entirely on React Native's `Animated`
 * (no reanimated/gesture-handler/linear-gradient, so it ships reload-only with no native rebuild).
 * Transform/opacity animations use the native driver; only the progress bar's width is JS-driven.
 *
 * Living colour is confined to chrome (headers, hero, loaders, empty states) — never behind photos.
 */
import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { palette, tint, grad } from './theme';

/** A Pressable that springs its scale down on press-in for tactile feedback. */
export function Springy({
  children,
  onPress,
  onLongPress,
  style,
  pressableStyle,
  disabled,
  hitSlop,
  scaleTo = 0.94,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>; // visual style (scales with the content)
  pressableStyle?: StyleProp<ViewStyle>; // layout style on the Pressable (e.g. flex:1)
  disabled?: boolean;
  hitSlop?: number;
  scaleTo?: number;
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
      onPressIn={() => !disabled && to(scaleTo)}
      onPressOut={() => to(1)}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

function useLoop(duration: number, easing = Easing.inOut(Easing.ease)) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 1, duration, easing, useNativeDriver: true }),
        Animated.timing(a, { toValue: 0, duration, easing, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [a, duration]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const a = useLoop(period, Easing.inOut(Easing.sin));
  const translateY = a.interpolate({ inputRange: [0, 1], outputRange: [-amplitude, amplitude] });
  return <Animated.View style={{ transform: [{ translateY }] }}>{children}</Animated.View>;
}

/** A slow living colour wash for a header band. Confined to `height`; parent should clip. */
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
  const t1x = a.interpolate({ inputRange: [0, 1], outputRange: [-50, 70] });
  const t1y = a.interpolate({ inputRange: [0, 1], outputRange: [-20, 30] });
  const t2x = b.interpolate({ inputRange: [0, 1], outputRange: [60, -60] });
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', top: 0, left: 0, right: 0, height, overflow: 'hidden' }, style]}>
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
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();
  }, [progress, w]);
  const width = w.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: tint(color, 0.18), overflow: 'hidden' }}>
      <Animated.View style={{ height, width, borderRadius: height / 2, backgroundColor: color }} />
    </View>
  );
}
