export function decideStreamingHeightCommit(input: {
  streamId: string | null;
  lastStreamId: string | null;
  committedHeight: number;
  measuredHeight: number;
  hasText: boolean;
  bufferPx: number;
}): {
  action: 'commit' | 'exact' | 'none';
  height: number;
  nextStreamId: string | null;
  nextCommittedHeight: number;
};
