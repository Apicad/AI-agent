import type { FleetHandoff } from '../types.js';

/**
 * Module-level store for fleet handoffs so the 60fps render loop can read them
 * without prop-plumbing fleetState through OfficeCanvas/App (which stay untouched).
 * Written by useExtensionMessages on every fleetState broadcast.
 */
let current: FleetHandoff[] = [];

export function setFleetHandoffs(handoffs: FleetHandoff[]): void {
  current = handoffs;
}

export function getFleetHandoffs(): FleetHandoff[] {
  return current;
}
