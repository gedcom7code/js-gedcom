export { G7Structure, G7Dataset }
import { G7Datatype, checkDatatype } from "./g7datatypes.js"
import { GEDCStruct, g7ConfGEDC } from "./gedcstruct.js"



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
   * Repair temporary GEDCStruct pointers with the given map
   * @param {Map<GEDCStruct,G7Structure>} map
   */
  fixPointers(map) {
    if (map.has(this.payload)) {
      this.payload = map.get(this.payload)
      this.payload.#ref.add(this)
    } else if (this.payload instanceof GEDCStruct) {
      this.#lookup.err?.('v7 forbids pointers to substructures')
      this.payload = null
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
   */
  validate() {
    // remove emoty sub lists, if any
    this.sub.forEach((v,k,m) => { if (!v || v.length == 0) m.delete(k) })
    // check substructure cardinality
    if (this.type in this.#lookup.g7.substructure) {
      Object.values(this.#lookup.g7.substructure)
            .forEach(v => {
              if (v.cardinality?.[1] === '1' && !this.sub.has(v.type))
                this.#lookup.err?.(`Missing substructure: #{this.type} requires a ${v.type}`)
              if (v.cardinality?.[3] === '1' && this.sub.has(v.type) && this.sub.get(v.type).length > 1)
                this.#lookup.err?.(`Duplicate substructures: #{this.type} may have at most one ${v.type}`)
              
            })
    }
    // check for empty structures
    if (this.sub.size === 0 && (this.payload === undefined || this.payload?.length === 0 || this.payload?.isEmpty?.()))
      this.#lookup.err?.(`Empty structure: ${this.type} with no substructure and no payload`)
    // check payload
    const plt = this.#lookup.payload(this.type)
    if (!checkDatatype(this.payload, plt))
      this.#lookup.err?.(`Invalid payload: ${this.type} requires a ${plt.set || plt.to || plt.type}, not ${this.payload?.type || this.payload || "an empty payload"}`)
    // deprecation check for EXID.TYPE
    if (this.type == 'https://gedcom.io/terms/v7/EXID' && !this.sub.has('https://gedcom.io/terms/v7/EXID-TYPE'))
      this.#lookup.warn?.(`Deprecated: Having an EXID without an EXID.TYPE substructure is deprecated`)
    // recursively
    this.sub.forEach(v => v.forEach(e => e.validate()))
  }
}

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
    if (!skipHeader) {
      this.header = new G7Structure(lookup, 'https://gedcom.io/terms/v7/HEAD')
      const g = new G7Structure(lookup, 'https://gedcom.io/terms/v7/GEDC', this.header)
      const v = new G7Structure(lookup, 'https://gedcom.io/terms/v7/GEDC-VERS', g, '7.0')
    }
  }

  /**
   * Creates a record (or header).
   * @param {string} type - a URI if has a colon, else a tag
   * @param payload - payload of the record, either encoded as a string or parsed as an object
   * @param pltype - may be a payload type definition; `true` meaning already checked and use as-is; or false meaning check the lookup and parse accordingly
   */
  createRecord(type, payload, pltype) {
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
    
    const rec = new G7Structure(this.#lookup, type, payload, this)
    
    if (type === 'https://gedcom.io/terms/v7/HEAD') {
      if (this.header) this.#lookup.err?.(`Only one header is allowed per dataset; additional headers ignored`)
      else this.header = rec
    } else if (this.records.has(type)) this.records.get(type).push(rec)
    else this.records.set(type, [rec])
    return rec
  }

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
        const rec = ans.createRecord(gedc.tag, gedc.payload, false)
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
}
