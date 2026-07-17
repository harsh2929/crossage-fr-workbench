/**
 * Form primitives — one SearchField, one Chip, one Segmented control, all accent-prop driven so a
 * tab's identity colour is set in exactly one place (this is what stops the Search/Desktop cyan from
 * drifting back to violet). Pure RN TextInput + Springy + the hand-drawn Icon set.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, ActivityIndicator, StyleSheet, Animated } from 'react-native';
import { palette, tint, radius, glowSm, tintFill, tintBorder, spring } from './theme';
import { Icon } from './Icon';
import { Springy, useReducedMotion } from './motion';

export function SearchField({
  value,
  onChangeText,
  onSubmit,
  onClear,
  placeholder,
  accent = palette.accent,
  pending,
  autoFocus,
}: {
  value: string;
  onChangeText: (t: string) => void;
  onSubmit?: () => void;
  onClear?: () => void;
  placeholder?: string;
  accent?: string;
  pending?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <View style={[styles.searchRow, { borderColor: tint(accent, tintBorder.rest) }]}>
      {pending ? (
        <ActivityIndicator color={accent} style={styles.searchLead} />
      ) : (
        <Icon name="search" size={20} color={accent} style={styles.searchLead} />
      )}
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        placeholderTextColor={palette.muted}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        selectionColor={accent}
        accessibilityLabel={placeholder ?? 'Search'}
      />
      {value.length > 0 && (
        <Springy onPress={onClear} hitSlop={{ top: 12, bottom: 12, left: 4, right: 10 }} style={styles.clear} accessibilityLabel="Clear search">
          <Icon name="close" size={13} color={palette.muted} strokeWidth={2} />
        </Springy>
      )}
    </View>
  );
}

export function Chip({
  label,
  sub,
  onPress,
  onLongPress,
  accent = palette.accent,
  selected,
}: {
  label: string;
  sub?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  accent?: string;
  selected?: boolean;
}) {
  const body = (
    <View
      style={[
        styles.chip,
        { backgroundColor: tint(accent, selected ? 0.3 : 0.14), borderColor: tint(accent, selected ? 0.75 : 0.45) },
      ]}
    >
      <Text maxFontSizeMultiplier={1.4} style={[styles.chipText, { color: selected ? palette.text : accent }]}>
        {label}
      </Text>
      {sub ? (
        <Text maxFontSizeMultiplier={1.4} style={styles.chipSub}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
  return onPress || onLongPress ? (
    <Springy
      onPress={onPress}
      onLongPress={onLongPress}
      // Vertical-only slop — a bare number would overlap neighbouring chips horizontally.
      hitSlop={{ top: 8, bottom: 8 }}
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected }}
    >
      {body}
    </Springy>
  ) : (
    body
  );
}

export function Segmented({
  options,
  value,
  onChange,
  accent = palette.accent,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  accent?: string;
}) {
  const [w, setW] = useState(0);
  const reduced = useReducedMotion();
  const idx = Math.max(0, options.findIndex((o) => o.key === value));
  const anim = useRef(new Animated.Value(idx)).current;
  useEffect(() => {
    if (reduced) {
      anim.setValue(idx);
      return;
    }
    Animated.spring(anim, { toValue: idx, useNativeDriver: true, ...spring.slide }).start();
  }, [idx, anim, reduced]);
  const seg = w > 0 ? w / options.length : 0;
  const canSlide = options.length >= 2 && seg > 0;
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={styles.segWrap}>
      {canSlide && (
        <Animated.View
          style={[
            styles.segPill,
            // Hue-aware glow on the active pill — the brand's alive depth cue, tinted to whatever
            // accent the control carries (violet by default, pink while the Favorites filter is active).
            glowSm(accent),
            {
              width: seg - 6,
              backgroundColor: tint(accent, tintFill.active),
              borderColor: tint(accent, tintBorder.active),
              transform: [
                {
                  translateX: anim.interpolate({
                    inputRange: options.map((_, i) => i),
                    outputRange: options.map((_, i) => i * seg + 3),
                  }),
                },
              ],
            },
          ]}
        />
      )}
      {options.map((o) => (
        <Springy
          key={o.key}
          onPress={() => onChange(o.key)}
          pressableStyle={styles.seg}
          scaleTo={0.94}
          // Vertical-only slop lifts the ~32pt segment to the 44pt touch minimum WITHOUT horizontal
          // overlap onto the neighbouring segment (which would make edge taps ambiguous).
          hitSlop={{ top: 6, bottom: 6 }}
          accessibilityLabel={o.label}
          accessibilityState={{ selected: o.key === value }}
        >
          <Text maxFontSizeMultiplier={1.3} style={[styles.segText, { color: o.key === value ? palette.text : palette.sub }]}>
            {o.label}
          </Text>
        </Springy>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.surfaceHi,
    borderWidth: 1,
    borderRadius: radius.input,
    paddingHorizontal: 12,
  },
  searchLead: { marginRight: 8 },
  input: { flex: 1, paddingVertical: 12, color: palette.text, fontSize: 16 },
  clear: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },

  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  chipText: { fontSize: 14, fontWeight: '700', letterSpacing: 0.1 },
  chipSub: { color: palette.muted, fontSize: 11, fontWeight: '600', marginTop: 2 },

  segWrap: {
    flexDirection: 'row',
    backgroundColor: palette.surfaceHi,
    borderRadius: radius.pill,
    padding: 3,
    position: 'relative',
  },
  segPill: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 0,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  seg: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  segText: { fontSize: 13, fontWeight: '700', letterSpacing: 0.15 },
});
