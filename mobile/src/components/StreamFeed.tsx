import { useEffect, useRef, type ReactNode } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from 'react-native';
import type { PhoneCommand } from '../protocol/phoneCommands';
import type { FeedItem } from '../protocol/types';
import type { ConnectionStatus } from '../ws/PhoneMirrorConnection';
import { SessionControls } from './SessionControls';

export interface AckToast {
  message: string;
  ok: boolean;
}

interface Props {
  items: FeedItem[];
  status: ConnectionStatus;
  hostLabel: string;
  fatalError?: string | null;
  notice?: string | null;
  ackToast?: AckToast | null;
  stealthActive?: boolean;
  /**
   * Ticket 20 slot: start-session / mode picker / session+stealth status.
   * Rendered under the top bar, above the feed.
   */
  topSlot?: ReactNode;
  onDisconnect: () => void;
  onEditPairing: () => void;
  onSendCommand: (cmd: PhoneCommand) => boolean;
  onLocalNotice?: (message: string) => void;
}

function formatTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function statusLabel(status: ConnectionStatus): string {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting…';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'stopped':
      return 'Stopped';
    default:
      return 'Offline';
  }
}

export function StreamFeed({
  items,
  status,
  hostLabel,
  fatalError,
  notice,
  ackToast,
  stealthActive = false,
  topSlot,
  onDisconnect,
  onEditPairing,
  onSendCommand,
  onLocalNotice,
}: Props) {
  const listRef = useRef<FlatList<FeedItem>>(null);
  const connected = status === 'connected';

  useEffect(() => {
    if (items.length === 0) return;
    const t = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 50);
    return () => clearTimeout(t);
  }, [items.length, items[items.length - 1]]);

  const renderItem: ListRenderItem<FeedItem> = ({ item }) => {
    if (item.kind === 'error') {
      return (
        <View style={[styles.card, styles.errorCard]}>
          <View style={styles.meta}>
            <Text style={styles.roleError}>Error</Text>
            <Text style={styles.time}>{formatTime(item.createdAt)}</Text>
          </View>
          <Text style={styles.errorBody}>{item.message}</Text>
        </View>
      );
    }

    const isUser = item.role === 'user';
    return (
      <View
        style={[
          styles.card,
          isUser && styles.userCard,
          item.live && styles.liveCard,
        ]}
      >
        <View style={styles.meta}>
          <View style={styles.roleRow}>
            <View style={[styles.pip, isUser ? styles.pipUser : styles.pipAssistant]} />
            <Text style={styles.role}>{isUser ? 'You' : 'Assistant'}</Text>
            {item.label ? <Text style={styles.labelTag}>{item.label}</Text> : null}
            {item.live ? <Text style={styles.liveBadge}>Live</Text> : null}
          </View>
          <Text style={styles.time}>{formatTime(item.createdAt)}</Text>
        </View>
        <Text style={styles.body}>{item.content || (item.live ? '…' : '')}</Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
    >
      <View style={styles.topbar}>
        <View style={styles.topLeft}>
          <Text style={styles.title}>Live stream</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {hostLabel}
          </Text>
        </View>
        <View style={[styles.statusPill, connected && styles.statusConnected]}>
          <View style={[styles.dot, connected && styles.dotConnected]} />
          <Text style={styles.statusText}>{statusLabel(status)}</Text>
        </View>
      </View>

      {/* Ticket 20: start-session / modes / session+stealth status */}
      {topSlot ? <View style={styles.topSlot}>{topSlot}</View> : null}

      {fatalError ? (
        <View style={styles.bannerFatal}>
          <Text style={styles.bannerFatalText}>{fatalError}</Text>
          <Pressable onPress={onEditPairing}>
            <Text style={styles.bannerAction}>Edit pairing</Text>
          </Pressable>
        </View>
      ) : null}
      {!fatalError && notice ? (
        <View style={styles.bannerNotice}>
          <Text style={styles.bannerNoticeText}>{notice}</Text>
        </View>
      ) : null}
      {ackToast ? (
        <View style={[styles.bannerAck, ackToast.ok ? styles.bannerAckOk : styles.bannerAckFail]}>
          <Text
            style={[
              styles.bannerAckText,
              ackToast.ok ? styles.bannerAckTextOk : styles.bannerAckTextFail,
            ]}
          >
            {ackToast.message}
          </Text>
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        style={styles.list}
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={
          items.length === 0 ? styles.emptyContainer : styles.listContent
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            {connected
              ? 'Waiting for history and live answers from desktop…'
              : 'Not connected.'}
          </Text>
        }
      />

      <SessionControls
        enabled={connected}
        stealthActive={stealthActive}
        onSendCommand={onSendCommand}
        onLocalNotice={onLocalNotice}
      />

      <View style={styles.actions}>
        <Pressable style={styles.secondaryBtn} onPress={onEditPairing}>
          <Text style={styles.secondaryBtnText}>Pairing</Text>
        </Pressable>
        <Pressable style={styles.dangerBtn} onPress={onDisconnect}>
          <Text style={styles.dangerBtnText}>Disconnect</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#05070a',
  },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 12,
  },
  topLeft: { flex: 1, minWidth: 0 },
  title: {
    color: '#f1f6fb',
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    marginTop: 4,
    color: '#7b8896',
    fontSize: 12,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 11,
    minHeight: 32,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(11,15,21,0.76)',
  },
  statusConnected: {
    borderColor: 'rgba(108,240,214,0.28)',
  },
  statusText: {
    color: '#c5d0db',
    fontSize: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#ff5d6c',
  },
  dotConnected: {
    backgroundColor: '#6cf0d6',
  },
  topSlot: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  bannerFatal: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,93,108,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,93,108,0.35)',
    gap: 8,
  },
  bannerFatalText: {
    color: '#ff8a96',
    fontSize: 13,
    lineHeight: 18,
  },
  bannerAction: {
    color: '#6cf0d6',
    fontSize: 13,
    fontWeight: '600',
  },
  bannerNotice: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(85,166,255,0.1)',
  },
  bannerNoticeText: {
    color: '#9ec4ef',
    fontSize: 12,
  },
  bannerAck: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  bannerAckOk: {
    backgroundColor: 'rgba(108,240,214,0.1)',
    borderColor: 'rgba(108,240,214,0.28)',
  },
  bannerAckFail: {
    backgroundColor: 'rgba(255,93,108,0.12)',
    borderColor: 'rgba(255,93,108,0.35)',
  },
  bannerAckText: {
    fontSize: 13,
    fontWeight: '600',
  },
  bannerAckTextOk: { color: '#6cf0d6' },
  bannerAckTextFail: { color: '#ff8a96' },
  list: { flex: 1 },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  empty: {
    color: '#7b8896',
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 21,
  },
  card: {
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#0c1117',
    marginBottom: 12,
  },
  userCard: {
    borderColor: 'rgba(85,166,255,0.18)',
    backgroundColor: '#101820',
  },
  liveCard: {
    borderColor: 'rgba(120,200,255,0.28)',
  },
  errorCard: {
    borderColor: 'rgba(255,93,108,0.35)',
    backgroundColor: 'rgba(40,12,16,0.9)',
  },
  meta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  pip: {
    width: 6,
    height: 6,
    borderRadius: 999,
  },
  pipAssistant: { backgroundColor: '#6cf0d6' },
  pipUser: { backgroundColor: '#55a6ff' },
  role: {
    color: '#7b8896',
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  roleError: {
    color: '#ff8a96',
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  labelTag: {
    marginLeft: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(108,240,214,0.22)',
    color: '#6cf0d6',
    fontSize: 10,
    fontWeight: '700',
    overflow: 'hidden',
  },
  liveBadge: {
    marginLeft: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(108,240,214,0.32)',
    color: '#6cf0d6',
    fontSize: 10,
    fontWeight: '700',
    overflow: 'hidden',
  },
  time: {
    color: '#5c6a78',
    fontSize: 11,
  },
  body: {
    color: '#f1f6fb',
    fontSize: 15.5,
    lineHeight: 24,
  },
  errorBody: {
    color: '#ffc4ca',
    fontSize: 14,
    lineHeight: 21,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
  },
  secondaryBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    color: '#c5d0db',
    fontWeight: '600',
  },
  dangerBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(255,93,108,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,93,108,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerBtnText: {
    color: '#ff8a96',
    fontWeight: '700',
  },
});
