/**
 * On-device semantic search — the crown-jewel capability, and the first thing that beats Apple
 * Photos: natural-language photo search with NO Apple Intelligence gate, NO cloud, offline.
 *
 * CLIP ViT-B/32 (image + text encoders) via react-native-executorch (ExecuTorch / XNNPACK). Both
 * encoders map into the same 512-d space, so a text query and a photo are directly comparable by
 * cosine. We L2-normalize both sides and store image embeddings in the sqlite-vec replica table;
 * a query becomes a text embedding and a KNN over that table returns the matching photos.
 *
 * Per spec §3.1 the desktop is the heavyweight oracle and would sync image embeddings; here we also
 * prove the phone can compute them itself with the free/on-device image encoder — the hybrid the
 * spec calls for (phone indexes NEW photos incrementally, desktop backfills the library).
 */
import {
  ImageEmbeddingsModule,
  TextEmbeddingsModule,
  initExecutorch,
  CLIP_VIT_BASE_PATCH32_IMAGE_QUANTIZED,
  CLIP_VIT_BASE_PATCH32_TEXT,
} from 'react-native-executorch';
import { ExpoResourceFetcher } from 'react-native-executorch-expo-resource-fetcher';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export const CLIP_DIM = 512;

let imageModule: ImageEmbeddingsModule | null = null;
let textModule: TextEmbeddingsModule | null = null;
let executorchReady = false;

/** Register the download adapter once (executorch v0.9 requires an explicit resource fetcher). */
function ensureExecutorch(): void {
  if (executorchReady) return;
  initExecutorch({ resourceFetcher: ExpoResourceFetcher });
  executorchReady = true;
}

export type LoadProgress = { stage: 'image' | 'text'; progress: number };

/** Download + load both CLIP encoders. Idempotent. Reports coarse progress. */
export async function loadClip(onProgress?: (p: LoadProgress) => void): Promise<void> {
  ensureExecutorch();
  if (!imageModule) {
    imageModule = await ImageEmbeddingsModule.fromModelName(
      {
        modelName: CLIP_VIT_BASE_PATCH32_IMAGE_QUANTIZED.modelName,
        modelSource: CLIP_VIT_BASE_PATCH32_IMAGE_QUANTIZED.modelSource,
      },
      (p) => onProgress?.({ stage: 'image', progress: p }),
    );
  }
  if (!textModule) {
    textModule = await TextEmbeddingsModule.fromModelName(
      {
        modelName: CLIP_VIT_BASE_PATCH32_TEXT.modelName,
        modelSource: CLIP_VIT_BASE_PATCH32_TEXT.modelSource,
        tokenizerSource: CLIP_VIT_BASE_PATCH32_TEXT.tokenizerSource,
      },
      (p) => onProgress?.({ stage: 'text', progress: p }),
    );
  }
}

export function clipReady(): boolean {
  return imageModule !== null && textModule !== null;
}

function l2normalize(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/**
 * Normalize any image (HEIC included) to a JPEG file:// URI the executorch image reader can decode.
 *
 * iOS ImageIO — which expo-image-manipulator uses under the hood — decodes HEIC; executorch's
 * XNNPACK image reader does NOT (it throws "invalid argument" on HEIC), and a real iPhone library is
 * almost entirely HEIC. Transcoding every image to JPEG makes the whole library indexable and also
 * (a) bounds decode memory by downscaling the 12 MP originals and (b) bakes EXIF orientation upright
 * via renderAsync(). We only resize to a moderate longest edge — executorch resizes to 224×224
 * internally, so anything larger is wasted work — and preserve aspect (no pre-distortion).
 */
async function toDecodableJpeg(uri: string): Promise<string> {
  const ctx = ImageManipulator.manipulate(uri);
  ctx.resize({ width: 512 }); // height omitted → aspect ratio preserved
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
  return out.uri;
}

/** Embed one image (by URI) into the shared CLIP space, L2-normalized. */
export async function embedImage(uri: string): Promise<Float32Array> {
  if (!imageModule) throw new Error('CLIP image encoder not loaded');
  const jpegUri = await toDecodableJpeg(uri);
  return l2normalize(await imageModule.forward(jpegUri));
}

/** Embed a text query into the shared CLIP space, L2-normalized. */
export async function embedText(text: string): Promise<Float32Array> {
  if (!textModule) throw new Error('CLIP text encoder not loaded');
  return l2normalize(await textModule.forward(text));
}
