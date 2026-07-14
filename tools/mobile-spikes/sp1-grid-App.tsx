/**
 * SP-1 — Can React Native hold a Photos-grade grid over a 100k-asset library?
 *
 * Mirrors the real architecture: the phone fetches thumbnails over the network from the
 * paired Mac (here, a local server) rather than reading a bundled asset. Server-side cache
 * is disabled, so every cell fetch is a real fetch + decode — a cold scroll over an
 * un-cached library. That is the worst case, and the one that matters.
 *
 * Two modes, because the claim under test is specifically about IMAGE MEMORY:
 *   THUMB — 256px thumbnails (the correct pipeline)
 *   FULL  — 4032x3024 originals (the naive pipeline reported to spike to 1.53 GB and crash)
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, Dimensions } from 'react-native'
import { FlashList, FlashListRef } from '@shopify/flash-list'
import { Image } from 'expo-image'
import { runVecBench } from './vecbench'

const HOST = 'http://localhost:8099'
const ITEM_COUNT = 100_000
const COLS = 5
const CORPUS = 60

type Mode = 'THUMB' | 'FULL' | 'THUMB_CACHED' | 'VEC'

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window')
const CELL = SCREEN_W / COLS

type Item = { id: number }
const DATA: Item[] = Array.from({ length: ITEM_COUNT }, (_, i) => ({ id: i }))

// A sustained fast flick: 400 near-viewport steps.
const STEPS = 400
const STEP_MS = 100

function Cell({ id, mode }: { id: number; mode: Mode }) {
  const n = id % CORPUS
  const uri = `${HOST}/${mode === 'FULL' ? 'full' : 'thumb'}/${n}.jpg`
  // THUMB_CACHED = what the real app does: disk+memory cache the thumbnail the Mac sent us.
  return (
    <Image
      source={{ uri }}
      style={{ width: CELL - 2, height: CELL - 2, margin: 1, backgroundColor: '#222' }}
      recyclingKey={String(id)}
      cachePolicy={mode === 'THUMB_CACHED' ? 'memory-disk' : 'none'}
      contentFit="cover"
      transition={0}
    />
  )
}

export default function App() {
  const listRef = useRef<FlashListRef<Item>>(null)
  const [mode, setMode] = useState<Mode | null>(null)
  const [status, setStatus] = useState('fetching mode')
  const frames = useRef<number[]>([])
  const sampling = useRef(false)
  const mountedAt = useRef(Date.now())
  const firstFrameAt = useRef<number | null>(null)

  useEffect(() => {
    fetch(`${HOST}/mode`)
      .then((r) => r.text())
      .then((m) => {
        const t = m.trim() as Mode
        setMode(['FULL','THUMB_CACHED','VEC'].includes(t) ? t : 'THUMB')
        setStatus('mounting')
      })
      .catch(() => { setMode('THUMB'); setStatus('mode fetch failed, defaulting THUMB') })
  }, [])

  // rAF sampler: inter-frame deltas on the JS thread for the duration of the scroll.
  useEffect(() => {
    let raf: number
    let last = performance.now()
    const tick = (t: number) => {
      if (sampling.current) {
        const dt = t - last
        if (dt > 0 && dt < 2000) frames.current.push(dt)
      }
      last = t
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const run = useCallback(async () => {
    setStatus('scrolling')
    sampling.current = true
    const t0 = Date.now()

    for (let i = 1; i <= STEPS; i++) {
      listRef.current?.scrollToOffset({ offset: i * SCREEN_H * 0.9, animated: false })
      await new Promise((r) => setTimeout(r, STEP_MS))
    }

    sampling.current = false
    const durationMs = Date.now() - t0
    const f = frames.current.slice().sort((a, b) => a - b)
    const pct = (p: number) => (f.length ? f[Math.min(f.length - 1, Math.floor(f.length * p))] : 0)
    const sum = f.reduce((a, b) => a + b, 0)
    const avg = sum / (f.length || 1)

    const result = {
      spike: 'SP-1',
      mode: mode,
      itemCount: ITEM_COUNT,
      columns: COLS,
      cellPx: Math.round(CELL),
      steps: STEPS,
      scrolledPx: Math.round(STEPS * SCREEN_H * 0.9),
      durationMs,
      framesSampled: f.length,
      avgFrameMs: +avg.toFixed(2),
      medianFrameMs: +pct(0.5).toFixed(2),
      p95FrameMs: +pct(0.95).toFixed(2),
      p99FrameMs: +pct(0.99).toFixed(2),
      maxFrameMs: +(f[f.length - 1] || 0).toFixed(2),
      effectiveFps: +(1000 / avg).toFixed(1),
      framesOver16ms: f.filter((x) => x > 16.67).length,
      framesOver33ms: f.filter((x) => x > 33.3).length,
      framesOver100ms: f.filter((x) => x > 100).length,
      pctFramesOver16ms: +((100 * f.filter((x) => x > 16.67).length) / (f.length || 1)).toFixed(1),
      timeToFirstFrameMs: firstFrameAt.current ? firstFrameAt.current - mountedAt.current : null,
    }

    try {
      const st = await (await fetch(`${HOST}/stats`)).json()
      ;(result as any).serverImageRequests = st.reqCount
      ;(result as any).serverMBServed = st.mb
    } catch {}
    setStatus(`done: ${result.effectiveFps} fps`)
    try {
      await fetch(`${HOST}/result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(result),
      })
    } catch (e) {
      setStatus('POST failed: ' + String(e))
    }
  }, [mode])

  const onFirstDraw = useCallback(() => {
    if (firstFrameAt.current == null) {
      firstFrameAt.current = Date.now()
      setTimeout(run, 1500)
    }
  }, [run])

  useEffect(() => {
    if (mode !== 'VEC') return
    setStatus('SP-2: building 100k-vector index...')
    runVecBench()
      .then((r) => setStatus('SP-2 done: ' + JSON.stringify(r).slice(0, 200)))
      .catch((e) => setStatus('SP-2 failed: ' + String(e)))
  }, [mode])

  if (!mode || mode === 'VEC') {
    return (
      <View style={styles.root}>
        <Text style={styles.hudText}>{status}</Text>
      </View>
    )
  }

  return (
    <View style={styles.root}>
      <FlashList
        ref={listRef}
        data={DATA}
        numColumns={COLS}
        keyExtractor={(it) => String(it.id)}
        renderItem={({ item }) => <Cell id={item.id} mode={mode!} />}
        onLoad={onFirstDraw}
      />
      <View style={styles.hud}>
        <Text style={styles.hudText}>
          {mode} · {ITEM_COUNT.toLocaleString()} items · {status}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', paddingTop: 60 },
  hud: { position: 'absolute', top: 0, left: 0, right: 0, padding: 10, backgroundColor: '#111' },
  hudText: { color: '#0f0', fontSize: 12, fontFamily: 'Menlo' },
})
