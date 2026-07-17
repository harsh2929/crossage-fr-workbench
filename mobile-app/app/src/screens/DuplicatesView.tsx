/**
 * Duplicates — the offline answer to Apple Photos' "Duplicates" (which needs Apple Intelligence).
 * Clusters the on-device CLIP image embeddings into near-identical groups (see
 * replica.findDuplicateGroups) and lets you choose WHICH copy to keep, then deletes the rest of each
 * group via the same PhotoKit delete path as multi-select.
 *
 * Choosing a keeper: tap any thumbnail to mark it the keeper (it gains the accent border + "Keep"
 * badge). The default keeper is the first member of the group, so the flow degrades to the old
 * keep-first behaviour if you never tap. "Delete N" then removes every OTHER member of the set. The
 * per-group choice lives in a Map keyed by the group's first external_id (also the FlatList key).
 *
 * The scan is synchronous over sqlite-vec; we defer it a tick so the "Scanning…" state paints first.
 * (For very large libraries this should move off the JS thread / chunk — a documented follow-up.)
 *
 * Chrome carries the living colour (gradient header, a RollingNumber set-count badge, glowing card
 * edges, the accent "Keep" badge, the destructive chip); the thumbnails themselves sit on neutral
 * cells / a neutral shimmer so photos read cleanly. Every successful delete confirms with a toast.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, FlatList, Animated } from 'react-native';
import { Image } from 'expo-image';
import { Center, EmptyState, palette, assetUri } from '../ui';
import { findDuplicateGroups } from '../replica';
import { ScreenHeader } from '../Header';
import { Springy, Shimmer, Loader, RollingNumber } from '../motion';
import { Icon } from '../Icon';
import { toast } from '../Toast';
import { grad, tint, glow, radius, readableText, typography, tintFill, tintBorder, glowSm, dur, space } from '../theme';

const KEEP_INK = readableText(palette.accent);

export function DuplicatesView({
  onDeleteAssets,
  onBack,
}: {
  onDeleteAssets?: (ids: string[]) => Promise<boolean>;
  onBack: () => void;
}) {
  const [groups, setGroups] = useState<string[][] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // group key (first external_id) -> chosen keeper external_id. Absent = keep-first default.
  const [keepers, setKeepers] = useState<Map<string, string>>(() => new Map());
  const scrollY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = setTimeout(() => setGroups(findDuplicateGroups()), 0);
    return () => clearTimeout(t);
  }, []);

  const chooseKeeper = (groupKey: string, id: string) => {
    setKeepers((prev) => {
      if ((prev.get(groupKey) ?? groupKey) === id) return prev; // already the keeper — no churn
      const next = new Map(prev);
      next.set(groupKey, id);
      return next;
    });
  };

  const deleteExtras = async (group: string[]) => {
    if (!onDeleteAssets || group.length < 2) return;
    const groupKey = group[0];
    const keeper = keepers.get(groupKey) ?? groupKey;
    const extras = group.filter((id) => id !== keeper);
    if (extras.length === 0) return;
    setBusy(groupKey);
    const ok = await onDeleteAssets(extras);
    setBusy(null);
    if (ok) {
      setGroups((prev) => (prev ? prev.filter((g) => g !== group) : prev));
      setKeepers((prev) => {
        if (!prev.has(groupKey)) return prev;
        const next = new Map(prev);
        next.delete(groupKey);
        return next;
      });
      // App.onDeleteAssets already fires the "Deleted N photos" confirmation — don't double-toast.
    }
  };

  const meta =
    groups == null
      ? 'Scanning your photos on-device…'
      : groups.length === 0
        ? 'Nothing to merge'
        : 'Tap a copy to keep · we delete the rest';

  const countNode =
    groups && groups.length > 0 ? (
      <View
        style={styles.countPill}
        accessible
        accessibilityRole="text"
        accessibilityLabel={`${groups.length} duplicate ${groups.length === 1 ? 'set' : 'sets'}`}
      >
        <RollingNumber value={groups.length} fontSize={16} style={styles.countNum} />
        <Text style={styles.countLabel}>{groups.length === 1 ? 'set' : 'sets'}</Text>
      </View>
    ) : undefined;

  const renderHeader = (sy?: Animated.Value) => (
    <ScreenHeader
      title="Duplicates"
      meta={meta}
      gradient={grad.brand}
      back={{ label: 'Albums', onPress: onBack }}
      right={countNode}
      scrollY={sy}
    />
  );

  if (groups == null) {
    return (
      <View style={styles.root}>
        {renderHeader()}
        <Center>
          <Loader label="Comparing image embeddings…" />
        </Center>
      </View>
    );
  }

  if (groups.length === 0) {
    return (
      <View style={styles.root}>
        {renderHeader()}
        <EmptyState
          orb
          glyph="✨"
          title="No duplicates found"
          subtitle="Your library looks tidy — there's nothing near-identical to merge."
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {renderHeader(scrollY)}
      <FlatList
        data={groups}
        keyExtractor={(g) => g[0]}
        contentContainerStyle={styles.list}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
        scrollEventThrottle={16}
        renderItem={({ item: group }) => {
          const groupKey = group[0];
          const keeper = keepers.get(groupKey) ?? groupKey;
          const extra = group.length - 1;
          const pending = busy === groupKey;
          return (
            <View style={[styles.group, glow(palette.accent, 14, 0.16)]}>
              <View style={styles.groupHeader}>
                <Text
                  style={styles.groupCount}
                  accessibilityRole="header"
                  maxFontSizeMultiplier={1.6}
                >{`${group.length} near-identical`}</Text>
                {onDeleteAssets && (
                  <Springy
                    onPress={() => deleteExtras(group)}
                    disabled={pending}
                    hitSlop={8}
                    scaleTo={0.9}
                    style={styles.deleteChip}
                    accessibilityLabel={`Delete ${extra} duplicate${extra === 1 ? '' : 's'}`}
                    accessibilityHint="Keeps the chosen copy and deletes the rest of this set"
                    accessibilityState={{ disabled: pending, busy: pending }}
                  >
                    {pending ? (
                      <ActivityIndicator size="small" color={palette.danger} />
                    ) : (
                      <>
                        <Icon name="trash" size={15} color={palette.danger} strokeWidth={2} />
                        <Text style={styles.deleteText}>{`Delete ${extra}`}</Text>
                      </>
                    )}
                  </Springy>
                )}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
                {group.map((id, i) => {
                  const isKeeper = id === keeper;
                  return (
                    <Springy
                      key={id}
                      onPress={() => chooseKeeper(groupKey, id)}
                      disabled={pending}
                      scaleTo={0.92}
                      style={styles.thumbWrap}
                      accessibilityRole="button"
                      accessibilityLabel={`Photo ${i + 1} of ${group.length}`}
                      accessibilityHint="Marks this photo as the one to keep; the rest of the set is deleted"
                      accessibilityState={{ selected: isKeeper, disabled: pending }}
                    >
                      <Shimmer style={styles.thumbShimmer} />
                      <Image
                        source={{ uri: assetUri(id) }}
                        style={[styles.thumb, isKeeper && styles.thumbKeep]}
                        recyclingKey={id}
                        cachePolicy="memory-disk"
                        contentFit="cover"
                        transition={dur.base}
                      />
                      {isKeeper && (
                        <View style={[styles.keepBadge, glowSm(palette.accent)]}>
                          <Text style={styles.keepText} maxFontSizeMultiplier={1.3}>Keep</Text>
                        </View>
                      )}
                    </Springy>
                  );
                })}
              </ScrollView>
            </View>
          );
        }}
      />
    </View>
  );
}

const THUMB = 96;

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 24 },
  countPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    backgroundColor: tint(palette.accent, tintFill.rest),
    borderWidth: 1,
    borderColor: tint(palette.accent, tintBorder.faint),
  },
  countNum: { color: palette.text, fontWeight: '800' },
  countLabel: { color: palette.sub, ...typography.caption },
  group: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: tint(palette.accent, tintBorder.faint),
    padding: 12,
    marginBottom: 12,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  groupCount: { color: palette.sub, ...typography.body },
  deleteChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    minWidth: 104,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: tint(palette.danger, tintFill.rest),
    borderWidth: 1,
    borderColor: tint(palette.danger, tintBorder.faint),
  },
  deleteText: { color: palette.danger, fontSize: 15, fontWeight: '700' },
  thumbs: { gap: 8, paddingRight: 4 },
  thumbWrap: { position: 'relative', width: THUMB, height: THUMB },
  thumbShimmer: { position: 'absolute', top: 0, left: 0, width: THUMB, height: THUMB, borderRadius: radius.md },
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.md },
  thumbKeep: { borderWidth: 2, borderColor: palette.accent },
  keepBadge: {
    position: 'absolute',
    top: space.xs,
    left: space.xs,
    backgroundColor: palette.accent,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  keepText: { color: KEEP_INK, fontSize: 11, fontWeight: '800' },
});
