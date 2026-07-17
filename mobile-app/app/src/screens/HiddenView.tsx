/**
 * HiddenView — the app-local Hidden album. Apple Photos keeps a Hidden album that third-party apps
 * can't touch, so this is ours: photos flagged hidden are filtered out of Library/Search/Albums (in
 * App.tsx) and surface only here. A photo can be Selected → Unhidden (moved back into the library);
 * hiding itself happens from Library's select mode. Everything is app-local — nothing is written to
 * PhotoKit and nothing leaves the device.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { type AssetMetadata } from 'expo-media-library';
import * as LocalAuthentication from 'expo-local-authentication';
import { PhotoGrid, EmptyState, palette } from '../ui';
import { ScreenHeader } from '../Header';
import { Springy, Reveal, RollingNumber } from '../motion';
import { Icon } from '../Icon';
import { grad, tint, radius, typography, tintFill, tintBorder, glowMd } from '../theme';
import { useInsets } from '../insets';
import { getPref } from '../replica';

export function HiddenView({
  assets,
  onUnhide,
  onBack,
  onToggleFavorite,
  onFindSimilar,
}: {
  assets: AssetMetadata[];
  onUnhide: (ids: string[]) => void;
  onBack: () => void;
  onToggleFavorite?: (externalId: string, next: boolean) => void;
  onFindSimilar?: (externalId: string) => void;
}) {
  const insets = useInsets();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const count = selected.size;

  // Biometric gate. Hidden is sensitive by nature, so it opens locked (the "hidden.lock" pref
  // defaults ON — only an explicit '0' disables it) and reveals its contents only after a Face ID /
  // Touch ID / passcode check. Degradation is deliberate: if the device has no biometric hardware or
  // nothing enrolled, or the native module isn't in this build, we DON'T lock the user out of their
  // own photos — we fall open to unlocked (mirroring the OCR/Skia isLinkError graceful-degradation
  // pattern). The lock only ever *adds* friction where the platform can actually satisfy it.
  const [unlocked, setUnlocked] = useState(() => getPref('hidden.lock') === '0');
  const [authing, setAuthing] = useState(false);

  const unlock = useCallback(async () => {
    setAuthing(true);
    try {
      const [hasHardware, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      if (!hasHardware || !enrolled) {
        setUnlocked(true); // nothing to authenticate against — never trap the user out
        return;
      }
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Hidden',
        cancelLabel: 'Cancel',
      });
      if (res.success) setUnlocked(true);
    } catch {
      setUnlocked(true); // module missing / native error — fall open rather than crash-lock
    } finally {
      setAuthing(false);
    }
  }, []);

  // Auto-prompt once on mount when still locked (native module absent → resolves to unlocked).
  useEffect(() => {
    if (!unlocked) void unlock();
    // Mount-only: we intentionally don't re-prompt on every `unlocked`/`unlock` change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const exitSelect = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);

  const allSelected = assets.length > 0 && count === assets.length;
  const toggleAll = useCallback(() => {
    setSelected((prev) => (prev.size === assets.length ? new Set() : new Set(assets.map((a) => a.id))));
  }, [assets]);

  if (!unlocked) {
    return (
      <View style={styles.root}>
        <ScreenHeader
          title="Hidden"
          kicker="Locked · on device"
          gradient={grad.brand}
          back={{ label: 'Albums', onPress: onBack }}
        />
        <View style={styles.locked}>
          <Reveal visible style={styles.lockedInner}>
            <View
              style={styles.lockOrb}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Text style={styles.lockGlyph}>🔒</Text>
            </View>
            <View
              accessible
              accessibilityRole="header"
              accessibilityLabel="Hidden is locked. Unlock with Face ID, Touch ID, or your passcode to view these photos."
            >
              <Text style={styles.lockTitle} maxFontSizeMultiplier={1.6}>
                Hidden is locked
              </Text>
              <Text style={styles.lockSub} maxFontSizeMultiplier={1.6}>
                Unlock with Face ID, Touch ID, or your passcode to view these photos.
              </Text>
            </View>
            <Springy
              pressableStyle={[styles.unlockBtn, glowMd(palette.accent)]}
              onPress={unlock}
              disabled={authing}
              scaleTo={0.97}
              accessibilityLabel={authing ? 'Unlocking Hidden' : 'Unlock Hidden'}
              accessibilityHint="Requires Face ID, Touch ID, or your passcode"
              accessibilityState={{ busy: authing, disabled: authing }}
            >
              <View style={styles.unlockInner}>
                <Icon name="eyeOff" size={16} color={palette.accent} />
                <Text style={styles.unlockText} maxFontSizeMultiplier={1.3}>
                  {authing ? 'Unlocking…' : 'Unlock'}
                </Text>
              </View>
            </Springy>
          </Reveal>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Hidden"
        meta={selecting ? undefined : `${assets.length} hidden`}
        kicker={selecting ? undefined : 'App-local · on device'}
        gradient={grad.brand}
        back={selecting ? undefined : { label: 'Albums', onPress: onBack }}
        right={
          assets.length > 0 ? (
            selecting ? (
              <View style={styles.headRight}>
                <Springy onPress={toggleAll} hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }} accessibilityLabel={allSelected ? 'Deselect all' : 'Select all'}>
                  <Text style={styles.headBtn} maxFontSizeMultiplier={1.3}>{allSelected ? 'None' : 'All'}</Text>
                </Springy>
                <Springy onPress={exitSelect} hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }} accessibilityLabel="Cancel selection">
                  <Text style={styles.headBtn} maxFontSizeMultiplier={1.3}>Cancel</Text>
                </Springy>
              </View>
            ) : (
              <Springy onPress={() => setSelecting(true)} hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }} accessibilityLabel="Select photos">
                <Text style={styles.headBtn} maxFontSizeMultiplier={1.3}>Select</Text>
              </Springy>
            )
          ) : undefined
        }
      />

      {assets.length === 0 ? (
        <EmptyState
          orb
          glyph="🙈"
          title="Nothing hidden"
          subtitle="Photos you hide from the Library land here — out of your grid, still on your device."
        />
      ) : (
        <PhotoGrid
          data={assets}
          gridKey={`hidden:${selecting}`}
          onFindSimilar={onFindSimilar}
          onToggleFavorite={onToggleFavorite}
          selection={selecting ? { active: true, selected, onToggle: toggle } : undefined}
        />
      )}

      <Reveal visible={selecting && count > 0} style={[styles.actionBar, { bottom: insets.bottom + 12 }]}>
        <Springy
          pressableStyle={[styles.action, glowMd(palette.accent)]}
          onPress={() => {
            onUnhide([...selected]);
            exitSelect();
          }}
          scaleTo={0.97}
          accessibilityLabel={`Unhide ${count} photo${count === 1 ? '' : 's'}`}
          accessibilityHint="Moves them back into your library"
        >
          <View style={styles.actionInner}>
            <Icon name="eyeOff" size={18} color={palette.accent} />
            <Text style={styles.actionText} maxFontSizeMultiplier={1.3}>Unhide</Text>
            <RollingNumber value={count} fontSize={15} style={styles.actionText} />
          </View>
        </Springy>
      </Reveal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headRight: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  headBtn: { color: palette.accent, fontSize: 16, fontWeight: '700' },
  locked: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  lockedInner: { alignItems: 'center' },
  lockOrb: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: tint(palette.accent, tintFill.rest),
    borderColor: tint(palette.accent, tintBorder.rest),
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  lockGlyph: { fontSize: 40 },
  lockTitle: { ...typography.heading, color: palette.text, textAlign: 'center' },
  lockSub: {
    ...typography.body,
    color: palette.sub,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
    maxWidth: 300,
  },
  unlockBtn: {
    backgroundColor: tint(palette.accent, tintFill.rest),
    borderColor: tint(palette.accent, tintBorder.rest),
    borderWidth: 1,
    borderRadius: radius.lg,
    minHeight: 52,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  unlockInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  unlockText: { color: palette.accent, fontSize: 15, fontWeight: '800' },
  actionBar: { position: 'absolute', left: 16, right: 16 },
  action: {
    backgroundColor: tint(palette.accent, tintFill.rest),
    borderColor: tint(palette.accent, tintBorder.rest),
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: 14,
  },
  actionInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  actionText: { color: palette.accent, fontSize: 15, fontWeight: '800' },
});
