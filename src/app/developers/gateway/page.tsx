// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import ContentPage, { A, Code, Section } from '@/components/content/ContentPage'
import { DevNav, Table, TestnetNotice } from '@/components/developers/DevBits'
import { EXAMPLES, GATEWAY_CORS_ORIGINS, GATEWAY_ERRORS, GATEWAY_METHODS, GATEWAY_ROUTES, GATEWAY_URL } from '@/lib/developers/content'
import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta('/developers/gateway', 'RPC gateway docs', 'Falcon Cloud RPC gateway: API keys, JSON-RPC methods, examples and rate limits.')

export default function GatewayDocs() {
  return (
    <ContentPage current="community" title="Falcon Cloud RPC gateway" back={{ href: '/developers', label: 'Developers' }}>
      <DevNav active="/developers/gateway" />
      <TestnetNotice />
      <p className="text-xs text-slate-400" data-testid="gateway-base-url">
        Base URL: <span className="font-mono">{GATEWAY_URL}</span>
      </p>
      <Section title="Authentication">
        <p>Every RPC call needs an API key. Send it as <span className="font-mono">Authorization: Bearer fplk_…</span> or <span className="font-mono">X-API-Key: fplk_…</span>.</p>
        <p>Keys are shown once when issued and stored only as a SHA-256 hash. Keep them server-side; never ship a key in browser code or a public repo. Every plan, including Free, needs a key. Get or revoke a key on <A href="/developers/api-keys">Get an API key</A>.</p>
      </Section>
      <Section title="Endpoints">
        <Table head={['Route', 'Key', 'Notes']} rows={GATEWAY_ROUTES.map((r) => [`${r.method} ${r.path}`, r.auth ? 'yes' : 'no', r.note])} />
      </Section>
      <Section title="Browser calls (CORS)">
        <p data-testid="gateway-cors">Browser requests are accepted only from approved origins: {GATEWAY_CORS_ORIGINS.map((o) => <span key={o} className="font-mono mr-2">{o}</span>)}. Call the gateway from your own server for anything else.</p>
      </Section>
      <Section title="Streaming">
        <p data-testid="gateway-stream">Live book, trades and ticker updates are available as server-sent events at <span className="font-mono">GET /v1/stream?channels=book:BTC4-FPL,trades:BTC4-FPL,ticker:BTC4-FPL</span>. Send your API key as <span className="font-mono">Authorization: Bearer</span>, or first call <span className="font-mono">POST /v1/stream/session</span> and use the short-lived <span className="font-mono">?ticket=</span> (EventSource cannot set headers). Opening a stream costs 1 unit, then 1 unit per minute it stays open. Free keys may hold 2 streams at once (Builder 4, Scale 8).</p>
      </Section>
      <Section title="Not supported yet">
        <ul className="list-disc pl-5 space-y-1" data-testid="gateway-not-supported">
          <li>Batch requests (a JSON array) return HTTP 400. Send one request per call.</li>
        </ul>
      </Section>
      <Section title="Time quality">
        <p data-testid="gateway-time-quality">Candles, 24 h ticker stats and historical fill times use observer arrival, not verified on-chain UTC. Treat them as estimated.</p>
      </Section>
      <Section title="Allowed methods">
        <p>Read methods plus transaction submit. Node admin and operator calls are never exposed.</p>
        <Table head={['Method', 'Params', 'Returns', 'Units']} rows={GATEWAY_METHODS.map((m) => [m.name, m.params, m.returns, m.units])} />
      </Section>
      <Section title="curl">
        <Code>{EXAMPLES.curl}</Code>
      </Section>
      <Section title="JavaScript">
        <Code>{EXAMPLES.js}</Code>
      </Section>
      <Section title="Python">
        <Code>{EXAMPLES.python}</Code>
      </Section>
      <Section title="Errors">
        <p>Errors use the JSON-RPC envelope <span className="font-mono">{'{ "error": { "code", "message" } }'}</span>.</p>
        <Table head={['HTTP', 'Code', 'Meaning', 'What to do']} rows={GATEWAY_ERRORS.map((e) => [e.http, e.code || '—', e.meaning, e.action])} />
      </Section>
      <Section title="Handling 429">
        <p>Each key has a per-second rate with a short burst allowance, a separate per-minute limit for <span className="font-mono">fpl_submitTx</span>, and a monthly quota in units. When you exceed a rate, the gateway answers HTTP 429 with a <span className="font-mono">Retry-After</span> header in seconds: wait that long, then retry. The examples above do this. A quota 429 has no Retry-After and lasts until the 1st of the month (00:00 UTC). Check <span className="font-mono">GET /v1/usage</span> to see where you are. Limits per plan: <A href="/developers/pricing">pricing</A>.</p>
      </Section>
    </ContentPage>
  )
}
