// electron/services/reranking/rerankProbe.ts
//
// The payload Settings > Reranker's "Test Connection" sends.
//
// WHY THIS IS NOT THREE SENTENCES ANY MORE
//
// The probe used to send a query and three one-line documents. That measured a
// latency, and `describeRerankLatencyFit` then told the user whether their
// reranker fits the 1200/3000/8000ms budgets — the app's only warning that a
// model is too slow to affect a single answer.
//
// But production sends up to RERANK_CANDIDATE_POOL chunks of ~225 tokens, and
// every hosted port declares `batchSize = Number.MAX_SAFE_INTEGER`, so the
// whole pool goes in ONE request. Three short sentences and thirty real chunks
// are not the same measurement: the payload differs by roughly two orders of
// magnitude, and a hosted model that probes well under the live budget can sit
// far past it on the real pool. The warning was calibrated against a workload
// nothing runs, which is worse than no warning — it is a green light for a
// reranker that will never change an answer.
//
// So the probe now sends what the pool sends. The Test Connection button costs
// what one real reranked query costs on a BYOK provider, which is the point:
// that number is also what the user needs to know before selecting the model.
//
// WHY THE ANSWER IS NOT AT INDEX 0
//
// The check was `rankedFirst === 0` against a payload whose first document was
// the answer, so a port that returned its input order unchanged — the single
// most likely wiring bug, and precisely what a ranking check exists to catch —
// reported a correct ranking. The answer now sits mid-pool and the verdict
// compares against `expectedIndex`.

export interface RerankProbe {
    query: string;
    documents: string[];
    /** Index of the ONE document that answers `query`. Never 0 unless size is 1. */
    expectedIndex: number;
}

const QUERY = 'What is the capital city of France?';

/**
 * The one passage that answers QUERY. Written at production chunk length so it
 * competes on the same terms as the distractors — a short answer among long
 * distractors would be ranked by length as much as by relevance.
 */
const ANSWER = [
    'Paris is the capital and most populous city of France. Situated on the river Seine in the',
    'north of the country, it sits at the heart of the Île-de-France region and has been the',
    'seat of French national government since the Capetian kings made it their principal',
    'residence. The city proper covers a little over one hundred square kilometres and is',
    'divided into twenty arrondissements that spiral outward from the Louvre. Administrative',
    'functions are concentrated along the Seine: the Élysée Palace houses the President, the',
    'Hôtel Matignon the Prime Minister, and the Palais Bourbon the National Assembly. Beyond',
    'its role as the seat of government, the city is the financial and commercial centre of',
    'the country, and the surrounding region accounts for a substantial share of national',
    'economic output. Its transport network — six major railway terminals, two international',
    'airports and a dense metro system opened in 1900 — makes it the hub through which most',
    'domestic and international travel to France passes. The status of the city as capital is',
    'not merely administrative convention but is reflected in the concentration of ministries,',
    'courts, embassies and national institutions within its boundaries, a centralisation that',
    'has shaped French political geography since the seventeenth century and that successive',
    'decentralisation programmes have adjusted without fundamentally displacing.',
].join(' ');

/**
 * Distractors: plausible, same-register, same-length prose that does NOT answer
 * the query. Deliberately topical rather than random — a reranker separating
 * "river in Europe" from "capital of France" is doing no work. These are all
 * geography-and-institutions passages, so the ranking check measures relevance
 * rather than topic detection.
 */
const DISTRACTOR_SUBJECTS: ReadonlyArray<readonly [string, string]> = [
    ['The Rhine', 'a river rising in the Swiss Alps and reaching the North Sea through the Netherlands'],
    ['Lyon', 'a city at the confluence of the Rhône and the Saône in east-central France'],
    ['The Loire', 'the longest river in France, running from the Massif Central to the Atlantic'],
    ['Marseille', 'a Mediterranean port city and the oldest continuously inhabited settlement in France'],
    ['Brussels', 'a city in the central part of Belgium and the seat of several European institutions'],
    ['The Pyrenees', 'a mountain range forming a natural border between France and Spain'],
    ['Bordeaux', 'a port city on the Garonne in the southwest of the country'],
    ['Geneva', 'a city at the southern tip of Lake Geneva in the French-speaking part of Switzerland'],
    ['Normandy', 'a region on the northern coast of France facing the English Channel'],
    ['Toulouse', 'a city on the Garonne in the south of the country, centre of the aerospace industry'],
    ['The Seine', 'a river flowing northwest through northern France to the English Channel'],
    ['Strasbourg', 'a city on the Ill near the German border, seat of the European Parliament'],
    ['Corsica', 'a mountainous island in the Mediterranean administered as a territorial collectivity'],
    ['Nantes', 'a city on the Loire in the west, historically the capital of Brittany'],
    ['The Alps', 'a mountain system crossing eight countries in south-central Europe'],
    ['Lille', 'a city in the far north of the country near the Belgian border'],
    ['Monaco', 'a sovereign city-state on the Mediterranean coast bordered on three sides by France'],
    ['Nice', 'a city on the Mediterranean coast in the southeast, on the Baie des Anges'],
    ['Luxembourg', 'a small landlocked country between Belgium, Germany and France'],
    ['Rennes', 'a city at the confluence of the Ille and the Vilaine in the northwest'],
    ['The Massif Central', 'a highland region occupying much of the south-central part of the country'],
    ['Montpellier', 'a city near the Mediterranean coast in the south of the country'],
    ['Andorra', 'a small principality in the eastern Pyrenees between France and Spain'],
    ['Grenoble', 'a city in the Alps at the confluence of the Drac and the Isère'],
    ['Reims', 'a city in the northeast, historically where French monarchs were crowned'],
    ['Dijon', 'a city in the east of the country, historically the seat of the Dukes of Burgundy'],
    ['The Garonne', 'a river rising in the Spanish Pyrenees and flowing to the Atlantic'],
    ['Avignon', 'a city on the left bank of the Rhône in the southeast of the country'],
    ['Le Havre', 'a port city on the Channel at the mouth of the Seine estuary'],
    ['Clermont-Ferrand', 'a city in the Massif Central surrounded by a chain of dormant volcanoes'],
    ['Tours', 'a city on the lower reaches of the Loire between Orléans and the Atlantic'],
    ['Besançon', 'a city in a loop of the Doubs river near the border with Switzerland'],
];

/** Pad a distractor to production chunk length with same-register prose. */
const distractor = (name: string, gloss: string): string => [
    `${name} is ${gloss}. Its situation has shaped the pattern of settlement and exchange`,
    'around it for a long period, and the surrounding area supports a mixture of agriculture,',
    'light manufacturing and services. Local administration is organised through the ordinary',
    'territorial structures of the state rather than through any special arrangement, and the',
    'relevant prefecture and council exercise the competences assigned to them by statute.',
    'Transport links follow the terrain: the main routes run along the natural corridors, and',
    'the rail and road network was laid out in the nineteenth and twentieth centuries to',
    'connect the area to the larger regional centres rather than to serve through traffic.',
    'Population has been broadly stable in recent decades, with growth in the outer periphery',
    'offsetting a slow decline in the older core, a pattern common across comparable places in',
    'the region. Cultural institutions include the usual complement of museums, a theatre and',
    'a conservatory, several of them occupying buildings that predate their current use.',
    'Seasonal visitor numbers rise in the warmer months without reaching the levels seen at',
    'the better-known destinations nearby. Nothing in its administrative status confers on it',
    'any role in the national government, whose institutions are seated elsewhere, and it has',
    'never been the seat of a national legislature or head of state in the modern period.',
].join(' ');

/**
 * Build the Test Connection payload for a pool of `poolSize` passages.
 *
 * Deterministic: two runs at the same size return identical payloads, so two
 * measurements are comparable. The answer is placed mid-pool (index 0 only when
 * the pool is a single document) so input order cannot pass the ranking check.
 */
export function buildRerankProbe(poolSize: number): RerankProbe {
    const size = Math.max(1, Math.min(
        DISTRACTOR_SUBJECTS.length + 1,
        Number.isFinite(poolSize) ? Math.floor(poolSize) : 1,
    ));
    if (size === 1) return { query: QUERY, documents: [ANSWER], expectedIndex: 0 };

    const documents = DISTRACTOR_SUBJECTS
        .slice(0, size - 1)
        .map(([name, gloss]) => distractor(name, gloss));
    // Mid-pool: far enough from index 0 that identity order fails, and — for any
    // pool of three or more — not last either, so a port that REVERSES its input
    // does not pass for the mirror-image reason. At size 2 there is no position
    // that is neither first nor last; production pools are 30, where this is 15.
    const expectedIndex = Math.floor(size / 2);
    documents.splice(expectedIndex, 0, ANSWER);
    return { query: QUERY, documents, expectedIndex };
}
