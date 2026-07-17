/**
 * Icon — one hand-drawn icon vocabulary, built from plain Views + a few tintable Unicode glyphs (no
 * icon library, no SVG dep). Every functional glyph in the app's chrome comes from here at a shared
 * stroke weight and optical box, so the search-lens, close-✕, chevron, etc. all match. Large emoji
 * (✨, 🖥️) are reserved for hero art only.
 *
 * Icons are decorative: they're hidden from assistive tech (the wrapping Springy/Pressable supplies
 * the accessible label). Pass `style` to rotate/offset (e.g. a left-pointing back chevron).
 */
import React from 'react';
import { View, Text, type StyleProp, type ViewStyle } from 'react-native';

export type IconName =
  | 'search'
  | 'info'
  | 'close'
  | 'chevron'
  | 'check'
  | 'heart'
  | 'heartFill'
  | 'spark'
  | 'grid'
  | 'stack'
  | 'desktop'
  | 'trash'
  | 'share'
  | 'sliders'
  | 'eyeOff';

export function Icon({
  name,
  size = 20,
  color = '#ffffff',
  strokeWidth = 2,
  style,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden={true} // iOS: keep Unicode glyphs (♡/♥/✦) off VoiceOver
      accessible={false}
      style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      {glyph(name, size, color, strokeWidth)}
    </View>
  );
}

function glyph(name: IconName, s: number, color: string, w: number): React.ReactNode {
  const bar = (extra: ViewStyle) => ({ backgroundColor: color, borderRadius: w, ...extra } as ViewStyle);
  switch (name) {
    case 'close':
      return (
        <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
          <View style={bar({ width: s * 0.72, height: w, transform: [{ rotate: '45deg' }] })} />
          <View style={bar({ width: s * 0.72, height: w, marginTop: -w, transform: [{ rotate: '-45deg' }] })} />
        </View>
      );
    case 'check':
      return (
        <View
          style={{
            width: s * 0.4,
            height: s * 0.66,
            borderColor: color,
            borderRightWidth: w,
            borderBottomWidth: w,
            transform: [{ rotate: '45deg' }],
            marginTop: -s * 0.06,
          }}
        />
      );
    case 'chevron':
      return (
        <View
          style={{
            width: s * 0.42,
            height: s * 0.42,
            borderColor: color,
            borderTopWidth: w,
            borderRightWidth: w,
            transform: [{ rotate: '45deg' }],
            marginLeft: -s * 0.08,
          }}
        />
      );
    case 'search':
      return (
        <View style={{ width: s, height: s }}>
          <View
            style={{
              position: 'absolute',
              top: s * 0.1,
              left: s * 0.1,
              width: s * 0.56,
              height: s * 0.56,
              borderRadius: s * 0.28,
              borderWidth: w,
              borderColor: color,
            }}
          />
          <View
            style={bar({
              position: 'absolute',
              bottom: s * 0.12,
              right: s * 0.1,
              width: s * 0.3,
              height: w,
              transform: [{ rotate: '45deg' }],
            })}
          />
        </View>
      );
    case 'info':
      return (
        <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ position: 'absolute', width: s, height: s, borderRadius: s / 2, borderWidth: w, borderColor: color }} />
          <View style={bar({ width: w * 1.1, height: w * 1.1, borderRadius: w, marginBottom: s * 0.08 })} />
          <View style={bar({ width: w, height: s * 0.3 })} />
        </View>
      );
    case 'grid':
      return (
        <View
          style={{ width: s * 0.78, height: s * 0.78, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignContent: 'space-between' }}
        >
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{ width: s * 0.32, height: s * 0.32, borderRadius: s * 0.1, backgroundColor: color }} />
          ))}
        </View>
      );
    case 'stack':
      return (
        <View style={{ width: s * 0.8, height: s * 0.8, justifyContent: 'center', gap: s * 0.15 }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={bar({ width: s * 0.8, height: w * 1.35 })} />
          ))}
        </View>
      );
    case 'desktop':
      return (
        <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: s * 0.92, height: s * 0.64, borderRadius: s * 0.14, borderWidth: w, borderColor: color }} />
          <View style={bar({ width: s * 0.34, height: w, marginTop: w })} />
        </View>
      );
    case 'trash':
      return (
        <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
          <View style={bar({ width: s * 0.72, height: w, marginBottom: w * 1.2 })} />
          <View
            style={{
              width: s * 0.56,
              height: s * 0.56,
              borderWidth: w,
              borderColor: color,
              borderTopLeftRadius: w,
              borderTopRightRadius: w,
              borderBottomLeftRadius: s * 0.16,
              borderBottomRightRadius: s * 0.16,
            }}
          />
        </View>
      );
    case 'share':
      return (
        <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ position: 'absolute', bottom: s * 0.06, width: s * 0.62, height: s * 0.5, borderWidth: w, borderColor: color, borderRadius: w }} />
          <View style={bar({ position: 'absolute', top: s * 0.06, width: w, height: s * 0.46 })} />
          <View style={bar({ position: 'absolute', top: s * 0.1, left: s * 0.33, width: s * 0.2, height: w, transform: [{ rotate: '-45deg' }] })} />
          <View style={bar({ position: 'absolute', top: s * 0.1, right: s * 0.33, width: s * 0.2, height: w, transform: [{ rotate: '45deg' }] })} />
        </View>
      );
    case 'sliders':
      return (
        <View style={{ width: s, height: s, justifyContent: 'center', gap: s * 0.28 }}>
          {[0.58, 0.2].map((knobLeft, i) => (
            <View key={i} style={bar({ width: s, height: w, justifyContent: 'center' })}>
              <View
                style={{
                  position: 'absolute',
                  left: s * knobLeft,
                  top: -s * 0.13,
                  width: s * 0.28,
                  height: s * 0.28,
                  borderRadius: s * 0.14,
                  backgroundColor: color,
                }}
              />
            </View>
          ))}
        </View>
      );
    case 'heart':
      return <Text accessible={false} allowFontScaling={false} style={{ fontSize: s, lineHeight: s * 1.04, color }}>♡</Text>;
    case 'heartFill':
      return <Text accessible={false} allowFontScaling={false} style={{ fontSize: s, lineHeight: s * 1.04, color }}>♥</Text>;
    case 'spark':
      return <Text accessible={false} allowFontScaling={false} style={{ fontSize: s * 0.94, lineHeight: s, color }}>✦</Text>;
    case 'eyeOff':
      return (
        <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
          {/* eye lens + pupil, struck through by a diagonal slash → "hidden" */}
          <View style={{ width: s * 0.86, height: s * 0.52, borderRadius: s * 0.26, borderWidth: w, borderColor: color }} />
          <View style={bar({ position: 'absolute', width: s * 0.2, height: s * 0.2, borderRadius: s * 0.1 })} />
          <View style={bar({ position: 'absolute', width: s * 0.98, height: w, transform: [{ rotate: '-45deg' }] })} />
        </View>
      );
  }
}
