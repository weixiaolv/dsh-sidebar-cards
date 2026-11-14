/**
 * Host half of dsh-sidebar-cards.
 *
 * The product is entirely client-side: the client half takes over the
 * `sidebar.workspaces` slot and renders the two cards. This half exists for one
 * reason — the categories, groups and collapse state must survive a page
 * reload, a port change and a browser switch, so they cannot live in
 * `localStorage` (the renderer's origin is the Host's loopback address, whose
 * port changes between launches).
 *
 * So it serves exactly one route under the `/api` carrier every DSH Host
 * already provides: a tiny JSON read/write over
 * `~/.dsh/sidebar-cards/state.json`. The client reaches it through
 * `ctx.connection.rpc.call`, so authentication, the request envelope and the
 * response envelope stay the Host's own.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE = 'dsh-sidebar-cards'
const ENDPOINT = 'dsh-sidebar-cards/state'
const ROUTE_PATH = `/api/${ENDPOINT}`

// Tests and sandboxes point DSC_STATE_DIR somewhere else, so the real user
// state is never touched by a probe run.
const STATE_DIR = process.env.DSC_STATE_DIR
  ? path.resolve(process.env.DSC_STATE_DIR)
  : path.join(os.homedir(), '.dsh', 'sidebar-cards')
const STATE_FILE = path.join(STATE_DIR, 'state.json')
// UI copy ships as plain JSON beside the package, one file per language.
const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url))
const UI_LOCALE_DIR = path.join(PACKAGE_DIR, 'locale', 'ui')
const UI_LANGUAGES = new Set(['en', 'zh-Hans', 'zh-Hant', 'ja', 'fr', 'de', 'es', 'pt', 'ru'])
const HOST_LOG = path.join(STATE_DIR, 'host.log')

const MAX_BODY_BYTES = 512 * 1024
const MAX_STATE_BYTES = 384 * 1024
const LOG_KEEP_BYTES = 256 * 1024

const BOOT = Math.random().toString(36).slice(2, 8)

/* ------------------------------------------------------------------ helpers */

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}

async function logHost(line) {
  try {
    await fs.mkdir(STATE_DIR, { recursive: true })
    const text = `${new Date().toISOString()} [${BOOT}] ${line}\n`
    try {
      const stat = await fs.stat(HOST_LOG)
      if (stat.size > LOG_KEEP_BYTES) await fs.writeFile(HOST_LOG, '')
    } catch {
      /* first line of this install */
    }
    await fs.appendFile(HOST_LOG, text)
  } catch {
    /* a log is a convenience, never a reason to fail a request */
  }
}

function isLoopbackAuthority(authority) {
  if (typeof authority !== 'string' || authority === '') return false
  try {
    const url = new URL(`http://${authority}`)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return false
    const hostname = url.hostname.replace(/\.$/, '')
    return (
      hostname === 'localhost' ||
      hostname === '::1' ||
      hostname === '[::1]' ||
      /^127\.\d+\.\d+\.\d+$/.test(hostname)
    )
  } catch {
    return false
  }
}

/** The desktop's dev-proxy serves the page from a reserved origin. */
function isProxyAuthority(authority) {
  if (typeof authority !== 'string' || authority === '') return false
  const hostname = authority.split(':')[0].toLowerCase()
  return hostname.endsWith('.localhost') || hostname.endsWith('.test') || hostname === '0.0.0.0'
}

function isOwnRequest(request) {
  const host = request.headers.get('host')
  const proxied = isProxyAuthority(host)
  if (!isLoopbackAuthority(host) && !proxied) return false
  if (proxied) return true
  const site = request.headers.get('sec-fetch-site')
  if (site !== null && site !== 'same-origin' && site !== 'none') return false
  const origin = request.headers.get('origin')
  if (origin === null) return true
  try {
    const url = new URL(origin)
    if (url.host === host) return true
    return url.protocol === 'dsh-app:' || url.protocol === 'file:'
  } catch {
    return false
  }
}

function reply(rpcId, result) {
  const value =
    result && result.ok === false
      ? { ...result, error: { ...result.error, details: (result.error && result.error.details) || {} } }
      : result
  return Response.json({ type: 'server-response', rpcId, result: value })
}

function refusal(code, message) {
  return { ok: false, error: { code, message } }
}

/* ------------------------------------------------------------------- state */

function normalizeState(raw) {
  if (!isRecord(raw)) return {}
  // The client owns the schema; the Host only refuses values it could never
  // hand back (non-JSON) and caps the size. A shallow whitelist keeps the file
  // from growing into a dumping ground for unrelated data.
  const out = {}
  const allowed = [
    'version',
    'mode',
    'categories',
    'assign',
    'expanded',
    'visible',
    'archived',
    'workspaceCollapsed',
    'panelPins',
    'workspaceSort',
    'workspaceSortDir',
    'lang',
    'pluginCollapsed',
    'pluginGroups',
    'pluginAssign',
    'pluginHidden',
    'pluginShowHidden',
    'filesCollapsed',
    'updatedAt'
  ]
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) out[key] = raw[key]
  }
  return out
}

async function readState() {
  try {
    const text = await fs.readFile(STATE_FILE, 'utf8')
    if (text.length > MAX_STATE_BYTES) return { state: null, exists: false, tooLarge: true }
    const parsed = JSON.parse(text)
    return { state: normalizeState(parsed), exists: isRecord(parsed) }
  } catch (error) {
    if (error && error.code === 'ENOENT') return { state: null, exists: false }
    await logHost(`read failed: ${describeError(error)}`)
    return { state: null, exists: false, error: describeError(error) }
  }
}

async function writeState(raw) {
  if (!isRecord(raw)) return { ok: false, reason: 'state must be a JSON object' }
  const state = normalizeState(raw)
  state.updatedAt = Date.now()
  const text = JSON.stringify(state)
  if (text.length > MAX_STATE_BYTES) return { ok: false, reason: 'state too large' }
  await fs.mkdir(STATE_DIR, { recursive: true })
  const temporary = `${STATE_FILE}.${process.pid}.tmp`
  await fs.writeFile(temporary, text, 'utf8')
  await fs.rename(temporary, STATE_FILE)
  return { ok: true, at: state.updatedAt, bytes: text.length }
}

/* ------------------------------------------------------------------- route */

async function handleState(scope, request) {
  if (!isOwnRequest(request)) {
    await logHost(`refused: ${request.method} host=${request.headers.get('host')}`)
    return new Response('forbidden', { status: 403 })
  }
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })
  const contentType = request.headers.get('content-type')
  if (!contentType || contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    return new Response('content type must be application/json', { status: 415 })
  }
  let raw
  try {
    raw = await request.text()
  } catch {
    return new Response('body is unreadable', { status: 400 })
  }
  if (raw.length > MAX_BODY_BYTES) return new Response('body too large', { status: 413 })
  let message
  try {
    message = JSON.parse(raw)
  } catch {
    return new Response('body is not JSON', { status: 400 })
  }
  const rpcId = isRecord(message) && typeof message.rpcId === 'string' ? message.rpcId : 'invalid-request'
  if (
    !isRecord(message) ||
    message.type !== 'client-request' ||
    typeof message.rpcId !== 'string' ||
    message.method !== ENDPOINT ||
    !isRecord(message.payload)
  ) {
    return reply(rpcId, refusal('gateway/bad-request', 'This is not a sidebar-cards request.'))
  }
  const call = message.payload
  const method = typeof call.method === 'string' ? call.method : ''
  try {
    if (method === 'get') {
      const result = await readState()
      return reply(rpcId, { ok: true, value: result })
    }
    if (method === 'strings') {
      // One body with every language: the Client asks once per page.
      const languages = {}
      let names = []
      try {
        names = await fs.readdir(UI_LOCALE_DIR)
      } catch {
        names = []
      }
      for (const name of names) {
        if (!name.endsWith('.json')) continue
        const language = name.slice(0, -'.json'.length)
        if (!UI_LANGUAGES.has(language)) continue
        try {
          languages[language] = JSON.parse(await fs.readFile(path.join(UI_LOCALE_DIR, name), 'utf8'))
        } catch (error) {
          await logHost(`strings: ${name} unreadable (${describeError(error)})`)
        }
      }
      const count = Object.keys(languages).length
      if (count === 0) await logHost('strings: no locale/ui/*.json under ' + UI_LOCALE_DIR)
      else await logHost('strings: served ' + String(count) + ' languages (' + String(Object.keys(languages).length) + ')')
      return reply(rpcId, { ok: true, value: { languages } })
    }
    if (method === 'save') {
      const incoming = isRecord(call.payload) && Object.prototype.hasOwnProperty.call(call.payload, 'state') ? call.payload.state : call.state
      const written = await writeState(incoming)
      if (!written.ok) return reply(rpcId, refusal('sidebar-cards/rejected', written.reason))
      return reply(rpcId, { ok: true, value: written })
    }
    if (method === 'reset') {
      await fs.rm(STATE_FILE, { force: true })
      return reply(rpcId, { ok: true, value: { ok: true } })
    }
    return reply(rpcId, refusal('sidebar-cards/unknown-method', `Unknown method "${method}".`))
  } catch (error) {
    await logHost(`${method || 'unknown'} failed: ${describeError(error)}`)
    return reply(rpcId, refusal('sidebar-cards/failed', describeError(error)))
  }
}

function mount(scope) {
  const connection = serviceOf(scope, 'connection')
  if (!connection || !connection.fetch || typeof connection.fetch.register !== 'function') return null
  return connection.fetch.register({
    path: ROUTE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => handleState(scope, request),
  })
}

function serviceOf(scope, name) {
  if (!scope) return null
  try {
    if (typeof scope.get === 'function') {
      const service = scope.get(name)
      if (service) return service
    }
  } catch {
    /* a service that is not mounted yet */
  }
  try {
    return scope[name] || null
  } catch {
    return null
  }
}

export const name = 'dsh-sidebar-cards'

export function apply(ctx) {
  let disposed = false
  let dispose = null
  let retry = null
  let attempts = 0

  const attach = (scope) => {
    if (disposed || dispose) return
    attempts += 1
    try {
      dispose = mount(scope)
    } catch (error) {
      console.error(`[${PACKAGE}] failed to register ${ROUTE_PATH}`, error)
      logHost(`mount failed: ${describeError(error)}`)
    }
    if (dispose) {
      logHost(`route mounted at ${ROUTE_PATH} (attempt ${attempts})`)
      return
    }
    if (!disposed) retry = setTimeout(() => attach(scope), 1000)
  }

  try {
    if (typeof ctx.inject === 'function') ctx.inject(['connection'], attach)
    else attach(ctx)
  } catch (error) {
    console.error(`[${PACKAGE}] host half could not start`, error)
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(
      () => () => {
        disposed = true
        if (retry) clearTimeout(retry)
        retry = null
        if (typeof dispose === 'function') {
          try {
            dispose()
          } catch {
            /* the Host already tore the route down */
          }
        }
        dispose = null
      },
      `${PACKAGE}: state route`,
    )
  }
}
