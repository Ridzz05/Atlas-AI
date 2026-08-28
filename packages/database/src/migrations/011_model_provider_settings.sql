-- Persisted model-provider configuration. API keys are encrypted before insertion.
CREATE TABLE IF NOT EXISTS model_provider_settings (
    id VARCHAR(32) PRIMARY KEY,
    provider VARCHAR(64) NOT NULL,
    model_name VARCHAR(128) NOT NULL,
    encrypted_api_key TEXT,
    api_key_fingerprint VARCHAR(16),
    updated_by VARCHAR(128) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT model_provider_settings_singleton CHECK (id = 'singleton')
);
