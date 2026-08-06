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
import { PairingScreen } from './src/components/PairingScreen';
import { StreamFeed } from './src/components/StreamFeed';
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

  const handleConnect = async (config: PairingConfig) => {
    setFatalError(null);
    setNotice(null);
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
    setScreen('pairing');
  };

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
                onDisconnect={handleDisconnect}
                onEditPairing={handleEditPairing}
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
});
