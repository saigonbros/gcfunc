const { google } = require('googleapis')
const { Storage } = require('@google-cloud/storage')
const Neode = require('neode')
const { v4: uuidv4 } = require('uuid')

// const SPREADSHEET_ID = '1WPebDacBSSLFwdQX9Z9uZD0NpwX4YUvRLknsrzPqcb4' // -local
const SPREADSHEET_ID = '11e-2TIrPwBrkXfbkjD_hwpzmcnIY1EDOmKMGXwSOK0Y'
// const LOGS_SHEET_ID = 2142188353 // -local
const LOGS_SHEET_ID = 584155013
const ENTRY_BUCKET = 'saidong'
const DEST_BUCKET = 'saidong-production'

async function updateSheetsLogs (googleSheetsInstance, value) {
  const dateTime = new Date().toISOString()
  // insert a blank new row at index 0
  await googleSheetsInstance.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: {
      requests: [{
        insertDimension: {
          range: {
            sheetId: LOGS_SHEET_ID,
            dimension: 'ROWS',
            startIndex: 0,
            endIndex: 1
          }
        }
      }]
    }
  })
  return googleSheetsInstance.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: {
      valueInputOption: 'RAW',
      data: [{
        range: 'logs!A1:B1',
        values: [[dateTime, value]]
      }]
    }
  })
}

/**
 * Triggered from a change to a Cloud Storage bucket.
 *
 * @param {!Object} event Event payload.
 * @param {!Object} context Metadata for the event.
 */
exports.helloGCS = async (event, context) => {
  const gcsEvent = event

  const map = {
    ImageUID: 18,
    LogoImageUID: 19,
    CreatedAt: 20,
    UpdatedAt: 21
  }

  console.log('----------------------------------------')
  console.log(gcsEvent.name)
  console.log('----------------------------------------')

  const storage = new Storage()

  const auth = new google.auth.GoogleAuth({
    keyFile: '/etc/secrets/googleapis',
    scopes: 'https://www.googleapis.com/auth/spreadsheets'
  })
  const authClientObject = await auth.getClient()
  const googleSheetsInstance = google.sheets({
    version: 'v4',
    auth: authClientObject
  })

  const instance = new Neode(
    process.env.NEO4J_URI,
    process.env.NEO4J_USERNAME,
    process.env.NEO4J_PASSWORD

  )

  // 1. strip the extension and underscores from file name
  let name = gcsEvent.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ')

  console.log({ name })

  const isLogo = !!(name.match(/-logo$/))

  console.log({ isLogo })

  name = name.replace(/-logo$/, '')

  console.log({ name })

  let business = await instance.cypher('MATCH (b:Business) WHERE b.name =~ $name RETURN b;', {
    name: `(?i)${name}`
  })

  if (business.records.length !== 1) {
    await updateSheetsLogs(googleSheetsInstance, `Error: unable to find business "${name}" (${gcsEvent.name})`)
    return
  }

  business = business.records[0].get('b').properties
  const uuid = uuidv4()

  // yeah I should actually check for errors...
  if (isLogo) {
    await instance.cypher('MATCH(b:Business) WHERE b.uid = $uid SET b.logo_image = $logo_image RETURN b;', {
      uid: business.uid,
      logo_image: uuid
    })
  } else {
    await instance.cypher('MATCH(b:Business) WHERE b.uid = $uid SET b.image = $image RETURN b;', {
      uid: business.uid,
      image: uuid
    })
  }

  await storage.bucket(ENTRY_BUCKET)
    .file(gcsEvent.name)
    .copy(storage.bucket(DEST_BUCKET).file(uuid + '.png'))

  await storage.bucket(ENTRY_BUCKET)
    .file(gcsEvent.name)
    .delete()

  // append value to businesses table
  const businesses = (await googleSheetsInstance.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'businesses!A2:D'
  })).data.values

  console.log(businesses)
  const i = businesses.findIndex((b) => b[0].toLowerCase().replace(/_/g, '_') === name.toLowerCase())
  console.log({ i })

  let range = ''

  if (isLogo) {
    range = 'businesses!T' + (i + 2)
  } else {
    range = 'businesses!S' + (i + 2)
  }

  await updateSheetsLogs(googleSheetsInstance, `Success: Updated business "${name}" with image "${uuid}" isLogo: ${isLogo}, range: ${range}`)

  const result = await googleSheetsInstance.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: {
      valueInputOption: 'RAW',
      data: [{
        range,
        values: [[uuid]]
      }]
    }
  })

  console.log(result)

  instance.close()
}
