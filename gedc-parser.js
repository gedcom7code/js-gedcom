/**
 * Parses GEDC data format strings into a forest of GEDC structures.
 * Allows additional validation for specific GEDC dialects.
 * 
 * Uses a generic dialect of GEDC.
 * 
 * Payloads that start "@" but not "@#" are encoded as "TAG @@"
 * thus, `TAG @#` and `TAG @@#` are synonyms for payload "@#"
 * but payload "@@#" is unambiguously encoded `TAG @@@#`
 * 
 * Written by Luther Tychonievich, July 2023. Released to the public domain,
 * to be used freely for any purpose with or without acknowledgement.
 */
export { GEDCStruct, g5ConfGEDC, g7ConfGEDC }

/**
 * A GEDC structure:
 * - tag (a string)
 * - payload (undefined or string or reference to another GEDC structure)
 * - sub (a list of GEDC structures)
 */
class GEDCStruct {
  tag
  payload
  sub = []
  
  #sup
  #ref = []
  #id
  
  /**
   * @param {string} tag
   * @param {GEDCStruct} sup - the superstructure; sup.sub will contain this unless sup is null
   * @param {GEDCStruct|string} ptr - a pointer payload, either directly or by ID
   * @patam {string} str - a string payload; ignored if ptr supplied
   * @param {string} id - a preferred identifier for serializing pointers
   */
  constructor(tag, sup, ptr, str, id) {
    this.tag = tag
    this.#sup = sup
    if (sup instanceof GEDCStruct) sup.sub.push(this)
    if (ptr instanceof GEDCStruct) {
      ptr.#ref.push(this)
      this.payload = ptr
    } else if (ptr !== undefined) {
      this.ptr = ptr // temporary, will be removed by fixPtrs
    } else {
      this.payload = str
    }
    
    if (id) this.#id = id
  }
  
  /**
   * Replaces string pointers with GEDStruct pointers and assigns every
   * pointed-to structure an id. If a string pointer is not in ids,
   * replaces with null and logs the incident.
   * 
   * @param {Object<string,GEDCStruct>} ids - string-to-structure map
   * @param {function} logger - called with any error messages
   */
  fixPtrs(ids, logger) {
    if ('ptr' in this && this.ptr in ids) {
      this.payload = ids[this.ptr]
      delete this.ptr
      if (this.payload) this.payload.#ref.push(this)
    } else if ('ptr' in this) {
      if (logger) logger(`pointer to undefined xref_id @${this.ptr}@`)
      delete this.ptr
      this.payload = null
    }
    if (this.#ref.length > 0) { // need an ID
      const used = Symbol.for('used')
      const next = Symbol.for('next')
      if (!(used in ids)) { ids[used] = new Set(); ids[used].add('VOID') }
      if (!(next in ids)) ids[next] = 0
      if (!this.#id || ids[used].has(this.#id)) {
        ids[next] += 1
        while ('X'+ids[next] in ids) ids[next]+=1
        this.#id = 'X'+ids[next]
        ids[this.#id] = this
      }
      ids[used].add(this.#id)
    }
    
    this.sub.forEach(e => e.fixPtrs(ids, logger))
  }
  
  /**
   * Serializes to GEDC string
   * 
   * @param {string} newline - how lines should end; defaults to '\n'
   * @param {Number} maxlen - if positive, will wrap lines to this many characters
   * @param {boolean} escapes - if true, leading @# unchanged; if false, becomes @@#
   */
  toString(newline, maxlen, escapes) {
    if (!newline || !/^[\n\r]+$/.test(newline) ) newline = '\n'
    let level = 0
    for(let s = this.#sup; s; s = s.#sup) level += 1
    let ans = `${level} `
    if (this.#ref.length > 0) ans += `@${this.#id}@ `
    ans += this.tag
    if (this.payload instanceof GEDCStruct) {
      ans += ` @${this.payload.#id}@`+newline
    } else if ('string' === typeof this.payload) {
      let lines = this.payload.split(/\r\n?|\n\r?/g).map(s => s.replace((escapes ? /^@(?!#)/ : /^@/),'@@'))
      let leader = ans
      ans += (lines[0].length > 0 ? ' ' : '')+(lines.join(newline+(level+1)+' CONT ')+newline).replaceAll('CONT '+newline, 'CONT'+newline)
      if (maxlen > 0 && ans.length > maxlen) {
        let pfx = newline + (level+1)+' CONC '
        if (maxlen < pfx + 1 || maxlen < leader.length)
          throw new Error(`length limit ${maxlen} too small to allow CONC insertion`)
        let ipt = new RegExp('^([^\\n\\r]{'+maxlen+'})([^\n\r])', 'm')
        console.log(ipt)
        while (ipt.test(ans)) {
          ans = ans.replace(ipt, '$1'+pfx+'$2')
        }
        ans = ans.replace(escapes ? /^([0-9]+ CONC @(?!#))/gm : /^([0-9]+ CONC @)/gm, '$1@')
      }
    } else if (this.payload === null) {
      ans += ' @VOID@'+newline
    } else {
      ans += newline
    }
    return ans + this.sub.map(s => s.toString(newline, maxlen, escapes)).join('')
  }
  
  /**
   * Encodes pointers using id and href
   */
  toJSON() {
    const ans = {tag:this.tag}
    if (this.#ref.length > 0) ans.id = this.#id
    if (this.payload instanceof GEDCStruct)
      ans.href = this.payload.#id
    else if (this.payload === null)
      ans.href = null
    else if ('string' === typeof this.payload)
      ans.text = this.payload
    if (this.sub.length > 0) ans.sub = this.sub.map(e=>e.toJSON())
    return ans
  }
  
  /**
   * Parses a GEDC string into a list of top-level GEDC structures.
   *
   * Accepts a configuration object with the following keys:
   * - `len` = `0`{.js}
   * 
   *    positive: limit lines to this many characters
   * 
   *    zero: no length limit
   * 
   *    negative: no length limit and no CONC allowed
   *
   * - `tag` = `/.+/`{.js}
   *
   *    A regex to limit the set of permitted tags.
   *    Tags will always match at least `/^[^@\p{Cc}\p{Z}][^\p{Cc}\p{Z}]*$/u`{.js}:
   *    that is, 1 or more characters,
   *    no whitespace or control characters,
   *    and not beginning with `@`.
   *
   *  - `xref` = `/.+/`{.js}
   *
   *     A regex to limit the set of permitted cross-reference identifiers.
   *     Cross-reference identifiers will always match at least `/^([^@#\p{Cc}]|\t)([^@\p{Cc}]|\t)*$/u`{.js}:
   *     that is, one or more characters,
   *     no non-tab control characters,
   *     no `@`,
   *     and not beginning with `#`.
   *
   * - `linesep` = `/.+/`{.js}
   * 
   *     A regex to limit what is considered a line separation.
   *     Line separations will always match at least /^[\n\r]\p{WSpace}*$/u:
   *     that is, a carriage return or line feed
   *     followed by whitespace.
   *
   * - `delim` = `/.+/`{.js}
   *
   *     A regex to limit what is considered a delimiter.
   *     Delimiters will always match at least /^[ \t\p{Zs}]+$/u:
   *     that is, linear whitespace.
   *
   *     A single space will always be used during serialization, regardless of *     the value of `delim`.
   *
   * - `payload` = `/(.*)/`{.js}
   *
   *     A regex to limit permitted string payloads.
   *
   * - `zeros` = `true`{.js}
   * 
   *     If `false`, leading zeros on levels (like `02`) is not allowed
   * 
   * @param {string} input - a full GEDC-serialized input
   * @param {Object} config - parser configuration; see above for more.
   * @param {function} logger - called with any error messages
   * @return {GEDCStructure[]}
   */
  static fromString(input, config, logger) {
    // level: [0-9]+
    // delim: [ \t\p{Zs}]+
    // xref: (?:[^@#\p{Cc}]|\t)(?:[^@\p{Cc}]|\t)*
    // tag: [^@\p{Cc}\p{Z}][^\p{Cc}\p{Z}]*
    // (level)(delim)(?:@(xref)@(delim))?(tag)(?:(delim)(?:@(xref)@|(payload)))?(?:(linesep)|$)
    var lre = /([0-9]+)([ \t\p{Zs}]+)(?:@((?:[^@#\p{Cc}]|\t)(?:[^@\p{Cc}]|\t)*)@([ \t\p{Zs}]+))?([^@\p{Cc}\p{Z}][^\p{Cc}\p{Z}]*)(?:([ \t\p{Zs}]+)(?:@((?:[^@#\p{Cc}]|\t)(?:[^@\p{Cc}]|\t)*)@|((?:[^@\n\r]|@[@#])[^\n\r]*)))?(?:([\n\r]\p{WSpace}*)|$)/gu;
    var context = [];
    var records = [];
    var ids = {};
    var line = 0
    var lastidx = 0
    if (input.startsWith('\ufeff')) input = input.substr(1)
    for(let match of input.matchAll(lre)) {
      line += 1
      let [all,l,d1,i,d2,t,d3,x,p,n] = match
      if (p && p.length > 1 && p[0] == '@' && p[1] == '@') p = p.substr(1)
      if (logger) {
        if (match.index != lastidx)
          logger(`${line}: unable to parse ${JSON.stringify(match.input.substring(lastidx,match.index))}`)
        if (!config.zeros && l.length > 1 && l[0] == '0')
          logger(`${line}: leading zeros not permitted in level`)
        if (config.delim) {
          if (!config.delim.test(d1))
            logger(`${line}: invalid delimiter ${JSON.stringify(d1)}`)
          if (d2 !== undefined && !config.delim.test(d2))
            logger(`${line}: invalid delimiter ${JSON.stringify(d2)}`)
          if (d3 !== undefined && !config.delim.test(d3))
            logger(`${line}: invalid delimiter ${JSON.stringify(d3)}`)
        }
        if (config.tag && !config.tag.test(t))
          logger(`${line}: invalid tag ${JSON.stringify(t)}`)
        if (config.xref) {
          if (i !== undefined && !config.xref.test(i))
            logger(`${line}: invalid xref_id ${JSON.stringify(i)}`)
          if (x !== undefined && !config.xref.test(x))
            logger(`${line}: invalid pointer ${JSON.stringify(x)}`)
        }
        if (config.linesep && n && !config.linesep.test(n))
          logger(`${line}: invalid line separator ${JSON.stringify(n)}`)
        if (config.payload && n && !config.payload.test(p))
          logger(`${line}: invalid string payload ${JSON.stringify(p)}`)
        if (config.len > 0 && all.length > config.len)
          logger(`${line}: line has ${all.length} characters, but only ${config.len} permitted`)
      }
      lastidx = match.index + all.length
      var level = Number(match[1]);
      if (level > context.length) {
        if (logger) logger(`${line}: level ${level} cannot follow level ${context.length-1}`)
        continue
      }
      context.length = level
      if (t == "CONT" || t == "CONC") {
        if (context[level-1].payload instanceof GEDCStruct || 'ptr' in context[level-1]) {
          if (logger) logger(`${line}: ${t} cannot follow pointer`)
        } else if (context[level-1].sub.length > 0) {
          if (logger) logger(`${line}: ${t} cannot follow substructure`)
        }
        if (context[level-1].payload === undefined) context[level-1].payload = ''
        if (p === undefined) p = ''
        if (t == 'CONT') context[level-1].payload += '\n' + p
        else if ('len' in config && config.len < 0) {
          if (logger) logger(`${line}: CONC not permitted`)
        } else context[level-1].payload += p
        continue;
      }
      let st = new GEDCStruct(t, level >= 0 ? context[level-1] : null, x, p, i)
      context.push(st)
      if (level == 0) records.push(st);
      if (i) ids[i] = st;
    }
    records.forEach(x => x.fixPtrs(ids, logger));
    return records;
  }
  
  static fromJSON(o, ids, sup) {
    const top = !ids
    if (top) ids = {}
    if (Array.isArray(o)) {
      const recs = o.map(e => GEDCStruct.fromJSON(e, ids, sup))
      if (top) recs.forEach(x => x.fixPtrs(ids))
      return recs
    }
    const ans = new GEDCStruct(o.tag, sup, o.href, o.text, o.id)
    if (o.id) ids[o.id] = ans
    if (o.sub) o.sub.forEach(e => GEDCStruct.fromJSON(e, ids, ans))
    if (top) ans.fixPtrs(ids)
    return ans
  }
}

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
