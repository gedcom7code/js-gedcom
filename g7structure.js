export { G7Structure, G7Dataset }
import { G7Datatype } from "./g7datatypes.js"
import { GEDCStruct, g7ConfGEDC } from "./gedcstruct.js"



class G7Structure {
  type
  payload
  sub
  #sup
  #ref
  #id
  #lookup
  
  // 4 ways of making:
  // dataset.createRecord
  // structure.createSubstructure
  // fromGEDC (also makes substructures; pointers need post-processing
  // fromJSON (also makes substructures; pointers need post-processing
  
  constructor(lookup, type, payload, sup, id) {
    this.#lookup = lookup
    this.type = type
    this.payload = payload
    this.#sup = sup
    this.sub = new Map()
    this.#ref = new WeakMap()
    if (sup instanceof G7Structure) {
      if (sup.sub.has(type)) sup.sub.get(type).push(this)
      else sup.sub.set(type, [this])
    }
    if (payload instanceof G7Structure) {
      payload.#ref.add(this)
    }
    this.#id = id
  }
  
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
  
  gedcSubstructures(sub) {
    for(let s of sub) {
      const s7 = this.createSubstructure(s.tag, s.payload)
      s7.gedcSubstructures(s.sub)
    }
  }
  
  fixPointers(map) {
    if (map.has(this.payload)) {
      this.payload = map.get(this.payload)
      this.payload.#ref.add(this)
    } else if (this.payload instanceof GEDCStruct) {
      this.#lookup.err?.('v7 forbids pointers to substructures')
      this.payload = null
    }
  }
}

class G7Dataset {
  header
  records
  #lookup
  
  /**
   * If skipHeader is not false, creates  minimal dataset: HEAD.GEDC.VERS and TRLR
   */
  constructor(lookup, skipHeader) {
    this.#lookup = lookup
    this.records = new Map()
    if (!skipHeader) {
      this.header = new G7Structure(lookup, 'https://gedcom.io/terms/v7/HEAD')
      const g = new G7Structure(lookup, 'https://gedcom.io/terms/v7/GEDC', this.header)
      const v = new G7Structure(lookup, 'https://gedcom.io/terms/v7/GEDC-VERS', g, '7.0')
    }
  }

  /**
   * Creates a record (or header).
   * @param {string} type - a URI if has a colon, else a tag
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

  static fromString(str, lookup) {
    const src = GEDCStruct.fromString(src, g7ConfGEDC, lookup.err)
    return G7Dataset.fromGEDC(src, lookup)
  }
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
    return ans
  }
}
