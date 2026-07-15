/**
 * Library — the whole camera roll, newest first, read from the encrypted on-device replica.
 *
 * Also the management surface: a "Select" mode turns cell taps into multi-select, with a bottom
 * action bar to batch-favorite (write-through to PhotoKit) or delete (via the iOS system prompt).
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { type AssetMetadata } from 'expo-media-library';
import { PhotoGrid, Center, palette } from '../ui';
import { ScreenHeader } from '../Header';
import { Springy } from '../motion';
import { grad } from '../theme';

export function LibraryScreen({
  assets,
  loadMs,
  onFindSimilar,
  onToggleFavorite,
  onFavoriteAssets,
  onDeleteAssets,
}: {
  assets: AssetMetadata[];
  loadMs: number | null;
  onFindSimilar?: (externalId: string) => void;
  onToggleFavorite?: (externalId: string, next: boolean) => void;
  onFavoriteAssets?: (ids: string[], next: boolean) => void;
  onDeleteAssets?: (ids: string[]) => Promise<boolean>;
}) {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const canSelect = !!(onFavoriteAssets || onDeleteAssets);
  const exit = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const ids = [...selected];

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={selecting ? `${selected.size} selected` : 'Library'}
        kicker={selecting ? undefined : 'Your library'}
        gradient={grad.brand}
        meta={
          selecting
            ? undefined
            : `${assets.length.toLocaleString()} photos · encrypted replica${loadMs != null ? ` · ${loadMs} ms` : ''}`
        }
        right={
          canSelect && assets.length > 0 ? (
            <Springy onPress={() => (selecting ? exit() : setSelecting(true))} hitSlop={10}>
              <Text style={styles.selectBtn}>{selecting ? 'Cancel' : 'Select'}</Text>
            </Springy>
          ) : null
        }
      />

      {assets.length === 0 ? (
        <Center>
          <Text style={styles.body}>No photos in this library yet.</Text>
        </Center>
      ) : (
        <PhotoGrid
          data={assets}
          gridKey="library"
          onFindSimilar={onFindSimilar}
          onToggleFavorite={onToggleFavorite}
          selection={canSelect ? { active: selecting, selected, onToggle: toggle } : undefined}
        />
      )}

      {selecting && selected.size > 0 && (
        <View style={styles.actionBar}>
          {onFavoriteAssets && (
            <Springy
              pressableStyle={styles.action}
              onPress={() => {
                onFavoriteAssets(ids, true);
                exit();
              }}
            >
              <Text style={styles.actionText}>♥  Favorite</Text>
            </Springy>
          )}
          {onDeleteAssets && (
            <Springy
              pressableStyle={styles.action}
              onPress={async () => {
                const ok = await onDeleteAssets(ids);
                if (ok) exit();
              }}
            >
              <Text style={[styles.actionText, styles.deleteText]}>Delete</Text>
            </Springy>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: palette.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  selectBtn: { color: palette.accent, fontSize: 16, fontWeight: '700' },
  meta: { color: palette.accent, fontSize: 13, marginTop: 2, fontVariant: ['tabular-nums'] },
  body: { color: palette.sub, fontSize: 15, textAlign: 'center' },
  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    backgroundColor: '#14141d',
    borderTopColor: 'rgba(139,92,246,0.25)',
    borderTopWidth: 1,
    paddingVertical: 14,
  },
  action: { flex: 1, alignItems: 'center' },
  actionText: { color: palette.accentSoft, fontSize: 15, fontWeight: '700' },
  deleteText: { color: palette.danger },
});
