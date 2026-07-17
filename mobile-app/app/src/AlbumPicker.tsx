/**
 * AlbumPicker — a reusable "Add to Album" sheet: lists the user's albums + a "New Album…" row, adds
 * the given photos to the chosen album (or creates one via the iOS prompt), and toasts the result.
 * Shared by the photo viewer (single photo) and Library's Select mode (bulk). Self-contained: it owns
 * the album load, the add/create calls, and the feedback.
 */
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, ScrollView, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { palette, tint, radius, typography, hairline } from './theme';
import { Icon } from './Icon';
import { Springy } from './motion';
import { toast } from './Toast';
import { listUserAlbums, addAssetsToAlbum, createAlbumWithAssets, type DeviceAlbum } from './albums';

export function AlbumPicker({
  visible,
  assetIds,
  onClose,
  onAdded,
}: {
  visible: boolean;
  assetIds: string[];
  onClose: () => void;
  onAdded?: () => void;
}) {
  const [albums, setAlbums] = useState<DeviceAlbum[] | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setAlbums(null);
    listUserAlbums()
      .then((a) => !cancelled && setAlbums(a))
      .catch(() => !cancelled && setAlbums([]));
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const n = assetIds.length;
  const noun = `${n} photo${n === 1 ? '' : 's'}`;

  const addTo = async (album: DeviceAlbum) => {
    onClose();
    if (n === 0) return;
    try {
      await addAssetsToAlbum(assetIds, album.id);
      toast({ text: `Added ${noun} to ${album.title}`, tone: 'brand' });
      onAdded?.();
    } catch {
      toast({ text: 'Couldn’t add to album', tone: 'danger' });
    }
  };

  const newAlbum = () => {
    if (n === 0) {
      onClose();
      return;
    }
    // Present the prompt over the still-visible picker; only dismiss the picker once the user acts.
    // (Closing first and presenting the alert in the same tick races the Modal dismissal on iOS and
    // the prompt silently never appears.)
    Alert.prompt?.('New Album', 'Name your new album', async (name?: string) => {
      onClose();
      const nm = (name ?? '').trim();
      if (!nm) return;
      try {
        await createAlbumWithAssets(nm, assetIds);
        toast({ text: `Created “${nm}” with ${noun}`, tone: 'brand' });
        onAdded?.();
      } catch {
        toast({ text: 'Couldn’t create album', tone: 'danger' });
      }
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close album picker">
        <Pressable style={styles.card} onPress={() => {}} accessibilityViewIsModal onAccessibilityEscape={onClose}>
          <Text style={styles.title}>Add {noun} to Album</Text>
          {albums == null ? (
            <View style={styles.loading}>
              <ActivityIndicator color={palette.accent} />
            </View>
          ) : (
            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              <Springy onPress={newAlbum} pressableStyle={styles.row} accessibilityLabel="New album">
                <Icon name="spark" size={16} color={palette.accentSoft} />
                <Text style={styles.new}>New Album…</Text>
              </Springy>
              {albums.map((a) => (
                <Springy key={a.id} onPress={() => addTo(a)} pressableStyle={styles.row} accessibilityLabel={a.title}>
                  <Icon name="stack" size={16} color={palette.sub} />
                  <Text style={styles.rowText} numberOfLines={1}>
                    {a.title}
                  </Text>
                </Springy>
              ))}
              {albums.length === 0 ? <Text style={styles.empty}>No albums yet — create one above.</Text> : null}
            </ScrollView>
          )}
          <Springy onPress={onClose} pressableStyle={styles.cancel} accessibilityLabel="Cancel">
            <Text style={styles.cancelText}>Cancel</Text>
          </Springy>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    alignSelf: 'stretch',
    backgroundColor: palette.surfaceHi,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: tint(palette.accent, 0.3),
    padding: 16,
    maxHeight: '70%',
  },
  title: { ...typography.sheetTitle, color: palette.text, marginBottom: 12 },
  loading: { paddingVertical: 32, alignItems: 'center' },
  list: { maxHeight: 320 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomColor: hairline,
    borderBottomWidth: 1,
  },
  new: { color: palette.accentSoft, fontSize: 15, fontWeight: '700' },
  rowText: { color: palette.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  empty: { color: palette.muted, fontSize: 16, paddingVertical: 16, textAlign: 'center' },
  cancel: { marginTop: 12, alignItems: 'center', paddingVertical: 12 },
  cancelText: { color: palette.sub, fontSize: 15, fontWeight: '700' },
});
