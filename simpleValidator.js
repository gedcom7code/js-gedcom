import { GEDCStruct, g7ConfGEDC } from "./gedcstruct.js"
import { G7Lookups } from './g7lookups.js'
import { G7Dataset } from './g7structure.js'

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
window.validateFile = fileList => {
  if (!window.g7validation) {
    addError("Failed to load GEDCOM 7 validation data from <a href='https://github.com/FamilySearch/GEDCOM-registries'>GEDCOM-registries/generated_files/g7validation.json</a>, which is required to perform validation")
    return
  }
  window.g7v = new G7Lookups(g7validation)
  if (!window.g7v) {
    addError("Failed to parse GEDCOM 7 validation data from <a href='https://github.com/FamilySearch/GEDCOM-registries'>GEDCOM-registries/generated_files/g7validation.json</a>, which is required to perform validation")
    return
  }

  g7v.err = addError
  g7v.warn = addWarning

  document.getElementById('errors').innerHTML = ''
  document.getElementById('warnings').innerHTML = ''
  if (fileList.length != 1) return
  var fr = new FileReader();
  fr.addEventListener('load', evt => {
    var data = evt.target.result
    try {
      window.gedc = GEDCStruct.fromString(data, g7ConfGEDC, g7v.err)
      if (!Array.isArray(window.gedc) || window.gedc.length == 0) {
        addError("File does not appear to contain GEDCOM data")
      }
      if (document.getElementById('errors').childElementCount > 0) {
        addWarning("Errors parsing syntax; version 7 structures not checked")
      } else {
        window.ged7 = G7Dataset.fromGEDC(gedc, g7v)
      }
    } catch(error) {
      addError(error.message+"\nUnrecoverable error; parsing halted")
    }
  })
  fr.readAsText(fileList[0], 'utf-8')
}



window.addEventListener('load', async () => {
  const url = 'https://raw.githubusercontent.com/FamilySearch/GEDCOM-registries/main/generated_files/g7validation.json'
  window.g7validation = await fetch(url).then(res => res.json())
})

