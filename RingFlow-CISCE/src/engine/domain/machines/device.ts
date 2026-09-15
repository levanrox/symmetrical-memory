import { createStateMachine, type StateMachine } from '../state-machine';

/**
 * Device lifecycle — blueprint §4.5.
 *
 * Enrolment is a one-time act (a pairing code), so `ENROLLED` is the gate for
 * authentication. Losing the network only moves a device between `ONLINE`,
 * `STALE` and `OFFLINE`; it never silently un-enrols it, which is what lets the
 * admin dashboard distinguish "ring is quiet" from "ring was never paired".
 */
export const DEVICE_STATES = [
  'UNENROLLED',
  'ENROLLED',
  'AUTHENTICATED',
  'ONLINE',
  'STALE',
  'OFFLINE',
] as const;

export type DeviceState = (typeof DEVICE_STATES)[number];

export const deviceMachine: StateMachine<DeviceState> = createStateMachine<DeviceState>({
  initial: 'UNENROLLED',
  transitions: {
    UNENROLLED: ['ENROLLED'],
    ENROLLED: ['AUTHENTICATED', 'UNENROLLED'],
    AUTHENTICATED: ['ONLINE', 'OFFLINE'],
    ONLINE: ['STALE', 'OFFLINE'],
    STALE: ['ONLINE', 'OFFLINE'],
    // A returning device may re-authenticate, or be re-enrolled if it was reset.
    OFFLINE: ['ONLINE', 'AUTHENTICATED', 'UNENROLLED'],
  },
});
