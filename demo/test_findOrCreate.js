import { GEDCStruct, g7ConfGEDC } from "../gedcstruct.js"
import { G7Lookups } from '../g7lookups.js'
import { G7Dataset } from '../g7structure.js'

const addError = (msg) => {
  const li = document.createElement('li')
  li.append(msg)
  document.getElementById('errors').append(li)
}
const addWarning = (msg) => {
  const li = document.createElement('li')
  li.append(msg)
  document.getElementById('warnings').append(li)
}

window.addEventListener('load', async () => {
  // parse the validation data and set up error logs
  const url = 'https://raw.githubusercontent.com/FamilySearch/GEDCOM-registries/main/generated_files/g7validation.json'
  window.g7validation = await fetch(url).then(res => res.json())
  window.g7v = new G7Lookups(g7validation)
  g7v.err = addError
  g7v.warn = addWarning
  document.getElementById('errors').innerHTML = ''
  document.getElementById('warnings').innerHTML = ''
  
  // make an empty dataset
  window.g7 = new G7Dataset(g7v)
  
  // add a person uniquely identified within this dataset by a REFN value
  let r1 = g7.findOrCreate('https://gedcom.io/terms/v7/record-INDI', -1,
                           'https://gedcom.io/terms/v7/REFN', 'Me')
  let r2 = g7.findOrCreate('https://gedcom.io/terms/v7/record-INDI', -1,
                           'https://gedcom.io/terms/v7/REFN', 'Me')
  if (r1 !== r2) console.error("should have created once and then returned what it created", r1, r2)

  // add a birth uniquely identified by a UUID and set it to an assertion the vent occured
  r1.findOrCreate('https://gedcom.io/terms/v7/BIRT', -1,
                  'https://gedcom.io/terms/v7/UID', 'e0f02fe9-cc9a-4dde-acd7-d2dde9477f94')
    .payload = 'Y'

  // grab that same birth again and add an inline source string to it
  r1.findOrCreate('https://gedcom.io/terms/v7/BIRT', -1,
                  'https://gedcom.io/terms/v7/UID', 'e0f02fe9-cc9a-4dde-acd7-d2dde9477f94')
    .createSubstructure('https://gedcom.io/terms/v7/SOUR',null)
    .createSubstructure('https://gedcom.io/terms/v7/PAGE',"I'm alive when writing this so I must have been born")
  
  // create a submitter record for myself
  let sub = g7.findOrCreate('https://gedcom.io/terms/v7/record-SUBM',-1,
                            'https://gedcom.io/terms/v7/NAME','Luther Tychonievich')
  
  // flag myself as the submitter of the INDI
  g7.findOrCreate('https://gedcom.io/terms/v7/record-INDI', -1,
                  'https://gedcom.io/terms/v7/REFN', 'Me')
    .findOrCreate('https://gedcom.io/terms/v7/SUBM', sub)
  
  // create a family uniquely identified within this dataset by an EXID value and its TYPE, and make me a child of the family
  g7.findOrCreate('https://gedcom.io/terms/v7/record-FAM', -1,
                  'https://gedcom.io/terms/v7/EXID', 'my-family',
                  'https://gedcom.io/terms/v7/EXID-TYPE', 'https://example.com/')
    .findOrCreate('https://gedcom.io/terms/v7/CHIL', r1)
  // required symmetry: add a FAMC to match the CHIL 
  r1.findOrCreate('https://gedcom.io/terms/v7/INDI-FAMC',
                  g7.findOrCreate('https://gedcom.io/terms/v7/record-FAM', -1,
                                  'https://gedcom.io/terms/v7/EXID', 'my-family',
                                  'https://gedcom.io/terms/v7/EXID-TYPE', 'https://example.com/'))
  
  // add a relocated standard structure, just to show we can
  sub.findOrCreate('https://gedcom.io/terms/v7/SUBM', sub)
  // add a documented extension structure, just to show we can
  sub.findOrCreate('https://example.com/Nonsense', 'Lorem ipsum')
  
  // validate that the data follows the validation rules
  g7.validate()
  
  // serialize it as a string
  document.getElementById('output').append(g7.toString())
})

