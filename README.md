This repository has plain dependency-free JavaScript that can process GEDCOM in various ways and forms.
It is designed to have various operating modes
which are handled by separate module files to facilitate uses which do not need them all.

This repository does not currently handle different character sets.
It assumes you have correctly parsed bytes into a JavaScript string before processing.

# Status

- [*] Tag-oriented layer
    - [*] Tag-oriented parser
        - [*] With CONT and CONC handling
        - [*] With multiple dialects
    - [*] Manual creation of structures
    - [*] Tag-oriented JSON serializer/deserializer
- [ ] Type-aware layer
    - [*] Parse spec from <https://github.com/FamilySearch/GEDCOM-registries>
    - [*] Parse tag-oriented into type-aware
        - [*] Context-aware structure type
            - [*] Error for out-of-place standard tags
            - [ ] Error for cardinality violations
        - [*] Structure-type-aware payload parsing
            - [*] Error for malformed payloads
            - [*] Error for enumeration set membership violations
            - [ ] Error for pointed-to type violations
        - [*] Support extensions, schema
            - [*] Warn about undocumented, unregistered, aliased, and relocated
        - [ ] Warn about deprecations
        - [ ] Warn about not-recommended patterns
    - [ ] Manual creation of structures
        - [*] Creation, pointer handling, etc
        - [ ] Error checking
    - [ ] Serialize to tag-oriented
        - [ ] Schema deduction
        - [ ] Serialization
    - [ ] Type-oriented JSON serializer/deserializer
        - [*] Datatype serialization/deserialization
        - [ ] Structure serialization/deserialization
    


# GEDC parser/serializer

Parses a GEDCOM dataset string
into a sequence of GEDC structures.
Each structure contains

- `tag`
- optionally `payload`, which is one of
    - a string
    - a (pointer to) another GEDC structure
    - `null` for an encoded pointer with no destination
- optionally `sub`, which is a list of other structures

For internal use, we also track the following:

- `sup`, the (unique) structure that this structure is in the `sub` list of, or null for top-level structures
- `references`, a (usually empty) list of other structures that this is the `payload` of
- optionally `id`, a recommended xref_id to use in serializing pointers to this structure

Both GEDCStruct
and the list of GEDCStruct returned by `fromJSON` and `fromString`
have two utility methods, `querySelect` and `querySelectAll`,
modeled after the corresponding methods in DOM Elements
but using GEDCOM dot-notation paths instead. In particular,

- `XYZ` matches any structure with tag `XYZ`
- `.XYZ` matches any top-level structure with tag `XYZ`
- `ABC.XYZ` matches any structure with tag `XYZ` that is a substructure of a structure with tag `ABC`
- `ABC..XYZ` matches any structure with tag `XYZ` that contained within a structure with tag `ABC`

GEDC parsing takes care of converting xref_id to pointers
and managing CONT and CONC pseudostructures;
GEDC serializing handles these going the other way.

GEDC parsing and serializing both accept a configuration object with the following keys.

Parsing configurations:

- `len` = `0`{.js}
    
    positive: limit lines to this many characters
    
    zero: no length limit
    
    negative: no length limit and no CONC allowed

  - `tag` = `/.*/`{.js}

    A regex to limit the set of permitted tags.
    Tags will always match at least `/^[^@\p{Cc}\p{Z}][^\p{Cc}\p{Z}]*$/u`{.js}:
    that is, 1 or more characters,
    no whitespace or control characters,
    and not beginning with `@`.

- `xref` = `/.*/`{.js}
    
    A regex to limit the set of permitted cross-reference identifiers.
    Cross-reference identifiers will always match at least `/^([^@#\p{Cc}]|\t)([^@\p{Cc}]|\t)*$/u`{.js}:
    that is, one or more characters,
    no non-tab control characters,
    no `@`,
    and not beginning with `#`.

- `linesep` = `/.*/`{.js}
    
    A regex to limit what is considered a line separation.
    Line separations will always match at least /^[\n\r]\p{WSpace}*$/u:
    that is, a carriage return or line feed
    followed by whitespace.

- `delim` = `/.*/`{.js}
    
    A regex to limit what is considered a delimiter.
    Delimiters will always match at least /^[ \t\p{Zs}]+$/u:
    that is, linear whitespace.
    
    A single space will always be used during serialization, regardless of the value of `delim`.

- `payload` = `/.*/`{.js}
    
    A regex to limit permitted string payloads.

- `zeros` = `false`
    
    If `true`, allow leading zeros on levels (e.g. `00` or `01`)

Serializing configurations:

- `newline` = `'\n'`{.js}
    
    A string to insert between lines when serializing.
    Should match `linesep`.

- `escapes` = `false`
    
    If `true`, serialize payloads beginning `@#` as `@#` instead of `@@#`.
    Both always deserialize as the same thing.

Two special config objects are provided to match the GEDCOM 5.x and FamilySearch GEDCOM 7.x specs:

```js
/** GEDCOM 5.x-compatible configuration */
const g5ConfGEDC = {
  len: 255,
  tag: /^[0-9a-z_A-Z]{1,31}$/u,
  xref: /^[0-9a-z_A-Z][^\p{Cc}@]{0,19}$/u,
  linesep: /^[\r\n][\r\n \t]*$/,
  delim: /^ $/,
  zeros: false,
  escapes: true,
}

/** GEDCOM 7.x-compatible configuration */
const g7ConfGEDC = {
  len: -1,
  tag: /^([A-Z]|_[0-9_A-Z])[0-9_A-Z]*$/u,
  xref: /^([A-Z]|_[0-9_A-Z])[0-9_A-Z]*$/u,
  linesep: /^(\r\n?|\n\r?)$/,
  delim: /^ $/,
  payload: /^.+$/,
  zeros: false,
  escapes: false,
}
```

As of commit 34dd91ad90ce5e8301e943b4d559a603028b45c9 (2023-07-18), the implementation round-trips `maximal70.ged` from <https://gedcom.io/tools/>; that is maximal70.ged → fromString → toJSON → fromJSON → toString == maximal70.ged.
Note that this does not constitute an exhaustive test
and the code may contain bugs.

# FamilySearch GEDCOM 7 Type Checker

Uses a parsed schema like [g7validation.json](https://github.com/FamilySearch/GEDCOM-registries/blob/main/generated_files/g7validation.json)
to convert a GEDC dataset into a FamilySearch GEDCOM 7 dataset.
Various FamilySearch GEDCOM 7 rules are embedded within the code,
including extension handling,
payload datatypes,
and structure ordering rules.

A G7Structure contains

- `type`, a URI or unregistered extension tag
- optionally `payload`, which may have many different types depending on the `type`
- `sub`, which is a map with `type` keys and list-of-G7Structure values

The `type` is omitted during JSON serialization as it is available in the G7Structure's containing structure.

For internal use, we also track the following:

- `sup`, the (unique) structure that this structure is in the `sub` list of, or null for top-level structures
- `references`, a (usually empty) list of other structures that this is the `payload` of
- optionally `id`, a recommended xref_id to use in serializing pointers to this structure

Because some operations are handled centrally (such as determining which extension tags are in use),
a G7Dataset is used to enclose the G7Structures;
it contains

- `header`, a `G7Structure` with type <https://gedcom.io/terms/v7/HEAD>
- `records`, which is exactly like G7Structure's `sub`

