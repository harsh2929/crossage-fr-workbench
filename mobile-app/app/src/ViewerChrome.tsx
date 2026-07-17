/**
 * Shared full-screen viewer chrome: a top bar and a bottom panel that float over a photo on faked
 * neutral scrims (stacked-alpha black — no blur dep), with responsive safe-area padding. Used by both
 * the local PhotoDetail and the desktop DesktopDetail so "close / counter / actions" is one language.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from './Icon';
import { Springy, Scrim, useReducedMotion, useReduceTransparency } from './motion';
import { space, dur, palette, discScrim, radius } from './theme';
import { useInsets } from './insets';
import { type CellRect } from './media';

/**
 * useZoomStage — the viewer's open/close motion. The photo stage grows from the tapped cell's rect
 * (or from a slight scale-up when no rect is known) while a backdrop fades in; closing reverses it.
 * Transform + opacity only → native driver. Returns styles to spread onto the backdrop + stage, and a
 * requestClose(done) that plays the exit before `done()` unmounts the Modal.
 */
export function useZoomStage(originRect?: CellRect | null) {
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) {
      t.setValue(1);
      return;
    }
    Animated.spring(t, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 3 }).start();
  }, [t, reduced]);
  const requestClose = useCallback(
    (done: () => void) => {
      if (reduced) {
        done();
        return;
      }
      Animated.timing(t, { toValue: 0, duration: dur.base, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(
        () => done(),
      );
    },
    [t, reduced],
  );

  const { width: W, height: H } = Dimensions.get('window');
  let initScale = 0.92;
  let initTX = 0;
  let initTY = 0;
  if (originRect && originRect.w > 0) {
    initScale = Math.max(0.05, originRect.w / W);
    initTX = originRect.x + originRect.w / 2 - W / 2;
    initTY = originRect.y + originRect.h / 2 - H / 2;
  }
  const stageStyle = {
    opacity: t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 1] }),
    transform: [
      { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [initTX, 0] }) },
      { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [initTY, 0] }) },
      { scale: t.interpolate({ inputRange: [0, 1], outputRange: [initScale, 1] }) },
    ],
  };
  const backdropOpacity = t.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  return { stageStyle, backdropOpacity, requestClose };
}

export function ViewerTopBar({
  onClose,
  center,
  right,
}: {
  onClose: () => void;
  center?: React.ReactNode;
  right?: React.ReactNode;
}) {
  const insets = useInsets();
  const rt = useReduceTransparency();
  return (
    <View style={[styles.top, { paddingTop: insets.top + space.sm }]} pointerEvents="box-none">
      {/* bespoke over-photo legibility scrim — intentionally heavier than discScrim(0.28); feather height (insets.top + 76) and maxOpacity are deliberate */}
      <Scrim edge="top" height={insets.top + 76} maxOpacity={rt ? 0.85 : 0.55} />
      <Springy
        onPress={onClose}
        hitSlop={space.sm}
        style={styles.discBtn}
        accessibilityLabel="Close"
        accessibilityHint="Returns to the photo grid"
      >
        <Icon name="close" size={22} color={palette.text} />
      </Springy>
      <View style={styles.center} pointerEvents="box-none">
        {center ? (
          <View pointerEvents="box-none" style={styles.centerPill}>
            {center}
          </View>
        ) : null}
      </View>
      <View style={styles.right}>{right ?? <View style={styles.iconBtn} />}</View>
    </View>
  );
}

export function ScrimPanel({
  children,
  style,
  height = 240,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  height?: number;
}) {
  const insets = useInsets();
  const rt = useReduceTransparency();
  return (
    <View style={[styles.panel, { paddingBottom: insets.bottom + space.lg }, style]} pointerEvents="box-none">
      {/* bespoke over-photo legibility scrim — intentionally heavier than discScrim(0.28) */}
      <Scrim edge="bottom" height={height} maxOpacity={rt ? 0.94 : 0.78} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingBottom: space.md,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  discBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: discScrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { flex: 1, alignItems: 'center' },
  centerPill: {
    backgroundColor: discScrim,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  right: { flexDirection: 'row', alignItems: 'center' },
  // paddingHorizontal 20 aligns panel content to the top-bar glyph column; the 44pt iconBtn shifts that column ~21→23, leaving a ~3px drift (documented, left as-is)
  panel: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingTop: space.lg, paddingHorizontal: 20 },
});
