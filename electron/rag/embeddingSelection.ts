// electron/rag/embeddingSelection.ts
//
// Validation for an explicit embedding-provider choice.
//
// This guarantee used to live in the panel, which filtered its selector down to
// available providers. That is a UI detail and it has moved before; the rule
// belongs on the write path so no surface can store a selection that cannot run.
//
// The failure it prevents is silent and misleading rather than loud: the choice
// is written, the resolver correctly yields NO candidate for a provider with no
// credentials, resolve() falls through to the bundled model, and the user is
// left looking at MiniLM wondering why picking Gemini chose something else.

export interface SelectableProvider {
  id: string;
  name: string;
  available: boolean;
  unavailableReason?: 'no_key' | 'not_running' | 'blocked_by_policy' | 'not_configured';
}

export interface SelectionVerdict {
  ok: boolean;
  error?: 'provider_unavailable' | 'unknown_provider';
  message?: string;
}

/**
 * Reason text is per-cause on purpose. "Add an API key" is actively misleading
 * for Ollama (which takes none) and for a policy block (where a key would not
 * help), and a user who follows the wrong instruction concludes the app is
 * broken.
 */
function explain(p: SelectableProvider): string {
  switch (p.unavailableReason) {
    case 'no_key':
      return `${p.name} has no API key yet. Add one in AI Providers, then choose it here.`;
    case 'not_running':
      return `${p.name} is not running. Start it and try again.`;
    case 'not_configured':
      return `${p.name} has no endpoint set. Enter the server URL first.`;
    case 'blocked_by_policy':
      return `${p.name} is blocked by your privacy settings, which do not allow embeddings to leave this device.`;
    default:
      return `${p.name} is not available right now.`;
  }
}

/**
 * Verdict on an explicit provider choice.
 *
 * `undefined` is automatic mode — not a selection, and never blocked.
 */
export function validateEmbeddingSelection(
  providerId: string | undefined,
  catalog: readonly SelectableProvider[],
): SelectionVerdict {
  const chosen = (providerId || '').trim();
  if (!chosen) return { ok: true };

  const provider = catalog.find(p => p.id === chosen);
  if (!provider) {
    return {
      ok: false,
      error: 'unknown_provider',
      message: `"${chosen}" is not an embedding provider Natively knows about.`,
    };
  }
  if (!provider.available) {
    return { ok: false, error: 'provider_unavailable', message: explain(provider) };
  }
  return { ok: true };
}
