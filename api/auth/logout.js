import { makeSetCookie, SESSION_COOKIE } from '../_utils.js'

export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    return res.end('Method Not Allowed')
  }
  res.setHeader('Set-Cookie', makeSetCookie({ name: SESSION_COOKIE, value: '', maxAgeSeconds: 0 }))
  res.setHeader('Content-Type', 'application/json')
  res.statusCode = 200
  res.end(JSON.stringify({ ok: true }))
}

