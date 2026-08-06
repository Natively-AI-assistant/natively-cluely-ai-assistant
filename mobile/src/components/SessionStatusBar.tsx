import { StyleSheet, Text, View } from 'react-native';
import type { SessionStatus } from '../protocol/types';
import type { ConnectionStatus } from '../ws/PhoneMirrorConnection';

interface Props {
  connectionStatus: ConnectionStatus;
  session: SessionStatus;
}

function connectionLabel(status: ConnectionStatus): string {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting';
    case 'reconnecting':
      return 'Reconnecting';
    case 'stopped':
      return 'Stopped';
    default:
      return 'Offline';
  }
}

function Chip({
  label,
  active,
  tone = 'neutral',
}: {
  label: string;
  active: boolean;
  tone?: 'neutral' | 'accent' | 'warn';
}) {
  return (
    <View
      style={[
        styles.chip,
        active && tone === 'accent' && styles.chipAccent,
        active && tone === 'warn' && styles.chipWarn,
        active && tone === 'neutral' && styles.chipOn,
        !active && styles.chipOff,
      ]}
    >
      <View
        style={[
          styles.dot,
          active && tone === 'accent' && styles.dotAccent,
          active && tone === 'warn' && styles.dotWarn,
          active && tone === 'neutral' && styles.dotOn,
        ]}
      />
      <Text style={[styles.chipText, !active && styles.chipTextOff]}>{label}</Text>
    </View>
  );
}

/**
 * Connected / session-active / stealth-active chips.
 * Session + stealth come from desktop `status` (including reconnect).
 */
export function SessionStatusBar({ connectionStatus, session }: Props) {
  const connected = connectionStatus === 'connected';
  return (
    <View style={styles.row} accessibilityRole="summary">
      <Chip
        label={connectionLabel(connectionStatus)}
        active={connected}
        tone="accent"
      />
      <Chip label="Session" active={session.sessionActive} tone="neutral" />
      <Chip label="Stealth" active={session.stealthActive} tone="warn" />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    minHeight: 28,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipOn: {
    borderColor: 'rgba(197,208,219,0.28)',
    backgroundColor: 'rgba(197,208,219,0.08)',
  },
  chipAccent: {
    borderColor: 'rgba(108,240,214,0.35)',
    backgroundColor: 'rgba(108,240,214,0.1)',
  },
  chipWarn: {
    borderColor: 'rgba(255,186,92,0.4)',
    backgroundColor: 'rgba(255,186,92,0.12)',
  },
  chipOff: {
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(11,15,21,0.6)',
  },
  chipText: {
    color: '#c5d0db',
    fontSize: 11,
    fontWeight: '600',
  },
  chipTextOff: {
    color: '#5c6a78',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: '#3a4450',
  },
  dotOn: { backgroundColor: '#c5d0db' },
  dotAccent: { backgroundColor: '#6cf0d6' },
  dotWarn: { backgroundColor: '#ffba5c' },
});
