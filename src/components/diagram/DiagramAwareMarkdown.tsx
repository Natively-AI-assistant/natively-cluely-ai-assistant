// Markdown with diagram cards, for surfaces that own their Markdown renderer.
//
// The surface passes its own renderer; this component only decides which
// pieces of the answer go to it and which go to the shared diagram card. With
// diagrams switched off, or with no Mermaid block in the answer, the surface's
// renderer receives the whole text in one call — exactly what it did before.

import React, { useId, useMemo } from 'react';
import { DiagramArtifact } from './DiagramArtifact';
import { splitAnswerForDiagrams } from '../../lib/diagram/diagramSegments.mjs';
import { useDiagramsEnabled } from '../../lib/diagram/diagramRuntime';

export interface DiagramAwareMarkdownProps {
  text: string;
  /** The answer is still streaming (a block without its closing fence is not drawn). */
  streaming?: boolean;
  /** The surface's own Markdown renderer for one chunk of the answer. */
  renderMarkdown: (chunk: string, key: string) => React.ReactNode;
  /** Live answers may repair a broken diagram once; replays leave this off. */
  allowAutoRepair?: boolean;
  onRepaired?: (originalSource: string, repairedSource: string) => void;
  maxHeight?: number;
}

export const DiagramAwareMarkdown: React.FC<DiagramAwareMarkdownProps> = ({
  text,
  streaming = false,
  renderMarkdown,
  allowAutoRepair = false,
  onRepaired,
  maxHeight,
}) => {
  const enabled = useDiagramsEnabled();
  // Unique per mounted answer, so the same diagram in two answers (or two
  // windows) is two artifacts with two ids.
  const instanceId = useId();
  const segments = useMemo(() => (enabled ? splitAnswerForDiagrams(text, { streaming }) : null), [enabled, text, streaming]);

  if (!segments || (segments.length === 1 && segments[0].type === 'markdown')) {
    return <>{renderMarkdown(text, 'm0')}</>;
  }
  return (
    <>
      {segments.map((segment) =>
        segment.type === 'markdown' ? (
          renderMarkdown(segment.text, segment.key)
        ) : (
          <DiagramArtifact
            key={segment.key}
            artifactId={`${instanceId}:${segment.key}`}
            source={segment.source}
            info={segment.info}
            complete={segment.complete}
            streaming={streaming}
            description={segment.description}
            allowAutoRepair={allowAutoRepair}
            onRepaired={onRepaired}
            maxHeight={maxHeight}
          />
        ),
      )}
    </>
  );
};

export default DiagramAwareMarkdown;
