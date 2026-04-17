import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/xml-doc.js
var require_xml_doc = __commonJS({
  "node_modules/refractor/lang/xml-doc.js"(exports, module) {
    module.exports = xmlDoc;
    xmlDoc.displayName = "xmlDoc";
    xmlDoc.aliases = [];
    function xmlDoc(Prism) {
      ;
      (function(Prism2) {
        function insertDocComment(lang, docComment) {
          if (Prism2.languages[lang]) {
            Prism2.languages.insertBefore(lang, "comment", {
              "doc-comment": docComment
            });
          }
        }
        var tag = Prism2.languages.markup.tag;
        var slashDocComment = {
          pattern: /\/\/\/.*/,
          greedy: true,
          alias: "comment",
          inside: {
            tag
          }
        };
        var tickDocComment = {
          pattern: /'''.*/,
          greedy: true,
          alias: "comment",
          inside: {
            tag
          }
        };
        insertDocComment("csharp", slashDocComment);
        insertDocComment("fsharp", slashDocComment);
        insertDocComment("vbnet", tickDocComment);
      })(Prism);
    }
  }
});

export {
  require_xml_doc
};
//# sourceMappingURL=chunk-6AEEMCXB.js.map
