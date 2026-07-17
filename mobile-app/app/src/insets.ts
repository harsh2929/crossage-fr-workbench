/**
 * useInsets() — a responsive fake safe-area, without react-native-safe-area-context (a native dep,
 * banned). It replaces the scattered magic numbers (paddingTop:60, paddingBottom:28, top:56/52) with
 * one heuristic derived from Platform + Dimensions, and recomputes on rotation.
 *
 * The heuristic: tall edge-to-edge iPhones (X and later) have a notch/Dynamic Island + home
 * indicator; home-button iPhones and iPads do not. Aspect ratio separates them cleanly
 * (~2.16 for modern iPhones vs ~1.78 for the 8/SE and ~1.33 for iPad).
 */
import { useEffect, useState } from 'react';
import { Dimensions, Platform, StatusBar } from 'react-native';

export interface Insets {
  top: number;
  bottom: number;
}

export function computeInsets(): Insets {
  const { width, height } = Dimensions.get('window');
  if (Platform.OS === 'android') {
    return { top: (StatusBar.currentHeight ?? 24) + 4, bottom: 10 };
  }
  const longest = Math.max(width, height);
  const shortest = Math.min(width, height);
  const isLandscape = width > height;
  const notched = longest / shortest > 1.8;
  if (notched) {
    return isLandscape ? { top: 0, bottom: 21 } : { top: 59, bottom: 34 };
  }
  return { top: isLandscape ? 0 : 20, bottom: 0 };
}

export function useInsets(): Insets {
  const [insets, setInsets] = useState<Insets>(computeInsets);
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', () => setInsets(computeInsets()));
    return () => sub.remove();
  }, []);
  return insets;
}
