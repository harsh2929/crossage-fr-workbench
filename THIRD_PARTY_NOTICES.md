# Third-Party Notices

Vintrace includes or distributes the following third-party software. Each
component remains subject to its own license terms.

## Whisper.cpp, PyWhisperCpp, and Whisper tiny

Runtime: PyWhisperCpp 1.5.0 with whisper.cpp revision `9386f23`  
Model: multilingual Whisper tiny `q5_1` GGML  
Model source: https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1  
Upstream model: https://github.com/openai/whisper/tree/v20250625  
License: MIT

Vintrace uses these components entirely on device for timestamped speech
transcription. The model path is integrity-pinned and no runtime model download
is permitted. Complete license texts are distributed in `models/audio`.

## TensorFlow YAMNet

Model source: https://github.com/tensorflow/models/tree/5c597f85268743140854f0e670f2175e8668553a/research/audioset/yamnet  
License: Apache-2.0  
Changes: the official Keras checkpoint was converted to an ONNX core model;
Vintrace supplies the official log-mel preprocessing in NumPy and limits stored
labels to a concrete, non-biometric sound-event allowlist.

The pinned source/checkpoint hashes, conversion versions, numerical parity
results, model hashes, and full Apache-2.0 text are distributed in
`models/audio/manifest.json` and `models/audio/YAMNET-LICENSE`.

## SQLCipher and sqlcipher3

SQLCipher project: https://github.com/sqlcipher/sqlcipher  
Python binding: https://github.com/coleifer/sqlcipher3  
Binding version: 0.6.2  
SQLCipher license: BSD-3-Clause  
sqlcipher3 binding license: MIT/Zlib-style notice

Vintrace distributes the `sqlcipher3` wheel and its statically linked SQLCipher
runtime to encrypt workspace SQLite databases, journals, and snapshots.

Copyright (c) 2025, ZETETIC LLC. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of ZETETIC LLC nor the names of its contributors may be
   used to endorse or promote products derived from this software without
   specific prior written permission.

THIS SOFTWARE IS PROVIDED BY ZETETIC LLC "AS IS" AND ANY EXPRESS OR IMPLIED
WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO
EVENT SHALL ZETETIC LLC BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS;
OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR
OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED
OF THE POSSIBILITY OF SUCH DAMAGE.

The sqlcipher3 binding retains this notice:

Copyright (c) 2004-2007 Gerhard Häring

This software is provided 'as-is', without any express or implied warranty. In
no event will the authors be held liable for any damages arising from the use
of this software.

Permission is granted to anyone to use this software for any purpose,
including commercial applications, and to alter it and redistribute it freely,
subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not claim
   that you wrote the original software. If you use this software in a product,
   an acknowledgment in the product documentation would be appreciated but is
   not required.
2. Altered source versions must be plainly marked as such, and must not be
   misrepresented as being the original software.
3. This notice may not be removed or altered from any source distribution.

## C2PA Python SDK

Project: https://github.com/contentauth/c2pa-python  
Version: 0.36.0 (native c2pa-rs SDK 0.89.0)  
License: Apache-2.0 OR MIT

Vintrace distributes the official Content Authenticity Initiative Python SDK
and its native platform library to read, validate, create, and embed C2PA 2.4
Content Credentials. Vintrace uses an offline workspace-local signer; this is
not an assertion that the signer appears on the global C2PA Trust List.

Copyright 2023-2026 Adobe and c2pa-rs contributors.

The complete upstream Apache-2.0 and MIT license texts are distributed as
`licenses/C2PA-LICENSE-APACHE.txt` and `licenses/C2PA-LICENSE-MIT.txt`.

## osxphotos

Project: https://github.com/RhetTbull/osxphotos  
Version: 0.76.1  
License: MIT

Copyright (c) 2019-2021 Rhet Turnbull

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Model Context Protocol Apps SDK

Project: https://github.com/modelcontextprotocol/ext-apps  
Package: `@modelcontextprotocol/ext-apps`  
Version: 1.7.4  
License: Apache-2.0 with unrelicensed contributions retained under MIT

Vintrace bundles the SDK's browser `App` client into the path-free image-review
resource and adds a small compatibility adapter. The exact upstream transition,
Apache-2.0, and MIT license text is packaged in the MCPB under
`licenses/MCP-Apps-SDK-LICENSE.txt`.

## node-qrcode

Project: https://github.com/soldair/node-qrcode  
Package: `qrcode`  
Version: 1.5.4  
License: MIT

Vintrace uses the browser build locally in the desktop renderer to turn a
one-use mobile pairing URL into a QR code. Pairing data is not sent to a QR
generation service.

Copyright (c) 2012 Ryan Day

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## python-zeroconf

Project: https://github.com/python-zeroconf/python-zeroconf  
Package: `zeroconf`  
Version: 0.149.17  
License: GNU Lesser General Public License 2.1 or later

Vintrace uses python-zeroconf only for operator-enabled Bonjour discovery of
encrypted local-sync peers on the private network. The complete license text is
packaged in `zeroconf-0.149.17.dist-info/licenses/COPYING`.

## ifaddr

Project: https://github.com/pydron/ifaddr  
Package: `ifaddr`  
Version: 0.2.0  
License: MIT

Vintrace receives local interface addresses through ifaddr as a dependency of
python-zeroconf. The complete license text is packaged in
`ifaddr-0.2.0.dist-info/LICENSE.txt`.

## eDifFIQA(T)

Model: `ediffiqa_tiny_jun2024.onnx`  
Source: https://github.com/opencv/opencv_zoo/tree/8bdc41bb5e3db55a99aec2902412f3d930524892/models/face_image_quality_assessment_ediffiqa  
Attribution: OpenCV Zoo contributors; eDifFIQA(T) model  
License: Creative Commons Attribution 4.0 International (CC-BY-4.0)  
License URL: https://creativecommons.org/licenses/by/4.0/  
Changes to the model: none

The complete license text is distributed at `models/fiq/LICENSE` inside the
source tree and packaged backend.

## Syn-Vis-v0 fixed face cohort

Dataset: Syn-Vis-v0: A Dataset of Synthetic Faces  
Source: https://huggingface.co/datasets/retowyss/Syn-Vis-v0/tree/100262732989e77f38cd831d70a376a93735006a  
Attribution: Reto Wyss, Syn-Vis-v0 (2025)  
Individual source-image license: CC0 1.0 Universal  
Curation and documentation license: CC-BY-SA-4.0

Vintrace does not distribute the source images. It distributes 60 normalized,
model-specific embedding vectors derived from a pinned sample for symmetric
AS-Norm. Provenance, source-image hashes, selection counts, recognizer hashes,
and known demographic/appearance limitations are recorded in
`models/cohort/manifest.json` and `models/cohort/README.md`.

## SigLIP 2 semantic search and synthetic-enrollment screen

Encoder: `google/siglip2-base-patch16-256` (`onnx-community` ONNX export)  
Source: https://huggingface.co/onnx-community/siglip2-base-patch16-256-ONNX  
License: Apache License 2.0  
Distributed artifacts: uint8 vision ONNX, uint8 text ONNX, and Gemma tokenizer  
Changes: artifacts are redistributed unchanged for offline photo/video semantic
search; the vision encoder is also consumed by a Vintrace-trained linear review
head

The linear head is trained from an allowlisted Public Domain/CC0 U.S. Congress
portrait set, Syn-Vis-v0 (images CC0-1.0; curation CC-BY-SA-4.0), and SFHQ-T2I
version 1 (MIT). The classifier and sanitized provenance metadata are distributed
under CC-BY-SA-4.0 with attribution to Vintrace and Syn-Vis-v0 curation by Reto
Wyss. No source images or face embeddings are distributed in this model pack.
Exact revisions, training/split hashes, benchmark boundaries, and license links
are recorded in `models/synthetic-screen/manifest.json` and
`models/synthetic-screen/LICENSES.md`.

The official FSFM checkpoint is CC-BY-NC-4.0 and is explicitly excluded from
the product and training lineage.

## PaddleOCR PP-OCRv6 via RapidOCR

Runtime: RapidOCR 3.9.1  
Runtime source: https://github.com/RapidAI/RapidOCR/tree/v3.9.1  
Upstream models: PaddleOCR PP-OCRv6 small detector and multilingual recognizer  
Upstream release: https://github.com/PaddlePaddle/PaddleOCR/releases/tag/v3.7.0  
License: Apache License 2.0  
Changes: RapidOCR ONNX conversions are redistributed unchanged; Vintrace adds
an integrity manifest and passes the local model paths explicitly for offline
CPU inference.

The bundled recognition conversion embeds its multilingual character
dictionary and therefore differs byte-for-byte from PaddlePaddle's official
ONNX export. Both upstream and redistributed artifact commits, sizes, and
SHA-256 values are recorded in `models/ocr/manifest.json`. The full Apache-2.0
license is distributed at `models/ocr/LICENSE` inside the source tree and
packaged backend.

## Qwen3-VL portable photo caption model

Model: `Qwen/Qwen3-VL-4B-Instruct-GGUF` (`Q4_K_M` language model with the
`Q8_0` vision projector)  
Source: https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/tree/1cd86afb9a95c410a6038ab3b40d8b578c892266  
Upstream model: https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct/tree/ebb281ec70b05090aa6165b016eac8ec08e71b17  
License: Apache License 2.0  
Changes: none to the optional downloaded GGUF artifacts; Vintrace adds a
restricted caption/tag prompt, integrity verification, and local capability
routing.

## SmolVLM2 portable low-memory photo caption model

Model: `ggml-org/SmolVLM2-2.2B-Instruct-GGUF` (`Q4_K_M` language model with
the `Q8_0` vision projector)  
Source: https://huggingface.co/ggml-org/SmolVLM2-2.2B-Instruct-GGUF/tree/1bc3c9f74ceafd4c8d4411cc9cf188bba3798f91  
Upstream model: https://huggingface.co/HuggingFaceTB/SmolVLM2-2.2B-Instruct/tree/482adb537c021c86670beed01cd58990d01e72e4  
License: Apache License 2.0  
Changes: none to the optional downloaded GGUF artifacts; Vintrace adds a
restricted caption/tag prompt, integrity verification, and local capability
routing.

## llama.cpp portable VLM runtime

Runtime: llama.cpp `b9969` (`76f2798059575a96a12e4d34342165a4b6a6a312`)  
Source: https://github.com/ggml-org/llama.cpp/releases/tag/b9969  
License: MIT  
Changes: none to the optional platform runtime archive. Vintrace starts the
verified `llama-server` binary on loopback with an ephemeral API key, local
model paths, disabled Web UI/MCP proxy, and `--offline` forced.

The exact model/runtime revisions, artifact sizes, SHA-256 values, memory tiers,
and platform archives are distributed in `models/vlm/catalog.json`. Full Apache
2.0 and llama.cpp MIT license texts are packaged beside that catalog.

## LaMa local photo inpainting

Model: OpenCV `inpainting_lama_2025jan.onnx` at revision
`aee6d22f0a13e5e35af1c9a1c3afd62841fc6f3f`  
Source: https://huggingface.co/opencv/inpainting_lama  
Upstream project: https://github.com/advimman/lama  
License: Apache License 2.0  
Changes: none to the optional downloaded ONNX model. Vintrace adds local
ONNX Runtime execution, bounded brush masks, exact outside-mask composition,
artifact integrity checks, and non-destructive edit provenance.

## Real-ESRGAN local photo upscaling

Runtime/model: Real-ESRGAN NCNN/Vulkan `v0.2.5.0`  
Source: https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.2.5.0  
License: Real-ESRGAN BSD-3-Clause; NCNN BSD-3-Clause; portable wrapper MIT  
Changes: none to the optional runtime archive or model. Vintrace invokes the
verified 4x model with bounded explicit tiling and locally downsamples that
result when a 2x output is requested.

## Qwen Image Edit local heavy tier

Model: `Qwen/Qwen-Image-Edit-2511` at revision
`6f3ccc0b56e431dc6a0c2b2039706d7d26f22cb9`  
Source: https://huggingface.co/Qwen/Qwen-Image-Edit-2511  
Quantized diffusion source: https://huggingface.co/unsloth/Qwen-Image-Edit-2511-GGUF  
Supporting components: https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI  
License: Apache License 2.0  
Changes: none to the optional downloaded model files. Vintrace adds fixed
identity-preserving mode prompts, deterministic bounded parameters, hardware
gating, explicit large-download consent, and non-destructive provenance.

## stable-diffusion.cpp local image runtime

Runtime: `master-775-b5d8120` (`b5d812008eb7082a238fc589444544b3278187ae`)  
Source: https://github.com/leejet/stable-diffusion.cpp/releases/tag/master-775-b5d8120  
License: MIT  
Changes: none to the optional platform archive. Vintrace verifies every
extracted member and launches `sd-cli` without a shell, with offline environment
flags and only pinned local model paths.

The exact generative model/runtime revisions, platform archives, byte sizes,
SHA-256 values, memory gates, and license links are distributed in
`models/generative/catalog.json` and `models/generative/LICENSES.md`.
