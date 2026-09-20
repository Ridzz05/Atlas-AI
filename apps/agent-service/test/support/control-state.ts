import { vi } from 'vitest';

/**
 * A control-state source that reports the system is running.
 *
 * Every intake route is gated on the operator's pause / emergency-stop state, and the gate fails
 * closed: a server with no control-state source refuses intake with 503 rather than proceeding as if
 * the stop had never been pressed. Tests that exercise intake therefore have to say which state the
 * system is in — which is the point of the requirement.
 *
 * Use `runningControlState()` for the ordinary case, and build the object by hand when a test is
 * about the gate itself (see intake-gate.test.ts).
 */
export function runningControlState() {
  return {
    getControlState: vi.fn(async () => ({
      paused: false,
      emergencyStop: false,
      updatedBy: 'test',
      updatedAt: new Date().toISOString()
    })),
    setPaused: vi.fn(),
    setEmergencyStop: vi.fn(),
    resume: vi.fn()
  };
}

/** A control-state source that reports the system is paused. */
export function pausedControlState() {
  return {
    getControlState: vi.fn(async () => ({
      paused: true,
      emergencyStop: false,
      updatedBy: 'test',
      updatedAt: new Date().toISOString()
    })),
    setPaused: vi.fn(),
    setEmergencyStop: vi.fn(),
    resume: vi.fn()
  };
}
