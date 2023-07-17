This repository has plain dependency-free JavaScript that can process GEDCOM in various ways and forms.
It is designed to have various operating modes
which are handled by separate module files to facilitate uses which do not need them all.

This repository does not currently handle different character sets.
It assumes you have correctly parsed bytes into a JavaScript string before processing.

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

GEDC parsing takes care of converting xref_id to pointers
and managing CONT and CONC pseudostructures;
GEDC serializing handles these going the other way.

GEDC parsing and serializing both accept a configuration object with the following keys:

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

- `newline` = `'\n'`{.js}
  
  A string to insert between lines when serializing.
  Should match `linesep`.

- `delim` = `/.*/`{.js}
  
  A regex to limit what is considered a delimiter.
  Delimiters will always match at least /^[ \t\p{Zs}]+$/u:
  that is, linear whitespace.
  
  A single space will always be used during serialization, regardless of the value of `delim`.

- `payload` = `/.*/`{.js}
  
  A regex to limit permitted string payloads.

Two special config objects are provided to match the GEDCOM 5.x and FamilySearch GEDCOM 7.x specs:

```js
const g5ConfGEDC = {
  len: 255,
  tag: /^[0-9a-z_A-Z]{1,31}$/u,
  xref: /^[0-9a-z_A-Z][^\p{Cc}@]{0,19}$/u,
  linesep: /^[\r\n][\r\n \t]*$/,
  delim: /^ $/,
}
const g7ConfGEDC = {
  len: -1,
  tag: /^([A-Z]|_[0-9_A-Z])[0-9_A-Z]*$/u,
  xref: /^([A-Z]|_[0-9_A-Z])[0-9_A-Z]*$/u,
  linesep: /^(\r\n?|\n\r?)$/,
  delim: /^ $/,
  payload: /^.+$/,
}
```

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

