import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/server.js';
import { EnvConfigSchema } from '@atlas/shared';

describe('agent-service settings endpoints', () => {
  const config = EnvConfigSchema.parse({ NODE_ENV: 'test' });
  const server = buildServer({ config, processQueue: false });

  it('rejects a telegram bot token containing a line break', async () => {
    const response = await server.inject({
      method: 'PUT',
      url: '/api/v1/settings/telegram',
      payload: { botToken: '123456:fake\nAPI_AUTH_TOKEN=' }
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe('Invalid telegram settings payload');
  });

  it('rejects a telegram allowlist containing a carriage return', async () => {
    const response = await server.inject({
      method: 'PUT',
      url: '/api/v1/settings/telegram',
      payload: { allowedUserIds: '7860981010\r\nEXTERNAL_WRITES_ENABLED=true' }
    });

    expect(response.statusCode).toBe(400);
  });
});
