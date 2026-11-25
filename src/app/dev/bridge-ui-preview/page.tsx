// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import { notFound } from 'next/navigation'
import BridgeUiPreview from './BridgeUiPreview'

export const metadata = { robots: { index: false, follow: false }, title: 'Bridge UI preview' }

export default function Page() {
  // Review/screenshot fixture only — never serve on the production domain deploy.
  if (process.env.VERCEL_ENV === 'production') notFound()
  return <BridgeUiPreview />
}
