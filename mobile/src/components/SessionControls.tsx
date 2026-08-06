import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  QUICK_ACTIONS,
  buildActionCommand,
  buildChatCommand,
  buildScreenshotCommand,
  buildStealthCommand,
  type PhoneCommand,
  type StealthOp,
} from '../protocol/phoneCommands';

export interface SessionControlsProps {
  enabled: boolean;
  stealthActive?: boolean;
  onSendCommand: (cmd: PhoneCommand) => boolean;
  /** Immediate local feedback before desktop ack (e.g. "Capturing…"). */
  onLocalNotice?: (message: string) => void;
}

/**
 * One-handed session controls: quick actions, stealth, screenshot shutter, chat.
 * Ticket 20 owns start-session / mode picker / status pill — keep those out of this tree.
 */
export function SessionControls({
  enabled,
  stealthActive = false,
  onSendCommand,
  onLocalNotice,
}: SessionControlsProps) {
  const [draft, setDraft] = useState('');
  const [workingAction, setWorkingAction] = useState<string | null>(null);

  const send = (cmd: PhoneCommand, workingKey?: string): boolean => {
    if (!enabled) {
      onLocalNotice?.('Not connected');
      return false;
    }
    const ok = onSendCommand(cmd);
    if (!ok) {
      onLocalNotice?.('Not connected');
      return false;
    }
    if (workingKey) {
      setWorkingAction(workingKey);
      setTimeout(() => setWorkingAction((cur) => (cur === workingKey ? null : cur)), 1200);
    }
    return true;
  };

  const submitChat = () => {
    const cmd = buildChatCommand(draft);
    if (!cmd) return;
    if (send(cmd)) setDraft('');
  };

  const fireAction = (actionId: string) => {
    const cmd = buildActionCommand(actionId);
    if (!cmd) return;
    send(cmd, actionId);
  };

  const fireScreenshot = () => {
    onLocalNotice?.('Capturing…');
    send(buildScreenshotCommand(), 'screenshot');
  };

  const fireStealth = (op: StealthOp) => {
    send(buildStealthCommand(op), `stealth:${op}`);
  };

  return (
    <View style={styles.panel}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.actionsRow}
        keyboardShouldPersistTaps="handled"
      >
        {QUICK_ACTIONS.map((action) => {
          const busy = workingAction === action.id;
          return (
            <Pressable
              key={action.id}
              style={[styles.chip, busy && styles.chipWorking, !enabled && styles.disabled]}
              disabled={!enabled}
              onPress={() => fireAction(action.id)}
              accessibilityRole="button"
              accessibilityLabel={action.label}
            >
              <Text style={styles.chipText}>{action.label}</Text>
            </Pressable>
          );
        })}
        <Pressable
          style={[
            styles.chip,
            styles.screenshotChip,
            workingAction === 'screenshot' && styles.chipWorking,
            !enabled && styles.disabled,
          ]}
          disabled={!enabled}
          onPress={fireScreenshot}
          accessibilityRole="button"
          accessibilityLabel="Capture screenshot"
        >
          <Text style={styles.chipText}>Capture</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.stealthRow}>
        <Pressable
          style={[
            styles.stealthBtn,
            styles.stealthEnter,
            stealthActive && styles.stealthActive,
            !enabled && styles.disabled,
          ]}
          disabled={!enabled}
          onPress={() => fireStealth('enter')}
          accessibilityRole="button"
          accessibilityLabel="Enter two-device stealth"
        >
          <Text style={styles.stealthText}>
            {stealthActive ? 'Stealth on' : 'Enter stealth'}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.stealthBtn, styles.stealthExit, !enabled && styles.disabled]}
          disabled={!enabled}
          onPress={() => fireStealth('exit')}
          accessibilityRole="button"
          accessibilityLabel="Exit two-device stealth"
        >
          <Text style={styles.stealthText}>Exit</Text>
        </Pressable>
        <Pressable
          style={[styles.stealthBtn, styles.stealthEnd, !enabled && styles.disabled]}
          disabled={!enabled}
          onPress={() => fireStealth('end')}
          accessibilityRole="button"
          accessibilityLabel="End session"
        >
          <Text style={[styles.stealthText, styles.stealthEndText]}>End</Text>
        </Pressable>
      </View>

      <View style={styles.inputRow}>
        <TextInput
          style={[styles.chatInput, !enabled && styles.disabled]}
          value={draft}
          onChangeText={setDraft}
          editable={enabled}
          placeholder="Ask anything…"
          placeholderTextColor="#6b7785"
          autoCapitalize="sentences"
          autoCorrect
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={submitChat}
          maxLength={2000}
        />
        <Pressable
          style={[styles.sendBtn, (!enabled || !draft.trim()) && styles.disabled]}
          disabled={!enabled || !draft.trim()}
          onPress={submitChat}
          accessibilityRole="button"
          accessibilityLabel="Send chat"
        >
          <Text style={styles.sendBtnText}>↑</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#070a0f',
    paddingTop: 10,
    paddingBottom: 8,
    gap: 10,
  },
  actionsRow: {
    paddingHorizontal: 12,
    gap: 8,
    alignItems: 'center',
  },
  chip: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#121820',
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenshotChip: {
    borderColor: 'rgba(108,240,214,0.28)',
    backgroundColor: 'rgba(108,240,214,0.08)',
  },
  chipWorking: {
    borderColor: 'rgba(85,166,255,0.45)',
    backgroundColor: 'rgba(85,166,255,0.14)',
  },
  chipText: {
    color: '#e8eef5',
    fontSize: 13,
    fontWeight: '600',
  },
  stealthRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
  },
  stealthBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  stealthEnter: {
    borderColor: 'rgba(108,240,214,0.28)',
    backgroundColor: 'rgba(108,240,214,0.08)',
  },
  stealthActive: {
    borderColor: 'rgba(108,240,214,0.55)',
    backgroundColor: 'rgba(108,240,214,0.18)',
  },
  stealthExit: {
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#121820',
  },
  stealthEnd: {
    borderColor: 'rgba(255,93,108,0.35)',
    backgroundColor: 'rgba(255,93,108,0.12)',
  },
  stealthText: {
    color: '#d7e0ea',
    fontSize: 13,
    fontWeight: '700',
  },
  stealthEndText: {
    color: '#ff8a96',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  chatInput: {
    flex: 1,
    minHeight: 48,
    maxHeight: 96,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#0c1117',
    color: '#f1f6fb',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#6cf0d6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: {
    color: '#04120f',
    fontSize: 20,
    fontWeight: '800',
  },
  disabled: {
    opacity: 0.45,
  },
});
