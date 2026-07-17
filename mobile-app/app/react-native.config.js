// React Native autolinking overrides.
//
// @react-native-ml-kit/text-recognition (OCR / Live Text) is DISABLED on iOS here because of an
// unavoidable simulator-architecture conflict:
//   • Google MLKit ships an arm64 slice built for DEVICE only (it has x86_64-simulator + arm64-device,
//     but NO arm64-simulator slice).
//   • react-native-executorch — the CLIP engine behind on-device semantic search, the app's core
//     differentiator — ships arm64-simulator + arm64-device, but NO x86_64 slice at all.
// There is therefore NO simulator architecture that links both: arm64-sim drops MLKit, x86_64-sim
// (Rosetta) drops ExecutorchLib. CLIP wins, so we build arm64-simulator and drop MLKit's pod.
//
// This is safe: the MLKit JS wrapper builds a Proxy when its native module is absent and only throws a
// LINKING_ERROR when .recognize() is actually called. The OCR indexer (src/useOcrIndex.ts) catches
// that via isLinkError() and settles into status 'unavailable', so Search stays visual-only on the
// simulator and nothing crashes at import or render.
//
// On a physical arm64 device BOTH frameworks link (each ships an arm64-device slice), so OCR works
// there. For a device / TestFlight build, remove this override (or gate it on the build destination).
module.exports = {
  dependencies: {
    '@react-native-ml-kit/text-recognition': {
      platforms: { ios: null },
    },
  },
};
