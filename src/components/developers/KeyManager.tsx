// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
'use client'
import { useCallback, useEffect, useState } from 'react'

type KeyRow = { keyId: string; tier: string | null; disabled: boolean; createdAt: string }

export default function KeyManager() {
  const [keys, setKeys] = useState<KeyRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setErr(null)
    try {
      const r = await fetch('/api/falcon-cloud/keys', { headers: { Accept: 'application/json' } })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error ?? 'Could not load keys.'); return }
      setKeys(j.keys ?? [])
    } catch { setErr('Could not load keys.') }
  }, [])

  useEffect(() => {
    void reload()
    const onChange = () => { void reload() }
    window.addEventListener('falcon-cloud-keys-changed', onChange)
    return () => window.removeEventListener('falcon-cloud-keys-changed', onChange)
  }, [reload])

  async function act(action: 'revoke' | 'claim', body: Record<string, string>) {
    setBusy(action)
    setErr(null)
    try {
      const r = await fetch('/api/falcon-cloud/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) setErr(j.error ?? 'Could not update the key.')
      else { setPaste(''); await reload() }
    } catch { setErr('Could not update the key.') }
    setBusy(null)
  }

  return (
    <div className="space-y-3 text-xs" data-testid="key-manager">
      {err && <p className="text-rose-300">{err}</p>}
      {keys === null ? (
        <p className="text-slate-400">Loading your keys…</p>
      ) : keys.length === 0 ? (
        <p className="text-slate-400" data-testid="key-manager-empty">No keys are attached to this browser yet. Create a Free key above, or paste one you already have.</p>
      ) : (
        <ul className="space-y-2" data-testid="key-manager-list">
          {keys.map((k) => (
            <li key={k.keyId} className="rounded border border-slate-800 bg-slate-950/60 p-2 flex flex-wrap items-center gap-2">
              <code className="text-amber-200">{k.keyId}</code>
              <span className="text-slate-400">{k.tier ?? '—'}</span>
              <span className={k.disabled ? 'text-rose-300' : 'text-emerald-300'}>{k.disabled ? 'revoked' : 'active'}</span>
              <span className="text-slate-500">{k.createdAt?.slice(0, 10)}</span>
              {!k.disabled && (
                <button type="button" disabled={busy !== null} data-testid={`revoke-${k.keyId}`}
                  className="ml-auto rounded bg-slate-700 px-2 py-1 disabled:opacity-60"
                  onClick={() => { if (confirm('Revoke this key? It will stop working within about a minute.')) void act('revoke', { keyId: k.keyId }) }}>
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (paste.startsWith('fplk_')) void act('claim', { key: paste }) }}>
        <label className="block text-slate-300">Already have a key? Paste it to attach it to this browser, then revoke it if you need to.</label>
        <input type="password" autoComplete="off" value={paste} onChange={(e) => setPaste(e.target.value)}
          data-testid="key-manager-paste" aria-label="API key"
          className="w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 text-slate-200" />
        <div className="flex gap-2">
          <button type="submit" disabled={busy !== null || !paste.startsWith('fplk_')} data-testid="key-manager-claim"
            className="rounded bg-slate-700 px-3 py-1 disabled:opacity-60">Add to this browser</button>
          <button type="button" disabled={busy !== null || !paste.startsWith('fplk_')} data-testid="key-manager-revoke-paste"
            className="rounded bg-rose-900 px-3 py-1 disabled:opacity-60"
            onClick={() => { if (confirm('Revoke this key? It will stop working within about a minute.')) void act('revoke', { key: paste }) }}>
            Revoke pasted key
          </button>
        </div>
      </form>
    </div>
  )
}
