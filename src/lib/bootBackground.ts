/**
 * "Plasma Silk" — the living-color boot background.
 *
 * A self-contained WebGL1 (GLSL ES 1.00) fragment shader that paints a
 * domain-warped fractal-Brownian-motion field folding slowly through a curated
 * teal -> blue -> indigo -> violet -> magenta silk ramp. Runs entirely on the
 * GPU as a single full-screen triangle driven by a uTime uniform, so it holds
 * 60fps for ~zero main-thread cost.
 *
 * Zero dependencies, zero network — safe for the offline/privacy-first packaged
 * app. Gracefully degrades: if WebGL is unavailable / the shader fails / the
 * context is lost, it adds `boot-no-webgl` to the root element so the CSS mesh
 * fallback shows (never a black screen). Honors prefers-reduced-motion by
 * rendering exactly one static frame. `init` returns a teardown that cancels
 * the rAF loop, removes every listener, and releases the GL context.
 */

const VERT = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;

// --- value noise (smooth, cheap) ---
float hash(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i + vec2(0.0, 0.0));
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// --- fractal Brownian motion: 5 octaves, rotated each step ---
float fbm(vec2 p){
  float v = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 5; i++){
    v += amp * noise(p);
    p = rot * p * 2.0 + 0.03;
    amp *= 0.5;
  }
  return v;
}

// curated silk ramp: teal -> electric blue -> indigo -> violet -> magenta
vec3 palette(float t){
  t = clamp(t, 0.0, 1.0);
  vec3 teal    = vec3(0.04, 0.42, 0.50);
  vec3 blue    = vec3(0.10, 0.36, 0.92);
  vec3 indigo  = vec3(0.30, 0.20, 0.78);
  vec3 violet  = vec3(0.55, 0.22, 0.80);
  vec3 magenta = vec3(0.92, 0.32, 0.70);
  vec3 col;
  if (t < 0.25)      col = mix(teal,   blue,    smoothstep(0.0,  0.25, t));
  else if (t < 0.5)  col = mix(blue,   indigo,  smoothstep(0.25, 0.5,  t));
  else if (t < 0.75) col = mix(indigo, violet,  smoothstep(0.5,  0.75, t));
  else               col = mix(violet, magenta, smoothstep(0.75, 1.0,  t));
  return col;
}

// ordered 8x8-derived Bayer dither -> kills gradient banding on 8-bit displays
float bayer(vec2 fragcoord){
  vec2 p = floor(mod(fragcoord, 4.0));
  int idx = int(p.x) + int(p.y) * 4;
  float m = 0.0;
  if(idx==0) m=0.0;   else if(idx==1) m=8.0;  else if(idx==2) m=2.0;  else if(idx==3) m=10.0;
  else if(idx==4) m=12.0; else if(idx==5) m=4.0; else if(idx==6) m=14.0; else if(idx==7) m=6.0;
  else if(idx==8) m=3.0;  else if(idx==9) m=11.0; else if(idx==10) m=1.0; else if(idx==11) m=9.0;
  else if(idx==12) m=15.0; else if(idx==13) m=7.0; else if(idx==14) m=13.0; else m=5.0;
  return (m / 16.0) - 0.5;
}

void main(){
  // aspect-correct, centered coords
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes.xy) / uRes.y;
  float t = uTime * 0.06;

  // --- DOMAIN WARP (two folds): fbm of fbm of fbm = liquid silk ---
  vec2 q = vec2(
    fbm(p * 1.6 + vec2(0.0, t)),
    fbm(p * 1.6 + vec2(5.2, -t * 0.8))
  );
  vec2 r = vec2(
    fbm(p * 1.6 + 3.0 * q + vec2(1.7, 9.2) + t * 0.5),
    fbm(p * 1.6 + 3.0 * q + vec2(8.3, 2.8) - t * 0.4)
  );
  float f = fbm(p * 1.6 + 3.5 * r + t * 0.3);

  // map the folded field into the curated ramp; q/r add slow hue travel
  float hue = f + 0.28 * length(q) + 0.16 * r.x + 0.06 * sin(t * 1.3);
  vec3 col = palette(fract(hue));

  // depth shading: peaks of the flow glow, troughs sink (adds 3D fold feel)
  float shade = smoothstep(0.1, 1.0, f);
  col *= 0.55 + 0.85 * shade;

  // RARE warm highlight where the fold crests hardest (amber/rose), masked tight
  float crest = smoothstep(0.72, 0.96, f) * smoothstep(0.55, 0.9, length(r));
  vec3 warm = mix(vec3(1.0, 0.62, 0.32), vec3(1.0, 0.42, 0.55), r.x);
  col = mix(col, warm, crest * 0.55);

  // luminous lift + gentle saturation so it reads as light, not paint
  col += 0.06 * vec3(0.4, 0.6, 1.0) * shade;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, 1.16);

  // filmic tonemap so the brightest magenta crests read photographic, not blown
  col = col / (col + 0.55);
  col = pow(col, vec3(0.86));

  // soft radial vignette baked in for depth
  float vig = smoothstep(1.35, 0.25, length(p));
  col *= 0.5 + 0.5 * vig;

  // film grain (animated) — subtle, keeps it from feeling flat/CG
  float grain = hash(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5;
  col += grain * 0.025;

  // ordered dither in the last bit to defeat 8-bit banding
  col += bayer(gl_FragCoord.xy) * (1.5 / 255.0);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

/**
 * Start the living background on `canvas`. `root` is the `.boot` element that
 * receives the `boot-no-webgl` class when falling back to the CSS mesh.
 * Returns a teardown function — call it on unmount.
 */
export function initBootBackground(
  canvas: HTMLCanvasElement,
  root: HTMLElement | null
): () => void {
  const noop = () => {};
  if (typeof window === "undefined") return noop;

  const DPR_CAP = 2;
  const reduce =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const markFallback = () => {
    if (root) root.classList.add("boot-no-webgl");
  };

  let gl: WebGLRenderingContext | null = null;
  try {
    const opts: WebGLContextAttributes = {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "low-power",
    };
    gl =
      (canvas.getContext("webgl", opts) as WebGLRenderingContext | null) ||
      (canvas.getContext("experimental-webgl", opts) as WebGLRenderingContext | null);
  } catch {
    gl = null;
  }
  if (!gl) {
    markFallback();
    return noop;
  }
  const glc = gl;

  const compile = (type: number, src: string): WebGLShader | null => {
    const sh = glc.createShader(type);
    if (!sh) return null;
    glc.shaderSource(sh, src);
    glc.compileShader(sh);
    if (!glc.getShaderParameter(sh, glc.COMPILE_STATUS)) {
      glc.deleteShader(sh);
      return null;
    }
    return sh;
  };

  const vs = compile(glc.VERTEX_SHADER, VERT);
  const fs = compile(glc.FRAGMENT_SHADER, FRAG);
  let prog: WebGLProgram | null = vs && fs ? glc.createProgram() : null;
  if (prog && vs && fs) {
    glc.attachShader(prog, vs);
    glc.attachShader(prog, fs);
    glc.linkProgram(prog);
    if (!glc.getProgramParameter(prog, glc.LINK_STATUS)) prog = null;
  }
  if (!prog) {
    markFallback();
    return noop;
  }
  glc.useProgram(prog);

  // full-screen triangle (covers clip space with one tri = fewer verts)
  const buf = glc.createBuffer();
  glc.bindBuffer(glc.ARRAY_BUFFER, buf);
  glc.bufferData(glc.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), glc.STATIC_DRAW);
  const aPos = glc.getAttribLocation(prog, "aPos");
  glc.enableVertexAttribArray(aPos);
  glc.vertexAttribPointer(aPos, 2, glc.FLOAT, false, 0, 0);

  const uRes = glc.getUniformLocation(prog, "uRes");
  const uTime = glc.getUniformLocation(prog, "uTime");

  let width = 0;
  let height = 0;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    const w = Math.max(1, Math.round(window.innerWidth * dpr));
    const h = Math.max(1, Math.round(window.innerHeight * dpr));
    if (w === width && h === height) return;
    width = w;
    height = h;
    canvas.width = w;
    canvas.height = h;
    glc.viewport(0, 0, w, h);
    glc.uniform2f(uRes, w, h);
  };

  let raf = 0;
  let running = false;
  let contextLost = false;
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const startT = now();

  const renderOnce = (nowMs: number) => {
    if (contextLost) return;
    glc.uniform1f(uTime, (nowMs - startT) / 1000);
    glc.drawArrays(glc.TRIANGLES, 0, 3);
    if (!canvas.classList.contains("ready")) canvas.classList.add("ready");
  };
  const loop = (ts: number) => {
    if (!running) return;
    renderOnce(ts);
    raf = window.requestAnimationFrame(loop);
  };
  const start = () => {
    if (running || contextLost) return;
    running = true;
    raf = window.requestAnimationFrame(loop);
  };
  const stop = () => {
    running = false;
    if (raf) {
      window.cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  resize();

  const onResize = () => {
    resize();
    if (!running && !contextLost) renderOnce(now());
  };
  const onLost = (ev: Event) => {
    ev.preventDefault();
    contextLost = true;
    stop();
    markFallback();
  };
  const onVisibility = () => {
    if (document.hidden) stop();
    else if (!reduce && !contextLost) start();
  };

  window.addEventListener("resize", onResize);
  canvas.addEventListener("webglcontextlost", onLost, false);
  document.addEventListener("visibilitychange", onVisibility, false);

  if (reduce) renderOnce(startT + 6200); // one hand-picked, pleasing static frame
  else start();

  return () => {
    stop();
    window.removeEventListener("resize", onResize);
    canvas.removeEventListener("webglcontextlost", onLost);
    document.removeEventListener("visibilitychange", onVisibility);
    const ext = glc.getExtension("WEBGL_lose_context");
    if (ext) {
      try {
        ext.loseContext();
      } catch {
        /* ignore */
      }
    }
  };
}
