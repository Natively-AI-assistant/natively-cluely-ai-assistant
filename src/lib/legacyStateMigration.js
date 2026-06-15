export const SAFE_DEFAULT_MODEL = 'gemini-3.1-flash-lite';
export const SAFE_STT_PROVIDER = 'none';

export function sanitizeDefaultModel(model) {
  return model === 'natively' ? SAFE_DEFAULT_MODEL : (model || SAFE_DEFAULT_MODEL);
}

export function sanitizeSttProvider(provider) {
  return provider === 'natively' ? SAFE_STT_PROVIDER : (provider || SAFE_STT_PROVIDER);
}

