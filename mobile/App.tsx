import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  View,
} from 'react-native';
import { ModePicker } from './src/components/ModePicker';
import { PairingScreen } from './src/components/PairingScreen';
import { SessionStatusBar } from './src/components/SessionStatusBar';
import { StartSessionButton } from './src/components/StartSessionButton';
import { StreamFeed } from './src/components/StreamFeed';
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
import type { PairingConfig } from './src/protocol/types';
import { loadPairingConfig, savePairingConfig } from './src/storage/pairingStorage';
import {
  PhoneMirrorConnection,
  type ConnectionStatus,
} from './src/ws/PhoneMirrorConnection';

type Screen = 'loading' | 'pairing' | 'stream';

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [pairing, setPairing] = useState<PairingConfig>({
    host: '',
    port: '4123',
    phoneToken: '',
  });
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [feed, setFeed] = useState<FeedState>(initialFeedState);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const connectionRef = useRef<PhoneMirrorConnection | null>(null);

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
    };
  }, []);

  const ensureConnection = (): PhoneMirrorConnection => {
    if (connectionRef.current) return connectionRef.current;
    const conn = new PhoneMirrorConnection({
      onStatus: (next) => setStatus(next),
      onEvent: (event) => {
        setFeed((prev) => applyStreamEvent(prev, event));
        if (event.type === 'history') setNotice(null);
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
    setFeed(initialFeedState);
    await savePairingConfig(config);
    setPairing(config);
    setScreen('stream');
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

  // If connect-time status omitted modes, ask once when connected + empty.
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
        <StreamFeed
          items={feedItemsForDisplay(feed)}
          status={status}
          hostLabel={`${pairing.host}:${pairing.port}`}
          fatalError={fatalError}
          notice={notice}
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
        />
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
  sessionRow: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  startWrap: {
    alignSelf: 'stretch',
  },
});
