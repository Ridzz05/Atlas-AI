import { ModelProvider, ModelRunRequest, ModelRunResult } from './types.js';
import { ProviderConfig, createModelProvider } from './factory.js';

export type ModelProviderConfigResolver = () => Promise<ProviderConfig | undefined>;

/**
 * Resolves persisted provider settings at call time so API and worker processes
 * can share a runtime model configuration without restarting either process.
 */
export class ReloadableModelProvider implements ModelProvider {
  public readonly id: string;
  public readonly name: string;

  constructor(
    private readonly fallback: ModelProvider,
    private readonly resolveConfig: ModelProviderConfigResolver
  ) {
    this.id = fallback.id;
    this.name = fallback.name;
  }

  public estimateCost(inputTokens: number, outputTokens: number): number {
    return this.fallback.estimateCost(inputTokens, outputTokens);
  }

  public async run(request: ModelRunRequest): Promise<ModelRunResult> {
    const config = await this.resolveConfig();
    const provider = config ? createModelProvider(config) : this.fallback;
    return provider.run(request);
  }
}
