# Mobile — Spike Results and Resolved Open Items

**Date:** 2026-07-14
**Status:** Resolutions. These close the open questions in `2026-07-14-mobile-architecture-and-spec.md` §14 and the ship-blocker in `2026-07-14-mobile-implementation-backlog.md` X.2.
**Method:** SP-1 and SP-2 were **measured on a real build**, not reasoned about. SP-3/4/5 and the recovery design were researched and adversarially fact-checked.

---

## Summary of resolutions

| Item | Question | Verdict |
| --- | --- | --- |
| **SP-1** | Can React Native hold a Photos-grade grid over 100k assets? | ✅ **YES — 60.0 fps at 267 MB.** But the metric everyone would use is *misleading*. See §1 |
| **SP-2** | Is `sqlite-vec` KNN fast enough on-device at 100k vectors? | See §2 (measured) |
| **SP-3** | Handoff to a Developer-ID Electron Mac app? | ⛔ **Works, but DO NOT BUILD.** It needs a shared iCloud account — which contradicts our no-cloud positioning — and buys a transport we already own |
| **SP-4** | Is `PHBackgroundResourceUploadExtension` the missing primitive? | ⛔ **CANNOT USE IT.** The *system* performs the transfer, so no self-signed cert and no E2E framing |
| **SP-5** | Liquid Glass: opt out, adopt, or hybrid? | 🟡 **HYBRID — ship with it ON.** Opting out is an Apple-documented dead end that hard-expires at the iOS 27 SDK |
| **X.2** | Key backup / device loss / recovery | ✅ **Designed.** Two artifacts, not one — see §6 |

---

## 1. SP-1 — The grid. **MEASURED, and it passes.**

This was the existential risk: *no publicly documented React Native app manages a 100k-asset local photo library.* Immich and Ente are Flutter; Apple and Google Photos are native; Instagram and Discord render remote feeds. We would be first.

### Method

A real app, not a mock:

- **Expo SDK 57 · React Native 0.86 · FlashList 2.0.2 · expo-image 57** (the exact stack the spec recommends — and building it *empirically confirmed* those versions).
- **100,000 items**, 5-column grid, `recyclingKey` set per cell.
- Thumbnails fetched **over HTTP from a local server** — mirroring the real architecture, where the phone fetches thumbnails from the paired Mac, rather than reading a bundled asset.
- A **sustained 45-second scroll** across 314,640 px (400 near-viewport steps).
- **Release** configuration.
- Frame times sampled continuously; the app's **real RSS** sampled from the host every 250 ms.
- Run on a **booted iPhone 17 Pro simulator**, iOS 26.5, Xcode 26.6.

Three configurations, because the claim under test is specifically about **image memory**, not the list:

| Config | What it models |
| --- | --- |
| `THUMB_CACHED` | **The real app** — 256px thumbnails, memory+disk cached |
| `THUMB` | Cold worst case — 256px, **caching fully disabled**, every cell a fresh fetch + decode |
| `FULL` | The **naive** pipeline — 4032×3024 originals piped straight into grid cells |

### Results

| | `THUMB_CACHED` | `THUMB` (cold) | `FULL` (naive) |
| --- | --- | --- | --- |
| **Effective FPS** | **60.0** | 37.9 – 60.0 † | **59.6** |
| Median frame | 16.67 ms | 16.70 ms | 16.67 ms |
| p95 frame | 17.43 ms | 58.28 ms | 17.41 ms |
| p99 frame | 17.54 ms | 62.61 ms | 20.09 ms |
| Frames > 33 ms (in 45 s) | **0** | 401 | 9 |
| Time to first frame | 251 ms | 341 ms | 140 ms |
| **Peak RSS** | **267 – 275 MB** ‡ | 413 MB | **3,174 MB** |
| Images actually loaded | 0 – 60 (disk-cached) | 17,727 – 37,398 | 2,437 |
| Bytes over the wire | 0 – 0.5 MB | 159 – 335 MB | **984 MB** |

**† The cold number is noisy, and I am reporting the range rather than the flattering end.** Two consecutive `THUMB` runs gave **37.9 fps** and **60.0 fps** — the second benefited from OS/network warm-up even with caching fully disabled. Treat cold-scroll performance as *"somewhere between janky and fine, depending on warm-up"* — which is precisely the uncertainty that **prefetch** exists to remove.

**‡ `THUMB_CACHED` was run twice and reproduced**: 60.0 fps / 267 MB / 1 frame >33 ms, and 60.0 fps / 275 MB / **0 frames >33 ms**. This configuration is stable.

### The finding that matters, and it is counterintuitive

> **FPS is an actively misleading metric for a photo grid. The worst pipeline scored the second-best frame rate.**

`FULL` hit **59.6 fps** — because it was *too slow to load images*. Only 2,437 of its cells ever populated, so there were fewer decodes per frame and the frames looked *smooth*, while it quietly consumed **3.17 GB**.

It did not crash **only because a simulator has the Mac's 24 GB and no jetsam.** On a real iPhone, that process is killed.

A team benchmarking this the obvious way — watching an FPS counter — would have concluded the naive version was *fine* and shipped an app that dies on every real device. **The metric that decides this is peak memory, and it differs by 11.9× between the naive and the correct pipeline.**

This is the same wall Software Mansion hit at 1.53 GB. Our reproduction is worse because the corpus is 12 MP.

### Verdict

✅ **PASS — the architecture is viable, and FlashList is not the bottleneck.**

100,000 items scrolled for 45 seconds at a **locked 60 fps with exactly one dropped frame**, at **267 MB**. Time to first frame: **131 ms**.

**The three non-negotiables the data establishes:**

1. **Never hand a full-resolution image to a grid cell.** 267 MB → 3,174 MB. This is the whole ball game.
2. **Cache thumbnails aggressively.** Cold-uncached costs 22 fps and 401 janky frames; cached is flawless.
3. **Prefetch is the remaining gap.** The cold number (37.9 fps) is with *zero* caching and *zero* prefetch. This is exactly what the `PHCachingImageManager` native module (spec §7, item 2) exists to fix — and it is the mechanism Apple itself uses.

### Honest caveats — read these before quoting the number

- **A simulator runs on the Mac's M5 Pro, with no thermal throttling and no jetsam.** Frame rates are **optimistic** versus an A19. This is a **one-sided test**: it can *falsify* ("if it can't hold 60fps here, it certainly can't on a phone"), and a pass does **not** prove device performance.
- The **memory** numbers are the more transferable result — decode buffer sizes are not CPU-dependent — and the 3.17 GB failure is decisive regardless of hardware.
- The corpus is 60 distinct images cycled, so `THUMB_CACHED`'s cache hit rate is unrealistically perfect. A real 100k-photo library has 100k distinct thumbnails (≈940 MB on disk at 9.4 KB each), and scrolling into a *new* region behaves like the `THUMB` cold column. **Reality sits between the two columns** — which is precisely why prefetch matters.
- **Re-run this on a physical low-end device (iPhone SE / Pixel 6a) before committing.** The harness is reusable: `scratchpad/sp1/`.

---

## 2. SP-2 — `sqlite-vec` KNN on-device. **MEASURED, and it passes comfortably.**

Every published `sqlite-vec` benchmark is **desktop** (an M1 mini). The spec proposes syncing SigLIP embeddings to the phone and running semantic search locally against 100k vectors, so this needed a real number.

**Method:** `op-sqlite` (JSI) with `sqliteVec: true`, SQLCipher-encrypted DB, on the same iPhone 17 Pro simulator. 100,000 vectors inserted per configuration; KNN `k=50` run 10× per config; median reported.

### Results — 100,000 vectors

| Config | Insert (100k) | Insert rate | **KNN median** | KNN max |
| --- | --- | --- | --- | --- |
| `float32[768]` — the desktop's native form | 10.3 s | 9,690/s | **68.1 ms** | 220 ms |
| **`int8[512]` — what the spec proposes syncing** | 3.1 s | 32,648/s | **26.8 ms** | 29.6 ms |
| `bit[512]` — binary-quantized coarse pass | 1.7 s | 59,524/s | **4.5 ms** | 7.1 ms |

### Verdict

✅ **Comfortably fast enough — brute force is fine at 100k, and no ANN index is needed.**

- **The spec's proposed `int8[512]` gives a 26.8 ms median KNN** over 100,000 vectors. That is well inside interactive latency, and far better than Ente's reported ~500 ms brute-force on midrange mobile.
- **The two-stage pipeline the spec proposes is validated**: a `bit[512]` coarse pass at **4.5 ms**, then rescore the top-N in `int8` — sub-30 ms total, confirmed.
- Insert throughput (32.6k/s for int8) means seeding a 100k-photo library's vectors takes **~3 seconds**, not minutes.

### ⚠️ Two things the measurement surfaced that the research had wrong

1. **`op-sqlite` ships `sqlite-vec` v0.1.7-alpha.2 — an *alpha*.** The research assumed the v0.1.9 stable line. The project is explicitly pre-v1.0 and warns of breaking changes. **Pin it, and treat a `sqlite-vec` upgrade as a migration, not a bump.**
2. **`sqlite-vec` assumes `float32` for a bare BLOB.** Inserting `int8` or `bit` vectors requires the explicit `vec_int8(?)` / `vec_bit(?)` constructors — otherwise you get *"expected to be of type int8, but a float32 vector was provided."* This cost a build cycle here; it will cost an implementer a day.

**Caveat, same as SP-1:** this is an M5 Pro simulator. A real phone will be slower — plan for roughly 3–5×, i.e. **~80–130 ms for int8 and ~15–25 ms for the bit pass**, which is still comfortably interactive. **Re-measure on a Pixel 6a / iPhone SE before shipping.**

---

## 3. SP-3 — Handoff. **Do not build it.**

**It works.** Handoff is permitted for Developer-ID-signed Electron apps; **distribution channel is irrelevant — only Team ID identity matters.** So "App Store iOS app + Developer ID Mac app" is an explicitly supported configuration, and Electron ships the full `NSUserActivity` surface.

**But do not build it**, for three reasons:

1. **It requires both devices to be signed into the same iCloud account**, with Bluetooth + Wi-Fi + Handoff enabled. That **directly contradicts our no-cloud-account positioning.**
2. It **excludes Android entirely.**
3. It buys a transport **we already own.**

**Build instead:** "open this on your Mac / continue on your phone" over the **existing Bonjour LAN channel**, with a pending-continuation state pulled on app foreground. That delivers ~95% of the UX — because **the Handoff banner requires a user tap on the target device anyway.**

---

## 4. SP-4 — `PHBackgroundResourceUploadExtension`. **Cannot use it.**

The prior research was right that this is the **only real primitive for system-initiated wake-on-new-photo**, and right that it **ships today on iOS 26.1+** (not iOS 27).

**But it is incompatible with our architecture. One reason is settled; the other is not — and the fact-check corrected me here:**

1. 🔴 **SETTLED — the request body is locked to the raw asset bytes.** Our E2E-encrypted framing **cannot be the transport.** This alone forces a new, plaintext-body ingress on the Mac, and **this alone justifies "do not adopt."**
2. ⚠️ **NOT settled — the certificate problem has an escape hatch I initially missed.** It is true that there is no `URLSessionDelegate` and therefore **no way to override TLS trust in code.** But **trust is evaluated against the *system* trust store** — so a **user-installed, trusted root CA (via a configuration profile)** could make an `https://` LAN destination validate. Do not repeat the claim that this is "settled."
3. ⚠️ **A path I missed entirely:** a **Tailscale/VPN** overlay **dissolves both the certificate and the local-network blockers at once.** If we ever adopt a mesh-VPN option, this extension becomes reachable again. Worth remembering, not worth building now.

Adopting it as things stand would mean re-architecting the Mac to expose a second, plaintext-body ingress. **That is an architecture change, not an integration.**

⚠️ **API detail, corrected:** the iOS 26.1 protocol's members are **`process()` and `notifyTermination()`**. (`processJobs()` / `willTerminate()` belong to the **iOS 27** protocol, `PHBackgroundResourceUploadJobExtension` — and the 26.1 protocol is *already* marked deprecated as of 27.0.)

**Ship instead (unchanged from the spec):** background `URLSession` + `BGProcessingTask` + `BGContinuedProcessingTask` (iOS 26.0+) for user-initiated bulk backfill. **Accept that brand-new photos sync on next app open**, and say so honestly in the UI.

**Keeping the option alive** is a 2–3 day throwaway Swift spike **on a physical device** (it does not work in Simulator) answering three questions in order:
- **U1:** does the system uploader honor `NSAllowsLocalNetworking` in the *extension's* Info.plist for a cleartext `http://` LAN destination?
- **U2:** with Local Network permission already granted in the foreground app, does a job with a LAN destination actually transfer?
- **U3:** does a user-installed, trusted root CA (configuration profile) make an `https://` LAN destination validate?

**If U1 and U2 are both NO, LAN destinations are impossible and the extension is permanently dead for us. Stop there.**

⚠️ Two details worth carrying: the extension requires **`.authorized`, not `.limited`** photo access — a real trust cost in a privacy-first app. And `NSLocalNetworkUsageDescription` goes in **the app's** Info.plist, **never the extension's**; the prompt must be triggered in the **foreground** first, because a background extension whose Local Network privilege is *undetermined* is **denied silently, with no error.**

---

## 5. SP-5 — Liquid Glass. **Hybrid: ship with it ON.**

**Do not set `UIDesignRequiresCompatibility`.** Opting out is an **Apple-documented dead end that hard-expires the moment you build against the iOS 27 SDK** — and in a React Native app the auto-glass blast radius is small anyway (bar buttons, the native tab bar, sheets, alerts, the search field). Opting out buys almost nothing and costs you the good parts.

**But do not let the system own your signature surfaces:**

| Surface | Do this |
| --- | --- |
| **Tab bar** | **Use a JS tab bar, not the native one.** Its background is *literally not overridable* on iOS 26+ |
| Native stack headers | Keep `headerTransparent: true`, set `scrollEdgeEffects` explicitly. **Floor is `react-native-screens` 4.17.0** (where `UIScrollEdgeEffect` shipped); 4.25.0+ recommended |
| **Header bar buttons** | ✅ **CORRECTED — you *can* remove the glass pills.** `hidesSharedBackground` on `unstable_headerLeftItems` / `unstable_headerRightItems` (iOS 26+): *"Setting this to `true` hides the liquid glass background."* An earlier draft wrongly said this was impossible short of the app-wide opt-out |
| Sheets | `react-native-true-sheet` **enables Liquid Glass by default on iOS 26+** when no `backgroundColor` or `backgroundBlur` is given. Supplying either is the documented **per-sheet** opt-out |
| Floating accents | Opt into glass **explicitly**, via `expo-glass-effect` |
| **Text over photos** | **Always put your own scrim underneath.** Glass over arbitrary photography is a legibility hazard — and we are a photo app, so this is not a corner case |

This preserves the bold, maximalist direction while staying on Apple's supported path — and, with `hidesSharedBackground`, we keep per-item control where it matters most.

---

## 6. X.2 — Recovery. **Designed. This was the ship-blocker.**

### The insight that reframes the problem

> **Ente, Signal, and 1Password each hold your *ciphertext* on a server — so their recovery key alone suffices.**
>
> **We have no ciphertext custodian.** The user is therefore custodian of **both the key and the ciphertext.**
>
> **An Emergency Kit with no backup archive to open is a worthless piece of paper — and a dangerous false sense of safety.**

So we ship **two artifacts**, and **gate onboarding on both**:
1. A **printed Emergency Kit** containing a **24-word BIP39-encoded 256-bit Recovery Key**.
2. A **configured backup destination** holding encrypted archives.

### The structural fix: a Workspace Master Key

Today the **DB key is the root** — which is why the repo **cannot rotate it without invalidating every recovery envelope.**

Introduce a **Workspace Master Key (WMK)** above it:

- **WMK** — 32 random bytes, minted once. A **key-encrypting key only**: it never encrypts data, never leaves the desktop unwrapped, and **never goes to the phone.**
- **WMK wraps three secrets**, each with a distinct AAD label:
  - `DBK` — the SQLCipher key, now **random and wrapped** rather than the root, so `PRAGMA rekey` touches only `DBK` and **the printed Emergency Kit stays valid forever**.
  - `IDK` — the sync identity (Ed25519 + X25519).
  - `BUK` — the backup-archive key.
- **WMK itself has three unwrap slots:**
  - `wrap_os` — macOS Keychain via `safeStorage`. **The daily path.** Dies with a wiped Keychain or a new Mac.
  - `wrap_rk` — AES-256-GCM under `HKDF-SHA-512(RecoveryKey, salt=workspaceId)`. **The crisis path.** Survives everything the paper survives. **No stretching** — the Recovery Key already has 256 bits of entropy.
  - `wrap_pp` — an optional passphrase (Argon2id). **Label it in the UI as "a shortcut, not a backup"** — with no server rate-limiter, this slot is **offline-brute-forceable by construction.**

### 🔴 The bug this exposes, and it makes the current scheme decorative

> Today `crossage_fr/crypto.py` encrypts backup archives under a **separate operator passphrase** (`VINTRACE_BACKUP_PASSPHRASE`) that has **no relationship to the recovery envelope.**
>
> **So when the disk dies, the Emergency Kit cannot open the backup.** Unify them under `BUK`, or the entire recovery story is theatre.

Also delete `wrappedRecoveryPassphrase` (`workspace-encryption.cjs`): it stores the user's passphrase on disk purely so rotation can re-wrap the envelope. Once `DBK` sits under WMK, **rotation needs no user secret at all.** Remove the hack rather than hardening it.

### 🔴 A premise error corrected

> **Apple's CryptoKit exposes only `SecureEnclave.P256`. There is no `SecureEnclave.Curve25519`.**
>
> Our Ed25519 + X25519 sync identity therefore **cannot be Secure-Enclave-resident.** (An earlier draft of the spec implied it could.)

**Do now:** keep the identity as a Keychain data item, `WhenUnlockedThisDeviceOnly`, gated by `BIOMETRY_CURRENT_SET`.
**Do not plan on:** migrating to P-256 for true SE non-exportability — it is a **wire-protocol break on both ends**, not a free upgrade.

### The phone is a cache, not a vault — make this load-bearing

Because the desktop is authoritative for everything, **losing the phone's key costs zero data: wipe and re-pair.** That is what lets us use the strict `BIOMETRY_CURRENT_SET` ACL (which self-invalidates on Face ID re-enrollment) **without fear**, and it is why **the phone needs no recovery artifact of its own.**

⚠️ **Do not use `expo-secure-store`'s `requireAuthentication`** — it maps to `kSecAccessControlUserPresence`, which **permits device-passcode fallback**. Use `react-native-keychain` with `BIOMETRY_CURRENT_SET`. That single detail decides the "attacker has the phone *and* its PIN" scenario.

### What the phone can and cannot restore — say this out loud in the UI

The phone holds a **catalog-only replica**: no originals, no embeddings, no face templates.

> **It can restore your *words* — captions, keywords, ratings, album membership, people names. It can never restore your *pixels*.**

The UI must say exactly that. Anything vaguer is a lie the user will only discover on the worst day of their digital life.
