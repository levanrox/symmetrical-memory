import { randomUUID } from "node:crypto";

/**
 * Per-boot instance identifier.
 *
 * Generated once at module load, so it is stable for the whole process
 * lifetime but different on every restart. The health route reports it as
 * `instanceId`, and the admin "Judge access → Test" action fetches the
 * public URL's `/api/health` and compares the remote value with this one —
 * proving the pasted URL reaches THIS server and not a stale/typo'd one.
 *
 * Lives in its own module (rather than only inside the health route) so
 * both the route and the test action read the same module-load value
 * without cross-importing a route file.
 */
const INSTANCE_ID = randomUUID();

export function getInstanceId(): string {
  return INSTANCE_ID;
}
