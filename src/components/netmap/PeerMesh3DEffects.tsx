// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
'use client'

// Desktop-only bloom pass, split into its own chunk so phones never download postprocessing.
import { Bloom, EffectComposer } from '@react-three/postprocessing'

export default function PeerMesh3DEffects() {
  return (
    <EffectComposer multisampling={0}>
      <Bloom intensity={0.85} luminanceThreshold={0.55} luminanceSmoothing={0.25} mipmapBlur />
    </EffectComposer>
  )
}
