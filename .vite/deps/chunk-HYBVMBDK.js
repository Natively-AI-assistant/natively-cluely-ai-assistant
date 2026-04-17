import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/docker.js
var require_docker = __commonJS({
  "node_modules/refractor/lang/docker.js"(exports, module) {
    module.exports = docker;
    docker.displayName = "docker";
    docker.aliases = ["dockerfile"];
    function docker(Prism) {
      ;
      (function(Prism2) {
        var spaceAfterBackSlash = /\\[\r\n](?:\s|\\[\r\n]|#.*(?!.))*(?![\s#]|\\[\r\n])/.source;
        var space = /(?:[ \t]+(?![ \t])(?:<SP_BS>)?|<SP_BS>)/.source.replace(
          /<SP_BS>/g,
          function() {
            return spaceAfterBackSlash;
          }
        );
        var string = /"(?:[^"\\\r\n]|\\(?:\r\n|[\s\S]))*"|'(?:[^'\\\r\n]|\\(?:\r\n|[\s\S]))*'/.source;
        var option = /--[\w-]+=(?:<STR>|(?!["'])(?:[^\s\\]|\\.)+)/.source.replace(
          /<STR>/g,
          function() {
            return string;
          }
        );
        var stringRule = {
          pattern: RegExp(string),
          greedy: true
        };
        var commentRule = {
          pattern: /(^[ \t]*)#.*/m,
          lookbehind: true,
          greedy: true
        };
        function re(source, flags) {
          source = source.replace(/<OPT>/g, function() {
            return option;
          }).replace(/<SP>/g, function() {
            return space;
          });
          return RegExp(source, flags);
        }
        Prism2.languages.docker = {
          instruction: {
            pattern: /(^[ \t]*)(?:ADD|ARG|CMD|COPY|ENTRYPOINT|ENV|EXPOSE|FROM|HEALTHCHECK|LABEL|MAINTAINER|ONBUILD|RUN|SHELL|STOPSIGNAL|USER|VOLUME|WORKDIR)(?=\s)(?:\\.|[^\r\n\\])*(?:\\$(?:\s|#.*$)*(?![\s#])(?:\\.|[^\r\n\\])*)*/im,
            lookbehind: true,
            greedy: true,
            inside: {
              options: {
                pattern: re(
                  /(^(?:ONBUILD<SP>)?\w+<SP>)<OPT>(?:<SP><OPT>)*/.source,
                  "i"
                ),
                lookbehind: true,
                greedy: true,
                inside: {
                  property: {
                    pattern: /(^|\s)--[\w-]+/,
                    lookbehind: true
                  },
                  string: [
                    stringRule,
                    {
                      pattern: /(=)(?!["'])(?:[^\s\\]|\\.)+/,
                      lookbehind: true
                    }
                  ],
                  operator: /\\$/m,
                  punctuation: /=/
                }
              },
              keyword: [
                {
                  // https://docs.docker.com/engine/reference/builder/#healthcheck
                  pattern: re(
                    /(^(?:ONBUILD<SP>)?HEALTHCHECK<SP>(?:<OPT><SP>)*)(?:CMD|NONE)\b/.source,
                    "i"
                  ),
                  lookbehind: true,
                  greedy: true
                },
                {
                  // https://docs.docker.com/engine/reference/builder/#from
                  pattern: re(
                    /(^(?:ONBUILD<SP>)?FROM<SP>(?:<OPT><SP>)*(?!--)[^ \t\\]+<SP>)AS/.source,
                    "i"
                  ),
                  lookbehind: true,
                  greedy: true
                },
                {
                  // https://docs.docker.com/engine/reference/builder/#onbuild
                  pattern: re(/(^ONBUILD<SP>)\w+/.source, "i"),
                  lookbehind: true,
                  greedy: true
                },
                {
                  pattern: /^\w+/,
                  greedy: true
                }
              ],
              comment: commentRule,
              string: stringRule,
              variable: /\$(?:\w+|\{[^{}"'\\]*\})/,
              operator: /\\$/m
            }
          },
          comment: commentRule
        };
        Prism2.languages.dockerfile = Prism2.languages.docker;
      })(Prism);
    }
  }
});

export {
  require_docker
};
//# sourceMappingURL=chunk-HYBVMBDK.js.map
