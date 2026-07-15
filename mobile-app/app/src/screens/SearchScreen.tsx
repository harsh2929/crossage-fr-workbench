/**
 * Search — the differentiator. Natural-language photo search powered by on-device CLIP, fully
 * offline, with no Apple Intelligence gate. Search-as-you-type (debounced) once the index is built.
 *
 * The index is opt-in behind one tap (it downloads the CLIP encoders once, then embeds the library
 * on-device); after that, every keystroke re-ranks the grid by relevance.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView } from 'react-native';
import { type AssetMetadata } from 'expo-media-library';
import { PhotoGrid, Center, palette } from '../ui';
import { ScreenHeader } from '../Header';
import { Springy, FloatingView, BreathingOrb, ProgressBar } from '../motion';
import { grad } from '../theme';
import { type SemanticSearch } from '../useSemanticSearch';

const EXAMPLES = ['dog', 'beach', 'sunset', 'flowers', 'mountains', 'food', 'a red car', 'city at night'];
const DEBOUNCE_MS = 250;

export function SearchScreen({
  assets,
  search,
  onFindSimilar,
  onToggleFavorite,
}: {
  assets: AssetMetadata[];
  search: SemanticSearch;
  onFindSimilar?: (externalId: string) => void;
  onToggleFavorite?: (externalId: string, next: boolean) => void;
}) {
  // Seed from the last text query so the box matches the results after a tab-switch remount (this
  // screen unmounts on tab change but the search state lives in the App-level hook and persists).
  const [q, setQ] = useState(search.similar ? '' : search.lastQuery);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending debounce when the screen unmounts (e.g. tab switch) so an abandoned query
  // doesn't fire against the still-alive hook after the user has left.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const debouncedSearch = useCallback(
    (text: string) => {
      if (timer.current) clearTimeout(timer.current);
      if (!text.trim()) {
        search.clear();
        return;
      }
      timer.current = setTimeout(() => search.search(text), DEBOUNCE_MS);
    },
    [search],
  );

  const onChangeText = (text: string) => {
    setQ(text);
    if (search.status === 'ready') debouncedSearch(text);
  };

  const runNow = (text: string) => {
    setQ(text);
    if (timer.current) clearTimeout(timer.current);
    search.search(text);
  };

  // Map the relevance-ordered external_ids back to renderable assets, preserving order.
  const results = useMemo<AssetMetadata[] | null>(() => {
    if (search.results == null) return null;
    const byId = new Map(assets.map((a) => [a.id, a]));
    return search.results
      .map((id) => byId.get(id))
      .filter((a): a is AssetMetadata => !!a);
  }, [search.results, assets]);

  // Before the index exists: the opt-in enable / progress flow.
  if (search.status !== 'ready') {
    const busy = search.status === 'loading' || search.status === 'indexing';
    const pct = search.status === 'loading' ? search.progress : search.total ? search.indexed / search.total : 0;
    return (
      <View style={styles.root}>
        <ScreenHeader title="Search" kicker="On-device intelligence" gradient={grad.search} accent={palette.cyan} />
        <Center>
          <View style={styles.heroWrap}>
            <BreathingOrb size={150} color={palette.cyan} />
            <FloatingView>
              <Text style={styles.hero}>✨</Text>
            </FloatingView>
          </View>
          <Text style={styles.pitch}>
            Search your photos by what’s in them — “a dog on a beach”, “sunset”, “my red car”.
          </Text>
          <Text style={styles.pitchSub}>On-device · offline · no Apple Intelligence</Text>
          <Springy
            style={[styles.enable, busy && styles.enableBusy]}
            onPress={busy ? undefined : search.enable}
            disabled={busy}
          >
            <Text style={styles.enableText}>
              {search.status === 'idle' && '✨ Enable semantic search'}
              {search.status === 'loading' && `Loading models…  ${Math.round(search.progress * 100)}%`}
              {search.status === 'indexing' && `Indexing  ${search.indexed}/${search.total}…`}
              {search.status === 'error' && 'Try again'}
            </Text>
          </Springy>
          {busy && (
            <View style={styles.progressWrap}>
              <ProgressBar progress={pct} color={palette.cyan} />
            </View>
          )}
          {search.status === 'error' && (
            <Text style={styles.err}>{(search.error ?? '').slice(0, 200)}</Text>
          )}
        </Center>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title="Search" kicker="On-device intelligence" gradient={grad.search} accent={palette.cyan} />
      <View style={styles.controls}>
        <View style={styles.searchRow}>
          <Text style={styles.searchGlyph}>⌕</Text>
          <TextInput
            style={styles.input}
            placeholder="a dog on a beach, sunset, red car…"
            placeholderTextColor={palette.muted}
            value={q}
            onChangeText={onChangeText}
            onSubmitEditing={() => runNow(q)}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {q.length > 0 && (
            <Springy
              onPress={() => {
                setQ('');
                search.clear();
              }}
              hitSlop={12}
              style={styles.clear}
            >
              <Text style={styles.clearX}>✕</Text>
            </Springy>
          )}
        </View>

        {search.searchError && (
          <Text style={styles.searchErr}>Search failed — {search.searchError.slice(0, 140)}</Text>
        )}

        {results == null ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            {EXAMPLES.map((ex) => (
              <Springy key={ex} style={styles.chip} onPress={() => runNow(ex)}>
                <Text style={styles.chipText}>{ex}</Text>
              </Springy>
            ))}
          </ScrollView>
        ) : (
          <Text style={styles.meta}>
            {search.similar
              ? `✨ ${results.length} similar photo${results.length === 1 ? '' : 's'}`
              : `${results.length} result${results.length === 1 ? '' : 's'} for “${search.lastQuery}”`}
          </Text>
        )}
      </View>

      {results == null ? (
        <Center>
          <Text style={styles.body}>Type anything, or tap a suggestion.</Text>
        </Center>
      ) : results.length === 0 ? (
        <Center>
          <Text style={styles.body}>{search.similar ? 'Nothing similar found.' : 'No matches. Try another phrase.'}</Text>
        </Center>
      ) : (
        <PhotoGrid
          data={results}
          gridKey={search.similar ? `sim:${results[0]?.id ?? ''}` : `q:${search.lastQuery}`}
          onFindSimilar={onFindSimilar}
          onToggleFavorite={onToggleFavorite}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  controls: { paddingHorizontal: 16, paddingBottom: 10 },
  meta: { color: palette.accent, fontSize: 13, marginTop: 10, fontVariant: ['tabular-nums'] },
  searchErr: { color: palette.danger, fontSize: 13, marginTop: 10 },
  body: { color: palette.sub, fontSize: 15, textAlign: 'center' },
  heroWrap: { width: 150, height: 150, alignItems: 'center', justifyContent: 'center' },
  progressWrap: { width: 220, marginTop: 16 },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    backgroundColor: '#16161f',
    borderColor: 'rgba(139,92,246,0.4)',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
  },
  searchGlyph: { color: palette.accentSoft, fontSize: 20, marginRight: 6 },
  input: { flex: 1, paddingVertical: 12, color: palette.text, fontSize: 16 },
  clear: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  clearX: { color: palette.muted, fontSize: 15 },

  chips: { gap: 8, paddingTop: 12, paddingRight: 16 },
  chip: {
    backgroundColor: 'rgba(139,92,246,0.14)',
    borderColor: 'rgba(139,92,246,0.45)',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipText: { color: palette.accentSoft, fontSize: 14, fontWeight: '600' },

  hero: { fontSize: 48 },
  pitch: { color: palette.text, fontSize: 17, textAlign: 'center', lineHeight: 24, fontWeight: '600' },
  pitchSub: { color: palette.muted, fontSize: 13, textAlign: 'center', letterSpacing: 0.3 },
  enable: {
    marginTop: 8,
    backgroundColor: palette.accent,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 22,
    alignItems: 'center',
  },
  enableBusy: { backgroundColor: 'rgba(139,92,246,0.35)' },
  enableText: { color: palette.text, fontSize: 15, fontWeight: '700' },
  err: { color: palette.danger, fontSize: 12, textAlign: 'center' },
});
