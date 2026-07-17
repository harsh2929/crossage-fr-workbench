/**
 * Ask Photos — a conversational, plan-transparent search surface. Apple's "Ask Photos" calls a cloud
 * LLM; ours is fully offline. You type a plain-language question and we show, as chips, exactly what we
 * understood (a date window, favorites, a media type, a scene phrase), then answer by intersecting
 * those constraints over the library. The scene phrase is retrieved by on-device CLIP ∪ OCR — the same
 * signals the Search tab uses — so nothing leaves the device.
 *
 * The heavy lifting lives in the PURE planner (./askPhotos): parseAsk() decomposes the text and
 * executeAsk() runs the retrieval + filters. This component is the presentation layer — a debounced
 * input, the plan chips, and a result grid — plus the graceful "build the index" prompt for scene
 * questions asked before the CLIP index exists (date/favorite/media questions work with no index).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, StyleSheet, ScrollView } from 'react-native';
import { type AssetMetadata } from 'expo-media-library';
import { PhotoGrid, EmptyState, palette } from './ui';
import { SearchField, Chip } from './fields';
import { Springy, GradientButton, useReducedMotion } from './motion';
import { Icon } from './Icon';
import { grad, tint, radius, typography, tintFill, tintBorder } from './theme';
import { useInsets } from './insets';
import { parseAsk, executeAsk, planIsEmpty, type AskPlan } from './askPhotos';

// Example questions that showcase the planner's range: pure-filter (work with no index), scene (CLIP),
// and combinations. Tapping one seeds the box.
const PROMPTS = [
  'my favorites this year',
  'videos from last week',
  'beach photos',
  'a dog',
  'receipts from last month',
  'food',
  'screenshots',
  'photos from march',
];

type Props = {
  visible: boolean;
  onClose: () => void;
  assets: AssetMetadata[];
  clipReady: boolean;
  indexing?: boolean;
  onEnableIndex?: () => void;
  onFindSimilar?: (externalId: string) => void;
  onToggleFavorite?: (externalId: string, next: boolean) => void;
  /** Optional seed query (deep-linking / dev harness). Applied once when the sheet becomes visible. */
  initialQuery?: string;
};

export function AskSheet({
  visible,
  onClose,
  assets,
  clipReady,
  indexing,
  onEnableIndex,
  onFindSimilar,
  onToggleFavorite,
  initialQuery,
}: Props) {
  const insets = useInsets();
  const reduced = useReducedMotion();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<AssetMetadata[] | null>(null);
  const [running, setRunning] = useState(false);
  const [meta, setMeta] = useState({ usedClip: false, usedOcr: false, needsIndex: false });
  // Monotonic token so a slow CLIP embed can't overwrite a newer query's results.
  const reqId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const plan: AskPlan = useMemo(() => parseAsk(q), [q]);

  const run = useCallback(
    async (text: string) => {
      const my = ++reqId.current;
      const p = parseAsk(text);
      if (planIsEmpty(p)) {
        setResults(null);
        setRunning(false);
        return;
      }
      setRunning(true);
      try {
        const r = await executeAsk(p, { assets, clipReady });
        if (my !== reqId.current) return;
        setResults(r.assets);
        setMeta({ usedClip: r.usedClip, usedOcr: r.usedOcr, needsIndex: r.needsIndex });
      } catch {
        if (my !== reqId.current) return;
        setResults([]);
        setMeta({ usedClip: false, usedOcr: false, needsIndex: false });
      } finally {
        if (my === reqId.current) setRunning(false);
      }
    },
    [assets, clipReady],
  );

  // Debounce query → run. An empty box resets to the idle state and invalidates any in-flight run.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) {
      reqId.current++;
      setResults(null);
      setRunning(false);
      return;
    }
    timer.current = setTimeout(() => void run(q), 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, run]);

  // Seed on open; fully reset on close so the next open starts clean.
  useEffect(() => {
    if (visible) {
      if (initialQuery) setQ(initialQuery);
    } else {
      reqId.current++;
      setQ('');
      setResults(null);
      setRunning(false);
    }
  }, [visible, initialQuery]);

  const clear = useCallback(() => {
    setQ('');
    setResults(null);
  }, []);

  // Fold every dimension that reorders the grid into the key (the codebase's FlashList re-rank rule).
  const gridKey = useMemo(
    () => `ask:${q.trim()}:${results?.length ?? 0}:${clipReady ? 1 : 0}`,
    [q, results, clipReady],
  );

  return (
    <Modal visible={visible} animationType={reduced ? 'fade' : 'slide'} transparent onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top + 8 }]} accessibilityViewIsModal onAccessibilityEscape={onClose}>
        <View style={styles.header}>
          <Springy onPress={onClose} hitSlop={12} pressableStyle={styles.close} accessibilityLabel="Close Ask Photos">
            <Icon name="close" size={16} color={palette.sub} />
          </Springy>
          <View style={styles.titleWrap}>
            <Text maxFontSizeMultiplier={1.3} style={styles.kicker}>ON DEVICE · OFFLINE</Text>
            <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.title}>Ask Photos</Text>
          </View>
        </View>

        <View style={styles.searchWrap}>
          <SearchField
            value={q}
            onChangeText={setQ}
            onClear={clear}
            placeholder="Ask your photos…"
            accent={palette.cyan}
            pending={running}
            autoFocus
          />
        </View>

        {/* Plan chips — a transparent read-back of what the question was understood to mean. */}
        {!planIsEmpty(plan) && (
          <View
            style={styles.planRow}
            accessible
            accessibilityLabel={`Looking for ${plan.chips.join(', ')}`}
          >
            <Text style={styles.planLead}>Looking for</Text>
            <View
              style={styles.planChips}
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
            >
              {plan.chips.map((c, i) => (
                <View key={`${i}:${c}`} style={styles.planChip}>
                  <Text maxFontSizeMultiplier={1.4} style={styles.planChipText}>
                    {c}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {results == null ? (
          <ScrollView contentContainerStyle={styles.idle} keyboardShouldPersistTaps="handled">
            <Text style={styles.idleHint}>
              Ask in plain language. I combine what’s IN your photos (scenes &amp; text, computed on
              device) with when they were taken, favorites, and media type — all offline, no cloud.
            </Text>
            <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.sectionLabel}>Try</Text>
            <View style={styles.prompts}>
              {PROMPTS.map((p) => (
                <Chip key={p} label={p} accent={palette.cyan} onPress={() => setQ(p)} />
              ))}
            </View>
          </ScrollView>
        ) : results.length === 0 ? (
          <EmptyState
            orb
            orbColor={palette.cyan}
            glyph={meta.needsIndex ? '✨' : '🔍'}
            title={meta.needsIndex ? 'Turn on scene search' : 'No matches'}
            subtitle={
              meta.needsIndex
                ? 'This question searches what’s inside your photos, which needs the on-device index. Build it once — it stays on your device.'
                : 'Try describing the photo differently, or loosen the date.'
            }
            action={
              meta.needsIndex && onEnableIndex ? (
                <GradientButton
                  label={indexing ? 'Building…' : 'Build index'}
                  tone="search"
                  busy={indexing}
                  onPress={onEnableIndex}
                />
              ) : undefined
            }
          />
        ) : (
          <PhotoGrid
            data={results}
            gridKey={gridKey}
            onFindSimilar={onFindSimilar}
            onToggleFavorite={onToggleFavorite}
            ListHeaderComponent={
              <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.4} style={styles.count}>
                {results.length} {results.length === 1 ? 'match' : 'matches'}
                {meta.needsIndex ? ' · build the index to also search scenes' : ''}
              </Text>
            }
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.popover, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  close: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: palette.surfaceHi,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleWrap: { flex: 1 },
  kicker: { ...typography.kicker, color: palette.cyan, marginBottom: 2 },
  title: { ...typography.largeTitle, color: palette.text },
  searchWrap: { marginBottom: 12 },
  planRow: { marginBottom: 12 },
  planLead: { ...typography.kicker, color: palette.sub, marginBottom: 8 },
  planChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  planChip: {
    backgroundColor: tint(palette.cyan, tintFill.rest),
    borderColor: tint(palette.cyan, tintBorder.rest),
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  planChipText: { ...typography.meta, color: palette.cyan, fontWeight: '700' },
  idle: { paddingTop: 8, paddingBottom: 40 },
  idleHint: { ...typography.body, color: palette.sub, marginBottom: 24 },
  sectionLabel: { ...typography.kicker, color: palette.sub, marginBottom: 12 },
  prompts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  count: { ...typography.meta, color: palette.sub, fontWeight: '700', paddingVertical: 12, fontVariant: ['tabular-nums'] },
});
