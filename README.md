This repository has plain dependency-free JavaScript that can process GEDCOM in various ways and forms.
It is designed to have various operating modes
which are handled by separate module files to facilitate uses which do not need them all.

This repository does not currently handle different character sets.
It assumes you have correctly parsed bytes into a JavaScript string before processing.

To use this project as a FamilySearch GEDCOM 7 validator, visit <https://gedcom7code.github.io/js-gedcom/>.

# Status

- [x] Tag-oriented layer
    - [x] Tag-oriented parser
        - [x] With CONT and CONC handling
        - [x] With multiple dialects
    - [x] Manual creation of structures
    - [x] Tag-oriented JSON serializer/deserializer
    - [x] `querySelector` and `querySelectorAll` accepting `"HEAD.GEDC"`-type tag paths
- [x] Type-aware layer
    - [x] Parse spec from <https://github.com/FamilySearch/GEDCOM-registries>
    - [x] Parse tag-oriented into type-aware
        - [x] Context-aware structure type
            - [x] Error for out-of-place standard tags
            - [x] Error for cardinality violations
        - [x] Structure-type-aware payload parsing
            - [x] Error for malformed payloads
            - [x] Error for enumeration set membership violations
            - [x] Error for pointed-to type violations
        - [x] Support extensions, schema
            - [x] Warn about undocumented, unregistered, aliased, and relocated
        - [x] Warn about deprecations
            - [x] EXID.TYPE
            - [ ] g7:enumset-ord-STAT members COMPLETED, EXCLUDED, INFANT, PRE_1970, SUBMITTED, UNCLEARED
        - [ ] Warn about not-recommended patterns
    - [x] Manual creation of structures
        - [x] Creation, pointer handling, etc
        - [x] Error checking
            - [x] on request via `.validate()`
            - [ ] automatic partial checking on creation: payload types, superstructure not having too many of non-plural substructures
    - [x] Serialize to tag-oriented
        - [x] Schema deduction
        - [x] Serialization
    - [x] Type-oriented JSON serializer/deserializer
        - [x] Datatype serialization/deserialization
        - [x] Structure serialization/deserialization
    - [x] `find` and `findOrCreate` accepting arbitrarily-nested structure types and payload values (e.g. for finding a record with a given `EXID` and `EXID-TYPE`).

So far, the testing has been limited to starting with maximal70.ged augmented with various extensions and verifying the following properties, mostly by hand, also checking that all warnings and errors issued are correct:

```js
gedc = GEDCStruct.fromString(maximal, g7ConfGEDC)
maximal2 = gedc.toString()
// assert(maximal2 == maximal)

json_gedc = gedc.map(e=>e.toJSON())
gedc2 = GEDCStruct.fromJSON(json)
maximal3 = gedc2.map(e => e.toString('\n',-1,false)).join('')
// assert(maximal3 == maximal)

ged7 = G7Dataset.fromGEDC(gedc, g7validation)
gedc3 = ged7.toGEDC()
maximal4 = gedc3.toString()
// assert(maximal4 == maximal modulo some reordering and normalization)

json_ged7 = ged7.toJSON()
ged72 = G7Dataset.fromJSON(json, g7validation)
gedc4 = ged72.toGEDC()
maximal5 = gedc4.toString()
// assert(maximal5 == maximal4)
```

I've also done just a little ad-hoc testing to verify that if I create a G7Dataset programmatically it it populates its schema and otherwise serializes as expected.

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

# License

This code is released under both the MIT and UNLICENSE.
The dual licensing is motivated by the following observations:

- I, Luther Tychonievich, would like to participate in a small bit of ideological activism by promoting the Unlicense's goal: to disclaim copyright monopoly interest.
- I would also like as many people to use the code as possible. Since the Unlicense is not a proven or well known license, I also offer this code under the MIT license, which is ubiquitous and accepted by almost everyone.

More specifically, this code and all its dependencies are compatible with this licensing choice. Any dependencies (direct and transitive) will always be limited to permissive licenses. This code will never depend on code that is not permissively licensed. This means rejecting any dependency that uses a copyleft license such as the GPL, LGPL, MPL or any of the Creative Commons ShareAlike licenses.


# Contributing

Reports of errors or gaps in the code are very welcome, preferably as [issues on github](https://github.com/gedcom7code/js-gedcom/issues).
Pull requests extending functionality or fixing errors are also welcome.
