import { Pressable, StyleSheet, Text, View } from 'react-native';

interface Props {
  sessionActive: boolean;
  disabled?: boolean;
  onPress: () => void;
}

/** Start desktop meeting/session from the phone (no launcher). */
export function StartSessionButton({ sessionActive, disabled, onPress }: Props) {
  if (sessionActive) {
    return (
      <View style={styles.activeBadge}>
        <Text style={styles.activeText}>Session active</Text>
      </View>
    );
  }

  return (
    <Pressable
      style={[styles.btn, disabled && styles.btnDisabled]}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Start session"
    >
      <Text style={styles.btnText}>Start session</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(108,240,214,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(108,240,214,0.4)',
    paddingHorizontal: 14,
  },
  btnDisabled: {
    opacity: 0.45,
  },
  btnText: {
    color: '#6cf0d6',
    fontWeight: '700',
    fontSize: 14,
  },
  activeBadge: {
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(11,15,21,0.7)',
    paddingHorizontal: 14,
  },
  activeText: {
    color: '#7b8896',
    fontWeight: '600',
    fontSize: 13,
  },
});
