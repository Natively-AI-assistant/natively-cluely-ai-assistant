// assistPrivacy.ts
//
// Whether the assist features may hand saved notes to a model. The notes'
// own gate decides: Settings › AI Providers › data scopes, "post-call
// summary". Turned off, notes may still go to a model on this machine (the
// notes pipeline routes to Ollama the same way), never to a cloud provider.
// When this says no, the assist features show their lists without the model's
// parts (talking points come from the items instead).
//
// Pure, no platform branches.

export function notesMayUseModel(scopes: { post_call_summary?: boolean } | null | undefined, modelIsLocal: boolean): boolean {
  if (scopes?.post_call_summary !== false) return true;
  return modelIsLocal === true;
}
