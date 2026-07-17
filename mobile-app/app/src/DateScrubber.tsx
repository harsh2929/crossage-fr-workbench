/**
 * DateScrubber — a thin right-edge fast-scrub handle for the Albums month list (Apple Photos' fast
 * index). Drag the handle up/down and the vertical position maps to a month index; the parent scrolls
 * its list to that month (via a FlashList ref + scrollToIndex). A floating accent bubble shows the
 * month label while dragging.
 *
 * Living chrome: the handle glows + fills with accent while active, the label bubble is a glowing
 * accent pill; the rail underneath is a faint neutral guide. Pure react-native Animated + PanResponder
 * (PanResponder is core RN, not a native dep). Transform/opacity animations only.
 *
 * OPT-IN: the parent only mounts this when there are enough month rows to be worth fast-scrubbing.
 * It never assumes the list is measured — before onLayout reports a height, drags are ignored.
 */
import { useRef, useState } from 'react';
import { Animated, Easing, PanResponder, StyleSheet, Text, View } from 'react-native';
import { palette, tint, glow, glowMd, hairline, readableText } from './theme';
import { Icon } from './Icon';

const TRACK_W = 30; // touch strip width on the right edge
const THUMB_W = 22;
const THUMB_H = 46;
const PAD = 12; // vertical inset so the thumb never clips the top/bottom edge
const BUBBLE_H = 36;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function DateScrubber({
  count,
  labelAt,
  onScrubTo,
  accent = palette.accent,
}: {
  /** Number of scrubbable rows (months). */
  count: number;
  /** Label for a given row index (e.g. "September 2026"). */
  labelAt: (index: number) => string;
  /** Called (deduped) as the drag crosses into a new row index. */
  onScrubTo: (index: number) => void;
  accent?: string;
}) {
  const trackH = useRef(0);
  const lastIndex = useRef(-1);
  const thumbY = useRef(new Animated.Value(0)).current;
  const labelOpacity = useRef(new Animated.Value(0)).current;
  const [active, setActive] = useState(false);
  const [label, setLabel] = useState('');
  // Mirror the current row index in state so VoiceOver can announce/step it via accessibilityValue.
  const [currentIndex, setCurrentIndex] = useState(0);

  // Map a touch Y (relative to the track) to a row index; move the thumb and notify on index change.
  const scrub = (locationY: number) => {
    const h = trackH.current;
    if (h <= 0 || count <= 0) return;
    const half = THUMB_H / 2;
    const span = Math.max(1, h - THUMB_H - PAD * 2);
    const center = clamp(locationY, PAD + half, h - PAD - half);
    const top = center - half;
    thumbY.setValue(top);
    const frac = clamp((top - PAD) / span, 0, 1);
    const idx = clamp(Math.round(frac * (count - 1)), 0, count - 1);
    if (idx !== lastIndex.current) {
      lastIndex.current = idx;
      setCurrentIndex(idx);
      setLabel(labelAt(idx));
      onScrubTo(idx);
    }
  };

  // VoiceOver increment/decrement: step the index by one (clamped) and drive the same scrub path.
  const stepIndex = (delta: number) => {
    if (count <= 0) return;
    const next = clamp(currentIndex + delta, 0, count - 1);
    if (next === lastIndex.current) return;
    lastIndex.current = next;
    setCurrentIndex(next);
    setLabel(labelAt(next));
    onScrubTo(next);
  };
  // Keep the latest closure in a ref so the once-created PanResponder never captures stale props.
  const scrubRef = useRef(scrub);
  scrubRef.current = scrub;

  const hideLabel = () => {
    setActive(false);
    Animated.timing(labelOpacity, { toValue: 0, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start();
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Once grabbed, don't hand the gesture back to the list mid-scrub.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        setActive(true);
        Animated.timing(labelOpacity, { toValue: 1, duration: 140, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
        scrubRef.current(e.nativeEvent.locationY);
      },
      onPanResponderMove: (e) => scrubRef.current(e.nativeEvent.locationY),
      onPanResponderRelease: hideLabel,
      onPanResponderTerminate: hideLabel,
    }),
  ).current;

  return (
    <View
      style={styles.track}
      onLayout={(e) => {
        trackH.current = e.nativeEvent.layout.height;
      }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Month scrubber"
      accessibilityHint="Drag up or down to jump between months"
      accessibilityValue={{ text: labelAt(currentIndex) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment') stepIndex(1);
        else if (e.nativeEvent.actionName === 'decrement') stepIndex(-1);
      }}
      {...responder.panHandlers}
    >
      <View pointerEvents="none" style={styles.rail} />

      <Animated.View
        pointerEvents="none"
        style={[
          styles.bubble,
          glowMd(accent),
          { backgroundColor: accent, opacity: labelOpacity, transform: [{ translateY: thumbY }] },
        ]}
      >
        <Text numberOfLines={1} allowFontScaling={false} style={[styles.bubbleText, { color: readableText(accent) }]}>
          {label}
        </Text>
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[
          styles.thumb,
          { transform: [{ translateY: thumbY }] },
          active && { backgroundColor: tint(accent, 0.95), borderColor: tint('#ffffff', 0.5), ...glow(accent, 12, 0.6) },
        ]}
      >
        <Icon name="grid" size={12} color="#ffffff" />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: TRACK_W,
    zIndex: 20,
  },
  rail: {
    position: 'absolute',
    right: 4 + THUMB_W / 2 - 1.5, // centered under the thumb
    top: PAD,
    bottom: PAD,
    width: 3,
    borderRadius: 2,
    backgroundColor: hairline,
  },
  thumb: {
    position: 'absolute',
    top: 0,
    right: 4,
    width: THUMB_W,
    height: THUMB_H,
    borderRadius: THUMB_W / 2,
    backgroundColor: tint('#ffffff', 0.14),
    borderWidth: 1,
    borderColor: tint('#ffffff', 0.2),
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubble: {
    position: 'absolute',
    top: (THUMB_H - BUBBLE_H) / 2,
    right: 30,
    height: BUBBLE_H,
    minWidth: 104,
    paddingHorizontal: 16,
    borderRadius: BUBBLE_H / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleText: { fontSize: 15, fontWeight: '800', letterSpacing: 0.2 },
});
