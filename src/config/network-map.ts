// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
/**
 * Live network map (/scan/map) layout config. Edit this file to update known
 * hostnames and geographic labels for seats.
 *
 * Hub status, archive flags, online state, and peer edges NEVER live here —
 * they are read live from node RPCs (/api/scan and /api/scan/topology).
 * Seats not listed here still appear on the mesh with no location label so a
 * new validator or hub never disappears from the map.
 */

export interface MapHost {
  /** Machine name shown under the seat label. */
  host: string
  seats: string[]
  note?: string
}

export interface MapLocation {
  id: string
  /** Location name; empty for seats whose location is not known. */
  label: string
  hosts: MapHost[]
  /** Optional accent for the location cluster. */
  color?: string
}

export interface NetworkMapConfig {
  /**
   * Wallet services: where client transactions enter (wallet app + loadgen,
   * falcon-pl-loadgen.service). Shown as an ingress peer connected to live hubs.
   */
  wallet: { label: string; sub: string } | null
  /** Status poll interval, ms (/api/scan). */
  pollMs: number
  /** Peer topology poll interval, ms (/api/scan/topology). */
  topologyPollMs: number
  /** Max nodes / edges rendered on mobile viewports (< 768px) to stay light. */
  maxNodesMobile: number
  maxEdgesMobile: number
  /** Max nodes / edges rendered on desktop viewports. */
  maxNodesDesktop: number
  maxEdgesDesktop: number
  /** Hard cap on concurrent animated tx pulses. */
  maxBulges: number
  /** Max watcher names surfaced inline before +N summary. */
  maxWatcherParticles: number
  /** Show jailed / offline seats that are not in `locations`. */
  showUnplacedOffline: boolean
  locations: MapLocation[]
}

export const NETWORK_MAP_CONFIG: NetworkMapConfig = {
  wallet: { label: 'Wallet services', sub: 'wallet app · loadgen' },
  pollMs: 1500,
  topologyPollMs: 6000,
  maxNodesMobile: 20,
  maxEdgesMobile: 48,
  maxNodesDesktop: 44,
  maxEdgesDesktop: 120,
  maxBulges: 120,
  maxWatcherParticles: 48,
  showUnplacedOffline: false,
  locations: [
    {
      id: 'england',
      label: 'England',
      color: '#D4922A',
      hosts: [
        { host: 'falcon1', seats: ['v1'] },
        { host: 'falcon2', seats: ['v3', 'scottdog'] },
        { host: 'beartec-brain', seats: ['falcon-node'], note: 'loadgen: transactions enter here' },
      ],
    },
    {
      id: 'helsinki',
      label: 'Helsinki, Finland',
      color: '#38BDF8',
      hosts: [
        { host: 'ubuntu-4gb-hel1-6', seats: ['v10'] },
        { host: 'ubuntu-4gb-hel1-4', seats: ['scottspersonalnode'] },
      ],
    },
    {
      id: 'germany',
      label: 'Germany',
      color: '#4ADE80',
      hosts: [{ host: 'ubuntu-4gb-mhr', seats: ['v6'] }],
    },
    {
      id: 'falkenstein',
      label: 'Falkenstein, Germany',
      color: '#A78BFA',
      hosts: [{ host: 'ubuntu-8gb-fsn1-1', seats: ['v13'] }],
    },
    {
      id: 'hillsboro',
      label: 'Hillsboro, US',
      color: '#F472B6',
      hosts: [{ host: 'ubuntu-8gb-hil-2-1', seats: ['v12'] }],
    },
  ],
}
