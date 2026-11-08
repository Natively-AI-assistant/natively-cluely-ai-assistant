// Brand marks for Settings › Connectors: each row shows the service's own logo
// instead of a generic glyph. Vendored, never fetched at render time; sources and
// licences are in src/assets/provider-logos/README.md ("Connector marks").
//
// SVGs are inlined (`?raw`) for the same reason as BrandMark.tsx: the monochrome
// ones (Notion, Attio, MCP) paint with currentColor, which does not resolve inside
// an <img>, so they follow the theme. Slack, HubSpot and Salesforce carry their own
// colours. Affinity and Clearbit publish their mark only as a raster app icon, so
// those two are <img>, clipped to the same rounded corners at any size.
import React from 'react';
import slackMark from '../../assets/provider-logos/slack.svg?raw';
import notionMark from '../../assets/provider-logos/notion.svg?raw';
import hubspotMark from '../../assets/provider-logos/hubspot.svg?raw';
import attioMark from '../../assets/provider-logos/attio.svg?raw';
import salesforceMark from '../../assets/provider-logos/salesforce.svg?raw';
import mcpMark from '../../assets/provider-logos/mcp.svg?raw';
import pipedriveMark from '../../assets/provider-logos/pipedrive.svg?raw';
import gmailMark from '../../assets/provider-logos/gmail.svg?raw';
import zapierMark from '../../assets/provider-logos/zapier.svg?raw';
import webhooksMark from '../../assets/provider-logos/webhooks.svg?raw';
import affinityIcon from '../../assets/provider-logos/affinity.png';
import clearbitIcon from '../../assets/provider-logos/clearbit.png';

export type ConnectorId = 'gmail' | 'slack' | 'notion' | 'zapier' | 'hubspot' | 'attio' | 'affinity' | 'salesforce' | 'pipedrive' | 'clearbit' | 'webhooks' | 'mcp';

export const CONNECTOR_MARKS: Partial<Record<ConnectorId, string>> = {
    slack: slackMark,
    notion: notionMark,
    hubspot: hubspotMark,
    attio: attioMark,
    salesforce: salesforceMark,
    mcp: mcpMark,
    pipedrive: pipedriveMark,
    gmail: gmailMark,
    zapier: zapierMark,
    webhooks: webhooksMark,
};

export const CONNECTOR_MARK_IMAGES: Partial<Record<ConnectorId, string>> = {
    affinity: affinityIcon,
    clearbit: clearbitIcon,
};

/** A bare connector logo; SettingsRow already supplies the tile around it. */
export const ConnectorMark: React.FC<{ id: ConnectorId; size?: number }> = ({ id, size = 20 }) => {
    const src = CONNECTOR_MARK_IMAGES[id];
    if (src) {
        return <img src={src} alt="" aria-hidden="true" width={size} height={size} className="rounded-[5px] object-contain" />;
    }
    const markup = CONNECTOR_MARKS[id];
    if (!markup) return null;
    // Build-time constants from pinned, reviewed files: vector paths only, nothing
    // user-supplied. The marks are width/height="1em", so font-size is the size.
    return (
        <span
            aria-hidden="true"
            className="inline-flex items-center justify-center"
            style={{ fontSize: size, lineHeight: 0 }}
            dangerouslySetInnerHTML={{ __html: markup }}
        />
    );
};
