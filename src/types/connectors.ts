// Settings › Connectors, the parts beyond send-on-press (meetingOutputs.ts):
// webhooks and Zapier, automatic sending per folder, personal API keys for the
// local API, and Gmail. Exposed as window.electronAPI.connectors.
//
// Everything runs on this computer: notes never pass through Natively's
// servers. Webhooks, Zapier and automatic sends go out from the app when a
// meeting's notes are ready, so they only run while Natively is open.

import type { CrmService, OutputResult } from './meetingOutputs';

// ── Deliveries ─────────────────────────────────────────────────────────

export type DeliveryStatus = 'success' | 'failed' | 'pending';

/** The last attempt to deliver something, for the row's "Last sent" line. */
export interface DeliveryInfo {
    at: number;
    status: DeliveryStatus;
    /** The meeting it was about, for "Sent "Weekly sync" 2 min ago". */
    meetingTitle?: string;
    /** A plain sentence for a failure; never a status code. */
    message?: string;
}

// ── Webhooks and Zapier ─────────────────────────────────────────────────

/** note.generated: a meeting's notes are ready. note.edited: someone changed them in Natively. */
export type WebhookEvent = 'note.generated' | 'note.edited';

export interface WebhookEndpointInfo {
    id: string;
    /** 'zapier' is a "Catch Hook" URL from Zapier's Webhooks trigger; otherwise any https URL. */
    kind: 'webhook' | 'zapier';
    label: string;
    /** The host only, e.g. "hooks.zapier.com". The full URL is a secret and never comes back. */
    urlHost: string;
    events: WebhookEvent[];
    /** Only meetings in this folder; null for every meeting. */
    folderId: string | null;
    includeTranscript: boolean;
    enabled: boolean;
    createdAt: number;
    lastDelivery?: DeliveryInfo;
}

export interface WebhookCreateInput {
    kind: 'webhook' | 'zapier';
    label: string;
    url: string;
    events: WebhookEvent[];
    folderId: string | null;
    includeTranscript: boolean;
}

export type WebhookPatch = Partial<Pick<WebhookEndpointInfo, 'label' | 'events' | 'folderId' | 'includeTranscript' | 'enabled'>>;

// ── Automatic sending ───────────────────────────────────────────────────

export type AutoSendDestination =
    | { kind: 'slack'; webhookId: string }
    | { kind: 'notion' }
    | { kind: 'crm'; service: CrmService };

export interface AutoSendRuleInfo {
    id: string;
    destination: AutoSendDestination;
    /** Only meetings in this folder; null for every meeting. */
    folderId: string | null;
    enabled: boolean;
    createdAt: number;
    lastDelivery?: DeliveryInfo;
}

export interface FolderOption { id: string; name: string }

// ── Personal API keys (the local API) ───────────────────────────────────

export interface ApiKeyInfo {
    id: string;
    description: string;
    createdAt: number;
    /** null: never expires. */
    expiresAt: number | null;
    lastUsedAt: number | null;
    status: 'active' | 'expired' | 'revoked';
}

export interface LocalApiStatus {
    running: boolean;
    /** e.g. http://127.0.0.1:51234/v1 */
    baseUrl?: string;
    error?: string;
}

export const API_KEY_EXPIRY_DAYS = [1, 7, 30, 90, 180, 365] as const;

// ── Gmail ───────────────────────────────────────────────────────────────

export interface GmailStatus {
    /** False when this build has no Google client for Gmail: the row shows it is unavailable. */
    available: boolean;
    connected: boolean;
    /** The Gmail address connected. */
    account?: string;
    /** Read recent threads with attendees into meeting briefs. */
    briefsEnabled: boolean;
    /**
     * True without Pro or a trial (connectors are Pro): nothing is sent or read
     * through Gmail, and the follow-up falls back to Gmail's compose window.
     */
    locked?: boolean;
}

// ── The bridge ──────────────────────────────────────────────────────────

export interface ConnectorsApi {
    listFolders: () => Promise<FolderOption[]>;

    listWebhooks: () => Promise<WebhookEndpointInfo[]>;
    /** The signing secret comes back once, here, and never again. */
    createWebhook: (input: WebhookCreateInput) => Promise<OutputResult & { endpoint?: WebhookEndpointInfo; secret?: string }>;
    updateWebhook: (id: string, patch: WebhookPatch) => Promise<OutputResult>;
    deleteWebhook: (id: string) => Promise<OutputResult>;
    /** Sends a sample note.generated now. */
    testWebhook: (id: string) => Promise<OutputResult>;
    rotateWebhookSecret: (id: string) => Promise<OutputResult & { secret?: string }>;

    listAutoSendRules: () => Promise<AutoSendRuleInfo[]>;
    createAutoSendRule: (input: { destination: AutoSendDestination; folderId: string | null }) => Promise<OutputResult & { rule?: AutoSendRuleInfo }>;
    updateAutoSendRule: (id: string, patch: { enabled?: boolean; folderId?: string | null }) => Promise<OutputResult>;
    deleteAutoSendRule: (id: string) => Promise<OutputResult>;

    listApiKeys: () => Promise<{ keys: ApiKeyInfo[]; server: LocalApiStatus }>;
    /** The key comes back once, here, and never again. */
    createApiKey: (input: { description: string; expiresInDays: number | null }) => Promise<OutputResult & { key?: string; info?: ApiKeyInfo }>;
    revokeApiKey: (id: string) => Promise<OutputResult>;

    getGmailStatus: () => Promise<GmailStatus>;
    connectGmail: () => Promise<OutputResult>;
    cancelGmailConnect: () => Promise<void>;
    disconnectGmail: () => Promise<OutputResult>;
    setGmailBriefsEnabled: (enabled: boolean) => Promise<GmailStatus>;
    /** Sends the follow-up from the user's Gmail. Only on press. */
    sendGmailFollowUp: (input: { meetingId: string; to: string[]; subject: string; body: string }) => Promise<OutputResult & { messageUrl?: string }>;
}
