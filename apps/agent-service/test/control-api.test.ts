import { describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/server.js';
import { EnvConfigSchema } from '@atlas/shared';

const config = EnvConfigSchema.parse({ NODE_ENV: 'test' });

function createControlStateRepo() {
  const state = {
    paused: false,
    emergencyStop: false,
    updatedBy: null as string | null,
    updatedAt: null as Date | null
  };

  return {
    state,
    getControlState: vi.fn(async () => state),
    setPaused: vi.fn(async (paused: boolean, updatedBy: string) => ({
      ...state,
      paused,
      emergencyStop: false,
      updatedBy,
      updatedAt: new Date()
    })),
    setEmergencyStop: vi.fn(async (active: boolean, updatedBy: string) => ({
      ...state,
      paused: active,
      emergencyStop: active,
      updatedBy,
      updatedAt: new Date()
    })),
    resume: vi.fn(async (updatedBy: string) => ({
      ...state,
      paused: false,
      emergencyStop: false,
      updatedBy,
      updatedAt: new Date()
    }))
  };
}

describe('agent-service control API', () => {
  it('reads the durable execution control state', async () => {
    const controlStateRepo = createControlStateRepo();
    const server = buildServer({ config, controlStateRepo, processQueue: false });

    const response = await server.inject({ method: 'GET', url: '/api/v1/control' });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      durable: true,
      data: { paused: false, emergencyStop: false }
    });
    expect(controlStateRepo.getControlState).toHaveBeenCalledOnce();
  });

  it('activates emergency stop and requests cancellation of active runs', async () => {
    const controlStateRepo = createControlStateRepo();
    const runRepo = {
      requestCancellationForActive: vi.fn(async () => 3)
    };
    const server = buildServer({ config, controlStateRepo, runRepo: runRepo as any, processQueue: false });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/control/emergency-stop',
      payload: { reason: 'Dashboard incident response' }
    });

    expect(response.statusCode).toBe(200);
    expect(controlStateRepo.setEmergencyStop).toHaveBeenCalledWith(true, 'api-owner');
    expect(runRepo.requestCancellationForActive).toHaveBeenCalledWith('Dashboard incident response');
    expect(JSON.parse(response.body)).toMatchObject({
      durable: true,
      cancelledRuns: 3,
      data: { emergencyStop: true, paused: true }
    });
  });

  it('pauses and resumes execution through durable control actions', async () => {
    const controlStateRepo = createControlStateRepo();
    const server = buildServer({ config, controlStateRepo, processQueue: false });

    const pauseResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/control/pause',
      payload: { reason: 'Maintenance window' }
    });
    const resumeResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/control/resume'
    });

    expect(pauseResponse.statusCode).toBe(200);
    expect(resumeResponse.statusCode).toBe(200);
    expect(controlStateRepo.setPaused).toHaveBeenCalledWith(true, 'api-owner');
    expect(controlStateRepo.resume).toHaveBeenCalledWith('api-owner');
  });

  it('rejects malformed control reasons before changing state', async () => {
    const controlStateRepo = createControlStateRepo();
    const server = buildServer({ config, controlStateRepo, processQueue: false });

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/control/emergency-stop',
      payload: { reason: '   ' }
    });

    expect(response.statusCode).toBe(400);
    expect(controlStateRepo.setEmergencyStop).not.toHaveBeenCalled();
  });

  it('fails closed when durable control state is unavailable', async () => {
    const server = buildServer({ config, processQueue: false });

    const response = await server.inject({ method: 'GET', url: '/api/v1/control' });

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body).error).toContain('unavailable');
  });
});
