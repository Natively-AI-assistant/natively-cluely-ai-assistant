import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BrowseScreen } from './src/components/BrowseScreen';
import { ModePicker } from './src/components/ModePicker';
import { PairingScreen } from './src/components/PairingScreen';
import { SessionStatusBar } from './src/components/SessionStatusBar';
import { StartSessionButton } from './src/components/StartSessionButton';
import { StreamFeed, type AckToast } from './src/components/StreamFeed';
import {
  buildModesListCommand,
  buildModesSetCommand,
  buildStartSessionCommand,
} from './src/protocol/commands';
import {
  applyStreamEvent,
  feedItemsForDisplay,
  initialFeedState,
  type FeedState,
} from './src/protocol/feedReducer';
import { interpretAck, type PhoneCommand } from './src/protocol/phoneCommands';
import type { PairingConfig } from './src/protocol/types';
import { loadPairingConfig, savePairingConfig } from './src/storage/pairingStorage';
import {
  PhoneMirrorConnection,
  type ConnectionStatus,
} from './src/ws/PhoneMirrorConnection';

type Screen = 'loading' | 'pairing' | 'main';
type MainTab = 'session' | 'browse';

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [tab, setTab] = useState<MainTab>('session');
  const [pairing, setPairing] = useState<PairingConfig>({
    host: '',
    port: '4123',
    phoneToken: '',
  });
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [feed, setFeed] = useState<FeedState>(initialFeedState);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ackToast, setAckToast] = useState<AckToast | null>(null);
  const [stealthActive, setStealthActive] = useState(false);
  const connectionRef = useRef<PhoneMirrorConnection | null>(null);
  const ackClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadPairingConfig();
      if (cancelled) return;
      setPairing(stored);
      setScreen('pairing');
    })();
    return () => {
      cancelled = true;
      connectionRef.current?.disconnect();
      connectionRef.current = null;
      if (ackClearTimer.current) clearTimeout(ackClearTimer.current);
    };
  }, []);

  const showAckToast = (toast: AckToast) => {
    setAckToast(toast);
    if (ackClearTimer.current) clearTimeout(ackClearTimer.current);
    ackClearTimer.current = setTimeout(() => {
      ackClearTimer.current = null;
      setAckToast(null);
    }, 3200);
  };

  const ensureConnection = (): PhoneMirrorConnection => {
    if (connectionRef.current) return connectionRef.current;
    const conn = new PhoneMirrorConnection({
      onStatus: (next) => setStatus(next),
      onEvent: (event) => {
        setFeed((prev) => applyStreamEvent(prev, event));
        if (event.type === 'history') setNotice(null);
        if (event.type === 'status') {
          setStealthActive(event.stealthActive);
        }
        if (event.type === 'ack') {
          const interpreted = interpretAck(event);
          showAckToast({ message: interpreted.toast, ok: interpreted.ok });
          if (
            interpreted.kind === 'stealth' &&
            typeof interpreted.stealthActive === 'boolean'
          ) {
            setStealthActive(interpreted.stealthActive);
          }
        }
      },
      onFatalError: (reason) => {
        setFatalError(reason.message);
        setNotice(null);
        setStatus('stopped');
      },
      onTransientNotice: (message) => setNotice(message),
    });
    connectionRef.current = conn;
    return conn;
  };

  const sendOrNotice = (command: object, failMessage: string) => {
    const ok = connectionRef.current?.sendCommand(command);
    if (!ok) setNotice(failMessage);
  };

  const handleConnect = async (config: PairingConfig) => {
    setFatalError(null);
    setNotice(null);
    setAckToast(null);
    setStealthActive(false);
    setFeed(initialFeedState);
    await savePairingConfig(config);
    setPairing(config);
    setTab('session');
    setScreen('main');
    connectionRef.current?.disconnect();
    connectionRef.current = null;
    ensureConnection().connect(config);
  };

  const handleDisconnect = () => {
    connectionRef.current?.disconnect();
    setStatus('stopped');
    setNotice(null);
  };

  const handleEditPairing = () => {
    connectionRef.current?.disconnect();
    connectionRef.current = null;
    setStatus('idle');
    setNotice(null);
    setAckToast(null);
    setScreen('pairing');
  };

  const handleStartSession = () => {
    sendOrNotice(buildStartSessionCommand(), 'Not connected — cannot start session');
  };

  const handleSelectMode = (modeId: string) => {
    const command = buildModesSetCommand(modeId);
    if (!command) {
      setNotice('Invalid mode id');
      return;
    }
    sendOrNotice(command, 'Not connected — cannot set mode');
  };

  const handleSendCommand = (cmd: PhoneCommand): boolean => {
    return connectionRef.current?.sendCommand(cmd) ?? false;
  };

  useEffect(() => {
    if (status !== 'connected') return;
    if (feed.session.modes.length > 0) return;
    connectionRef.current?.sendCommand(buildModesListCommand());
  }, [status, feed.session.modes.length]);

  if (screen === 'loading') {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.loading}>
          <ActivityIndicator color="#6cf0d6" size="large" />
        </View>
        <StatusBar style="light" />
      </SafeAreaView>
    );
  }

  const connected = status === 'connected';

  return (
    <SafeAreaView style={styles.root}>
      {screen === 'pairing' ? (
        <PairingScreen
          initial={pairing}
          busy={status === 'connecting'}
          error={fatalError}
          onConnect={handleConnect}
        />
      ) : (
        <View style={styles.main}>
          <View style={styles.tabBar}>
            <Pressable
              style={[styles.tab, tab === 'session' && styles.tabActive]}
              onPress={() => setTab('session')}
            >
              <Text
                style={[
                  styles.tabText,
                  tab === 'session' && styles.tabTextActive,
                ]}
              >
                Session
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tab, tab === 'browse' && styles.tabActive]}
              onPress={() => setTab('browse')}
            >
              <Text
                style={[
                  styles.tabText,
                  tab === 'browse' && styles.tabTextActive,
                ]}
              >
                Browse
              </Text>
            </Pressable>
          </View>
          <View style={styles.tabBody}>
            {tab === 'session' ? (
              <StreamFeed
                items={feedItemsForDisplay(feed)}
                status={status}
                hostLabel={`${pairing.host}:${pairing.port}`}
                fatalError={fatalError}
                notice={notice}
                ackToast={ackToast}
                stealthActive={stealthActive || feed.session.stealthActive}
                headerSlot={
                  <View>
                    <SessionStatusBar
                      connectionStatus={status}
                      session={feed.session}
                    />
                    <View style={styles.sessionRow}>
                      <View style={styles.startWrap}>
                        <StartSessionButton
                          sessionActive={feed.session.sessionActive}
                          disabled={!connected}
                          onPress={handleStartSession}
                        />
                      </View>
                    </View>
                    <ModePicker
                      modes={feed.session.modes}
                      modeId={feed.session.modeId}
                      disabled={!connected}
                      onSelect={handleSelectMode}
                    />
                  </View>
                }
                onDisconnect={handleDisconnect}
                onEditPairing={handleEditPairing}
                onSendCommand={handleSendCommand}
                onLocalNotice={(message) => setNotice(message)}
              />
            ) : (
              <BrowseScreen
                pairing={pairing}
                hostLabel={`${pairing.host}:${pairing.port}`}
              />
            )}
          </View>
        </View>
      )}
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#05070a',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  main: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    padding: 4,
    borderRadius: 12,
    backgroundColor: '#111821',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: 'rgba(108,240,214,0.14)',
  },
  tabText: {
    color: '#8a97a6',
    fontSize: 14,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#6cf0d6',
  },
  tabBody: {
    flex: 1,
  },
  sessionRow: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  startWrap: {
    alignSelf: 'stretch',
  },
});
