import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PhoneModeSummary } from '../protocol/types';

interface Props {
  modes: PhoneModeSummary[];
  modeId: string | null;
  disabled?: boolean;
  onSelect: (modeId: string) => void;
}

function currentModeLabel(modes: PhoneModeSummary[], modeId: string | null): string {
  if (!modeId) return 'No mode';
  const match = modes.find((m) => m.id === modeId);
  return match?.name || modeId;
}

/** List + set active interview mode; highlights current modeId from status. */
export function ModePicker({ modes, modeId, disabled, onSelect }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.label}>Mode</Text>
        <Text style={styles.current} numberOfLines={1}>
          {currentModeLabel(modes, modeId)}
        </Text>
      </View>
      {modes.length === 0 ? (
        <Text style={styles.empty}>Modes appear after desktop status sync.</Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {modes.map((mode) => {
            const selected = mode.id === modeId;
            return (
              <Pressable
                key={mode.id}
                style={[
                  styles.chip,
                  selected && styles.chipSelected,
                  disabled && styles.chipDisabled,
                ]}
                disabled={disabled || selected}
                onPress={() => onSelect(mode.id)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Mode ${mode.name}`}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {mode.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  label: {
    color: '#7b8896',
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  current: {
    flex: 1,
    textAlign: 'right',
    color: '#f1f6fb',
    fontSize: 13,
    fontWeight: '600',
  },
  empty: {
    color: '#5c6a78',
    fontSize: 12,
  },
  chips: {
    gap: 8,
    paddingRight: 8,
  },
  chip: {
    paddingHorizontal: 12,
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(11,15,21,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: {
    borderColor: 'rgba(108,240,214,0.4)',
    backgroundColor: 'rgba(108,240,214,0.12)',
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipText: {
    color: '#c5d0db',
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextSelected: {
    color: '#6cf0d6',
  },
});
