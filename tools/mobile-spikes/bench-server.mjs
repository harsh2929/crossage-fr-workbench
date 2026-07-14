// SP-1 benchmark support server.
// Serves the image corpus the way the real app would fetch thumbnails from the paired Mac,
// and collects the benchmark result the app POSTs back.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const IMG = path.join(root, 'img')
const RESULTS = path.join(root, 'results.jsonl')

let reqCount = 0
let bytesServed = 0
const cache = new Map()
function readImg(kind, n) {
  const key = `${kind}/${n}`
  if (!cache.has(key)) cache.set(key, fs.readFileSync(path.join(IMG, kind, `${n}.jpg`)))
  return cache.get(key)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')

  if (req.method === 'POST' && url.pathname === '/result') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      fs.appendFileSync(RESULTS, body + '\n')
      console.log('RESULT>>> ' + body)
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
    })
    return
  }

  if (url.pathname === '/mode') {
    const mode = fs.existsSync(path.join(root, 'mode.txt'))
      ? fs.readFileSync(path.join(root, 'mode.txt'), 'utf8').trim()
      : 'THUMB'
    res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
    res.end(mode)
    return
  }
  if (url.pathname === '/stats') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ reqCount, bytesServed, mb: +(bytesServed / 1048576).toFixed(1) }))
    return
  }
  if (url.pathname === '/reset') { reqCount = 0; bytesServed = 0; res.writeHead(200); res.end('ok'); return }

  const m = url.pathname.match(/^\/(thumb|full)\/(\d+)\.jpg$/)
  if (m) {
    const [, kind, n] = m
    const buf = readImg(kind, Number(n) % 60)
    reqCount++
    bytesServed += buf.length
    res.writeHead(200, {
      'content-type': 'image/jpeg',
      'content-length': buf.length,
      // No caching, so every cell fetch is a real fetch+decode — the worst case,
      // and the one that mirrors a cold scroll over an un-cached library.
      'cache-control': 'no-store',
    })
    res.end(buf)
    return
  }

  if (url.pathname === '/ping') {
    res.writeHead(200); res.end('pong'); return
  }
  res.writeHead(404); res.end()
})

server.listen(8099, '0.0.0.0', () => console.log('sp1 server on :8099'))
