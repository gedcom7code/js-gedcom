/**
 * @module g7lookups
 * 
 * Wraps JSON from <https://github.com/FamilySearch/GEDCOM-registries>
 * with several useful functions, including handling of SCHMA.TAG.
 */
export { G7Lookups }


/**
 * Wraps g7validation.json from https://github.com/FamilySearch/GEDCOM-registries
 * with a dynamically-updatable list of documented extensions
 * to provide effective look-up of tags in various contexts
 * and reporting of undocumented extension tags
 * and documented-but-unregistered extension URIs
 */
class G7Lookups {
  /** reference to underlying definitions */
  g7
  
  /**
   * If set, used to report violations of the spec
   * @type {function}
   * @param {string} error message
   */
  err
  /**
   * If set, used to report not-recommended behaviors
   * @type {function}
   * @param {string} warning message
   */
  warn
  
  // helpers to avoid duplicate messages
  #olderr = new Set()
  #oldwarn = new Set()
  #err(msg) {
    if (this.#olderr.has(msg)) return
    this.#olderr.add(msg)
    this.err?.(msg)
  }
  #warn(msg) {
    if (this.#oldwarn.has(msg)) return
    this.#oldwarn.add(msg)
    this.warn?.(msg)
  }
  
  
  /** storage of documented extensions */
  #ext // Map with tag: [uri, uri]
  #extTag = {} // obj with uri: tag
  
  /** Logs documented extensions that are not registered in in g7 */
  unreg(msg) {
    this.#warn('\u261B Register extensions at https://github.com/FamilySearch/GEDCOM-registries \u261A')
    this.#warn(('Unregistered extension '+msg).replace('extension defined','extension-defined'))
  }
  /** Logs undocumented extensions */
  undoc(msg) {
    this.#warn('\u261B Document extensions using HEAD.SCHMA.TAG \u261A')
    this.#warn('Undocumented extension '+msg)
  }
  /** Reports ambiguous extensions: i.e., one tag with two URIs and insufficient information to pick which one to use */
  ambig(msg, asWarning) {
    if (asWarning) this.#warn('Ambiguous '+msg)
    else this.#err('Ambiguous '+msg)
  }
  /** Reports aliasing tags: an extension tag used where a standard tag exists */
  aliased(msg) {
    this.#warn('Aliased '+msg)
  }
    
  
  
  /**
   * Wrap an already-parsed specification JSON.
   * 
   * @see {@link make} for a method that fetches and parses JSON first
   * @param g7 - parsed JSON registry of tags
   * @param {function} err - called with errors; defaults to console.error
   * @param {function} warn - called with warnings; defaults to console.warn
   */
  constructor(g7, err, warn) {
    if ('object' != typeof g7 || !('substructure' in g7))
      throw new Error("Must be given a GEDCOM 7 specification object; try using G7Lookups.make instead")
    this.g7 = g7
    this.err = err === undefined ? console.error : err
    this.warn = warn === undefined ? console.warn : warn
    this.#ext = new Map()
    if (!('reqSubstr' in this.g7)) {
      this.g7.reqSubstr = Object.fromEntries(
          Object.entries(g7.substructure)
                .map(([uri,spec]) =>
                  [uri,
                   Object.values(spec)
                         .filter(e=>e.cardinality[1] == '1')
                         .map(e=>e.type)
                  ]
                ).filter(e => e[1].length > 0)
        )
    }
    
    // assemble aliases
    const alias = Symbol.for('alias')
    Object.values(g7.substructure).forEach(ss => {
      ss[alias] = new Map()
      Object.values(ss)
            .filter(v => !(v.type in ss))
            .forEach(v => ss[alias].set(v.type, v))
    })
    Object.values(g7.set).forEach(es => {
      es[alias] = new Map()
      Object.values(es)
            .filter(v => !(v in es))
            .forEach(v => es[alias].set(v, v))
    })
    Object.values(g7.calendar)
          .filter(cm => 'months' in cm)
          .forEach(cm => {
      cm.months[alias] = new Map()
      Object.values(cm.months)
            .filter(v => !(v in cm.months))
            .forEach(v => cm.months[alias].set(v, v))
    })
    g7.calendar[alias] = new Map()
    Object.values(g7.calendar)
          .filter(v => !(v.type in g7.calendar))
          .forEach(v => g7.calendar[alias].set(v.type, v))
    
    // assemble standard structure types that can be relocated
    const reloc = Symbol.for('reloc')
    g7[reloc] = new Map()
    for(let u in g7.payload)
      if (u in g7.tag && g7.tag[u][0] != '_') {
        const t = g7.tag[u]
        if (!g7[reloc].has(t)) g7[reloc].set(t,[])
        g7[reloc].get(t).push(u)
      }
  }
  
  /**
   * Fetches the JSON definition from the given URL,
   * which should be a local copy of or file in the same format as
   * <https://raw.githubusercontent.com/FamilySearch/GEDCOM-registries/main/generated_files/g7validation.json>
   * 
   * @param {string} url - the URL of a JSON file
   */
  static async make(url) {
    let json = await fetch(url).then(res => res.json())
    return new G7Lookups(json)
  }
  
  /** Registers a new extension tag. */
  addExtension(tag, uri) {
    if (!/_[A-Z0-9_]+/.test(tag)) {
      this.#err(`Malformed extension tag "${tag}"`)
      return
    }
    if (!uri.includes(':')) {
      this.#err(`Malformed URI "${uri}"`)
      return
    }
    if (!this.#ext.has(tag)) this.#ext.set(tag,[])
    if (this.#ext.get(tag).includes(uri)) return
    this.#ext.get(tag).push(uri)
    if (!(uri in this.#extTag)) this.#extTag[uri] = tag
    else this.warn?.(`New tag ${tag} superceded by existing ${this.#extTag[uri]} for ${uri}`)
  }

  /** Generic extension tag lookup:
   * the first URI for the tag in the SCHMA
   * of the tag itself if it is not in the SCHMA
   */
  misc(tag, prefix, ambigWarn) {
    if (tag[0] !== '_' && !tag.includes(':'))
      this.#err(`${tag} cannot be used as ${prefix}`)
    if (!this.#ext.has(tag)) {
      this.undoc(`${prefix} ${tag}`)
      return tag
    } else if (this.#ext.get(tag).length == 1) {
      this.unreg(`${prefix} ${this.#ext.get(tag)[0]}`)
      return this.#ext.get(tag)[0]
    } else {
      this.ambig(`${prefix} ${tag}\n  could be ${this.#ext.get(tag).join('\n        or ')}`, ambigWarn)
      return tag
    }
  }

  /** Looks up a calendar definition.
   * Defaults to `{type:URI}` if unregistered or `{type:tag}` if undocumented.
   */
  calendar(tag) {
    if (tag in this.g7.calendar) return this.g7.calendar[tag]
    if (tag[0] != '_') {
      this.#err(`Standard tag ${tag} cannot identify a calendar`)
    } else if (this.#ext.has(tag)) {
      const alias = Symbol.for('alias')
      let found = false
      for(let uri of this.#ext.get(tag)) {
        if (uri in this.g7.calendar || this.g7.calendar[alias]?.has(uri)) {
          if (found && found != uri) this.ambig(`calendar ${tag} matches both ${found} and ${uri}`)
          else found = uri
        }
      }
      if (found) {
        if (found in this.g7.calendar) return this.g7.calendar[found]
        this.aliased(`calendar ${found} with extTag ${tag}; use stdTag ${this.g7.tag[found]} instead`)
        return this.g7.calendar[alias].get(found)
      }
    }
    return {type:this.misc(tag,'calendar')}
  }

  /** Looks up a month's URI within a calendar definition.
   * Defaults to `tag` if undocumented.
   */
  month(cal, tag) {
    if (!('months' in cal)) return this.misc(tag, `calendar ${cal.type}'s month`)
    if (tag in cal.months) return cal.months[tag]
    if (tag[0] != '_') {
      this.#err(`calendar ${cal.type} does not have a month "${tag}"`)
    } else if (this.#ext.has(tag)) {
      const alias = Symbol.for('alias')
      let found = false
      for(let uri of this.#ext.get(tag)) {
        if (uri in cal.months || cal.months[alias]?.has(uri)) {
          if (found && found != uri) this.ambig(`${cal.type} month ${tag} matches both ${found} and ${uri}`)
          else found = uri
        }
      }
      if (found) {
        if (found in cal.months) return cal.months[found]
        this.aliased(`calendar ${cal.type} month ${found} with extTag ${tag}; use stdTag ${this.g7.tag[found]} instead`)
        return cal.months[alias].get(found)
      }
      this.#err(`calendar ${cal.type}'s months do not include "${this.#ext.get(tag).join(' or ')}"`)
    }
    return this.misc(tag, `calendar ${cal.type}'s month`)
  }
  
  /** Looks up the payload type definition for a given structure type
   * Defaults to `{type:"?"}` if unregistered or undocumented.
   */
  payload(uri) {
    if (uri in this.g7.payload) return this.g7.payload[uri]
    else return {type:"?"}
  }

  /** Looks up an enumeration value's URI within an enumeration set.
   * Defaults to tag if undocumented.
   */
  enumval(seturi, tag) {
    if (seturi in this.g7.set) {
      let set = this.g7.set[seturi]
      if (tag in set) return set[tag]
      if (tag[0] != '_')
        this.#err(`"${tag}" not permitted in enumeration set ${seturi}`)
          
      const alias = Symbol.for('alias')
      let found = false
      for(let uri of (this.#ext.get(tag)||[])) {
        if (uri in set || set[alias]?.has(uri)) {
          if (found && found != uri) this.ambig(`${seturi} element ${tag} matches both ${found} and ${uri}`)
          else found = uri
        }
      }
      if (found) {
        if (found in set) return set[found]
        this.aliased(`${seturi} element ${found} with extTag ${tag}; use stdTag ${this.g7.tag[found]} instead`)
        return set[alias].get(found)
      }
    }
    if (tag[0] != '_')
      this.#err(`"${tag}" not permitted in enumeration set ${seturi}`)

    return this.misc(tag, `enumeration set ${seturi} value`)
  }

  /** Looks up a substructure specification for a given tag within a an enumeration value's URI within an enumeration set.
   * Defaults to tag if undocumented.
   */
  substructure(uri,tag) {
    const pfx = uri?`substructure of ${uri}:`:'record'
    const alias = Symbol.for('alias')
    if (!(uri in this.g7.substructure)) {
      const reloc = this.g7[Symbol.for('reloc')]
      if (tag[0] != '_') {
        if (!reloc.has(tag))
          this.#warn(`Extension-defined ${pfx.replace(/:$/,'')} with novel tag ${tag}`)
        else if (reloc.get(tag).length == 1)
          this.unreg(`defined ${pfx} ${tag} recommended to mean ${reloc.get(tag)[0]}`)
        else if (uri && reloc.get(tag).filter(u=>!this.g7.substructure[''][alias].has(u)).length == 1)
          this.unreg(`defined ${pfx} ${tag} recommended to mean ${reloc.get(tag).filter(u=>!this.g7.substructure[''][alias].has(uri))[0]}`)
        else
          this.ambig(`extension-defined substructure ${tag}\n  could be ${reloc.get(tag).join('\n        or ')}`, true)
        return {
          cardinality: '{0:M}',
          type: tag,
        }
      } else {
        return {
          cardinality: '{0:M}',
          type: this.misc(tag,pfx),
        }
      }
    }
    if (tag in this.g7.substructure[uri])
      return this.g7.substructure[uri][tag]
    if (tag[0] != '_' && uri in this.g7.tag && this.g7.tag[uri][0] != '_')
      this.#err(`Prohibited ${pfx} ${tag}`)
    let found = false
    if (this.#ext.has(tag)) {
      for(let uri2 of this.#ext.get(tag)) {
        if (uri2 in this.g7.substructure[uri] || this.g7.substructure[uri][alias]?.has(uri2)) {
          if (found && found != uri2) this.ambig(`${pfx} ${tag} matches both ${found} and ${uri2}`)
          else found = uri2
        }
      }
    }
    if (found) {
      if (found in this.g7.substructure[uri])
        return this.g7.substructure[uri]?.[found]
      this.aliased(`${pfx} ${found} with extTag ${tag}; use stdTag ${this.g7.tag[found]} instead`)
      return this.g7.substructure[uri][alias].get(found)
    }
    
    return {
      cardinality: '{0:M}',
      type: this.misc(tag,pfx,true),
    }
  }
  /** Looks up the recommended tag to the URI.
   * If the second argument is true, prefers extTag over stdTag
   * Defaults to URI if none.
   */
  tag(uri, extFirst) {
    return (extFirst ? this.#extTag[uri] || this.g7.tag?.[uri] : this.g7.tag?.[uri] || this.#extTag[uri]) || uri
  }

  /** Looks up a list of required substrutures of a structure.
   * Defaults to `[]`
   */
  reqSubstr(uri) { return this.g7.reqSubstr[uri] || [] }


  /**
   * A function to assist in creating a GEDCOM 7 SCHMA.
   * If given an extension tag, that shall be undocumented
   * and any previous URI-tag mappings using it will get a new tag.
   * If given a URI in context, that shall be given a tag.
   * 
   * @param {string} tagOrURI - the tag or URI stored in the parsed data
   * @param {string} kind - one of {struct, enum, cal, month}
   * @param {string} within - the most directly containing structure
   * @param {Map<string, string>} schma - a uri-to-tag mapping that this function modifies
   */
  schemaPrep(type, kind, within, schma) {
    if (!type) return // empty string uri/tag (happens with dates sometimes)
    if (schma.has(type)) return // already handled

    const _used = Symbol.for('used')
    if (!schma.has(_used)) schma.set(_used, new Set())
    const used = schma.get(_used)

    if (!type.includes(':')) {
      // undocumented tag
      if (type[0] != '_') return // error? incomplete parsing of standard tag
      if (this.#ext.has(type)) { // conflict with undoc tag; rename documented
        let i = 1
        while (this.#ext.has(type+i) || used.has(type+i)) i += 1
        this.#ext.get(type).forEach(u => this.#extTag[u] = type+i)
        this.#ext.get(type).forEach(u => {
          if (schma.has(u) && schma.get(u) == type) {
            schma.set(u, type+i)
            used.add(type+i)
          }
        })
        this.#ext.set(type+i, this.#ext.get(type))
      }
      this.#ext.set(type, []) // place holder to avoid future naming conflicts
      used.add(type)
      return
    }

    // uri

    let tag1 = this.tag(type) // initial guess
    if (tag1.includes(':')) tag1 = undefined

    let tag2 // registered tag
    if (kind == 'struct') tag2 = this.g7.tagInContext.struct[within]?.[type] || '_'
    else if (kind == 'enum') tag2 = this.g7.tagInContext.enum[within]?.[type] || '_'
    else if (kind == 'cal') tag2 = this.g7.tagInContext.cal[type] || '_'
    else if (kind == 'month') tag2 = this.g7.tagInContext.month[within]?.[type] || '_'
    else throw Error('unexpected kind: '+kind)

    // case 1: standard in this context
    if (tag2 && tag2[0] != '_') return
    
    // case 2: already in schema
    if (type in this.#extTag) {
      let tag = this.#extTag[type]
      schma.set(type, tag)
      used.add(tag)
      return
    }
    
    // case 3: registered in this context
    if (tag2 && /^_./.test(tag2) || tag1 && /^_./.test(tag1)) {
      let tag = (tag1 && /^_./.test(tag1)) ? tag1 : tag2
      if ((this.#ext.has(tag) && this.#ext.get(tag) != type) || used.has(tag)) {
        let i = 1
        while (this.#ext.has(tag+i) || used.has(tag+i)) i += 1
        tag += i
      }
      schma.set(type, tag)
      used.add(tag)
      this.addExtension(tag, type)
      return
    }

    // case 4: standard but relocated
    if (tag1 && tag1[0] != '_') {
      let tag = '_'+tag1
      if ((this.#ext.has(tag) && this.#ext.get(tag) != type) || used.has(tag)) {
        let i = 1
        while (this.#ext.has(tag+i) || used.has(tag+i)) i += 1
        tag += i
      }
      schma.set(type, tag)
      used.add(tag)
      this.addExtension(tag, type)
      return
    }
    
    // case 5: registered but relocated
    if (tag1) {
      let tag = tag1
      if (tag == '_' || (this.#ext.has(tag) && this.#ext.get(tag) != type) || used.has(tag)) {
        let i = 1
        while (this.#ext.has(tag+i) || used.has(tag+i)) i += 1
        tag += i
      }
      schma.set(type, tag)
      used.add(tag)
      this.addExtension(tag, type)
      return
    }
    
    // case 6: unregistered, unknown URI
    let tag = G7Lookups.uriToTag(type) || '_EXT'
    if (tag == '_' || this.#ext.has(tag) || used.has(tag)) {
      let i = 1
      while (this.#ext.has(tag+i) || used.has(tag+i)) i += 1
      tag += i
    }
    schma.set(type, tag)
    used.add(tag)
    this.addExtension(tag, type)
    
  }

  /**
   * Tries to guess a good tag for a given URI.
   * Looks for a tag at the end of the URI,
   * or the only tag in the URI,
   * or an ending that can be converted to a tag.
   * 
   * @param {string} uri
   * @returns {string} a recommended extension tag, or undefined if none found
   */
  static uriToTag(uri) {
    var tail = /([^\/#?=&]+)\/?$/.exec(uri)[1]
    if (!tail) tail = uri
    if (/[A-Z][A-Z_0-9]+$/.test(tail)) return '_'+/[A-Z][A-Z_0-9]+$/.exec(tail)[0]
    const bits = tail.split(/([_A-Z][A-Z0-9_]+)/g)
    if (bits.length === 3) return (bits[1][0] === '_'?'_':'') + bits[1]
    if (/^[a-zA-Z0-9][-a-zA-Z0-9_]{1,14}$/.test(tail)) return '_'+tail.toUpperCase().replace(/[^A-Z0-9]/g, '_')
    return undefined
  }
}
