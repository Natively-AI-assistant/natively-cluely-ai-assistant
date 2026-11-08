// The Integrations list on Settings › Connectors, in the order rows appear,
// with what each one does. Order follows Granola's Connectors page (email
// first, then where notes go, then the CRMs, then webhooks last), split into
// Settings-style groups by what each is for; Clearbit, which Granola does not
// have, sits with the CRMs it complements, and Zapier moves down beside
// Webhooks, which it is built on.

import type { ConnectorId } from '../ConnectorMark';

export type ConnectorKey =
    | 'gmail' | 'slack' | 'notion' | 'zapier'
    | 'affinity' | 'hubspot' | 'salesforce' | 'attio' | 'pipedrive' | 'clearbit'
    | 'webhooks';

export type ConnectorGroup = 'workspace' | 'crm' | 'automation';

/** The list's groups, in order, each under a small-capitals label. */
export const CONNECTOR_GROUPS: readonly { id: ConnectorGroup; label: string }[] = [
    { id: 'workspace', label: 'Email and workspace' },
    { id: 'crm', label: 'CRM' },
    { id: 'automation', label: 'Automation' },
];

export interface ConnectorEntry {
    key: ConnectorKey;
    group: ConnectorGroup;
    title: string;
    description: string;
    mark: ConnectorId;
    /** What connecting it does, one plain sentence per line, for the detail page. */
    howItWorks: string[];
}

export const CONNECTOR_CATALOG: readonly ConnectorEntry[] = [
    {
        key: 'gmail', group: 'workspace', title: 'Gmail', mark: 'gmail',
        description: 'Enrich meeting briefs and send follow-up emails',
        howItWorks: [
            'Before a meeting, its brief can mention recent email threads with the people you are meeting.',
            'After a meeting, send the follow-up email from your own Gmail: press Send with Gmail, then confirm.',
            'Natively reads only threads with the people in your meetings, and sends only when you press Send.',
        ],
    },
    {
        key: 'slack', group: 'workspace', title: 'Slack', mark: 'slack',
        description: 'Post notes to channels',
        howItWorks: [
            'Connecting adds a channel: Slack asks which one.',
            'Post a meeting’s notes from its Share menu, after you review the message.',
            'Or have notes posted by themselves when a meeting ends.',
        ],
    },
    {
        key: 'notion', group: 'workspace', title: 'Notion', mark: 'notion',
        description: 'Export meeting notes to Notion pages',
        howItWorks: [
            'Pick the page or database new notes go under.',
            'Each meeting becomes its own Notion page, with its summary, action items and, if you choose, the transcript.',
            'Send from a meeting’s Share menu, or automatically when notes are ready.',
        ],
    },
    {
        key: 'zapier', group: 'automation', title: 'Zapier', mark: 'zapier',
        description: 'Connect Natively to thousands of apps',
        howItWorks: [
            'Make a Zap that starts with Webhooks by Zapier, Catch Hook.',
            'Paste its address here, and pick which meetings go to it.',
            'When a meeting’s notes are ready, Natively sends them to your Zap.',
        ],
    },
    {
        key: 'affinity', group: 'crm', title: 'Affinity', mark: 'affinity',
        description: 'Sync meeting notes to Affinity',
        howItWorks: [
            'Natively finds the people you met in Affinity by their email.',
            'You see who matched before anything is written, then the notes land as one note on all of them.',
        ],
    },
    {
        key: 'hubspot', group: 'crm', title: 'HubSpot', mark: 'hubspot',
        description: 'Add meeting notes to the contacts you met',
        howItWorks: [
            'Natively finds the contacts you met in HubSpot by their email.',
            'Send from a meeting’s Share menu after checking who matched, or automatically when notes are ready.',
        ],
    },
    {
        key: 'salesforce', group: 'crm', title: 'Salesforce', mark: 'salesforce',
        description: 'Log meetings on the contacts you met',
        howItWorks: [
            'Natively finds the contacts you met in Salesforce by their email.',
            'Each meeting is logged as a completed activity on each of them.',
        ],
    },
    {
        key: 'attio', group: 'crm', title: 'Attio', mark: 'attio',
        description: 'Add meeting notes to the people you met',
        howItWorks: [
            'Natively finds the people you met in Attio by their email.',
            'The notes land as a note on each person’s record.',
        ],
    },
    {
        key: 'pipedrive', group: 'crm', title: 'Pipedrive', mark: 'pipedrive',
        description: 'Add meeting notes to the people you met',
        howItWorks: [
            'Natively finds the people you met in Pipedrive by their email.',
            'The notes land as a note on each person.',
        ],
    },
    {
        key: 'clearbit', group: 'crm', title: 'Clearbit', mark: 'clearbit',
        description: 'Look up attendees’ title and company',
        howItWorks: [
            'From a meeting, press Look up attendees to find their title and company by email.',
            'Every result is a suggestion you accept on the People page. Nothing changes by itself.',
        ],
    },
    {
        key: 'webhooks', group: 'automation', title: 'Webhooks', mark: 'webhooks',
        description: 'Automatically send notes to other tools',
        howItWorks: [
            'Natively sends a signed request to your address when a meeting’s notes are ready, or when you edit them.',
            'Each request carries the notes themselves, so your tool needs nothing else to use them.',
            'Requests go out from this computer while Natively is open.',
        ],
    },
];

export const catalogEntry = (key: ConnectorKey): ConnectorEntry => CONNECTOR_CATALOG.find((e) => e.key === key)!;
