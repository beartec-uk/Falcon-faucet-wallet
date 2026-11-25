// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
'use client'

/**
 * Real-3D peer-to-peer mesh for /scan/map (react-three-fiber, lazy-loaded, no SSR).
 * Every object is procedural geometry + PBR materials lit by a generated room
 * environment, so it ships zero texture/model bytes. Driven by the same live
 * graph (/api/scan + /api/scan/topology) as the 2D Canvas fallback.
 */

import { Component, Suspense, lazy, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Billboard, Html, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { PeerMeshProps } from '@/components/netmap/PeerMeshCanvas'
import type { Round } from '@/lib/netmap-consensus'
import { phaseAt } from '@/lib/netmap-consensus'
import { bulgeCount, propagationPlan, ringFill, votePaths, type MeshEdge, type MeshNode } from '@/lib/netmap-layout'
import { linkControlPoint, quadBezier3, solveForceMesh3D, type Vec3 } from '@/lib/netmap-layout3d'
import { BRIDGE_OPERATORS } from '@/lib/bridge-operators'

const Effects = lazy(() => import('@/components/netmap/PeerMesh3DEffects'))

export interface PeerMesh3DProps extends PeerMeshProps {
  reducedMotion?: boolean
  /** Called when WebGL fails or the context is lost, so the page can fall back to 2D. */
  onFail?: (reason: string) => void
}

const C = {
  bg: '#020617',
  copper: '#C07838',
  copperHot: '#E09A50',
  gold: '#D4922A',
  goldHot: '#FFC060',
  cream: '#E0DBCA',
  green: '#22C55E',
  greenHot: '#4ADE80',
  cyan: '#38BDF8',
  teal: '#2DD4BF',
  slate: '#475569',
  violet: '#A78BFA',
}

const HOP_MS = 280
const R_LAYOUT = 7

interface Curve {
  edge: MeshEdge
  a: Vec3
  c: Vec3
  b: Vec3
}

interface Wave {
  at: number
  hops: { from: string; to: string; hop: number }[]
  maxHop: number
}

interface Anim {
  waves: Wave[]
  tx: { at: number; dur: number; idx: number }[]
  arrivals: Map<string, number>
  round: { h: number; startedAt: number; intervalMs: number; round: Round | null }
  votePaths: Array<[string, string][]>
  reduced: boolean
}

class Boundary extends Component<{ onFail?: (r: string) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    this.props.onFail?.(err instanceof Error ? err.message : String(err))
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

function stateColor(n: MeshNode, isPacker: boolean, isVoter: boolean): string {
  if (n.kind === 'wallet') return C.gold
  if (!n.online || n.jailed || n.inactive) return C.slate
  if (isPacker) return C.goldHot
  if (isVoter) return C.greenHot
  if (n.kind === 'observer') return '#94A3B8'
  return C.teal
}

/** Generated studio-style environment for metallic reflections (no HDR download). */
function StudioEnv() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const room = new RoomEnvironment()
    const env = pmrem.fromScene(room, 0.04).texture
    scene.environment = env
    scene.environmentIntensity = 0.55
    return () => {
      scene.environment = null
      env.dispose()
      pmrem.dispose()
      room.traverse((o) => {
        const m = o as THREE.Mesh
        m.geometry?.dispose?.()
      })
    }
  }, [gl, scene])
  return null
}

function Stars({ count }: { count: number }) {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const arr = new Float32Array(count * 3)
    let s = 1234567
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < count; i++) {
      const u = rnd() * 2 - 1
      const th = rnd() * Math.PI * 2
      const r = 38 + rnd() * 40
      const q = Math.sqrt(1 - u * u)
      arr[i * 3] = Math.cos(th) * q * r
      arr[i * 3 + 1] = u * r
      arr[i * 3 + 2] = Math.sin(th) * q * r
    }
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    return g
  }, [count])
  useEffect(() => () => geom.dispose(), [geom])
  return (
    <points geometry={geom}>
      <pointsMaterial size={0.09} sizeAttenuation color="#7C8BA1" transparent opacity={0.65} depthWrite={false} />
    </points>
  )
}

function Label({ y, title, sub, accent }: { y: number; title: string; sub?: string; accent?: string }) {
  return (
    <Html position={[0, y, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
      <div className="netmap3d-label">
        <div className="t" style={accent ? { color: accent } : undefined}>
          {title}
        </div>
        {sub ? <div className="s">{sub}</div> : null}
      </div>
    </Html>
  )
}

interface NodeProps {
  node: MeshNode
  pos: Vec3
  isPacker: boolean
  isVoter: boolean
  active: boolean
  packerFill: number
  anim: React.MutableRefObject<Anim>
  walletCount: number | null
  showGeoInLabel: boolean
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
}

function NodeObject({
  node,
  pos,
  isPacker,
  isVoter,
  active,
  packerFill,
  anim,
  walletCount,
  showGeoInLabel,
  onSelect,
  onHover,
}: NodeProps) {
  const group = useRef<THREE.Group>(null)
  const spin = useRef<THREE.Group>(null)
  const spin2 = useRef<THREE.Group>(null)
  const core = useRef<THREE.Mesh>(null)
  const beacon = useRef<THREE.Mesh>(null)
  const boxEdges = useMemo(
    () => (node.kind === 'wallet' ? new THREE.EdgesGeometry(new THREE.BoxGeometry(1.3, 1.3, 1.3)) : null),
    [node.kind],
  )
  useEffect(() => () => boxEdges?.dispose(), [boxEdges])
  const col = stateColor(node, isPacker, isVoter)
  const dim = !node.online || node.jailed || node.inactive

  useFrame((_, dt) => {
    const a = anim.current
    const now = Date.now()
    if (!a.reduced) {
      if (spin.current) spin.current.rotation.y += dt * (node.isHub ? 0.55 : 0.25)
      if (spin2.current) {
        spin2.current.rotation.x += dt * 0.4
        spin2.current.rotation.z += dt * 0.18
      }
      if (beacon.current) {
        const p = (now % 2400) / 2400
        beacon.current.scale.setScalar(0.6 + p * 1.6)
        const m = beacon.current.material as THREE.MeshBasicMaterial
        m.opacity = 0.55 * (1 - p)
      }
    }
    const t = a.arrivals.get(node.id)
    const glow = t != null && now >= t ? Math.max(0, 1 - (now - t) / 900) : 0
    if (core.current) core.current.scale.setScalar(1 + glow * 0.9)
    if (group.current) group.current.scale.setScalar(1 + glow * 0.12)
  })

  const handlers = {
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation()
      if (e.delta > 6 || node.kind === 'wallet') return
      onSelect(node.id)
    },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      if (node.kind === 'wallet') return
      onHover(node.id)
      document.body.style.cursor = 'pointer'
    },
    onPointerOut: () => {
      onHover(null)
      document.body.style.cursor = ''
    },
  }

  const size = node.kind === 'wallet' ? 0.75 : node.isHub ? 1.15 : node.kind === 'observer' ? 0.3 : 0.6
  const geo = showGeoInLabel && node.locationLabel ? node.locationLabel.split(',')[0] : ''
  const sub =
    node.kind === 'wallet'
      ? walletCount == null
        ? node.host
        : `${walletCount.toLocaleString('en-US')} wallets`
      : node.isHub
        ? ['HUB', node.host, geo].filter(Boolean).join(' · ')
        : [node.host, geo].filter(Boolean).join(' · ')

  return (
    <group ref={group} position={pos} {...handlers}>
      {node.kind === 'wallet' ? (
        <>
          <mesh scale={[1, 1.55, 1]}>
            <octahedronGeometry args={[0.5, 0]} />
            <meshStandardMaterial color={C.gold} emissive={C.gold} emissiveIntensity={0.55} metalness={1} roughness={0.15} flatShading />
          </mesh>
          <group ref={spin}>
            <lineSegments geometry={boxEdges ?? undefined}>
              <lineBasicMaterial color={C.goldHot} transparent opacity={0.55} toneMapped={false} />
            </lineSegments>
          </group>
          <mesh>
            <sphereGeometry args={[0.95, 12, 10]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </>
      ) : node.isHub ? (
        <>
          <mesh>
            <dodecahedronGeometry args={[0.55, 0]} />
            <meshStandardMaterial
              color={dim ? C.slate : C.copper}
              emissive={dim ? '#1e293b' : '#6b3410'}
              emissiveIntensity={0.7}
              metalness={0.95}
              roughness={0.18}
              flatShading
            />
          </mesh>
          <mesh ref={core}>
            <sphereGeometry args={[0.24, 16, 12]} />
            <meshBasicMaterial color={isPacker ? C.goldHot : isVoter ? C.greenHot : '#FFD08A'} toneMapped={false} />
          </mesh>
          <group ref={spin}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.98, 0.045, 10, 72]} />
              <meshStandardMaterial color={C.gold} emissive={C.gold} emissiveIntensity={0.9} metalness={1} roughness={0.2} />
            </mesh>
          </group>
          <group ref={spin2}>
            <mesh rotation={[0.4, 0.9, 0]}>
              <torusGeometry args={[1.18, 0.028, 8, 72]} />
              <meshStandardMaterial color={C.copperHot} emissive={C.copper} emissiveIntensity={0.8} metalness={1} roughness={0.25} />
            </mesh>
          </group>
        </>
      ) : node.kind === 'observer' ? (
        <mesh>
          <sphereGeometry args={[0.22, 12, 10]} />
          <meshBasicMaterial color="#94A3B8" wireframe transparent opacity={0.7} />
        </mesh>
      ) : (
        <>
          <mesh>
            <icosahedronGeometry args={[0.4, 0]} />
            <meshStandardMaterial
              color="#0B1220"
              emissive={col}
              emissiveIntensity={dim ? 0.15 : 0.55}
              metalness={0.8}
              roughness={0.22}
              flatShading
            />
          </mesh>
          <mesh ref={core}>
            <sphereGeometry args={[0.14, 12, 10]} />
            <meshBasicMaterial color={col} toneMapped={false} />
          </mesh>
          <group ref={spin}>
            <mesh>
              <icosahedronGeometry args={[0.6, 1]} />
              <meshBasicMaterial color={col} wireframe transparent opacity={dim ? 0.15 : 0.32} toneMapped={false} />
            </mesh>
          </group>
        </>
      )}

      {node.isArchive && (
        <group position={[0, -size - 0.05, 0]}>
          {[0, 1, 2].map((i) => (
            <mesh key={i} position={[0, i * 0.11, 0]}>
              <cylinderGeometry args={[0.42, 0.42, 0.06, 28]} />
              <meshStandardMaterial color={C.violet} emissive={C.violet} emissiveIntensity={0.6} metalness={0.7} roughness={0.3} />
            </mesh>
          ))}
        </group>
      )}

      {node.isSeed && node.kind !== 'wallet' && (
        <group position={[0, size + 0.05, 0]}>
          <mesh position={[0, 0.22, 0]}>
            <coneGeometry args={[0.05, 0.44, 8]} />
            <meshBasicMaterial color={C.cream} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.48, 0]}>
            <sphereGeometry args={[0.06, 10, 8]} />
            <meshBasicMaterial color="#FFFFFF" toneMapped={false} />
          </mesh>
          <Billboard position={[0, 0.48, 0]}>
            <mesh ref={beacon}>
              <ringGeometry args={[0.12, 0.16, 32]} />
              <meshBasicMaterial color={C.cream} transparent opacity={0.4} depthWrite={false} toneMapped={false} />
            </mesh>
          </Billboard>
        </group>
      )}

      {isPacker && (
        <Billboard>
          <mesh>
            <torusGeometry args={[size + 0.28, 0.05, 8, 64, Math.PI * 2 * Math.max(0.04, packerFill)]} />
            <meshBasicMaterial color={C.goldHot} toneMapped={false} />
          </mesh>
        </Billboard>
      )}
      {active && (
        <Billboard>
          <mesh>
            <ringGeometry args={[size + 0.42, size + 0.48, 48]} />
            <meshBasicMaterial color="#FFFFFF" transparent opacity={0.85} toneMapped={false} />
          </mesh>
        </Billboard>
      )}

      <Label
        y={-(size + (node.isArchive ? 0.75 : 0.45))}
        title={node.label}
        sub={sub}
        accent={node.isHub ? C.goldHot : node.kind === 'wallet' ? C.gold : undefined}
      />
    </group>
  )
}

function Links({ curves, activeId }: { curves: Curve[]; activeId: string | null }) {
  const mats = useMemo(() => {
    const mk = (color: string, opacity: number) =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
    return {
      hub: mk(C.copperHot, 0.9),
      peer: mk(C.cyan, 0.42),
      off: mk(C.slate, 0.3),
      ingress: mk(C.gold, 0.75),
      hot: mk(C.goldHot, 1),
    }
  }, [])
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats])

  const geoms = useMemo(
    () =>
      curves.map((cv) => {
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(...cv.a),
          new THREE.Vector3(...cv.c),
          new THREE.Vector3(...cv.b),
        )
        const hubHub = (cv as Curve & { hubHub?: boolean }).hubHub
        const r = cv.edge.kind === 'ingress' ? 0.035 : hubHub ? 0.06 : 0.028
        return new THREE.TubeGeometry(curve, 24, r, 6, false)
      }),
    [curves],
  )
  useEffect(() => () => geoms.forEach((g) => g.dispose()), [geoms])

  return (
    <group>
      {curves.map((cv, i) => {
        const x = cv as Curve & { hubHub?: boolean; online?: boolean }
        const touches = activeId != null && (cv.edge.source === activeId || cv.edge.target === activeId)
        const mat = touches
          ? mats.hot
          : cv.edge.kind === 'ingress'
            ? mats.ingress
            : x.hubHub
              ? mats.hub
              : x.online
                ? mats.peer
                : mats.off
        return <mesh key={cv.edge.id} geometry={geoms[i]} material={mat} raycast={() => null} />
      })}
    </group>
  )
}

function Pulses({
  curves,
  anim,
  pairIndex,
  max,
}: {
  curves: Curve[]
  anim: React.MutableRefObject<Anim>
  pairIndex: Map<string, number>
  max: number
}) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const tmp = useMemo(() => new THREE.Object3D(), [])
  const cGold = useMemo(() => new THREE.Color(C.goldHot), [])
  const cTx = useMemo(() => new THREE.Color(C.gold), [])
  const cVote = useMemo(() => new THREE.Color(C.greenHot), [])

  useEffect(() => {
    const m = mesh.current
    if (!m) return
    for (let i = 0; i < max; i++) m.setColorAt(i, cGold)
    m.count = 0
  }, [max, cGold])

  useFrame(() => {
    const m = mesh.current
    if (!m) return
    const a = anim.current
    const now = Date.now()
    let k = 0
    const put = (p: Vec3, s: number, col: THREE.Color) => {
      if (k >= max) return
      tmp.position.set(p[0], p[1], p[2])
      tmp.scale.setScalar(s)
      tmp.updateMatrix()
      m.setMatrixAt(k, tmp.matrix)
      m.setColorAt(k, col)
      k++
    }
    const along = (from: string, to: string, t: number): Vec3 | null => {
      const idx = pairIndex.get(`${from}|${to}`)
      if (idx != null) {
        const cv = curves[idx]
        return quadBezier3(cv.a, cv.c, cv.b, t)
      }
      const rev = pairIndex.get(`${to}|${from}`)
      if (rev != null) {
        const cv = curves[rev]
        return quadBezier3(cv.a, cv.c, cv.b, 1 - t)
      }
      return null
    }

    if (!a.reduced) {
      a.waves = a.waves.filter((w) => now - w.at < (w.maxHop + 1) * HOP_MS + 400)
      for (const w of a.waves) {
        const el = now - w.at
        for (const h of w.hops) {
          const t = (el - (h.hop - 1) * HOP_MS) / HOP_MS
          if (t < 0 || t > 1) continue
          const p = along(h.from, h.to, t)
          if (p) put(p, 1.3 - Math.abs(t - 0.5) * 0.6, cGold)
        }
      }
      a.tx = a.tx.filter((p) => now - p.at < p.dur)
      for (const p of a.tx) {
        const t = (now - p.at) / p.dur
        if (t < 0) continue
        const cv = curves[p.idx]
        if (cv) put(quadBezier3(cv.a, cv.c, cv.b, t), 0.7, cTx)
      }
      const r = a.round
      const { phase, u } = phaseAt(now - r.startedAt, r.intervalMs)
      if (phase === 'pulse') {
        for (const segs of a.votePaths) {
          const pos = Math.min(segs.length - 1e-6, u * segs.length)
          const si = Math.floor(pos)
          const seg = segs[si]
          if (!seg) continue
          const p = along(seg[0], seg[1], pos - si)
          if (p) put(p, 0.8, cVote)
        }
      }
    }
    m.count = k
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, max]} frustumCulled={false} raycast={() => null}>
      <sphereGeometry args={[0.11, 12, 10]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  )
}

function GeoHalos({ halos }: { halos: { id: string; label: string; color: string; c: Vec3; r: number }[] }) {
  return (
    <group>
      {halos.map((h) => (
        <group key={h.id} position={h.c}>
          <mesh raycast={() => null}>
            <sphereGeometry args={[h.r, 32, 20]} />
            <meshBasicMaterial color={h.color} transparent opacity={0.035} side={THREE.BackSide} depthWrite={false} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
            <torusGeometry args={[h.r, 0.012, 6, 96]} />
            <meshBasicMaterial color={h.color} transparent opacity={0.35} toneMapped={false} />
          </mesh>
          <Html position={[0, h.r + 0.35, 0]} center zIndexRange={[3, 0]} style={{ pointerEvents: 'none' }}>
            <div className="netmap3d-geo" style={{ color: h.color }}>
              {h.label.toUpperCase()}
            </div>
          </Html>
        </group>
      ))}
    </group>
  )
}

function FrameDriver({
  anim,
  phaseRef,
  fpsRef,
}: {
  anim: React.MutableRefObject<Anim>
  phaseRef?: React.MutableRefObject<HTMLSpanElement | null>
  fpsRef?: React.MutableRefObject<HTMLSpanElement | null>
}) {
  const fps = useRef({ frames: 0, since: Date.now() })
  useFrame(() => {
    const now = Date.now()
    const a = anim.current
    if (phaseRef?.current) {
      const { phase } = phaseAt(now - a.round.startedAt, a.round.intervalMs)
      const seal = a.waves.some((w) => now - w.at < 800)
      const label = seal ? 'seal' : phase
      phaseRef.current.textContent = label
      phaseRef.current.dataset.p = label
    }
    const f = fps.current
    f.frames++
    if (now - f.since >= 1000) {
      if (fpsRef?.current) fpsRef.current.textContent = `3D · ${Math.round((f.frames * 1000) / (now - f.since))} fps`
      f.frames = 0
      f.since = now
    }
  })
  return null
}

type ControlsRef = ComponentRef<typeof OrbitControls>

function CameraRig({
  controls,
  isMobile,
  fitKey,
}: {
  controls: React.MutableRefObject<ControlsRef | null>
  isMobile: boolean
  fitKey: number
}) {
  const { camera, size, invalidate } = useThree()
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    const aspect = size.width / Math.max(1, size.height)
    const half = THREE.MathUtils.degToRad(cam.fov / 2)
    const fitR = R_LAYOUT + 1.6
    const dist = fitR / (Math.tan(half) * Math.min(1, aspect)) * (isMobile ? 1.0 : 0.95)
    const dir = new THREE.Vector3(0.18, 0.32, 1).normalize()
    cam.position.copy(dir.multiplyScalar(dist))
    cam.near = 0.1
    cam.far = 200
    cam.updateProjectionMatrix()
    const c = controls.current
    if (c) {
      c.target.set(0, 0, 0)
      c.update()
    }
    invalidate()
  }, [camera, size.width, size.height, isMobile, fitKey, controls, invalidate])
  return null
}

export default function PeerMesh3D(props: PeerMesh3DProps) {
  const {
    graph,
    event,
    maxBulges,
    selected,
    onSelect,
    fpsRef,
    watchers,
    consensus,
    walletCount,
    isMobile = false,
    reducedMotion = false,
    onFail,
  } = props

  const [hovered, setHovered] = useState<string | null>(null)
  const [visible, setVisible] = useState(true)
  const [interacting, setInteracting] = useState(false)
  const [fitKey, setFitKey] = useState(0)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const controls = useRef<ControlsRef | null>(null)
  const invalidateRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const on = () => setVisible(!document.hidden)
    on()
    document.addEventListener('visibilitychange', on)
    return () => {
      document.removeEventListener('visibilitychange', on)
      if (idleTimer.current) clearTimeout(idleTimer.current)
      document.body.style.cursor = ''
    }
  }, [])

  // Live 3D layout over real edges; warm-started from the previous layout.
  const prevPos = useRef<Map<string, Vec3> | undefined>(undefined)
  const pos = useMemo(() => {
    const p = solveForceMesh3D(graph.nodes, graph.edges, {
      prev: prevPos.current,
      targetRadius: R_LAYOUT,
      iterations: prevPos.current ? 120 : 260,
    })
    return p
  }, [graph])
  useEffect(() => {
    prevPos.current = pos
  }, [pos])

  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph])
  const curves = useMemo(() => {
    const out: Array<Curve & { hubHub: boolean; online: boolean }> = []
    for (const e of graph.edges) {
      const a = pos.get(e.source)
      const b = pos.get(e.target)
      const na = byId.get(e.source)
      const nb = byId.get(e.target)
      if (!a || !b || !na || !nb) continue
      out.push({
        edge: e,
        a,
        b,
        c: linkControlPoint(a, b, e.kind === 'ingress' ? 0.1 : 0.16),
        hubHub: e.kind === 'peer' && na.isHub && nb.isHub,
        online: na.online && nb.online,
      })
    }
    return out
  }, [graph, pos, byId])
  const pairIndex = useMemo(() => {
    const m = new Map<string, number>()
    curves.forEach((cv, i) => m.set(`${cv.edge.source}|${cv.edge.target}`, i))
    return m
  }, [curves])

  const halos = useMemo(() => {
    const groups = new Map<string, MeshNode[]>()
    for (const n of graph.nodes) {
      if (!n.locationLabel) continue
      const g = groups.get(n.locationId) ?? []
      g.push(n)
      groups.set(n.locationId, g)
    }
    const out: { id: string; label: string; color: string; c: Vec3; r: number }[] = []
    for (const [id, list] of groups) {
      if (list.length < 2) continue
      const ps = list.map((n) => pos.get(n.id)).filter(Boolean) as Vec3[]
      if (ps.length < 2) continue
      const c: Vec3 = [0, 1, 2].map((k) => ps.reduce((s, p) => s + p[k], 0) / ps.length) as Vec3
      const r = Math.max(...ps.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]))) + 1.3
      out.push({ id, label: list[0].locationLabel, color: list[0].locationColor, c, r })
    }
    return out
  }, [graph, pos])
  const multiGeo = useMemo(() => new Set(halos.map((h) => h.id)), [halos])

  const anim = useRef<Anim>({
    waves: [],
    tx: [],
    arrivals: new Map(),
    round: { h: 0, startedAt: Date.now(), intervalMs: 3000, round: null },
    votePaths: [],
    reduced: reducedMotion,
  })
  anim.current.reduced = reducedMotion

  const round = consensus?.round ?? null
  const intervalMs = consensus?.intervalMs ?? 3000
  useEffect(() => {
    const r = anim.current.round
    r.round = round
    r.intervalMs = intervalMs
    if (round && round.height !== r.h) {
      r.h = round.height
      r.startedAt = Date.now()
    }
    anim.current.votePaths =
      round?.packer && round.voters.length ? votePaths(graph.edges, round.voters, round.packer) : []
    invalidateRef.current?.()
  }, [round, intervalMs, graph.edges])

  const recentMax = useRef(100)
  const [packerFill, setPackerFill] = useState(0.2)
  useEffect(() => {
    if (!event || !event.blocks.length) return
    const now = Date.now()
    const a = anim.current
    for (const blk of event.blocks) {
      if (blk.txs && blk.txs > recentMax.current) recentMax.current = blk.txs
      const packerId =
        blk.packer && byId.has(blk.packer)
          ? blk.packer
          : graph.hubIds[0] ?? graph.nodes.find((n) => n.online && n.kind !== 'wallet')?.id ?? ''
      if (!packerId) continue
      const plan = propagationPlan(graph.edges, packerId)
      a.waves.push({ at: now, hops: plan.hops, maxHop: Math.max(1, plan.maxHop) })
      if (a.waves.length > 3) a.waves.shift()
      a.arrivals.set(packerId, now)
      for (const h of plan.hops) a.arrivals.set(h.to, now + h.hop * HOP_MS)
      setPackerFill(ringFill(blk.txs ?? 0, recentMax.current))
    }
    const ingress: number[] = []
    curves.forEach((cv, i) => {
      if (cv.edge.kind === 'ingress') ingress.push(i)
    })
    if (ingress.length && event.newTxs > 0) {
      const cap = isMobile ? 12 : 28
      const count = Math.min(cap, bulgeCount(event.newTxs, maxBulges))
      for (let i = 0; i < count; i++) {
        a.tx.push({ at: now + i * 60, dur: 1000, idx: ingress[i % ingress.length] })
      }
      if (a.tx.length > cap * 2) a.tx.splice(0, a.tx.length - cap * 2)
    }
    invalidateRef.current?.()
  }, [event, byId, curves, graph, isMobile, maxBulges])

  const activeId = hovered ?? selected
  const packer = round?.packer ?? ''
  const voters = useMemo(() => new Set(round?.voters ?? []), [round])
  const hoveredNode = hovered ? byId.get(hovered) ?? null : null
  const liveWatchers = watchers?.live.length ?? 0
  const epochWatchers = watchers?.epoch.length ?? 0
  const animate = visible && !reducedMotion
  const autoRotate = !reducedMotion && !interacting

  const dolly = (f: number) => {
    const c = controls.current
    if (!c) return
    const cam = c.object as THREE.PerspectiveCamera
    const off = cam.position.clone().sub(c.target).multiplyScalar(f)
    const len = THREE.MathUtils.clamp(off.length(), 5, 80)
    cam.position.copy(c.target).add(off.setLength(len))
    c.update()
    invalidateRef.current?.()
  }

  return (
    <div className="relative w-full h-full select-none overflow-hidden">
      <Boundary onFail={onFail}>
        <Canvas
          className="touch-none"
          frameloop={animate ? 'always' : 'demand'}
          dpr={isMobile ? [1, 1.25] : [1, 1.75]}
          camera={{ fov: 45, position: [0, 6, 22] }}
          gl={{ antialias: !isMobile, powerPreference: 'high-performance', alpha: false }}
          onCreated={({ gl, invalidate }) => {
            invalidateRef.current = invalidate
            gl.toneMapping = THREE.ACESFilmicToneMapping
            gl.toneMappingExposure = 1.05
            gl.domElement.addEventListener(
              'webglcontextlost',
              (ev) => {
                ev.preventDefault()
                onFail?.('WebGL context lost')
              },
              { once: true },
            )
          }}
          onPointerMissed={() => setHovered(null)}
        >
          <color attach="background" args={[C.bg]} />
          <fog attach="fog" args={[C.bg, 26, 70]} />
          <ambientLight intensity={0.25} />
          <hemisphereLight args={['#94A3B8', '#020617', 0.35]} />
          <directionalLight position={[8, 12, 10]} intensity={1.1} color="#FFE2B8" />
          <pointLight position={[-12, -6, -8]} intensity={40} distance={60} color={C.cyan} />
          <StudioEnv />
          <Stars count={isMobile ? 260 : 700} />
          <GeoHalos halos={halos} />
          <Links curves={curves} activeId={activeId} />
          <Pulses curves={curves} anim={anim} pairIndex={pairIndex} max={isMobile ? 80 : 180} />
          {graph.nodes.map((n) => {
            const p = pos.get(n.id)
            if (!p) return null
            return (
              <NodeObject
                key={n.id}
                node={n}
                pos={p}
                isPacker={n.id === packer}
                isVoter={voters.has(n.id)}
                active={n.id === activeId}
                packerFill={packerFill}
                anim={anim}
                walletCount={walletCount ?? null}
                showGeoInLabel={!multiGeo.has(n.locationId)}
                onSelect={onSelect}
                onHover={setHovered}
              />
            )
          })}
          <FrameDriver anim={anim} phaseRef={consensus?.phaseRef} fpsRef={fpsRef} />
          <OrbitControls
            ref={controls}
            makeDefault
            enableDamping
            dampingFactor={0.08}
            autoRotate={autoRotate}
            autoRotateSpeed={0.5}
            minDistance={5}
            maxDistance={80}
            onStart={() => {
              setInteracting(true)
              if (idleTimer.current) clearTimeout(idleTimer.current)
            }}
            onEnd={() => {
              if (idleTimer.current) clearTimeout(idleTimer.current)
              idleTimer.current = setTimeout(() => setInteracting(false), 9000)
            }}
          />
          <CameraRig controls={controls} isMobile={isMobile} fitKey={fitKey} />
          {!isMobile && (
            <Suspense fallback={null}>
              <Effects />
            </Suspense>
          )}
        </Canvas>
      </Boundary>

      <div className="absolute left-2.5 md:left-3 bottom-2.5 md:bottom-3 max-w-[calc(100%-116px)] flex flex-wrap items-center gap-1.5 pointer-events-none">
        <div className="netmap-watch">
          <span className="netmap-watch-dot" data-on={liveWatchers > 0 ? '1' : undefined} />
          watchers {liveWatchers}/{epochWatchers}
        </div>
        <div className="netmap-watch" style={{ borderColor: 'rgba(56, 189, 248, 0.45)' }}>
          <span className="netmap-watch-dot" style={{ background: BRIDGE_OPERATORS.length ? '#38BDF8' : '#475569' }} />
          {BRIDGE_OPERATORS.length
            ? `bridge ops ${BRIDGE_OPERATORS.length}`
            : isMobile
              ? 'bridge · soon'
              : 'BTC bridge operators · coming soon'}
        </div>
      </div>

      <div className="absolute right-2.5 md:right-3 bottom-2.5 md:bottom-3 flex items-center gap-1 bg-[#0F172A]/85 border border-slate-800 rounded-lg p-1 text-xs netmap-mono">
        <button type="button" onClick={() => dolly(0.82)} className="px-2 py-0.5 text-slate-300 hover:text-[#E0DBCA]" aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => dolly(1.2)} className="px-2 py-0.5 text-slate-300 hover:text-[#E0DBCA]" aria-label="Zoom out">
          −
        </button>
        <button
          type="button"
          onClick={() => {
            setInteracting(false)
            setFitKey((k) => k + 1)
          }}
          className="px-2 py-0.5 text-slate-400 hover:text-[#E0DBCA]"
          aria-label="Reset 3D view"
        >
          fit
        </button>
      </div>

      {hoveredNode && !isMobile && (
        <div className="pointer-events-none absolute left-3 top-14 rounded-lg border border-slate-700 bg-[#0F172A]/95 px-3 py-2 text-[11px] netmap-mono shadow-lg space-y-0.5 z-[6]">
          <div className="text-[#D4922A] font-semibold">
            {hoveredNode.id}
            {hoveredNode.isHub && (
              <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded-full border border-[#C07838] text-[#FFC060]">
                {hoveredNode.isArchive ? 'HUB · ARCHIVE' : 'HUB'}
              </span>
            )}
            {hoveredNode.isSeed && (
              <span className="ml-1 text-[9px] px-1.5 py-0.5 rounded-full border border-slate-500 text-slate-200">SEED</span>
            )}
          </div>
          <div className="text-slate-400">
            {[hoveredNode.host, hoveredNode.locationLabel].filter(Boolean).join(' · ') || hoveredNode.kind}
          </div>
          <div className="text-slate-300">
            peers {hoveredNode.degree} · tip {hoveredNode.tip ? `#${hoveredNode.tip.toLocaleString()}` : '—'} · packs{' '}
            {hoveredNode.packs.toLocaleString()}
          </div>
        </div>
      )}
    </div>
  )
}
