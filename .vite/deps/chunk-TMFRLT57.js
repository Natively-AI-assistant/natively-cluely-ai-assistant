import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/highlight.js/lib/languages/purebasic.js
var require_purebasic = __commonJS({
  "node_modules/highlight.js/lib/languages/purebasic.js"(exports, module) {
    function purebasic(hljs) {
      const STRINGS = {
        // PB IDE color: #0080FF (Azure Radiance)
        className: "string",
        begin: '(~)?"',
        end: '"',
        illegal: "\\n"
      };
      const CONSTANTS = {
        // PB IDE color: #924B72 (Cannon Pink)
        //  "#" + a letter or underscore + letters, digits or underscores + (optional) "$"
        className: "symbol",
        begin: "#[a-zA-Z_]\\w*\\$?"
      };
      return {
        name: "PureBASIC",
        aliases: [
          "pb",
          "pbi"
        ],
        keywords: (
          // PB IDE color: #006666 (Blue Stone) + Bold
          // Keywords from all version of PureBASIC 5.00 upward ...
          "Align And Array As Break CallDebugger Case CompilerCase CompilerDefault CompilerElse CompilerElseIf CompilerEndIf CompilerEndSelect CompilerError CompilerIf CompilerSelect CompilerWarning Continue Data DataSection Debug DebugLevel Declare DeclareC DeclareCDLL DeclareDLL DeclareModule Default Define Dim DisableASM DisableDebugger DisableExplicit Else ElseIf EnableASM EnableDebugger EnableExplicit End EndDataSection EndDeclareModule EndEnumeration EndIf EndImport EndInterface EndMacro EndModule EndProcedure EndSelect EndStructure EndStructureUnion EndWith Enumeration EnumerationBinary Extends FakeReturn For ForEach ForEver Global Gosub Goto If Import ImportC IncludeBinary IncludeFile IncludePath Interface List Macro MacroExpandedCount Map Module NewList NewMap Next Not Or Procedure ProcedureC ProcedureCDLL ProcedureDLL ProcedureReturn Protected Prototype PrototypeC ReDim Read Repeat Restore Return Runtime Select Shared Static Step Structure StructureUnion Swap Threaded To UndefineMacro Until Until  UnuseModule UseModule Wend While With XIncludeFile XOr"
        ),
        contains: [
          // COMMENTS | PB IDE color: #00AAAA (Persian Green)
          hljs.COMMENT(";", "$", {
            relevance: 0
          }),
          {
            // PROCEDURES DEFINITIONS
            className: "function",
            begin: "\\b(Procedure|Declare)(C|CDLL|DLL)?\\b",
            end: "\\(",
            excludeEnd: true,
            returnBegin: true,
            contains: [
              {
                // PROCEDURE KEYWORDS | PB IDE color: #006666 (Blue Stone) + Bold
                className: "keyword",
                begin: "(Procedure|Declare)(C|CDLL|DLL)?",
                excludeEnd: true
              },
              {
                // PROCEDURE RETURN TYPE SETTING | PB IDE color: #000000 (Black)
                className: "type",
                begin: "\\.\\w*"
                // end: ' ',
              },
              hljs.UNDERSCORE_TITLE_MODE
              // PROCEDURE NAME | PB IDE color: #006666 (Blue Stone)
            ]
          },
          STRINGS,
          CONSTANTS
        ]
      };
    }
    module.exports = purebasic;
  }
});

export {
  require_purebasic
};
//# sourceMappingURL=chunk-TMFRLT57.js.map
