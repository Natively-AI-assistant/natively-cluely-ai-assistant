import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PairingConfig } from '../protocol/types';

const STORAGE_KEY = '@natively/phone-mirror-pairing';

const DEFAULTS: PairingConfig = {
  host: '',
  port: '4123',
  phoneToken: '',
};

export async function loadPairingConfig(): Promise<PairingConfig> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<PairingConfig>;
    return {
      host: typeof parsed.host === 'string' ? parsed.host : DEFAULTS.host,
      port: typeof parsed.port === 'string' ? parsed.port : DEFAULTS.port,
      phoneToken: typeof parsed.phoneToken === 'string' ? parsed.phoneToken : DEFAULTS.phoneToken,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function savePairingConfig(config: PairingConfig): Promise<void> {
  const payload: PairingConfig = {
    host: config.host.trim(),
    port: String(config.port).trim() || DEFAULTS.port,
    phoneToken: config.phoneToken.trim(),
  };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export async function clearPairingConfig(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
