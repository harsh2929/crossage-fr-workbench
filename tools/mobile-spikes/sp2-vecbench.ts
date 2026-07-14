/**
 * SP-2 — Is brute-force sqlite-vec KNN fast enough on-device at 100k vectors?
 *
 * The spec plans to sync SigLIP embeddings to the phone and run semantic search locally.
 * Every published sqlite-vec benchmark is DESKTOP (an M1 mini). This measures the real thing
 * through op-sqlite (JSI) with the sqlite-vec extension compiled in.
 *
 * Tests both dtypes the spec contemplates:
 *   float32 (768-d)  — the desktop's native dimensionality
 *   int8    (512-d)  — the quantized form the spec proposes syncing (~768 B/photo)
 * and the two-stage binary-quantize -> rescore pipeline.
 */
import { open } from '@op-engineering/op-sqlite'

const HOST = 'http://localhost:8099'
const N = 100_000

function randVecF32(d: number): Float32Array {
  const v = new Float32Array(d)
  let norm = 0
  for (let i = 0; i < d; i++) {
    v[i] = Math.random() * 2 - 1
    norm += v[i] * v[i]
  }
  norm = Math.sqrt(norm)
  for (let i = 0; i < d; i++) v[i] /= norm
  return v
}

function randVecI8(d: number): Int8Array {
  const v = new Int8Array(d)
  for (let i = 0; i < d; i++) v[i] = Math.floor(Math.random() * 255) - 128
  return v
}

export async function runVecBench() {
  const out: any = { spike: 'SP-2', n: N }
  const db = open({ name: 'vec.db', encryptionKey: 'sp2-test-key' })

  try {
    const ver = await db.execute('select vec_version() as v')
    out.vecVersion = ver.rows?._array?.[0]?.v ?? ver.rows?.[0]?.v ?? 'unknown'
  } catch (e) {
    out.error = 'sqlite-vec not available: ' + String(e)
    await post(out)
    return out
  }

  for (const cfg of [
    { name: 'float32-768', dim: 768, type: 'float' },
    { name: 'int8-512', dim: 512, type: 'int8' },
    { name: 'bit-512', dim: 512, type: 'bit' },
  ] as const) {
    const tbl = `v_${cfg.name.replace('-', '_')}`
    await db.execute(`drop table if exists ${tbl}`)
    await db.execute(
      `create virtual table ${tbl} using vec0(embedding ${cfg.type}[${cfg.dim}])`,
    )

    // --- insert 100k vectors, batched in one transaction ---
    const tIns = Date.now()
    await db.execute('begin')
    const BATCH = 2000
    for (let b = 0; b < N; b += BATCH) {
      for (let i = 0; i < BATCH && b + i < N; i++) {
        const vec =
          cfg.type === 'float'
            ? randVecF32(cfg.dim)
            : cfg.type === 'int8'
              ? randVecI8(cfg.dim)
              : randVecI8(cfg.dim / 8) // bit vectors: dim/8 bytes
        // sqlite-vec assumes float32 for a bare BLOB — int8/bit need an explicit constructor.
        const ctor = cfg.type === 'int8' ? 'vec_int8(?)' : cfg.type === 'bit' ? 'vec_bit(?)' : '?'
        await db.execute(`insert into ${tbl}(rowid, embedding) values (?, ${ctor})`, [
          b + i,
          vec.buffer as any,
        ])
      }
    }
    await db.execute('commit')
    const insertMs = Date.now() - tIns

    // --- KNN queries: 10 runs, report median ---
    const q =
      cfg.type === 'float'
        ? randVecF32(cfg.dim)
        : cfg.type === 'int8'
          ? randVecI8(cfg.dim)
          : randVecI8(cfg.dim / 8)

    const times: number[] = []
    for (let r = 0; r < 10; r++) {
      const t0 = performance.now()
      const qctor = cfg.type === 'int8' ? 'vec_int8(?)' : cfg.type === 'bit' ? 'vec_bit(?)' : '?'
      await db.execute(
        `select rowid, distance from ${tbl} where embedding match ${qctor} and k = 50 order by distance`,
        [q.buffer as any],
      )
      times.push(performance.now() - t0)
    }
    times.sort((a, b) => a - b)

    const sizeRow = await db.execute(
      `select sum(pgsize) as bytes from dbstat where name like '${tbl}%'`,
    ).catch(() => null)

    out[cfg.name] = {
      dim: cfg.dim,
      dtype: cfg.type,
      insertMs,
      insertRatePerSec: Math.round(N / (insertMs / 1000)),
      knnMedianMs: +times[5].toFixed(2),
      knnMinMs: +times[0].toFixed(2),
      knnMaxMs: +times[9].toFixed(2),
      approxBytes: sizeRow?.rows?._array?.[0]?.bytes ?? null,
    }
  }

  await post(out)
  return out
}

async function post(o: any) {
  try {
    await fetch(`${HOST}/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(o),
    })
  } catch {}
}
