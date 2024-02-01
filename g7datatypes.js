/**
 * @module g7datatypes
 * 
 * Many methods in the classes in this file depend on 
 * a G7Lookups object named `lookup` (see `g7lookups.js`)
 */
export { G7Age, G7Date, G7DateValue, G7Time, G7Enum, G7Datatype, checkDatatype }

class G7Datatype {
  
  constructor() { throw new Error("Use fromString or fromJSON instead"); }
  
  /**
   * Parses a payload encoded as a JSON value into a payload object
   * 
   * @param {Object|string} o - the JSON value to parse
   * @param {G7Lookups} lookup
   */
  static fromJSON(o, lookup) {
    if ('object' != typeof o) return o
    if ('calendar' in o) return new G7Date(o, lookup)
    if ('type' in o) return new G7DateValue(o, lookup)
    if ('hour' in o) return new G7Time(o, lookup)
    if ('value' in o) return new G7Enum(o, lookup)
    return new G7Age(o, lookup) // might be {} so no "in" check
  }

  /**
   * Parses a payload string into a payload object
   * 
   * @param {object} type - the datatype definition; type.type is a URI, may have other fields for some datatypes
   * @param {string} payload - the string to parse
   * @param {G7Lookups} lookup
   */
  static fromString(pltype, str, lookup) {
    if (str && 'string' != typeof str) return str
    switch(pltype.type) {
      case '?':
        return str
      case null:
        if (str) lookup.err?.(`no payload allowed`)
        return undefined
      case 'pointer':
        if (str !== null) lookup.err?.(`pointer payload expected, not ${JSON.stringify(str)}`)
        return null
      case 'http://www.w3.org/2001/XMLSchema#nonNegativeInteger':
        if (/^[0-9]+$/.test(str)) return Number(str)
        lookup.err?.(`integer payload expected, not ${JSON.stringify(str)}`)
        return 0
      case 'https://gedcom.io/terms/v7/type-Age':
        return new G7Age(str, lookup)
      case 'https://gedcom.io/terms/v7/type-Date':
        return new G7DateValue(str, lookup)
      case 'https://gedcom.io/terms/v7/type-Date#period':
        {
          const ans = new G7DateValue(str, lookup)
          if (ans.type != 'DatePeriod' && ans.type != 'empty') {
            lookup.err?.(`Expected DatePeriod, not ${ans.type}`)
            ans.type = 'empty'
            ans.date = undefined
            ans.date2 = undefined
          }
          return ans
        }
      case 'https://gedcom.io/terms/v7/type-Date#exact':
        if (/^[0-9]+ (JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) [0-9]+$/.test(str))
          return new G7Date(str, lookup)
        lookup.err?.(`Invalid DateExact: ${JSON.stringify(str)}`)
        return new G7Date("1 JAN 0", lookup)
      case 'https://gedcom.io/terms/v7/type-Time':
        return new G7Time(str, lookup)
      case 'https://gedcom.io/terms/v7/type-List#Text':
        {
          const ans = str.split(/\s*,\s*/g)
          ans.toString = function(){return this.join(', ')}
          return ans
        }
      case 'https://gedcom.io/terms/v7/type-Enum':
        return new G7Enum(lookup.enumval(pltype.set, str), lookup)
      case 'https://gedcom.io/terms/v7/type-List#Enum':
        {
          const ans = str.split(/\s*,\s*/g).map(s => new G7Enum(lookup.enumval(pltype.set, s), lookup))
          ans.toString = function(){return this.join(', ')}
          return ans
        }
      case 'Y|<NULL>':
        if (str && str !== 'Y') lookup.err?.(`Expected "Y" or "", not ${JSON.stringify(str)}`)
        return str === 'Y' ? 'Y' : ''
      case 'https://gedcom.io/terms/v7/type-Name':
        if (!/^[^\0-\x1f\/]*(\/[^\0-\x1f\/]*\/[^\0-\x1f\/]*)?$/.test(str)) {
          lookup.err?.(`Invalid personal name ${JSON.stringify(str)}; replacing "/" with "\u2044"`)
          return str.replaceAll('/','\u2044')
        } else return str
      case 'http://www.w3.org/2001/XMLSchema#Language':
        if(!/^[a-zA-Z]{2,3}(-[a-zA-Z]{3}){0,3}|[a-zA-Z]{4,8}(-[a-zA-Z]{4})?(-[a-zA-Z]{2}|[0-9]{3})?(-[a-zA-Z]{5,8}|[0-9][a-zA-Z0-9]{3})*(-[0-9A-WY-Za-wy-z](-[a-zA-Z0-9]{2,8})+)*(-x(-[a-zA-Z0-9]{1,8})+)?|x(-[a-zA-Z0-9]{1,8})+|en-GB-oed|i-(ami|bnn|default|enochian|hak|klingon|lux|mingo|navajo|pwn|tao|tay|tsu)|sgn-(BE-(FR|NL)|CH-DE)$/.test(str)) {
          lookup.err?.(`Invalid language tag ${JSON.stringify(str)}; using "und" instead`)
          return `und`
        } else return str
      case 'http://www.w3.org/ns/dcat#mediaType':
        if (!/^[!-'*-+\--.0-9A-Z^-}]+\/[!-'*-+\--.0-9A-Z^-}]+(;[!-'*-+\--.0-9A-Z^-}]+\=([!-'*-+\--.0-9A-Z^-}]+|("(\\.|[^\\"\r])*")))*$/.test(str)) {
          lookup.err?.(`Invalid media type ${JSON.stringify(str)}; using "application/octet-stream" instead`)
          return "application/octet-stream"
        } else return str
      case 'http://www.w3.org/2001/XMLSchema#string':
        return str || ''
      default:
        lookup.warn?.(`parser does not understand datatype ${pltype.type}; leaving as-is`)
        return str
    }
  }
}

/**
 * @param payload - a payload of any type
 * @plt {Object} - a payload type definition object
 */
function checkDatatype(payload, plt) {
  switch(plt.type) {
    case '?': return true
    case null: return payload === undefined
    case 'pointer': 
      return payload === null || (payload?.type === plt.to)
    case 'http://www.w3.org/2001/XMLSchema#nonNegativeInteger': return 'number' === typeof payload && (0|payload) == payload && payload >= 0
    case 'https://gedcom.io/terms/v7/type-List#Text': return Array.isArray(payload) && payload.map(e => 'string' == typeof e).reduce((x,y)=>x&&y, true)
    case 'https://gedcom.io/terms/v7/type-List#Enum': return Array.isArray(payload) && payload.map(e => e instanceof G7Enum).reduce((x,y)=>x&&y, true)
    case 'https://gedcom.io/terms/v7/type-Date': return payload instanceof G7DateValue
    case 'https://gedcom.io/terms/v7/type-Date#exact': return payload instanceof G7Date && payload.calendar === 'https://gedcom.io/terms/v7/cal-GREGORIAN' && payload.day !== undefined
    case 'https://gedcom.io/terms/v7/type-Date#period': return payload instanceof G7DateValue && (payload.type === 'empty' || payload.type === 'DatePeriod')
    case 'https://gedcom.io/terms/v7/type-Enum': return payload instanceof G7Enum
    case 'https://gedcom.io/terms/v7/type-Age': return payload instanceof G7Age
    case 'https://gedcom.io/terms/v7/type-Time': return payload instanceof G7Time
    case 'Y|<NULL>': return !payload || payload === 'Y'
    case 'https://gedcom.io/terms/v7/type-Name': return 'string' == typeof payload && payload && /^[^\0-\x1f\/]*(\/[^\0-\x1f\/]*\/[^\0-\x1f\/]*)?$/.test(payload)
    case 'http://www.w3.org/2001/XMLSchema#Language': return 'string' == typeof payload && /^[a-zA-Z]{2,3}(-[a-zA-Z]{3}){0,3}|[a-zA-Z]{4,8}(-[a-zA-Z]{4})?(-[a-zA-Z]{2}|[0-9]{3})?(-[a-zA-Z]{5,8}|[0-9][a-zA-Z0-9]{3})*(-[0-9A-WY-Za-wy-z](-[a-zA-Z0-9]{2,8})+)*(-x(-[a-zA-Z0-9]{1,8})+)?|x(-[a-zA-Z0-9]{1,8})+|en-GB-oed|i-(ami|bnn|default|enochian|hak|klingon|lux|mingo|navajo|pwn|tao|tay|tsu)|sgn-(BE-(FR|NL)|CH-DE)$/.test(payload)
    case 'http://www.w3.org/ns/dcat#mediaType': return 'string' == typeof payload && /^[!-'*-+\--.0-9A-Z^-}]+\/[!-'*-+\--.0-9A-Z^-}]+(;[!-'*-+\--.0-9A-Z^-}]+\=([!-'*-+\--.0-9A-Z^-}]+|("(\\.|[^\\"\r])*")))*$/.test(payload)
    default: return !payload || 'string' == typeof payload
  }
}



/**
 * An object representing the datatype https://gedcom.io/terms/v7/type-Age
 */
class G7Age {
  /** `'<'` or `'>'` or `undefined`; if defined, so is at least one other field */
  mod
  /** non-negative integer, or `undefined` */
  years
  /** non-negative integer, or `undefined` */
  months
  /** non-negative integer, or `undefined` */
  weeks
  /** non-negative integer, or `undefined` */
  days

  constructor(payload, lookup) {
    if (!payload) return // empty is OK
    if ('object' == typeof payload) { // JSON
      Object.entries(payload).forEach(([k,v]) => {
        if (!(k in this)) lookup.err?.(`Can't set ${k} of a G7Age`)
        else this[k] = v
      })
      return
    }
    let m = /^(?:([<>]))?(?:([0-9]+)y(?: |$))?(?:([0-9]+)m(?: |$))?(?:([0-9]+)w(?: |$))?(?:([0-9]+)d)?$/.exec(payload)
    if (!m || (!m[2] && !m[3] && !m[4] && !m[5])) {
      lookup.err?.(`Invalid age: ${JSON.stringify(payload)}`)
      this.mod = '>'
      this.years = 0
      return
    }
    this.mod = m[1]
    this.years = m[2] ? Number(m[2]) : undefined
    this.months = m[3] ? Number(m[3]) : undefined
    this.weeks = m[4] ? Number(m[4]) : undefined
    this.days = m[5] ? Number(m[5]) : undefined   
  }
  toString() {
    let ans = this.mod || ''
    if (this.years) ans += this.years+'y '
    if (this.months) ans += this.months+'m '
    if (this.weeks) ans += this.weeks+'w '
    if (this.days) ans += this.days+'d'
    return ans.trim()
  }
  
  isEmpty() { return this.years === undefined && this.months === undefined && this.weeks === undefined && this.days === undefined }
}

/**
 * An object representing the `date` production that is part of various date datatypes
 */
class G7Date {
  /** URI of a calendar; always set */
  calendar
  /** non-negative integer; always set */
  year
  /** URI of a month in the calendar, or `undefined` */
  month
  /** non-negative integer, or `undefined` */
  day
  /** tag of an epoch in the calendar, or `undefined` */
  epoch
  #lookup

  constructor(payload, lookup) {
    this.#lookup = lookup
    if ('object' === typeof payload) {
      Object.entries(payload).forEach(([k,v]) => {
        if (!(k in this)) lookup.err?.(`Can't set ${k} of a G7Date`)
        else this[k] = v
      })
      return
    }
    let m = /^(?:(GREGORIAN|JULIAN|FRENCH_R|HEBREW|_[A-Z0-9_]+) )?(?:(?:([0-9]+) )?([A-Z_][A-Z0-9_]+) )?([0-9]+)(?: (BCE|_[A-Z0-9_]+))?$/.exec(payload)
    if (!m) {
      lookup.err?.(`Invalid date: ${JSON.stringify(payload)}`)
      this.calendar = '_ERROR'
      this.year = 0
      return
    }
    let cal = lookup.calendar(m[1] || 'GREGORIAN')
    this.calendar = cal.type
    this.year = Number(m[4])
    if (m[3]) {
      this.month = lookup.month(cal, m[3])
    }
    this.day = m[2] && Number(m[2])
    if (m[5]) {
      if ('epochs' in cal) {
        if (cal.epochs.includes(m[5])) this.epoch = m[5]
        else lookup.err?.(`Invalid epoch ${m[5]} in calendar ${this.calendar}`)
      } else {
        this.epoch = m[5]
      }
    }
  }

  /**
   * @param {bool} showGregorian - if true, use "GREGORIAN" instead of ""
   */
  toString(showGregorian) {
    let ans = ''
    if (showGregorian || this.calendar != 'https://gedcom.io/terms/v7/cal-GREGORIAN')
      ans += this.#lookup.tag(this.calendar)+' '
    if (this.day !== undefined) ans += this.day+' '
    if (this.month !== undefined) ans += this.#lookup.tag(this.month)+' '
    ans += this.year
    if (this.epoch !== undefined) ans += ' '+this.epoch
    return ans
  }
}

/**
 * An object representing the datatype https://gedcom.io/terms/v7/type-Date
 * and the datatype https://gedcom.io/terms/v7/type-Date#period
 */
class G7DateValue {
  /** One of: `"dateRange"`, `"DatePeriod"`, `"date"`, `"ABT"`, `"CAL"`, `"EST"`, `"empty"` */
  type
  /** a G7Date, or `undefined`; the only date, or start dare of a window */
  date
  /** a G7Date, or `undefined`; the end dare of a window */
  date2
  constructor(payload, lookup) {
    if ('object' === typeof payload) {
      this.type = payload.type
      if (payload.date) this.date = new G7Date(payload.date, lookup)
      if (payload.date2) this.date2 = new G7Date(payload.date2, lookup)
      return
    }
    let m = /^(ABT|CAL|EST) (.*)$|^BET (.*) AND (.*)$|^BEF (.*)$|^AFT (.*)$|^FROM (.*) TO (.*)$|^FROM (.*)$|^TO (.*)$|^(.+)$/.exec(payload)
    if (!m) {
      if (payload) lookup.err?.(`Invalid date ${JSON.stringify(payload)}`)
      this.type = 'empty'
    } else if (m[1]) {
      this.type = m[1]
      this.date = new G7Date(m[2], lookup)
    } else if (m[3]) {
      this.type = 'dateRange'
      this.date = new G7Date(m[3], lookup)
      this.date2 = new G7Date(m[4], lookup)
    } else if (m[5]) {
      this.type = 'dateRange'
      this.date2 = new G7Date(m[5], lookup)
    } else if (m[6]) {
      this.type = 'dateRange'
      this.date = new G7Date(m[6], lookup)
    } else if (m[7]) {
      this.type = 'DatePeriod'
      this.date = new G7Date(m[7], lookup)
      this.date2 = new G7Date(m[8], lookup)
    } else if (m[9]) {
      this.type = 'DatePeriod'
      this.date = new G7Date(m[9], lookup)
    } else if (m[10]) {
      this.type = 'DatePeriod'
      this.date2 = new G7Date(m[10], lookup)
    } else if (m[11]) {
      this.type = 'date'
      this.date = new G7Date(m[11], lookup)
    } else {
      if (payload) lookup.err?.(`Invalid date ${JSON.stringify(payload)}`)
      this.type = 'empty'
    }
  }
  toString() {
    if (this.type == 'empty') return ''
    else if (this.type == 'date') return this.date.toString(false)
    else if (this.type == 'ABT' || this.type == 'CAL' || this.type == 'EST') {
      return this.type+' '+this.date.toString(false)
    } else if (this.type == 'dateRange') {
      if (this.date && this.date2)
        return 'BET '+this.date.toString(this.date.calendar != this.date2.calendar)+' AND '+this.date2.toString(this.date.calendar != this.date2.calendar)
      else if (date)
        return 'AFT '+this.date.toString(false)
      else
        return 'BEF '+this.date.toString(false)
    } else if (this.type == 'DatePeriod') {
      if (this.date && this.date2)
        return 'FROM '+this.date.toString(this.date.calendar != this.date2.calendar)+' TO '+this.date2.toString(this.date.calendar != this.date2.calendar)
      else if (this.date)
        return 'FROM '+this.date.toString(false)
      else
        return 'TO '+this.date.toString(false)
    } else {
      throw new Error(`Cannot serialize unknown date type ${this.type}`)
    }
  }

  isEmpty() { return this.type === 'empty' }
}

/**
 * An object representing the datatype https://gedcom.io/terms/v7/type-Time
 */
class G7Time {
  /** non-negative integer in 24-hour clock */
  hour
  /** non-negative integer */
  minute
  /** non-negative real number, or `undefined` */
  second
  /** `"Z"`, or `undefined` */
  tz
  constructor(payload, lookup) {
    if ('object' == typeof payload) { // JSON
      Object.entries(payload).forEach(([k,v]) => {
        if (!(k in this)) lookup.err?.(`Can't set ${k} of a G7Age`)
        else this[k] = v
      })
      return
    }
    let m = /^([01]?[0-9]|2[0-3]):([0-5][0-9])(?::([0-5][0-9](?:[.][0-9]+)?))?(?:(Z))?$/.exec(payload)
    if (!m) {
      lookup.err?.(`Invalid time: ${JSON.stringify(payload)}`)
      this.hour = 0
      this.minute = 0
    } else {
      this.hour = Number(m[1])
      this.minute = Number(m[2])
      this.second = m[3] && Number(m[3])
      this.tz = m[4]
    }
  }
  toString() {
    return (100+this.hour).toString().substr(1) + ':' + (100+this.minute).toString().substr(1) + (this.second === undefined ? '' : ':'+(100+this.second).toString().substr(1)) + (this.tz || "")
  }
}

/**
 * An object representing the datatype https://gedcom.io/terms/v7/type-Enum
 */
class G7Enum {
  value
  #lookup
  constructor(uri, lookup) { 
    this.#lookup = lookup
    if ('object' == typeof uri) this.value = uri.value
    else this.value = uri
  }
  toString() { return this.#lookup.tag(this.value) }
}


