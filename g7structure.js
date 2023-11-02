export { G7Structure, G7Dataset }
import { G7Date, G7DateValue, G7Enum, G7Datatype, checkDatatype } from "./g7datatypes.js"
import { GEDCStruct, g7ConfGEDC, GEDCToString } from "./gedcstruct.js"


/**
 * A structure or record
 */
class G7Structure {
  /**
   * The type of this structure; either a URI, or the tag of an undocumented
   * extension structure or extension-defined substructure 
   * @type {string}
   */
  type
  /**
   * The payload: null or G7Structure for pointers,
   * undefined for no payload,
   * string or type from g7datatypes.js for other payloads
   */
  payload
  /**
   * Substructures, organized as lists of substructures of a given type.
   * assert(this.sub.get(t)[i].type === t)
   * @type {Map<string, G7Structure[]>}
   */
  sub = new Map()
  #sup
  #ref = new WeakSet()
  #id
  #lookup
  
  /**
   * Internal-use constructor. To make a G7Structure, use one of the following:
   * 
   * - {@link G7Dataset#createRecord} to manually create a record
   * - {@link G7Structure#createSubstructure} to manually create a substructure
   * - {@link G7Dataset#fromString} to load a raw GEDCOM file
   * - {@link G7Dataset#fromGEDC} to load a parsed GEDCOM file
   * - {@link G7Dataset#fromJSON} to load a parsed JSON dataset
   */
  constructor(lookup, type, payload, sup, id) {
    this.#lookup = lookup
    this.type = type
    this.payload = payload
    this.#sup = sup
    if (sup instanceof G7Structure) {
      if (sup.sub.has(type)) sup.sub.get(type).push(this)
      else sup.sub.set(type, [this])
    }
    if (payload instanceof G7Structure) {
      payload.#ref.add(this)
      if(!payload.#id) payload.#id = this.#lookup.uniqueID()
    }
    this.#id = id
  }
  
  /**
   * Add a substructure to this structure
   * @param {string} type - URI of the structure type
   * @param payload - the payload of this structure
   * @param {Object|boolean} pltype - optional payload type definition. If `true` skips payload type check; if `false` or missing, looks up payload type
   */
  createSubstructure(type, payload, pltype) {
    if (!type.includes(':'))
      type = this.#lookup.substructure(this.type, type, false).type
    if (!pltype)
      pltype = this.#lookup.payload(type)
    if (pltype !== true) {
      const oldErr = this.#lookup.err
      if (oldErr) this.#lookup.err = msg => oldErr(type+': '+msg)
      payload = G7Datatype.fromString(pltype, payload, this.#lookup)
      this.#lookup.err = oldErr
    }
    return new G7Structure(this.#lookup, type, payload, this)
  }
  
  /** A helper function to be called by G7Dataset.fromGEDC */
  gedcSubstructures(sub) {
    for(let s of sub) {
      const s7 = this.createSubstructure(s.tag, s.payload)
      s7.gedcSubstructures(s.sub)
    }
  }
  
  /**
   * Repair temporary GEDCStruct pointers with the given map,
   * or temporary xref strings with given map.
   * @param {Map<GEDCStruct,G7Structure>} map, or Map<string,G7Structure> for xref
   */
  fixPointers(map) {
    if (this.xref) {
      if (map.has(this.xref.substr(1))) {
        this.payload = map.get(this.xref.substr(1))
        this.payload?.#ref.add(this)
        if(this.payload && !this.payload.#id) this.payload.#id = this.xref.substr(1)
      } else {
        this.#lookup.err?.(`unmatched xref ${this.xref} in JSON input`)
        this.payload = null
      }
      delete this.xref
    } else {
      if (map.has(this.payload)) {
        this.payload = map.get(this.payload)
        this.payload.#ref.add(this)
        if(!this.payload.#id) this.payload.#id = this.#lookup.uniqueID()
      } else if (this.payload instanceof GEDCStruct) {
        this.#lookup.err?.('v7 forbids pointers to substructures')
        this.payload = null
      }
    }
    this.sub.forEach(v => v.forEach(e => e.fixPointers(map)))
  }
  
  /**
   * Verify that
   * - required substructures are present
   * - singular substructures are not present more than once
   * - this structure has either payload or substructures or both
   * - payload matches spec
   * - hard-code check for deprecated EXID without TYPE
   *
   * @return {Number} the number of errors found, or 0 if none found
   */
  validate() {
    let errors = 0
    const err = m => {
      errors += 1
      this.#lookup.err?.(m)
    }
    // remove emoty sub lists, if any
    this.sub.forEach((v,k,m) => { if (!v || v.length == 0) m.delete(k) })
    // check substructure cardinality
    if (this.type in this.#lookup.g7.substructure) {
      Object.values(this.#lookup.g7.substructure[this.type])
            .forEach(v => {
              if (v.cardinality?.[1] === '1' && !this.sub.has(v.type))
                err(`Missing substructure: ${this.type} requires a ${v.type}`)
              if (v.cardinality?.[3] === '1' && this.sub.has(v.type) && this.sub.get(v.type).length > 1)
                err(`Duplicate substructures: ${this.type} may have at most one ${v.type}`)
              
            })
    }
    // check for empty structures
    if (this.sub.size === 0 && (this.payload === undefined || this.payload?.length === 0 || this.payload?.isEmpty?.()))
      err(`Empty structure: ${this.type} with no substructure and no payload`)
    // check payload
    const plt = this.#lookup.payload(this.type)
    if (!checkDatatype(this.payload, plt))
      err(`Invalid payload: ${this.type} requires a ${plt.set || plt.to || plt.type}, not ${this.payload?.type || this.payload || "an empty payload"}`)
    // deprecation check for EXID.TYPE
    if (this.type == 'https://gedcom.io/terms/v7/EXID' && !this.sub.has('https://gedcom.io/terms/v7/EXID-TYPE'))
      warn(`Deprecated: Having an EXID without an EXID.TYPE substructure is deprecated`)
    // recursively
    this.sub.forEach(v => v.forEach(e => errors += e.validate()))
    return errors
  }
  
  /**
   * uses #lookup.schemaPrep to populate a schma map
   * @param {Map<string,string>} schma - a map of URI to tag for all used documented extensions
   */
  populateSchema(schma) {
    
    // struct
    this.#lookup.schemaPrep(this.type, 'struct', this.#sup?.type || '', schma)
    
    // enum
    if (this.payload instanceof G7Enum)
      this.#lookup.schemaPrep(this.payload.value, 'enum', this.type, schma)
    else if (Array.isArray(this.payload) && this.payload.length > 0 && this.payload[0] instanceof G7Enum)
      this.payload.forEach(e => this.#lookup.schemaPrep(e.value, 'enum', this.type, schma))
    
    // cal and month
    else if (this.payload instanceof G7Date) {
      this.#lookup.schemaPrep(this.payload.calendar, 'cal', this.type, schma)
      this.#lookup.schemaPrep(this.payload.month, 'month', this.payload.calendar, schma)
    }
    else if (this.payload instanceof G7DateValue) {
      this.#lookup.schemaPrep(this.payload.date?.calendar, 'cal', this.type, schma)
      this.#lookup.schemaPrep(this.payload.date?.month, 'month', this.payload.date?.calendar, schma)
      this.#lookup.schemaPrep(this.payload.date2?.calendar, 'cal', this.type, schma)
      this.#lookup.schemaPrep(this.payload.date2?.month, 'month', this.payload.date2?.calendar, schma)
    }
    
    // recur
    this.sub.forEach(v => v.forEach(e => e.populateSchema(schma)))
  }
  
  toGEDC(schma, ptrTargets, sup) {
    let tag = this.type
    if (tag.includes(':')) tag = this.#lookup.tag(this.type)
    if (tag && tag[0] != '_') { // check for relocation
      let expected = this.#lookup.g7.tagInContext.struct[this.#sup?.type || '']?.[this.type]
      if (expected !== tag) tag = this.#lookup.tag(this.type, true) // relocated tag instead
    }
    if (!tag || tag.includes(':')) throw Error("Failed to find tag for "+this.type)
    if (tag[0] == '_' && schma.has(this.type) && tag != schma.get(this.type))
      throw Error(`Schema lookup error: got ${tag}, expected ${schma.get(this.type)}`)
    let gedc
    if (this.payload === null || this.payload instanceof G7Structure) {
      gedc = new GEDCStruct(tag, sup, this.payload, undefined, this.#id) // FIXME: no pointers appear
    } else {
      gedc = new GEDCStruct(tag, sup, undefined, this.payload?.toString?.(), this.#id)
    }
    if (!sup) ptrTargets.set(this, gedc)
    this.sub?.forEach(v => v.forEach(e => e.toGEDC(schma, ptrTargets, gedc)))
    return gedc
  }
  
  toJSON() {
    const ans = {}
    if (this.#id) ans.id = this.#id
    if (this.payload instanceof G7Structure) {
      if (this.payload.#id) ans.xref = '#'+this.payload.#id
      else throw Error("FIX ME: add identifiers to all pointed-to structures")
    } else if (this.payload !== undefined) ans.payload = this.payload
    
    if (this.sub && this.sub.size > 0) {
      ans.sub = {}
      this.sub.forEach((v,k) => ans.sub[k] = v.map(e=>e.toJSON()))
    }
    return ans
  }
  
  /** To be called only by G7Dataset.fromJSON() */
  static fromJSON(lookup, sup, type, obj, ids) {
    const ans = new G7Structure(lookup, type, obj.payload, sup, obj.id)
    if (obj.id) {
      if (sup instanceof G7Structure) lookup.err?.(`v7 forbids pointers to substructures`)
      else if (ids.has(obj.id)) lookup.err?.(`duplicate id ${obj.id} in JSON`)
      else ids.set(obj.id, ans)
    }
    if (obj.xref) ans.xref = obj.xref
    if (obj.sub) Object.entries(obj.sub).forEach?.(([k,v]) => ans.sub.set(k, v.map(e=>G7Structure.fromJSON(lookup, ans, k, e, ids))))
    return ans
  }

  /**
   * Looks for a substructure of this structure that matches the given pattern.
   * The first argument is the structure type of the structure to find;
   * then the payload of the structure to find (or `-1` to match any payload);
   * then the structure type of a substructure of the structure to find;
   * then the payload of the substructure;
   * then the structure type of a substructure of the substructure of the structure;
   * and so on.
   * 
   * WARNING: The payload comparisons are done by converting to a string; this may give a false negative
   * if a non-canonical string is provided as the argument, such as
   * 
   * - a date with calendar GREGORIAN
   * - a date range or period with one blank calendar and one non-GREGORIAN calendar
   * - a time with a 1-digit hour
   * - an integer with leading zeros
   * 
   * @param {string} type - the URI of a structure type
   * @param {any} payload - a payload value, or -1 to match any payload
   * @param args - type, payload, type, payload, ... as long as desired
   * @returns {G7Structure|null} - a substructure of `this` that matches the request, or null if none found
   */
  find(type, payload, ...args) {
    if (!this.sub.has(type)) return null
    if (args.length == 1 && Array.isArray(args[0])) args = args[0] // allow calling as find(type, payload, [args])
    for(let candidate of this.sub.get(type)) {
      if (payload !== -1 && payload !== candidate.payload && String(payload) != String(candidate.payload)) continue
      if (args.length <= 0 || candidate.find.apply(candidate, args) !== null) return candidate
    }
    return null
  }
  
  /**
   * If {@link G7Structure#find} would return non-null with the provided arguments,
   * this method is equivalent to that method.
   * Otherwise, creates and returns a new substructure of this that matches the query.
   * 
   * @see G7Structure#find
   * @returns {G7Structure} - the existing or newly-created structure
   */
  findOrCreate(type, payload, ...args) {
    const found = this.find(type, payload, args)
    if (found !== null) return found

    const pltype = this.#lookup.payload(type)
    let root = null
    if (payload === -1) {
      if (pltype.type == 'pointer') root = this.createSubstructure(type, null, pltype)
      else root = this.createSubstructure(type, "")
    } else root = this.createSubstructure(type, payload)
    if (args.length > 0) this.findOrCreate.apply(root, args)
    return root
  }
}


/**
 * A dataset: a header and zero or more records
 */
class G7Dataset {
  /** The single required header of the dataset
   * @type {G7Structure}
   */
  header
  /** The records in the dataset, stored by type
   * @type {Map<string,G7Structure[]}
   */
  records = new Map()
  
  #lookup
  
  /**
   * If skipHeader is not false, creates HEAD.GEDC.VERS 7.0
   */
  constructor(lookup, skipHeader) {
    this.#lookup = lookup
    if (!('_usedIDs' in this.#lookup)) {
      this.#lookup._usedIDs = new Set()
      this.#lookup._nextID = 0
      this.#lookup.uniqueID = function(id) {
        if (!id || this._usedIDs.has(id)) {
          id = String(this._nextID++)
          while(this._usedIDs.has(id))
            id = String(this._nextID++)
        }
        this._usedIDs.add(id)
        return id
      }
    }
    if (!skipHeader) {
      this.header = new G7Structure(lookup, 'https://gedcom.io/terms/v7/HEAD')
      const g = this.header.createSubstructure('https://gedcom.io/terms/v7/GEDC')
      const v = g.createSubstructure('https://gedcom.io/terms/v7/GEDC-VERS', '7.0')
    }
  }

  /**
   * Verify that
   * - required substructures are present
   * - singular substructures are not present more than once
   * - each structure has either payload or substructures or both
   * - payload matches spec
   * - hard-code check for deprecated EXID without TYPE
   *
   * @return {Number} the number of errors found, or 0 if none found
   */
  validate() {
    let errors = 0
    if (!this.header) {
      this.#lookup.err?.('Missing required https://gedcom.io/terms/v7/HEAD')
      this.#lookup.err?.('Missing required https://gedcom.io/terms/v7/GEDC')
      this.#lookup.err?.('Missing required https://gedcom.io/terms/v7/GEDC-VERS')
      errors += 3
    } else {
      errors += this.header.validate()
    }
    this.records.forEach(a => a.forEach(r=> errors += r.validate()))
    return errors
  }

  /**
   * Creates a record (or header).
   * @param {string} type - a URI if has a colon, else a tag
   * @param payload - payload of the record, either encoded as a string or parsed as an object
   * @param pltype - may be a payload type definition; `true` meaning already checked and use as-is; or false meaning check the lookup and parse accordingly
   * @param {string} id - a suggested xref_id to use when pointing to this record
   */
  createRecord(type, payload, pltype, id) {
    if (!type.includes(':'))
      type = this.#lookup.substructure('', type, false).type
    if (!pltype)
      pltype = this.#lookup.payload(type)
    if (pltype !== true) {
      const oldErr = this.#lookup.err
      if (oldErr) this.#lookup.err = msg => oldErr(type+': '+msg)
      payload = G7Datatype.fromString(pltype, payload, this.#lookup)
      this.#lookup.err = oldErr
    }
    
    const rec = new G7Structure(this.#lookup, type, payload, this, id)
    
    if (type === 'https://gedcom.io/terms/v7/HEAD') {
      if (this.header) this.#lookup.err?.(`Only one header is allowed per dataset; additional headers ignored`)
      else this.header = rec
    } else if (this.records.has(type)) this.records.get(type).push(rec)
    else this.records.set(type, [rec])
    return rec
  }
  
  /**
   * Ensures the schema has all needed entries for used URIs
   */
  populateSchema() {
    const schma = new Map()
    this.header.populateSchema(schma)
    this.records.forEach(v => v.forEach(e => e.populateSchema(schma)))
    if(schma.size <= 1) this.header.sub.delete('https://gedcom.io/terms/v7/SCHMA')
    else {
      let ss
      if (!this.header.sub.has('https://gedcom.io/terms/v7/SCHMA'))
        ss = this.header.createSubstructure('https://gedcom.io/terms/v7/SCHMA')
      else {
        ss = this.header.sub.get('https://gedcom.io/terms/v7/SCHMA')[0]
      }
      for(let [uri,tag] of schma.entries()) {
        if ('string' == typeof uri) {
          const payload = tag+' '+uri
          let found = false
          for(let tdef of (ss.sub?.get('https://gedcom.io/terms/v7/TAG') || []))
            if (tdef.payload == payload) { found = true; break; }
          if (!found)
            ss.createSubstructure('https://gedcom.io/terms/v7/TAG', payload)
        }
      }
    }
    return schma
  }
  
  /**
   * Serializes the dataset into a list of GEDCStructs
   */
  toGEDC() {
    const ptrTargets = new WeakMap()
    const schma = this.populateSchema()
    const ans = [this.header.toGEDC(schma, ptrTargets)]
    this.records.forEach(v => v.forEach(e => ans.push(e.toGEDC(schma, ptrTargets))))
    ans.push(new GEDCStruct('TRLR'))
    ans.forEach(e => e.fixPtrMap(ptrTargets, this.#lookup.err))
    ans.toString = GEDCToString
    return ans
  }
  /**
   * Serializes the dataset into a GEDCOM 7 string
   */
  toString() { return this.toGEDC().toString() }

  /** Parse a GEDCOM string into a dataset
   * @param {string} str - the entire dataset as a GEDCOM string
   * @patam {G7Lookup} lookup
   */
  static fromString(str, lookup) {
    const src = GEDCStruct.fromString(src, g7ConfGEDC, lookup.err)
    return G7Dataset.fromGEDC(src, lookup)
  }
  /** Parse a list of GEDCStruct into a dataset
   * @param {GEDCStruct[]} src - the entire dataset parsed as tags
   * @patam {G7Lookup} lookup
   */
  static fromGEDC(src, lookup) {
    if (!Array.isArray(src) || src.length < 1)
      throw new TypeError('Must be given an non-empty array of GEDCStruct objects')
    if (src[0]?.tag !== 'HEAD') lookup.err?.('Must begin with HEAD')
    if (src[src.length-1].tag !== 'TRLR')
      lookup.err?.('Must end with TRLR')
    if (!/^7[.]0($|[.])/.test(src[0].querySelector('.HEAD.GEDC.VERS')?.payload))
      lookup.warn?.(`Expected HEAD.GEDC.VERS 7.0, not ${src[0].querySelector('.HEAD.GEDC.VERS')?.payload}`)
    let ans = new G7Dataset(lookup, src[0]?.tag === 'HEAD')
    for(let tagdef of src[0].querySelectorAll('.HEAD.SCHMA.TAG')) {
      let m = /^((?:[A-Z]|_[0-9_A-Z])[0-9_A-Z]*) (.+)$/u.exec(tagdef.payload)
      if (!m) lookup.err?.(`Invalid HEAD.SHMA.TAG ${tagdef.payload}`)
      else lookup.addExtension(m[1], m[2])
    }
    let ptrs = new WeakMap()
    for(let i=0; i<src.length-(src[src.length-1].tag === 'TRLR'); i+=1) {
      const gedc = src[i]
      if (gedc.tag == 'TRLR') {
        lookup.err?.('TRLR can only appear at the end of a dataset')
      } else {
        const rec = ans.createRecord(gedc.tag, gedc.payload, false, gedc.xref_id)
        ptrs.set(gedc, rec)
        rec.gedcSubstructures(gedc.sub)
      }
    }
    ans.header.fixPointers(ptrs)
    ans.records.forEach(a => a.forEach(r=>r.fixPointers(ptrs)))
    ans.header.validate()
    ans.records.forEach(a => a.forEach(r=>r.validate()))
    return ans
  }

  toJSON() {
    const ans = {header:this.header.toJSON(), records:{}}
    this.records.forEach((v,k) => ans.records[k] = v.map(e=>e.toJSON()))
    return ans
  }

  static fromJSON(obj, lookup) {
    const ptrs = new Map()
    const ans = new G7Dataset(lookup, true)
    ans.header = G7Structure.fromJSON(lookup, this, `https://gedcom.io/terms/v7/HEAD`, obj.header, ptrs)
    Object.entries(obj.records).forEach(([k,v]) => ans.records.set(k, v.map(e => G7Structure.fromJSON(lookup, this, k, e, ptrs))))
    ans.header.fixPointers(ptrs)
    ans.records.forEach((v,k) => v.forEach(e => e.fixPointers(ptrs)))
    return ans
  }




  /**
   * Like {@link G7Structure#find} but for records instead of substructures
   * 
   * @param {string} type - the URI of a record type
   * @param {any} payload - a payload value, or -1 to match any payload
   * @param args - type, payload, type, payload, ... as long as desired
   * @returns {G7Structure|null} - a record that matches the request, or null if none found
   */
  find(type, payload, ...args) {
    if (!this.records.has(type)) return null
    if (args.length == 1 && Array.isArray(args[0])) args = args[0] // allow calling as find(type, payload, [args])
    for(let candidate of this.records.get(type)) {
      if (payload !== -1 && payload !== candidate.payload && String(payload) != String(candidate.payload)) continue
      if (args.length <= 0 || candidate.find.apply(candidate, args) !== null) return candidate
    }
    return null
  }
  
  /**
   * Like {@link G7Structure#findOrCreate} but for records instead of substructures
   * 
   * @see G7Dataset#find
   * @returns {G7Structure} - the existing or newly-created record
   */
  findOrCreate(type, payload, ...args) {
    const found = this.find(type, payload, args)
    if (found !== null) return found

    const pltype = this.#lookup.payload(type)
    let root = null
    if (payload === -1) {
      if (pltype.type == 'pointer') root = this.createRecord(type, null, pltype)
      else root = this.createRecord(type, "")
    } else root = this.createRecord(type, payload)
    if (args.length > 0) root.findOrCreate.apply(root, args)
    return root
  }
}
