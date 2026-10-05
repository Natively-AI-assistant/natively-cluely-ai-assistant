/**
 * Default phrase hints (Google STT "speech adaptation") for technical
 * meetings and interviews.
 *
 * WHY: when a phrase is recognized under a non-English primary language
 * (e.g. ru-RU), embedded English tech terms — "Stateless Widget", "hot
 * reload" — get phonetically mangled by that language's model. Google's
 * speechContexts bias recognition toward these exact tokens, so the model
 * emits the Latin term verbatim inside Cyrillic text instead of garbling it.
 *
 * Google STT v1 limits: ≤500 phrases, ≤100 chars each. Keep this list
 * curated — over-boosting a huge vocabulary causes false positives on
 * ordinary speech. Multi-word phrases are preferred: they collide with
 * normal words far less than single tokens do.
 */
export const DEFAULT_TECH_PHRASE_HINTS: string[] = [
    // Flutter / mobile
    'Stateless Widget', 'Stateful Widget', 'Widget tree', 'hot reload', 'hot restart',
    'Flutter', 'Dart', 'BuildContext', 'setState', 'Provider', 'Riverpod', 'BLoC',
    'Jetpack Compose', 'SwiftUI', 'UIKit', 'Kotlin', 'Swift', 'Xcode', 'Android Studio',

    // Web / frontend
    'React', 'React Native', 'Vue', 'Angular', 'Next.js', 'TypeScript', 'JavaScript',
    'useState', 'useEffect', 'Virtual DOM', 'server-side rendering', 'Tailwind',
    'Webpack', 'Vite', 'npm', 'Node.js', 'Electron',

    // Backend / architecture
    'REST API', 'GraphQL', 'gRPC', 'WebSocket', 'microservices', 'monolith',
    'load balancer', 'message queue', 'Kafka', 'RabbitMQ', 'event-driven',
    'dependency injection', 'middleware', 'JWT', 'OAuth', 'rate limiting',
    'CQRS', 'event sourcing', 'idempotency',

    // Databases
    'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'SQLite', 'Elasticsearch',
    'primary key', 'foreign key', 'index', 'sharding', 'replication',
    'ACID', 'transaction isolation', 'eventual consistency', 'ORM',

    // CS fundamentals
    'hash map', 'hash table', 'linked list', 'binary tree', 'binary search',
    'depth-first search', 'breadth-first search', 'dynamic programming',
    'time complexity', 'space complexity', 'Big O', 'quicksort', 'merge sort',
    'two pointers', 'sliding window', 'recursion', 'memoization', 'heap', 'stack', 'queue',

    // Languages / general
    'Python', 'Java', 'Golang', 'Rust', 'C++', 'C#', 'garbage collector',
    'mutex', 'deadlock', 'race condition', 'thread pool', 'async await',
    'promise', 'callback', 'closure', 'interface', 'abstract class',
    'polymorphism', 'inheritance', 'encapsulation', 'SOLID', 'design patterns',
    'singleton', 'factory', 'observer',

    // DevOps / cloud
    'Kubernetes', 'Docker', 'container', 'CI/CD', 'pipeline', 'deployment',
    'AWS', 'Google Cloud', 'Azure', 'Terraform', 'serverless', 'Lambda',
    'monitoring', 'observability', 'Prometheus', 'Grafana',

    // AI / data
    'machine learning', 'neural network', 'large language model', 'embedding',
    'fine-tuning', 'prompt engineering', 'RAG', 'vector database', 'transformer',
    'PyTorch', 'TensorFlow',

    // Process
    'code review', 'pull request', 'merge conflict', 'git rebase', 'unit test',
    'integration test', 'test coverage', 'refactoring', 'technical debt',
    'agile', 'scrum', 'sprint', 'stand-up', 'retrospective', 'backlog',
    'edge case', 'production', 'staging', 'rollback', 'feature flag',
];
