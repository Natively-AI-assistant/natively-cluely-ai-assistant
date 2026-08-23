// Single source of truth for Prism grammar registration across every code-
// rendering surface (NativelyInterface, MeetingChatOverlay, MeetingDetails).
//
// PROBLEM this solves: each of those components used to carry its own byte-
// identical `SyntaxHighlighter.registerLanguage(...)` block covering only ~15
// languages. `mapLanguageForPrism` (in prismLanguage.ts) resolves fence tags to
// grammar names for a MUCH larger set (ruby, java, kotlin, swift, php, c, …), so
// any tag outside the registered ~15 silently fell back to unhighlighted
// plaintext. Registration and resolution had drifted.
//
// Importing this module for its side effect registers a comprehensive set of
// popular languages/frameworks against the shared Prism singleton exactly once
// (guarded), so all surfaces highlight identically. `prism-light` only ships the
// core; grammars are pulled in on demand here.
//
// NOTE: keep the alias keys here in sync with the MAPPER in prismLanguage.ts —
// mapLanguageForPrism resolves a fence tag to one of these registered names.

import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light';

// Core / web
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import scss from 'react-syntax-highlighter/dist/esm/languages/prism/scss';
import sass from 'react-syntax-highlighter/dist/esm/languages/prism/sass';
import less from 'react-syntax-highlighter/dist/esm/languages/prism/less';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import json5 from 'react-syntax-highlighter/dist/esm/languages/prism/json5';
import graphql from 'react-syntax-highlighter/dist/esm/languages/prism/graphql';

// Frameworks / templating
import vue from 'react-syntax-highlighter/dist/esm/languages/prism/markup'; // .vue → markup base
import svelte from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import handlebars from 'react-syntax-highlighter/dist/esm/languages/prism/handlebars';
import pug from 'react-syntax-highlighter/dist/esm/languages/prism/pug';

// Backend / systems
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import ruby from 'react-syntax-highlighter/dist/esm/languages/prism/ruby';
import php from 'react-syntax-highlighter/dist/esm/languages/prism/php';
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import kotlin from 'react-syntax-highlighter/dist/esm/languages/prism/kotlin';
import scala from 'react-syntax-highlighter/dist/esm/languages/prism/scala';
import groovy from 'react-syntax-highlighter/dist/esm/languages/prism/groovy';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c';
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp';
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp';
import objectivec from 'react-syntax-highlighter/dist/esm/languages/prism/objectivec';
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift';
import dart from 'react-syntax-highlighter/dist/esm/languages/prism/dart';
import elixir from 'react-syntax-highlighter/dist/esm/languages/prism/elixir';
import erlang from 'react-syntax-highlighter/dist/esm/languages/prism/erlang';
import haskell from 'react-syntax-highlighter/dist/esm/languages/prism/haskell';
import clojure from 'react-syntax-highlighter/dist/esm/languages/prism/clojure';
import lua from 'react-syntax-highlighter/dist/esm/languages/prism/lua';
import perl from 'react-syntax-highlighter/dist/esm/languages/prism/perl';
import r from 'react-syntax-highlighter/dist/esm/languages/prism/r';
import julia from 'react-syntax-highlighter/dist/esm/languages/prism/julia';
import solidity from 'react-syntax-highlighter/dist/esm/languages/prism/solidity';
import fsharp from 'react-syntax-highlighter/dist/esm/languages/prism/fsharp';
import ocaml from 'react-syntax-highlighter/dist/esm/languages/prism/ocaml';

// Shell / config / data / infra
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import powershell from 'react-syntax-highlighter/dist/esm/languages/prism/powershell';
import batch from 'react-syntax-highlighter/dist/esm/languages/prism/batch';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import toml from 'react-syntax-highlighter/dist/esm/languages/prism/toml';
import ini from 'react-syntax-highlighter/dist/esm/languages/prism/ini';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import docker from 'react-syntax-highlighter/dist/esm/languages/prism/docker';
import nginx from 'react-syntax-highlighter/dist/esm/languages/prism/nginx';
import hcl from 'react-syntax-highlighter/dist/esm/languages/prism/hcl';
import makefile from 'react-syntax-highlighter/dist/esm/languages/prism/makefile';
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff';
import git from 'react-syntax-highlighter/dist/esm/languages/prism/git';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import protobuf from 'react-syntax-highlighter/dist/esm/languages/prism/protobuf';
import regex from 'react-syntax-highlighter/dist/esm/languages/prism/regex';

// Register once. Keys are the canonical grammar names produced by
// mapLanguageForPrism (aliases like `js`→`javascript` are resolved there, but we
// register the common short aliases too so a direct grammar-name lookup works).
let registered = false;

export function registerPrismLanguages(): void {
    if (registered) return;
    registered = true;

    const reg = (name: string, grammar: any) => SyntaxHighlighter.registerLanguage(name, grammar);

    // Core / web
    reg('javascript', javascript); reg('js', javascript);
    reg('typescript', typescript); reg('ts', typescript);
    reg('jsx', jsx);
    reg('tsx', tsx);
    reg('markup', markup); reg('html', markup); reg('xml', markup); reg('svg', markup);
    reg('css', css);
    reg('scss', scss);
    reg('sass', sass);
    reg('less', less);
    reg('json', json);
    reg('json5', json5);
    reg('graphql', graphql);

    // Frameworks / templating (Vue/Svelte SFCs highlight on their markup base)
    reg('vue', vue);
    reg('svelte', svelte);
    reg('handlebars', handlebars); reg('hbs', handlebars);
    reg('pug', pug);

    // Backend / systems
    reg('python', python); reg('py', python);
    reg('ruby', ruby); reg('rb', ruby);
    reg('php', php);
    reg('java', java);
    reg('kotlin', kotlin); reg('kt', kotlin);
    reg('scala', scala);
    reg('groovy', groovy);
    reg('go', go); reg('golang', go);
    reg('rust', rust); reg('rs', rust);
    reg('c', c);
    reg('cpp', cpp); reg('c++', cpp);
    reg('csharp', csharp); reg('cs', csharp);
    reg('objectivec', objectivec); reg('objc', objectivec);
    reg('swift', swift);
    reg('dart', dart);
    reg('elixir', elixir); reg('ex', elixir);
    reg('erlang', erlang);
    reg('haskell', haskell); reg('hs', haskell);
    reg('clojure', clojure); reg('clj', clojure);
    reg('lua', lua);
    reg('perl', perl);
    reg('r', r);
    reg('julia', julia); reg('jl', julia);
    reg('solidity', solidity); reg('sol', solidity);
    reg('fsharp', fsharp);
    reg('ocaml', ocaml);

    // Shell / config / data / infra
    reg('bash', bash); reg('sh', bash); reg('shell', bash); reg('zsh', bash);
    reg('powershell', powershell); reg('ps1', powershell);
    reg('batch', batch);
    reg('yaml', yaml); reg('yml', yaml);
    reg('toml', toml);
    reg('ini', ini);
    reg('sql', sql);
    reg('docker', docker); reg('dockerfile', docker);
    reg('nginx', nginx);
    reg('hcl', hcl); reg('terraform', hcl);
    reg('makefile', makefile);
    reg('diff', diff);
    reg('git', git);
    reg('markdown', markdown); reg('md', markdown);
    reg('protobuf', protobuf); reg('proto', protobuf);
    reg('regex', regex);
}
