const { google } = require('googleapis')
const Neode = require('neode')

const SPREADSHEET_ID = '1WPebDacBSSLFwdQX9Z9uZD0NpwX4YUvRLknsrzPqcb4'

/**
 * Triggered from a change to a Cloud Storage bucket.
 *
 * @param {!Object} event Event payload.
 * @param {!Object} context Metadata for the event.
 */
exports.helloGCS = async (event, context) => {
  const gcsEvent = event

  const instance = new Neode(
    process.env.NEO4J_URI,
    process.env.NEO4J_USERNAME,
    process.env.NEO4J_PASSWORD
  )

  let business = await instance.cypher(
    'MATCH (b:Business) WHERE b.name = $name RETURN b;',
    {
      name: gcsEvent.name
    }
  )

  business = business.records[0].get('b').properties
  console.log(business)

  const auth = new google.auth.GoogleAuth({
    keyFile: '/etc/secrets/googleapis',
    scopes: 'https://www.googleapis.com/auth/spreadsheets'
  })
  const authClientObject = await auth.getClient()
  const googleSheetsInstance = google.sheets({
    version: 'v4',
    auth: authClientObject
  })

  const result = await googleSheetsInstance.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: {
      valueInputOption: 'RAW',
      data: [{
        range: 'test!A1',
        values: [[gcsEvent.name]]
      }]
    }
  })

  console.log(`Processing file: ${gcsEvent.name}`)
  instance.close()
}
