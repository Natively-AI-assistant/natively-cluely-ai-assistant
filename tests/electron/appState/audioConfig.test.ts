/**
 * Tests for audioConfig.ts - pure STT provider selection functions.
 */

import { describe, it, expect } from 'vitest';
import { selectSttProvider, getSttApiKey, SttCredentials } from '../../../electron/appState/audioConfig';

describe('audioConfig', () => {
  const credentialsWithKeys: SttCredentials = {
    natively: 'natively-key',
    deepgram: 'deepgram-key',
    soniox: 'soniox-key',
    elevenlabs: 'elevenlabs-key',
    openai: 'openai-key',
    groq: 'groq-key',
    groqSttModel: 'whisper-large-v3',
    azure: { key: 'azure-key', region: 'eastus' },
    ibm: { key: 'ibm-key', region: 'us-south' }
  };

  const emptyCredentials: SttCredentials = {};

  describe('selectSttProvider', () => {
    it('returns natively config with key', () => {
      const config = selectSttProvider('natively', credentialsWithKeys);
      expect(config.providerName).toBe('natively');
      expect(config.apiKey).toBe('natively-key');
    });

    it('returns deepgram config with key', () => {
      const config = selectSttProvider('deepgram', credentialsWithKeys);
      expect(config.providerName).toBe('deepgram');
      expect(config.apiKey).toBe('deepgram-key');
    });

    it('returns soniox config with key', () => {
      const config = selectSttProvider('soniox', credentialsWithKeys);
      expect(config.providerName).toBe('soniox');
      expect(config.apiKey).toBe('soniox-key');
    });

    it('returns elevenlabs config with key', () => {
      const config = selectSttProvider('elevenlabs', credentialsWithKeys);
      expect(config.providerName).toBe('elevenlabs');
      expect(config.apiKey).toBe('elevenlabs-key');
    });

    it('returns openai config with key', () => {
      const config = selectSttProvider('openai', credentialsWithKeys);
      expect(config.providerName).toBe('openai');
      expect(config.apiKey).toBe('openai-key');
    });

    it('returns groq config with key and model override', () => {
      const config = selectSttProvider('groq', credentialsWithKeys);
      expect(config.providerName).toBe('groq');
      expect(config.apiKey).toBe('groq-key');
      expect(config.modelOverride).toBe('whisper-large-v3');
    });

    it('returns azure config with key and region', () => {
      const config = selectSttProvider('azure', credentialsWithKeys);
      expect(config.providerName).toBe('azure');
      expect(config.apiKey).toBe('azure-key');
      expect(config.region).toBe('eastus');
    });

    it('returns ibm config with key and region', () => {
      const config = selectSttProvider('ibmwatson', credentialsWithKeys);
      expect(config.providerName).toBe('ibmwatson');
      expect(config.apiKey).toBe('ibm-key');
      expect(config.region).toBe('us-south');
    });

    it('returns google (default) config with null key', () => {
      const config = selectSttProvider('google', credentialsWithKeys);
      expect(config.providerName).toBe('google');
      expect(config.apiKey).toBeNull();
    });

    it('returns null key for missing provider credentials', () => {
      const config = selectSttProvider('deepgram', emptyCredentials);
      expect(config.providerName).toBe('deepgram');
      expect(config.apiKey).toBeNull();
    });
  });

  describe('getSttApiKey', () => {
    it('extracts api key for each provider', () => {
      expect(getSttApiKey('deepgram', credentialsWithKeys)).toBe('deepgram-key');
      expect(getSttApiKey('soniox', credentialsWithKeys)).toBe('soniox-key');
      expect(getSttApiKey('elevenlabs', credentialsWithKeys)).toBe('elevenlabs-key');
      expect(getSttApiKey('openai', credentialsWithKeys)).toBe('openai-key');
      expect(getSttApiKey('groq', credentialsWithKeys)).toBe('groq-key');
    });

    it('returns null for missing keys', () => {
      expect(getSttApiKey('deepgram', emptyCredentials)).toBeNull();
    });

    it('returns null for google (no key needed)', () => {
      expect(getSttApiKey('google', credentialsWithKeys)).toBeNull();
    });
  });
});
