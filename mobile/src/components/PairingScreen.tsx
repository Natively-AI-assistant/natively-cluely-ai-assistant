import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { PairingConfig } from '../protocol/types';
import { parsePairingUrl } from '../protocol/wsUrl';
import {
  getTransportPreset,
  TRANSPORT_PRESETS,
  type TransportPresetId,
} from '../pairing/transportPresets';

interface Props {
  initial: PairingConfig;
  busy?: boolean;
  error?: string | null;
  onConnect: (config: PairingConfig) => void;
}

export function PairingScreen({ initial, busy, error, onConnect }: Props) {
  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(initial.port || '4123');
  const [phoneToken, setPhoneToken] = useState(initial.phoneToken);
  const [pasteUrl, setPasteUrl] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [transport, setTransport] = useState<TransportPresetId>('usb');

  const preset = getTransportPreset(transport);

  const applyTransport = (id: TransportPresetId) => {
    setTransport(id);
    const next = getTransportPreset(id);
    if (next.hostHint) {
      setHost(next.hostHint);
    }
    if (!port.trim()) setPort('4123');
    setLocalError(null);
  };

  const applyPaste = () => {
    const parsed = parsePairingUrl(pasteUrl);
    if (!parsed?.host) {
      setLocalError('Could not parse pairing URL. Expected http://host:port/?t=TOKEN');
      return;
    }
    setHost(parsed.host);
    if (parsed.port) setPort(parsed.port);
    if (parsed.phoneToken) setPhoneToken(parsed.phoneToken);
    setLocalError(null);
  };

  const submit = () => {
    const config: PairingConfig = {
      host: host.trim(),
      port: port.trim(),
      phoneToken: phoneToken.trim(),
    };
    if (!config.host || !config.port || !config.phoneToken) {
      setLocalError('Host, port, and phone token are required.');
      return;
    }
    setLocalError(null);
    onConnect(config);
  };

  const displayError = localError || error;

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Natively Mirror</Text>
      <Text style={styles.subtitle}>
        Personal React Native client — pair with desktop Phone Mirror. Interview day: USB;
        on-the-go: Tailscale.
      </Text>

      <Text style={styles.label}>Transport</Text>
      <View style={styles.chipRow}>
        {TRANSPORT_PRESETS.map((p) => {
          const active = p.id === transport;
          return (
            <Pressable
              key={p.id}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => applyTransport(p.id)}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.transportHelp}>{preset.help}</Text>

      <Text style={styles.label}>Paste pairing URL (optional)</Text>
      <TextInput
        style={styles.input}
        value={pasteUrl}
        onChangeText={setPasteUrl}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="http://172.20.10.2:4123/?t=… or Tailscale URL"
        placeholderTextColor="#6b7785"
      />
      <Pressable style={styles.secondaryBtn} onPress={applyPaste}>
        <Text style={styles.secondaryBtnText}>Apply URL</Text>
      </Pressable>
      {transport === 'usb' ? (
        <Text style={styles.usbNote}>
          After paste, set Host to the Mac USB/tether IP if the URL still has Wi‑Fi or Tailscale.
        </Text>
      ) : null}

      <Text style={styles.label}>Host</Text>
      <TextInput
        style={styles.input}
        value={host}
        onChangeText={setHost}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={preset.placeholder}
        placeholderTextColor="#6b7785"
      />

      <Text style={styles.label}>Port</Text>
      <TextInput
        style={styles.input}
        value={port}
        onChangeText={setPort}
        keyboardType="number-pad"
        placeholder="4123"
        placeholderTextColor="#6b7785"
      />

      <Text style={styles.label}>Phone token</Text>
      <TextInput
        style={[styles.input, styles.tokenInput]}
        value={phoneToken}
        onChangeText={setPhoneToken}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        placeholder="Token from desktop Sync / QR"
        placeholderTextColor="#6b7785"
      />

      {displayError ? <Text style={styles.error}>{displayError}</Text> : null}

      <Pressable
        style={[styles.primaryBtn, busy && styles.btnDisabled]}
        onPress={submit}
        disabled={!!busy}
      >
        {busy ? (
          <ActivityIndicator color="#051018" />
        ) : (
          <Text style={styles.primaryBtnText}>Connect</Text>
        )}
      </Pressable>

      <Text style={styles.hint}>
        Settings are saved on this device. Token rotate on desktop closes with code 4401 — reconnect
        only after updating the token. USB steps: mobile/docs/USB-INTERVIEW.md
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 32,
    backgroundColor: '#05070a',
  },
  title: {
    color: '#f1f6fb',
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  subtitle: {
    marginTop: 8,
    marginBottom: 18,
    color: '#7b8896',
    fontSize: 14,
    lineHeight: 20,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: '#111821',
  },
  chipActive: {
    borderColor: 'rgba(108,240,214,0.55)',
    backgroundColor: 'rgba(108,240,214,0.12)',
  },
  chipText: {
    color: '#9aa8b6',
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#6cf0d6',
  },
  transportHelp: {
    color: '#6b7785',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 4,
  },
  usbNote: {
    marginTop: 8,
    color: '#8a9aab',
    fontSize: 12,
    lineHeight: 17,
  },
  label: {
    color: '#9aa8b6',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#111821',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#f1f6fb',
    fontSize: 16,
  },
  tokenInput: {
    fontFamily: 'Menlo',
    fontSize: 13,
  },
  primaryBtn: {
    marginTop: 22,
    backgroundColor: '#6cf0d6',
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#051018',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(108,240,214,0.35)',
  },
  secondaryBtnText: {
    color: '#6cf0d6',
    fontSize: 13,
    fontWeight: '600',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  error: {
    marginTop: 14,
    color: '#ff5d6c',
    fontSize: 14,
    lineHeight: 20,
  },
  hint: {
    marginTop: 18,
    color: '#5c6a78',
    fontSize: 12,
    lineHeight: 18,
  },
});
