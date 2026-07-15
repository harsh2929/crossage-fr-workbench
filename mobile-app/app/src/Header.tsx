/**
 * Shared screen header: a bold large title + optional kicker/meta over a slow living-colour wash.
 * Used by Library / Search / Albums so the vivid chrome is consistent and the duplicated title
 * blocks collapse into one crafted component. The wash is confined to the header band; photos below
 * keep a neutral backdrop.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { palette } from './theme';
import { LivingGradient } from './motion';

export function ScreenHeader({
  title,
  meta,
  kicker,
  gradient,
  accent = palette.accentSoft,
  right,
}: {
  title: string;
  meta?: string;
  kicker?: string;
  gradient?: readonly [string, string];
  accent?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.wrap}>
      {gradient && <LivingGradient colors={gradient} height={140} />}
      <View style={styles.row}>
        <View style={styles.titleCol}>
          {kicker ? <Text style={[styles.kicker, { color: accent }]}>{kicker}</Text> : null}
          <Text style={styles.title}>{title}</Text>
          {meta ? <Text style={[styles.meta, { color: accent }]}>{meta}</Text> : null}
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingBottom: 10, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  titleCol: { flex: 1 },
  right: { paddingBottom: 4 },
  kicker: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4, marginBottom: 2 },
  title: { color: palette.text, fontSize: 34, fontWeight: '800', letterSpacing: -0.6 },
  meta: { fontSize: 13, fontWeight: '600', marginTop: 3, fontVariant: ['tabular-nums'] },
});
