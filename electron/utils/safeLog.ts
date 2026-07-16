import { redactSensitiveText } from './safeConnectionError';

const SENSITIVE_LOG_KEY = /^(authorization|proxy-authorization|api[-_]?key|token|secret|password|cookie|set-cookie|headers|config|request|response|prompt|transcript|content|text)$/i;

function safeSerialize(value: unknown): string {
  if (value instanceof Error) {
    return JSON.stringify({
      name: value.name,
      message: redactSensitiveText(value.message),
      code: redactSensitiveText((value as any).code),
      status: (value as any).status,
    });
  }

  if (typeof value === 'string') return redactSensitiveText(value);
  if (typeof value !== 'object' || value === null) return String(value);

  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (key, nestedValue) => {
      if (key && SENSITIVE_LOG_KEY.test(key)) return '[REDACTED]';
      if (nestedValue instanceof Error) {
        return {
          name: nestedValue.name,
          message: redactSensitiveText(nestedValue.message),
          code: redactSensitiveText((nestedValue as any).code),
          status: (nestedValue as any).status,
        };
      }
      if (typeof nestedValue === 'string') return redactSensitiveText(nestedValue);
      if (typeof nestedValue === 'object' && nestedValue !== null) {
        if (seen.has(nestedValue)) return '[Circular]';
        seen.add(nestedValue);
      }
      return nestedValue;
    });
  } catch {
    return '[Unserializable log value]';
  }
}

export function formatSafeLogArgs(args: unknown[]): string {
  return args.map(safeSerialize).join(' ');
}
