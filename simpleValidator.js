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
  document.getElementById('errors').innerHTML = ''
  document.getElementById('warnings').innerHTML = ''
  if (!window.g7v) {
    addError("Failed to load GEDCOM 7 validation data from <a href='https://github.com/FamilySearch/GEDCOM-registries'>GEDCOM-registries/generated_files/g7validation.json</a>, which is required to perform validation")
    return
  }
  if (fileList.length != 1) return
  var fr = new FileReader();
  fr.addEventListener('load', evt => {
    var data = evt.target.result
    console.log(data)
    try {
      window.gedc = GEDCStruct.fromString(data, g7ConfGEDC, g7v.err)
    } catch(error) {
      addError(error.message)
    }
    if (!Array.isArray(window.gedc) || window.gedc.length == 0) {
      addError("File does not appear to contain GEDCOM data")
    }
    if (document.getElementById('errors').childElementCount > 0) {
      addWarning("Errors parsing syntax; version 7 structures not checked")
    } else {
      window.ged7 = G7Dataset.fromGEDC(gedc, g7v)
    }
  })
  fr.readAsText(fileList[0], 'utf-8')
}



window.addEventListener('load', async () => {
  window.g7v = await G7Lookups.make('https://raw.githubusercontent.com/FamilySearch/GEDCOM-registries/main/generated_files/g7validation.json')
  g7v.err = addError
  g7v.warn = addWarning
})

