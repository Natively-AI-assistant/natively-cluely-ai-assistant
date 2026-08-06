import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItem,
} from 'react-native';
import {
  KnowledgeGatewayError,
  KNOWLEDGE_DOC_TYPES,
  getKnowledgeHealthz,
  listKnowledgeDocs,
  queryKnowledge,
  queryRag,
  type KnowledgeDocType,
  type KnowledgeGatewayChunk,
  type KnowledgeGatewayDocCount,
  type RagGatewayChunk,
} from '../api/knowledgeGatewayClient';
import type { PairingConfig } from '../protocol/types';

type QueryMode = 'knowledge' | 'rag';

type ResultChunk =
  | { kind: 'knowledge'; chunk: KnowledgeGatewayChunk; key: string }
  | { kind: 'rag'; chunk: RagGatewayChunk; key: string };

interface Props {
  pairing: PairingConfig;
  hostLabel: string;
}

function formatSimilarity(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function previewText(text: string, expanded: boolean): string {
  const trimmed = text.trim();
  if (expanded || trimmed.length <= 220) return trimmed;
  return `${trimmed.slice(0, 220).trimEnd()}…`;
}

function errorMessage(err: unknown): string {
  if (err instanceof KnowledgeGatewayError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Request failed';
}

export function BrowseScreen({ pairing, hostLabel }: Props) {
  const [mode, setMode] = useState<QueryMode>('knowledge');
  const [query, setQuery] = useState('');
  const [docType, setDocType] = useState<KnowledgeDocType>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ResultChunk[] | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [docs, setDocs] = useState<KnowledgeGatewayDocCount[]>([]);
  const [readyLabel, setReadyLabel] = useState<string | null>(null);

  const refreshMeta = useCallback(async () => {
    try {
      const [health, docList] = await Promise.all([
        getKnowledgeHealthz(pairing),
        listKnowledgeDocs(pairing),
      ]);
      setDocs(docList);
      setReadyLabel(
        `Knowledge ${health.knowledgeReady ? 'ready' : 'offline'} · RAG ${
          health.ragReady ? 'ready' : 'offline'
        }`,
      );
      setError(null);
    } catch (err) {
      setReadyLabel(null);
      setError(errorMessage(err));
    }
  }, [pairing]);

  useEffect(() => {
    void refreshMeta();
  }, [refreshMeta]);

  const runQuery = async () => {
    const q = query.trim();
    if (!q) {
      setError('Enter a query to search the desktop corpus.');
      return;
    }
    setBusy(true);
    setError(null);
    setExpanded({});
    try {
      if (mode === 'knowledge') {
        const chunks = await queryKnowledge(pairing, { query: q, docType });
        setResults(
          chunks.map((chunk, i) => ({
            kind: 'knowledge' as const,
            chunk,
            key: `k-${i}-${chunk.docType}-${chunk.similarity}`,
          })),
        );
      } else {
        const chunks = await queryRag(pairing, { query: q });
        setResults(
          chunks.map((chunk, i) => ({
            kind: 'rag' as const,
            chunk,
            key: `r-${i}-${chunk.similarity}`,
          })),
        );
      }
    } catch (err) {
      setResults(null);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const corpusEmpty =
    docs.length === 0 || docs.every((d) => d.count === 0);

  const renderItem: ListRenderItem<ResultChunk> = ({ item }) => {
    const isOpen = !!expanded[item.key];
    const text = item.chunk.text;
    const similarity = item.chunk.similarity;
    const typeLabel =
      item.kind === 'knowledge' ? item.chunk.docType : 'rag';
    const metaBits =
      item.kind === 'rag' && item.chunk.meta
        ? Object.entries(item.chunk.meta)
            .filter(([, v]) => v !== undefined && v !== null && v !== '')
            .slice(0, 3)
            .map(([k, v]) => `${k}: ${String(v)}`)
            .join(' · ')
        : '';

    return (
      <Pressable
        style={styles.card}
        onPress={() =>
          setExpanded((prev) => ({ ...prev, [item.key]: !prev[item.key] }))
        }
      >
        <View style={styles.metaRow}>
          <Text style={styles.badge}>{typeLabel}</Text>
          <Text style={styles.similarity}>{formatSimilarity(similarity)}</Text>
        </View>
        {metaBits ? <Text style={styles.metaBits}>{metaBits}</Text> : null}
        <Text style={styles.chunkText}>{previewText(text, isOpen)}</Text>
        {text.trim().length > 220 ? (
          <Text style={styles.expandHint}>{isOpen ? 'Collapse' : 'Expand'}</Text>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Browse / Test</Text>
        <Text style={styles.subtitle}>
          Query desktop knowledge + RAG over Tailscale/LAN — no Stealth session
          required. Host {hostLabel}.
        </Text>
        {readyLabel ? <Text style={styles.ready}>{readyLabel}</Text> : null}
      </View>

      <View style={styles.modeRow}>
        <Pressable
          style={[styles.modeBtn, mode === 'knowledge' && styles.modeBtnActive]}
          onPress={() => setMode('knowledge')}
        >
          <Text
            style={[
              styles.modeBtnText,
              mode === 'knowledge' && styles.modeBtnTextActive,
            ]}
          >
            Knowledge
          </Text>
        </Pressable>
        <Pressable
          style={[styles.modeBtn, mode === 'rag' && styles.modeBtnActive]}
          onPress={() => setMode('rag')}
        >
          <Text
            style={[
              styles.modeBtnText,
              mode === 'rag' && styles.modeBtnTextActive,
            ]}
          >
            RAG
          </Text>
        </Pressable>
      </View>

      {mode === 'knowledge' ? (
        <View style={styles.docTypeRow}>
          {KNOWLEDGE_DOC_TYPES.map((dt) => (
            <Pressable
              key={dt}
              style={[
                styles.docChip,
                docType === dt && styles.docChipActive,
              ]}
              onPress={() => setDocType(dt)}
            >
              <Text
                style={[
                  styles.docChipText,
                  docType === dt && styles.docChipTextActive,
                ]}
              >
                {dt}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <TextInput
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={
          mode === 'knowledge'
            ? 'Search lessons, resume, JD…'
            : 'Search meeting RAG corpus…'
        }
        placeholderTextColor="#6b7785"
        onSubmitEditing={() => {
          void runQuery();
        }}
        returnKeyType="search"
      />

      <Pressable
        style={[styles.primaryBtn, busy && styles.btnDisabled]}
        onPress={() => {
          void runQuery();
        }}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="#051018" />
        ) : (
          <Text style={styles.primaryBtnText}>
            {mode === 'knowledge' ? 'Query knowledge' : 'Query RAG'}
          </Text>
        )}
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {results === null ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>Test without Stealth Mode</Text>
          <Text style={styles.emptyBody}>
            {corpusEmpty
              ? 'Desktop corpus looks empty (or health check failed). Ingest docs on desktop, then query here — the phone never opens SQLite.'
              : `Indexed docs: ${docs
                  .map((d) => `${d.docType} (${d.count})`)
                  .join(', ')}. Run a query to see ranked chunks.`}
          </Text>
          <Pressable style={styles.secondaryBtn} onPress={() => void refreshMeta()}>
            <Text style={styles.secondaryBtnText}>Refresh corpus status</Text>
          </Pressable>
        </View>
      ) : results.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>No matching chunks</Text>
          <Text style={styles.emptyBody}>
            {corpusEmpty
              ? 'The knowledge corpus is empty on the desktop. Add lessons, resume, or JD docs, then try again.'
              : 'Nothing ranked for this query. Try different wording or another doc type.'}
          </Text>
        </View>
      ) : (
        <FlatList
          style={styles.list}
          data={results}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: '#05070a',
  },
  header: {
    marginBottom: 12,
  },
  title: {
    color: '#f1f6fb',
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    marginTop: 6,
    color: '#7b8896',
    fontSize: 13,
    lineHeight: 18,
  },
  ready: {
    marginTop: 8,
    color: '#6cf0d6',
    fontSize: 12,
    fontWeight: '600',
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  modeBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#111821',
  },
  modeBtnActive: {
    borderColor: 'rgba(108,240,214,0.55)',
    backgroundColor: 'rgba(108,240,214,0.12)',
  },
  modeBtnText: {
    color: '#9aa8b6',
    fontWeight: '600',
    fontSize: 14,
  },
  modeBtnTextActive: {
    color: '#6cf0d6',
  },
  docTypeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  docChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#0d131a',
  },
  docChipActive: {
    borderColor: 'rgba(108,240,214,0.45)',
    backgroundColor: 'rgba(108,240,214,0.1)',
  },
  docChipText: {
    color: '#8a97a6',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  docChipTextActive: {
    color: '#6cf0d6',
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
  primaryBtn: {
    marginTop: 12,
    backgroundColor: '#6cf0d6',
    borderRadius: 12,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#051018',
    fontSize: 15,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  secondaryBtn: {
    marginTop: 14,
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
  error: {
    marginTop: 12,
    color: '#ff5d6c',
    fontSize: 14,
    lineHeight: 20,
  },
  emptyBox: {
    marginTop: 20,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#0d131a',
  },
  emptyTitle: {
    color: '#f1f6fb',
    fontSize: 16,
    fontWeight: '700',
  },
  emptyBody: {
    marginTop: 8,
    color: '#7b8896',
    fontSize: 13,
    lineHeight: 19,
  },
  list: {
    flex: 1,
    marginTop: 14,
  },
  listContent: {
    paddingBottom: 28,
    gap: 10,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#111821',
    padding: 14,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  badge: {
    color: '#6cf0d6',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  similarity: {
    color: '#9aa8b6',
    fontSize: 12,
    fontWeight: '600',
  },
  metaBits: {
    color: '#5c6a78',
    fontSize: 11,
    marginBottom: 6,
  },
  chunkText: {
    color: '#e8eef4',
    fontSize: 14,
    lineHeight: 20,
  },
  expandHint: {
    marginTop: 8,
    color: '#6cf0d6',
    fontSize: 12,
    fontWeight: '600',
  },
});
