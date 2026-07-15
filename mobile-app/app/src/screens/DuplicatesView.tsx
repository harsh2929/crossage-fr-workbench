/**
 * Duplicates — the offline answer to Apple Photos' "Duplicates" (which needs Apple Intelligence).
 * Clusters the on-device CLIP image embeddings into near-identical groups (see
 * replica.findDuplicateGroups) and lets you keep the first and delete the rest of each group via the
 * same PhotoKit delete path as multi-select.
 *
 * The scan is synchronous over sqlite-vec; we defer it a tick so the "Scanning…" state paints first.
 * (For very large libraries this should move off the JS thread / chunk — a documented follow-up.)
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { Center, palette, assetUri } from '../ui';
import { findDuplicateGroups } from '../replica';

export function DuplicatesView({
  onDeleteAssets,
  onBack,
}: {
  onDeleteAssets?: (ids: string[]) => Promise<boolean>;
  onBack: () => void;
}) {
  const [groups, setGroups] = useState<string[][] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setGroups(findDuplicateGroups()), 0);
    return () => clearTimeout(t);
  }, []);

  const deleteExtras = async (group: string[]) => {
    if (!onDeleteAssets || group.length < 2) return;
    const extras = group.slice(1);
    setBusy(group[0]);
    const ok = await onDeleteAssets(extras);
    setBusy(null);
    if (ok) setGroups((prev) => (prev ? prev.filter((g) => g !== group) : prev));
  };

  const header = (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={10}>
        <Text style={styles.back}>‹ Albums</Text>
      </Pressable>
      <Text style={styles.title}>Duplicates</Text>
      <Text style={styles.meta}>
        {groups == null
          ? 'Scanning your photos on-device…'
          : `${groups.length} duplicate set${groups.length === 1 ? '' : 's'}`}
      </Text>
    </View>
  );

  if (groups == null) {
    return (
      <View style={styles.root}>
        {header}
        <Center>
          <ActivityIndicator color={palette.accent} />
          <Text style={styles.body}>Comparing image embeddings…</Text>
        </Center>
      </View>
    );
  }

  if (groups.length === 0) {
    return (
      <View style={styles.root}>
        {header}
        <Center>
          <Text style={styles.hero}>✨</Text>
          <Text style={styles.body}>No duplicates found. Your library looks tidy.</Text>
        </Center>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {header}
      <FlatList
        data={groups}
        keyExtractor={(g) => g[0]}
        contentContainerStyle={styles.list}
        renderItem={({ item: group }) => (
          <View style={styles.group}>
            <View style={styles.groupHeader}>
              <Text style={styles.groupCount}>{`${group.length} near-identical`}</Text>
              {onDeleteAssets && (
                <Pressable onPress={() => deleteExtras(group)} disabled={busy === group[0]} hitSlop={8}>
                  {busy === group[0] ? (
                    <ActivityIndicator color={palette.danger} />
                  ) : (
                    <Text style={styles.deleteExtras}>{`Delete ${group.length - 1}`}</Text>
                  )}
                </Pressable>
              )}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
              {group.map((id, j) => (
                <View key={id} style={styles.thumbWrap}>
                  <Image
                    source={{ uri: assetUri(id) }}
                    style={[styles.thumb, j === 0 && styles.thumbKeep]}
                    recyclingKey={id}
                    cachePolicy="memory-disk"
                    contentFit="cover"
                    transition={0}
                  />
                  {j === 0 && (
                    <View style={styles.keepBadge}>
                      <Text style={styles.keepText}>Keep</Text>
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 10 },
  back: { color: palette.accent, fontSize: 15, fontWeight: '600', marginBottom: 4 },
  title: { color: palette.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  meta: { color: palette.accent, fontSize: 13, marginTop: 2 },
  body: { color: palette.sub, fontSize: 15, textAlign: 'center' },
  hero: { fontSize: 44 },
  list: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 24 },
  group: {
    backgroundColor: '#14141d',
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  groupCount: { color: palette.sub, fontSize: 14, fontWeight: '600' },
  deleteExtras: { color: palette.danger, fontSize: 15, fontWeight: '700' },
  thumbs: { gap: 8, paddingRight: 4 },
  thumbWrap: { position: 'relative' },
  thumb: { width: 96, height: 96, borderRadius: 10, backgroundColor: palette.cell },
  thumbKeep: { borderWidth: 2, borderColor: palette.accent },
  keepBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: palette.accent,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  keepText: { color: '#fff', fontSize: 11, fontWeight: '800' },
});
