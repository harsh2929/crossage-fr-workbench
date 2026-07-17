/**
 * Toast — the app-wide feedback backbone. Every mutating action confirms with a toast; favorite
 * toasts carry an UNDO (favorite is reversible), delete is confirmation-only (PhotoKit delete is
 * irreversible). One <ToastHost/> mounts once at the App root (above the tab bar); anywhere can call
 * the module-level `toast(...)`. Single-slot (a new toast replaces the current one).
 *
 * Bottom card springs up + fades, auto-dismisses (~3.5s), respects Reduce Motion (snap, no slide).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { palette, tint, tintBorder, glowLg, radius, spring } from './theme';
import { Springy, useReducedMotion } from './motion';
import { useInsets } from './insets';

export type ToastTone = 'brand' | 'favorite' | 'danger' | 'desktop' | 'search';

export interface ToastOptions {
  text: string;
  tone?: ToastTone;
  action?: { label: string; onPress: () => void };
  duration?: number;
}

const TONE: Record<ToastTone, string> = {
  brand: palette.accent,
  favorite: palette.pink,
  danger: palette.danger,
  desktop: palette.cyan,
  search: palette.cyan,
};

let listener: ((t: ToastOptions) => void) | null = null;

/** Show a toast from anywhere. No-op until a <ToastHost/> is mounted. */
export function toast(opts: ToastOptions) {
  listener?.(opts);
}

export function ToastHost() {
  const insets = useInsets();
  const reduced = useReducedMotion();
  const [current, setCurrent] = useState<ToastOptions | null>(null);
  const y = useRef(new Animated.Value(140)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    Animated.parallel([
      Animated.timing(y, { toValue: 140, duration: 200, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(({ finished }) => finished && setCurrent(null));
  }, [y, opacity]);

  useEffect(() => {
    listener = (t) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setCurrent(t);
    };
    return () => {
      listener = null;
    };
  }, []);

  useEffect(() => {
    if (!current) return;
    // Announce to the screen reader; the toast card is otherwise silent. On Android the card's
    // accessibilityLiveRegion="polite" already announces it, so an explicit announce there would
    // double-speak — so this explicit call is iOS-only (where liveRegion is a no-op).
    if (Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(
        current.action ? current.text + '. Double tap ' + current.action.label + '.' : current.text,
      );
    }
    if (reduced) {
      y.setValue(0);
      opacity.setValue(1);
    } else {
      y.setValue(140);
      opacity.setValue(0);
      Animated.parallel([
        Animated.spring(y, { toValue: 0, useNativeDriver: true, ...spring.enter }),
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
      ]).start();
    }
    // Auto-hide. When an UNDO action is present, give screen-reader users longer to reach it.
    let cancelled = false;
    const base = current.duration ?? 3500;
    if (current.action) {
      AccessibilityInfo.isScreenReaderEnabled()
        .then((on) => {
          if (!cancelled) hideTimer.current = setTimeout(dismiss, on ? 7000 : base);
        })
        .catch(() => {
          if (!cancelled) hideTimer.current = setTimeout(dismiss, base);
        });
    } else {
      hideTimer.current = setTimeout(dismiss, base);
    }
    return () => {
      cancelled = true;
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [current, reduced, y, opacity, dismiss]);

  if (!current) return null;
  const color = TONE[current.tone ?? 'brand'];
  return (
    <View pointerEvents="box-none" style={[styles.host, { bottom: insets.bottom + 86 }]}>
      <Animated.View
        accessibilityLiveRegion="polite"
        style={[styles.card, glowLg(color), { borderColor: tint(color, tintBorder.active), transform: [{ translateY: y }], opacity }]}
      >
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text maxFontSizeMultiplier={1.5} style={styles.text} numberOfLines={2}>
          {current.text}
        </Text>
        {current.action && (
          <Springy
            onPress={() => {
              current.action!.onPress();
              dismiss();
            }}
            hitSlop={10}
            style={styles.action}
            accessibilityLabel={current.action.label}
          >
            <Text maxFontSizeMultiplier={1.4} style={[styles.actionText, { color }]}>
              {current.action.label}
            </Text>
          </Springy>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 16 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: 460,
    backgroundColor: palette.popover,
    borderWidth: 1,
    borderRadius: radius.input,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 12,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 12 },
  text: { flex: 1, color: palette.text, fontSize: 14, fontWeight: '600' },
  action: { paddingHorizontal: 12, paddingVertical: 4 },
  actionText: { fontSize: 14, fontWeight: '800' },
});
