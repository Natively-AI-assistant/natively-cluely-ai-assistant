import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/highlight.js/lib/languages/julia.js
var require_julia = __commonJS({
  "node_modules/highlight.js/lib/languages/julia.js"(exports, module) {
    function julia(hljs) {
      var VARIABLE_NAME_RE = "[A-Za-z_\\u00A1-\\uFFFF][A-Za-z_0-9\\u00A1-\\uFFFF]*";
      var KEYWORD_LIST = [
        "baremodule",
        "begin",
        "break",
        "catch",
        "ccall",
        "const",
        "continue",
        "do",
        "else",
        "elseif",
        "end",
        "export",
        "false",
        "finally",
        "for",
        "function",
        "global",
        "if",
        "import",
        "in",
        "isa",
        "let",
        "local",
        "macro",
        "module",
        "quote",
        "return",
        "true",
        "try",
        "using",
        "where",
        "while"
      ];
      var LITERAL_LIST = [
        "ARGS",
        "C_NULL",
        "DEPOT_PATH",
        "ENDIAN_BOM",
        "ENV",
        "Inf",
        "Inf16",
        "Inf32",
        "Inf64",
        "InsertionSort",
        "LOAD_PATH",
        "MergeSort",
        "NaN",
        "NaN16",
        "NaN32",
        "NaN64",
        "PROGRAM_FILE",
        "QuickSort",
        "RoundDown",
        "RoundFromZero",
        "RoundNearest",
        "RoundNearestTiesAway",
        "RoundNearestTiesUp",
        "RoundToZero",
        "RoundUp",
        "VERSION|0",
        "devnull",
        "false",
        "im",
        "missing",
        "nothing",
        "pi",
        "stderr",
        "stdin",
        "stdout",
        "true",
        "undef",
        "π",
        "ℯ"
      ];
      var BUILT_IN_LIST = [
        "AbstractArray",
        "AbstractChannel",
        "AbstractChar",
        "AbstractDict",
        "AbstractDisplay",
        "AbstractFloat",
        "AbstractIrrational",
        "AbstractMatrix",
        "AbstractRange",
        "AbstractSet",
        "AbstractString",
        "AbstractUnitRange",
        "AbstractVecOrMat",
        "AbstractVector",
        "Any",
        "ArgumentError",
        "Array",
        "AssertionError",
        "BigFloat",
        "BigInt",
        "BitArray",
        "BitMatrix",
        "BitSet",
        "BitVector",
        "Bool",
        "BoundsError",
        "CapturedException",
        "CartesianIndex",
        "CartesianIndices",
        "Cchar",
        "Cdouble",
        "Cfloat",
        "Channel",
        "Char",
        "Cint",
        "Cintmax_t",
        "Clong",
        "Clonglong",
        "Cmd",
        "Colon",
        "Complex",
        "ComplexF16",
        "ComplexF32",
        "ComplexF64",
        "CompositeException",
        "Condition",
        "Cptrdiff_t",
        "Cshort",
        "Csize_t",
        "Cssize_t",
        "Cstring",
        "Cuchar",
        "Cuint",
        "Cuintmax_t",
        "Culong",
        "Culonglong",
        "Cushort",
        "Cvoid",
        "Cwchar_t",
        "Cwstring",
        "DataType",
        "DenseArray",
        "DenseMatrix",
        "DenseVecOrMat",
        "DenseVector",
        "Dict",
        "DimensionMismatch",
        "Dims",
        "DivideError",
        "DomainError",
        "EOFError",
        "Enum",
        "ErrorException",
        "Exception",
        "ExponentialBackOff",
        "Expr",
        "Float16",
        "Float32",
        "Float64",
        "Function",
        "GlobalRef",
        "HTML",
        "IO",
        "IOBuffer",
        "IOContext",
        "IOStream",
        "IdDict",
        "IndexCartesian",
        "IndexLinear",
        "IndexStyle",
        "InexactError",
        "InitError",
        "Int",
        "Int128",
        "Int16",
        "Int32",
        "Int64",
        "Int8",
        "Integer",
        "InterruptException",
        "InvalidStateException",
        "Irrational",
        "KeyError",
        "LinRange",
        "LineNumberNode",
        "LinearIndices",
        "LoadError",
        "MIME",
        "Matrix",
        "Method",
        "MethodError",
        "Missing",
        "MissingException",
        "Module",
        "NTuple",
        "NamedTuple",
        "Nothing",
        "Number",
        "OrdinalRange",
        "OutOfMemoryError",
        "OverflowError",
        "Pair",
        "PartialQuickSort",
        "PermutedDimsArray",
        "Pipe",
        "ProcessFailedException",
        "Ptr",
        "QuoteNode",
        "Rational",
        "RawFD",
        "ReadOnlyMemoryError",
        "Real",
        "ReentrantLock",
        "Ref",
        "Regex",
        "RegexMatch",
        "RoundingMode",
        "SegmentationFault",
        "Set",
        "Signed",
        "Some",
        "StackOverflowError",
        "StepRange",
        "StepRangeLen",
        "StridedArray",
        "StridedMatrix",
        "StridedVecOrMat",
        "StridedVector",
        "String",
        "StringIndexError",
        "SubArray",
        "SubString",
        "SubstitutionString",
        "Symbol",
        "SystemError",
        "Task",
        "TaskFailedException",
        "Text",
        "TextDisplay",
        "Timer",
        "Tuple",
        "Type",
        "TypeError",
        "TypeVar",
        "UInt",
        "UInt128",
        "UInt16",
        "UInt32",
        "UInt64",
        "UInt8",
        "UndefInitializer",
        "UndefKeywordError",
        "UndefRefError",
        "UndefVarError",
        "Union",
        "UnionAll",
        "UnitRange",
        "Unsigned",
        "Val",
        "Vararg",
        "VecElement",
        "VecOrMat",
        "Vector",
        "VersionNumber",
        "WeakKeyDict",
        "WeakRef"
      ];
      var KEYWORDS = {
        $pattern: VARIABLE_NAME_RE,
        keyword: KEYWORD_LIST,
        literal: LITERAL_LIST,
        built_in: BUILT_IN_LIST
      };
      var DEFAULT = {
        keywords: KEYWORDS,
        illegal: /<\//
      };
      var NUMBER = {
        className: "number",
        // supported numeric literals:
        //  * binary literal (e.g. 0x10)
        //  * octal literal (e.g. 0o76543210)
        //  * hexadecimal literal (e.g. 0xfedcba876543210)
        //  * hexadecimal floating point literal (e.g. 0x1p0, 0x1.2p2)
        //  * decimal literal (e.g. 9876543210, 100_000_000)
        //  * floating pointe literal (e.g. 1.2, 1.2f, .2, 1., 1.2e10, 1.2e-10)
        begin: /(\b0x[\d_]*(\.[\d_]*)?|0x\.\d[\d_]*)p[-+]?\d+|\b0[box][a-fA-F0-9][a-fA-F0-9_]*|(\b\d[\d_]*(\.[\d_]*)?|\.\d[\d_]*)([eEfF][-+]?\d+)?/,
        relevance: 0
      };
      var CHAR = {
        className: "string",
        begin: /'(.|\\[xXuU][a-zA-Z0-9]+)'/
      };
      var INTERPOLATION = {
        className: "subst",
        begin: /\$\(/,
        end: /\)/,
        keywords: KEYWORDS
      };
      var INTERPOLATED_VARIABLE = {
        className: "variable",
        begin: "\\$" + VARIABLE_NAME_RE
      };
      var STRING = {
        className: "string",
        contains: [hljs.BACKSLASH_ESCAPE, INTERPOLATION, INTERPOLATED_VARIABLE],
        variants: [
          { begin: /\w*"""/, end: /"""\w*/, relevance: 10 },
          { begin: /\w*"/, end: /"\w*/ }
        ]
      };
      var COMMAND = {
        className: "string",
        contains: [hljs.BACKSLASH_ESCAPE, INTERPOLATION, INTERPOLATED_VARIABLE],
        begin: "`",
        end: "`"
      };
      var MACROCALL = {
        className: "meta",
        begin: "@" + VARIABLE_NAME_RE
      };
      var COMMENT = {
        className: "comment",
        variants: [
          { begin: "#=", end: "=#", relevance: 10 },
          { begin: "#", end: "$" }
        ]
      };
      DEFAULT.name = "Julia";
      DEFAULT.contains = [
        NUMBER,
        CHAR,
        STRING,
        COMMAND,
        MACROCALL,
        COMMENT,
        hljs.HASH_COMMENT_MODE,
        {
          className: "keyword",
          begin: "\\b(((abstract|primitive)\\s+)type|(mutable\\s+)?struct)\\b"
        },
        { begin: /<:/ }
        // relevance booster
      ];
      INTERPOLATION.contains = DEFAULT.contains;
      return DEFAULT;
    }
    module.exports = julia;
  }
});

export {
  require_julia
};
//# sourceMappingURL=chunk-HNZAOKTP.js.map
