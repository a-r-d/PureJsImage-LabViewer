import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_MODEL = 'openai/gpt-5.6-luna'
const CASES = Object.freeze({
  smoke: ['sem-particle-count'],
  analysis: ['sem-particle-count', 'split-touching-particles'],
  'ome-zarr': [
    'ome-zarr-open-v2',
    'ome-zarr-open-v3-sharded',
    'ome-zarr-select-plane',
    'ome-zarr-authored-channels',
    'ome-zarr-chunks-vs-shards',
    'ome-zarr-fetch-telemetry',
    'ome-zarr-label-dataset',
    'ome-zarr-unsupported-codec',
    'ome-zarr-cancel-open',
    'ome-zarr-rebind-directory',
    'ome-zarr-bounded-preview',
  ],
})
const MAXIMUM_RELAY_REQUEST_BYTES = 6 * 1_024 * 1_024

export function parseAgentEvalArgs(argv, environment = process.env) {
  const parsed = {
    confirmed: false,
    suite: 'smoke',
    model: environment['PJI_AGENT_EVAL_MODEL'] ?? DEFAULT_MODEL,
    reasoning: environment['PJI_AGENT_EVAL_REASONING_EFFORT'] ?? 'high',
    maxCostUsd: Number(environment['PJI_AGENT_EVAL_MAX_COST_USD'] ?? '0.25'),
    selectedCase: undefined,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (value === '--confirm-live') {
      parsed.confirmed = true
      continue
    }
    const [flag, inline] = value.split('=', 2)
    const nextValue = () => {
      if (inline !== undefined) return inline
      const next = argv[index + 1]
      if (next === undefined || next.startsWith('--')) throw new Error(`${flag} needs a value.`)
      index += 1
      return next
    }
    if (flag === '--suite') parsed.suite = nextValue()
    else if (flag === '--case') parsed.selectedCase = nextValue()
    else if (flag === '--model') parsed.model = nextValue()
    else if (flag === '--reasoning') parsed.reasoning = nextValue()
    else if (flag === '--max-cost-usd') parsed.maxCostUsd = Number(nextValue())
    else throw new Error(`Unknown live eval option ${value}.`)
  }
  return parsed
}

export function selectedAgentEvalCases(options) {
  if (options.selectedCase !== undefined) {
    const known = Object.values(CASES).flat()
    if (!known.includes(options.selectedCase))
      throw new Error(`Unknown live agent eval case ${options.selectedCase}.`)
    return [options.selectedCase]
  }
  const suiteCases = CASES[options.suite]
  if (suiteCases === undefined) throw new Error(`Unknown live agent eval suite ${options.suite}.`)
  return suiteCases
}

export function agentEvalChildEnvironment(parent, values) {
  const child = { ...parent, ...values }
  delete child['OPENROUTER_API_KEY']
  return child
}

function environmentValue(environment, name) {
  return environment[name]
}

function safeTimestamp() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

async function readBoundedBody(request) {
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > MAXIMUM_RELAY_REQUEST_BYTES)
      throw new Error('Local eval relay request exceeded its byte limit.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function createOpenRouterRelay(key) {
  const token = randomBytes(32).toString('base64url')
  const server = createServer(async (request, response) => {
    try {
      if (
        request.method !== 'POST' ||
        request.headers.authorization !== `Bearer ${token}` ||
        request.url !== '/openrouter'
      ) {
        response.writeHead(404).end()
        return
      }
      const payload = JSON.parse(await readBoundedBody(request))
      const endpoint = payload?.endpoint
      const body = typeof payload?.body === 'string' ? payload.body : ''
      const url =
        endpoint === 'models'
          ? 'https://openrouter.ai/api/v1/models?supported_parameters=tools&limit=1000'
          : endpoint === 'chat'
            ? 'https://openrouter.ai/api/v1/chat/completions'
            : undefined
      if (url === undefined) throw new Error('Local eval relay endpoint is invalid.')
      const upstream = await fetch(url, {
        method: endpoint === 'models' ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://127.0.0.1:4173',
          'X-Title': 'PureJsImage local scientific agent eval',
        },
        ...(body === '' ? {} : { body }),
      })
      const upstreamBody = await upstream.text()
      if (upstreamBody.includes(key))
        throw new Error('OpenRouter unexpectedly reflected the credential.')
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          status: upstream.status,
          contentType: upstream.headers.get('content-type') ?? 'application/json',
          body: upstreamBody,
        }),
      )
    } catch {
      response.writeHead(502, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'The local OpenRouter relay failed.' }))
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Local relay did not bind.')
  return {
    url: `http://127.0.0.1:${address.port}/openrouter`,
    token,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  }
}

async function validateLiveModel(key, model) {
  const response = await fetch(
    'https://openrouter.ai/api/v1/models?supported_parameters=tools&limit=1000',
    { headers: { Authorization: `Bearer ${key}` } },
  )
  if (!response.ok)
    throw new Error(`OpenRouter model preflight failed with HTTP ${response.status}.`)
  const body = await response.json()
  const models = Array.isArray(body?.data) ? body.data : []
  const selected = models.find((entry) => entry?.id === model)
  if (selected === undefined)
    throw new Error(`${model} is not currently advertised by OpenRouter as tool-capable.`)
  const modalities = Array.isArray(selected.architecture?.input_modalities)
    ? selected.architecture.input_modalities
    : []
  if (!modalities.includes('image'))
    throw new Error(`${model} does not currently advertise image input support.`)
  return {
    contextLength: Number.isFinite(selected.context_length) ? selected.context_length : null,
  }
}

function runPlaywright(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'corepack',
      ['pnpm', 'exec', 'playwright', 'test', '-c', 'playwright.agent-evals.config.ts'],
      { env, stdio: 'inherit' },
    )
    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (signal !== null) reject(new Error(`Live agent evals exited due to signal ${signal}.`))
      else resolve(code ?? 1)
    })
  })
}

async function main() {
  const options = parseAgentEvalArgs(process.argv.slice(2))
  const cases = selectedAgentEvalCases(options)
  const key = environmentValue(process.env, 'OPENROUTER_API_KEY')?.trim()
  if (environmentValue(process.env, 'CI'))
    throw new Error('Live OpenRouter evals refuse to run in CI.')
  if (!options.confirmed)
    throw new Error('Live paid evals require the explicit --confirm-live flag.')
  if (key === undefined || key.length < 8)
    throw new Error('OPENROUTER_API_KEY is missing from the local environment.')
  if (options.reasoning !== 'high')
    throw new Error('The scientific live eval currently requires --reasoning high.')
  if (!Number.isFinite(options.maxCostUsd) || options.maxCostUsd <= 0 || options.maxCostUsd > 10)
    throw new Error('--max-cost-usd must be greater than 0 and at most 10.')

  const outputDir = path.resolve('.local/agent-evals', safeTimestamp())
  await mkdir(outputDir, { recursive: true })
  console.log('[agent-eval] LIVE PAID RUN CONFIRMED')
  console.log(`[agent-eval] model: ${options.model}`)
  console.log(`[agent-eval] reasoning: ${options.reasoning}`)
  console.log(`[agent-eval] cases (${cases.length}): ${cases.join(', ')}`)
  console.log(`[agent-eval] soft cost ceiling: $${options.maxCostUsd.toFixed(2)}`)
  console.log(`[agent-eval] redacted output: ${outputDir}`)
  const metadata = await validateLiveModel(key, options.model)
  console.log(
    `[agent-eval] model preflight: tools + image; context ${metadata.contextLength ?? 'unknown'}`,
  )

  const relay = await createOpenRouterRelay(key)
  try {
    const code = await runPlaywright(
      agentEvalChildEnvironment(process.env, {
        PJI_AGENT_EVAL_LIVE: '1',
        PJI_AGENT_EVAL_CASES: cases.join(','),
        PJI_AGENT_EVAL_MODEL: options.model,
        PJI_AGENT_EVAL_REASONING_EFFORT: options.reasoning,
        PJI_AGENT_EVAL_MAX_COST_USD: String(options.maxCostUsd),
        PJI_AGENT_EVAL_OUTPUT_DIR: outputDir,
        PJI_AGENT_EVAL_RELAY_URL: relay.url,
        PJI_AGENT_EVAL_RELAY_TOKEN: relay.token,
      }),
    )
    process.exitCode = code
  } finally {
    await relay.close()
  }
}

const entryPoint = process.argv[1]
if (entryPoint !== undefined && import.meta.url === pathToFileURL(path.resolve(entryPoint)).href) {
  await main().catch((error) => {
    console.error(`[agent-eval] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
