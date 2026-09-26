import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Meeting } from '../db/DatabaseManager';

/**
 * Small, local-only fan-out for durable meeting notes.
 *
 * Agent Mesh and Obsidian are deliberately treated as optional sidecars. A
 * missing service, vault, token, or permission can never affect the meeting
 * save path. Only the generated summary is exported; raw transcript turns are
 * not copied into either destination.
 */
export interface LocalKnowledgeSyncResult {
    enabled: boolean;
    obsidian: 'written' | 'skipped' | 'failed';
    agentMesh: 'written' | 'skipped' | 'failed';
    notePath?: string;
    error?: string;
}

interface MeshMemoryResponse {
    source?: string;
}

const DEFAULT_AGENT_MESH_URL = 'http://127.0.0.1:17860';
const DEFAULT_VAULT_RELATIVE = path.join('AI-Second-Brain', 'AI-Second-Brain-Vault');
const AGENT_NAME = 'Natively Desktop';
const MAX_NOTE_BYTES = 190 * 1024;
const REQUEST_TIMEOUT_MS = 1200;
// Agent Mesh can be busy with its background orchestration writer while its
// read endpoints remain responsive. Registration is only a control-plane
// fallback, so give that one write enough time to complete without slowing the
// normal summary search/write path.
const REGISTRATION_TIMEOUT_MS = 35000;

function truthy(value: unknown): boolean {
    return ['1', 'true', 'on', 'yes'].includes(String(value ?? '').trim().toLowerCase());
}

function falsy(value: unknown): boolean {
    return ['0', 'false', 'off', 'no'].includes(String(value ?? '').trim().toLowerCase());
}

function envValue(name: string): string {
    return String(process.env[name] || '').trim();
}

function parseDotEnvValue(line: string, name: string): string | null {
    const match = line.match(new RegExp(`^${name}\\s*=\\s*(.*)$`));
    if (!match) return null;
    return match[1].trim().replace(/^['"]|['"]$/g, '');
}

function localAgentMeshToken(): string {
    const direct = envValue('AGENT_MESH_TOKEN');
    if (direct) return direct;

    // The existing local Agent Mesh service keeps its token in this user's
    // private .env.local. Read it without logging or returning it to a renderer.
    const roots = [
        path.join(os.homedir(), 'AI-Second-Brain'),
        process.cwd(),
    ];
    for (const root of roots) {
        for (const filename of ['.env.local', '.env']) {
            try {
                const content = fs.readFileSync(path.join(root, filename), 'utf8');
                const value = content.split(/\r?\n/).map((line) => parseDotEnvValue(line, 'AGENT_MESH_TOKEN')).find(Boolean);
                if (value) return value;
            } catch { /* optional local integration */ }
        }
    }
    return '';
}

function configuredSetting(): boolean | undefined {
    try {
        const { SettingsManager } = require('./SettingsManager') as typeof import('./SettingsManager');
        const value = SettingsManager.getInstance().get('localKnowledgeSyncEnabled');
        return typeof value === 'boolean' ? value : undefined;
    } catch {
        return undefined;
    }
}

function isWithin(parent: string, candidate: string): boolean {
    const root = path.resolve(parent);
    const resolved = path.resolve(candidate);
    return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function slug(value: string): string {
    const result = String(value || 'meeting')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()
        .slice(0, 72);
    return result || 'meeting';
}

function yaml(value: string): string {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
}

function stringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') {
            const candidate = item as Record<string, unknown>;
            return String(candidate.text ?? candidate.title ?? candidate.detail ?? '').trim();
        }
        return '';
    }).filter(Boolean);
}

function section(title: string, items: string[]): string {
    if (items.length === 0) return '';
    return `## ${title}\n\n${items.map((item) => `- ${item}`).join('\n')}\n`;
}

function summaryText(meeting: Meeting): string {
    const details = (meeting.detailedSummary || {}) as Record<string, unknown>;
    const overview = typeof details.overview === 'string' ? details.overview.trim() : '';
    const tldr = stringList(details.tldr).length ? stringList(details.tldr) : stringList(details.keyPoints);
    const decisions = stringList(details.decisions);
    const actions = stringList(details.actionItemsV3).length
        ? stringList(details.actionItemsV3)
        : (stringList(details.actionItemsStructured).length ? stringList(details.actionItemsStructured) : stringList(details.actionItems));
    const questions = stringList(details.openQuestions);
    const risks = stringList(details.risks);
    const topics = stringList(details.topics);
    const parts = [
        overview ? `## Overview\n\n${overview}\n` : '',
        section('Key points', tldr),
        section('Decisions', decisions),
        section('Action items', actions),
        section('Open questions', questions),
        section('Risks', risks),
        topics.length ? `## Topics\n\n${topics.join(', ')}\n` : '',
    ].filter(Boolean);
    return parts.join('\n');
}

function markdownFor(meeting: Meeting): string {
    const date = meeting.date || new Date().toISOString();
    const details = (meeting.detailedSummary || {}) as Record<string, unknown>;
    const mode = details.mode && typeof details.mode === 'object'
        ? String((details.mode as Record<string, unknown>).templateType || '')
        : '';
    const body = summaryText(meeting) || 'No generated summary was available.';
    const note = [
        '---',
        `title: "${yaml(meeting.title || 'Untitled meeting')}"`,
        `date: "${yaml(date)}"`,
        `duration: "${yaml(meeting.duration || '')}"`,
        `source: "natively://meeting/${yaml(meeting.id)}"`,
        'tags: [natively, meeting]',
        mode ? `mode: "${yaml(mode)}"` : '',
        '---',
        '',
        `# ${meeting.title || 'Untitled meeting'}`,
        '',
        body,
        '',
        `Source meeting id: \`${meeting.id}\``,
        '',
    ].filter(Boolean).join('\n');
    const bytes = Buffer.from(note, 'utf8');
    if (bytes.byteLength <= MAX_NOTE_BYTES) return note;
    return `${bytes.subarray(0, MAX_NOTE_BYTES - 160).toString('utf8')}\n\n> Note truncated to protect the local vault size limit.\n`;
}

export class LocalKnowledgeBridge {
    private static instance: LocalKnowledgeBridge | null = null;
    private registration: Promise<void> | null = null;
    private activeSyncs = new Set<string>();

    static getInstance(): LocalKnowledgeBridge {
        if (!this.instance) this.instance = new LocalKnowledgeBridge();
        return this.instance;
    }

    private agentMeshUrl(): string {
        return (envValue('NATIVELY_AGENT_MESH_URL') || envValue('AGENT_MESH_BASE_URL') || DEFAULT_AGENT_MESH_URL).replace(/\/$/, '');
    }

    private vaultPath(): string {
        return path.resolve(envValue('NATIVELY_OBSIDIAN_VAULT_PATH') || envValue('OBSIDIAN_VAULT_PATH') || path.join(os.homedir(), DEFAULT_VAULT_RELATIVE));
    }

    private enabled(): boolean {
        const override = envValue('NATIVELY_LOCAL_KNOWLEDGE_SYNC');
        if (truthy(override)) return true;
        if (falsy(override)) return false;
        const setting = configuredSetting();
        if (typeof setting === 'boolean') return setting;
        // Enabling Hindsight post-meeting memory is an explicit user opt-in to
        // durable summaries; use it as the compatibility default for this bridge.
        try {
            const { isIntelligenceFlagEnabled } = require('../intelligence/intelligenceFlags') as typeof import('../intelligence/intelligenceFlags');
            return isIntelligenceFlagEnabled('hindsightMemory') && isIntelligenceFlagEnabled('hindsightPostMeetingRetain');
        } catch {
            return false;
        }
    }

    getStatus(): { enabled: boolean; vault: string; vaultExists: boolean; agentMeshUrl: string } {
        const vault = this.vaultPath();
        return { enabled: this.enabled(), vault, vaultExists: fs.existsSync(vault), agentMeshUrl: this.agentMeshUrl() };
    }

    private async request<T = unknown>(endpoint: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const headers = new Headers(init.headers || {});
            headers.set('Content-Type', 'application/json');
            const token = localAgentMeshToken();
            if (token) headers.set('Authorization', `Bearer ${token}`);
            headers.set('X-Agent-Mesh-Agent', AGENT_NAME);
            const response = await fetch(`${this.agentMeshUrl()}${endpoint}`, { ...init, headers, signal: controller.signal });
            const text = await response.text();
            let payload: unknown = null;
            try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
            if (!response.ok) throw new Error(`Agent Mesh HTTP ${response.status}`);
            return payload as T;
        } finally {
            clearTimeout(timer);
        }
    }

    private register(): Promise<void> {
        if (this.registration) return this.registration;
        this.registration = (async () => {
            // Avoid taking the mesh write lock on every first sync when this
            // desktop agent was already registered by a previous launch.
            const agents = await this.request<unknown>('/agents', { method: 'GET' });
            const rows = Array.isArray(agents)
                ? agents
                : (agents && typeof agents === 'object' && Array.isArray((agents as { agents?: unknown[] }).agents)
                    ? (agents as { agents: unknown[] }).agents
                    : []);
            if (rows.some((row) => row && typeof row === 'object' && (row as { name?: unknown }).name === AGENT_NAME)) return;

            await this.request('/agents/register', {
                method: 'POST',
                body: JSON.stringify({
                    name: AGENT_NAME,
                    provider: 'natively',
                    type: 'desktop-app',
                    model: 'meeting-summary-memory',
                    status: 'active',
                    health: 'online',
                    endpoint: this.agentMeshUrl(),
                    max_concurrent_tasks: 1,
                    capabilities: {
                        meeting_summaries: true,
                        long_term_memory: true,
                        obsidian_sync: true,
                        agent_mesh: true,
                        local_only: true,
                    },
                    metadata: {
                        integration: 'natively-local-knowledge-bridge',
                        obsidian_vault: this.vaultPath(),
                        source_format: 'summary-only',
                    },
                }),
            }, REGISTRATION_TIMEOUT_MS);
        })().catch((error) => {
            this.registration = null;
            throw error;
        });
        return this.registration;
    }

    private async writeObsidian(meeting: Meeting): Promise<string> {
        const vault = this.vaultPath();
        if (!fs.existsSync(vault)) throw new Error('Obsidian vault does not exist');
        const date = (meeting.date || new Date().toISOString()).slice(0, 10);
        const relative = path.join('03_Projects', 'Natively', 'Meetings', `${date}-${slug(meeting.title)}-${slug(meeting.id).slice(0, 12)}.md`);
        const target = path.resolve(vault, relative);
        if (!isWithin(vault, target) || path.extname(target) !== '.md') throw new Error('invalid Obsidian note path');
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
        fs.writeFileSync(temp, markdownFor(meeting), { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(temp, target);
        return target;
    }

    private async writeAgentMesh(meeting: Meeting): Promise<void> {
        await this.register();
        const source = `natively://meeting/${meeting.id}`;
        const found = await this.request<MeshMemoryResponse[]>(`/memory/search?q=${encodeURIComponent(source)}`, { method: 'GET' });
        if (Array.isArray(found) && found.some((row) => row?.source === source)) return;
        await this.request('/memory', {
            method: 'POST',
            body: JSON.stringify({
                title: `Natively meeting: ${meeting.title || meeting.id}`,
                category: 'meeting_summary',
                body: summaryText(meeting).slice(0, 100000),
                source,
                confidence: 0.9,
                sensitivity: 'private-local',
            }),
        });
    }

    async syncMeeting(meeting: Meeting): Promise<LocalKnowledgeSyncResult> {
        if (!this.enabled() || !meeting?.id || meeting.summaryStatus === 'failed') {
            return { enabled: false, obsidian: 'skipped', agentMesh: 'skipped' };
        }
        if (this.activeSyncs.has(meeting.id)) return { enabled: true, obsidian: 'skipped', agentMesh: 'skipped' };
        this.activeSyncs.add(meeting.id);
        try {
            const [obsidian, agentMesh] = await Promise.allSettled([
                this.writeObsidian(meeting),
                this.writeAgentMesh(meeting),
            ]);
            const result: LocalKnowledgeSyncResult = {
                enabled: true,
                obsidian: obsidian.status === 'fulfilled' ? 'written' : 'failed',
                agentMesh: agentMesh.status === 'fulfilled' ? 'written' : 'failed',
                notePath: obsidian.status === 'fulfilled' ? obsidian.value : undefined,
                error: [
                    obsidian.status === 'rejected' ? `Obsidian: ${String(obsidian.reason?.message || obsidian.reason)}` : '',
                    agentMesh.status === 'rejected' ? `Agent Mesh: ${String(agentMesh.reason?.message || agentMesh.reason)}` : '',
                ].filter(Boolean).join('; ') || undefined,
            };
            console.log('[LocalKnowledgeBridge] meeting sync complete', {
                meetingId: meeting.id,
                obsidian: result.obsidian,
                agentMesh: result.agentMesh,
            });
            return result;
        } finally {
            this.activeSyncs.delete(meeting.id);
        }
    }
}

export const localKnowledgeBridge = LocalKnowledgeBridge.getInstance();
