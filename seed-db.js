const clc = require('cli-color')
const dedent = require('dedent-js')
const { google } = require('googleapis')
const { instance } = require('db/neode')
const { v4: uuidv4 } = require('uuid')
// const stripe = require('stripe')(process.env.STRIPE_API_KEY)

const spreadsheetId = process.env.SPREADSHEET_ID

start()

async function start () {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_KEYS_PATH,
    scopes: 'https://www.googleapis.com/auth/spreadsheets'
  })
  const authClientObject = await auth.getClient()
  const googleSheetsInstance = google.sheets({ version: 'v4', auth: authClientObject })

  await attributes(googleSheetsInstance)
  await businesses(googleSheetsInstance)
  await promotions(googleSheetsInstance)
  await tolls(googleSheetsInstance)
  await roads(googleSheetsInstance)

  instance.close()
}

async function attributes (googleSheetsInstance) {
  const attributes = (await googleSheetsInstance.spreadsheets.values.get({
    spreadsheetId,
    range: 'attributes!A2:B'
  })).data.values

  let orphanedAttributes = await instance.cypher(
    'MATCH (a:Attribute) WHERE NOT a.name IN $names RETURN a;',
    { names: attributes.filter(a => a.length).map(a => a[0]) }
  )
  orphanedAttributes = orphanedAttributes.records.map(r => r.get('a').properties)

  console.log(clc.green('Attributes in Google Sheets'))
  console.log(clc.green('--------------------------------------------------'))
  console.log(attributes)
  console.log(clc.red('Orphaned Attributes'))
  console.log(clc.red('--------------------------------------------------'))
  console.log(orphanedAttributes)

  const googleUpdates = []
  const neoUpdates = []

  for (let i = 0; i < attributes.length; i++) {
    const a = attributes[i]
    if (!a[0]) {
      console.log(clc.red('Error: empty row: ' + (i + 2)))
      continue
    }
    const node = await instance.first('Attribute', {
      name: a[0]
    })
    if (node) {
      if (!a[1] || a[1] !== node.get('uid')) {
        console.log(clc.green(`Adding ${a[0]} uid (${node.get('uid')}) to google sheets`))
        googleUpdates.push({
          range: 'attributes!B' + (i + 2),
          values: [[node.get('uid')]]
        })
      }
    } else {
      console.log(clc.green(`NEO4J Attribute Not Found: "${a[0]}", adding...`))
      const newUUID = uuidv4()
      neoUpdates.push({
        query: dedent`
          CREATE (a:Attribute {
            name: $name,
            uid: $uid
          })
        `,
        params: {
          name: a[0],
          uid: newUUID
        }
      })
      googleUpdates.push({
        range: 'attributes!B' + (i + 2),
        values: [[newUUID]]
      })
    }
  }

  neoUpdates.push({
    query: 'MATCH (a:Attribute) WHERE a.name IN $names DETACH DELETE a;',
    params: { names: orphanedAttributes.map(a => a.name) }
  })

  await instance.batch(neoUpdates)
  await googleSheetsInstance.spreadsheets.values.batchUpdate({
    spreadsheetId,
    resource: {
      valueInputOption: 'RAW',
      data: googleUpdates
    }
  })
}

async function businesses (googleSheetsInstance) {
  // Get all business records from google sheets
  const businesses = (await googleSheetsInstance.spreadsheets.values.get({
    spreadsheetId,
    range: 'businesses!A2:D'
  })).data.values
  console.log(clc.red('Businesses in Google Sheets'))
  console.log(clc.red('--------------------------------------------------'))
  console.log(businesses)

  const googleUpdates = []
  const neoUpdates = []
  for (let i = 0; i < businesses.length; i++) {
    const b = businesses[i]

    let node
    if (b[3]) {
      node = await instance.first('Business', {
        uid: b[3]
      })
    }

    if (b[3] && node) {
      console.log(clc.green(`Updating business "${b[0]}"`))
      neoUpdates.push({
        query: dedent`
          MATCH (b:Business {
            uid: $uid
          })
          SET b.name = $name,
              b.description = $description;
        `,
        params: {
          uid: b[3],
          name: b[0],
          description: b[1]
        }
      })
    } else {
      // business not yet in NEO4J, insert and add UID to google sheets
      const newUUID = uuidv4()
      console.log(clc.green(`Creating business "${b[0]}"`))
      neoUpdates.push({
        query: dedent`
          CREATE (b:Business {
            name: $name,
            uid: $uid,
            description: $description
          })
        `,
        params: {
          name: b[0],
          uid: newUUID,
          description: b[1]
        }
      })
      googleUpdates.push({
        range: 'businesses!D' + (i + 2), // +2 because google sheets is 1-indexed
        values: [[newUUID]]
      })
    }

    console.log(clc.blue(`Tagging ${b[0]} with attributes: ` + b[2]))
    // delete all attribute tags and recreate from spreadsheet
    neoUpdates.push({
      query: dedent`
        MATCH (a:Attribute)-[r:TAGS]->(b:Business {name: $businessName})
        DELETE r;
      `,
      params: {
        businessName: b[0]
      }
    })
    const attributes = b[2].split(',').map(s => s.trim())
    for (let k = 0; k < attributes.length; k++) {
      const a = attributes[k]
      console.log(`(${a})-[:TAGS]->(${b[0]})`)
      neoUpdates.push({
        query: dedent`
          MATCH (a:Attribute {name: $attributeName})
          MATCH (b:Business {name: $businessName})
          MERGE(a)-[:TAGS]->(b);
        `,
        params: {
          attributeName: a,
          businessName: b[0]
        }
      })
    }
  }

  await instance.batch(neoUpdates)
  await googleSheetsInstance.spreadsheets.values.batchUpdate({
    spreadsheetId,
    resource: {
      valueInputOption: 'RAW',
      data: googleUpdates
    }
  })
}

async function promotions (googleSheetsInstance) {
  // Get all business records from google sheets
  const promotions = (await googleSheetsInstance.spreadsheets.values.get({
    spreadsheetId,
    range: 'promotions!A2:G'
  })).data.values
  console.log(clc.red('Promotions in Google Sheets'))
  console.log(clc.red('--------------------------------------------------'))
  console.log(promotions)

  const googleUpdates = []
  const neoUpdates = []
  for (let i = 0; i < promotions.length; i++) {
    const p = promotions[i]
    const newUUID = uuidv4()

    let promotionNode = false
    if (p[6]) {
      promotionNode = await instance.first('Promotion', {
        uid: p[6]
      })
    }

    if (promotionNode) {
      // update
      console.log(`Promotion "${p[0]}" exists, updating...`)
      neoUpdates.push({
        query: dedent`
          MATCH (p:Promotion {uid: $uid})
          SET p.name = $name
        `,
        params: {
          uid: p[6],
          name: p[0]
        }
      })
    } else {
      // create
      console.log(`Promotion "${p[0]}" does not exist, creating...`)
      neoUpdates.push({
        query: dedent`
          CREATE (p:Promotion {
            uid: $uid,
            name: $name,
            percentage: $percentage,
            description: $description
          });`,
        params: {
          uid: newUUID,
          name: p[0],
          percentage: p[2],
          description: p[3] || ''
        }
      })

      neoUpdates.push({
        query: dedent`
          MATCH (b:Business {name: $name})
          MATCH (p:Promotion {uid: $uid})
          MERGE (b)-[:HAS_PROMOTION]->(p);`,
        params: {
          name: p[1],
          uid: newUUID
        }
      })

      googleUpdates.push({
        range: 'promotions!G' + (i + 2), // +2 because google sheets is 1-indexed
        values: [[newUUID]]
      })

      // delete all attribute tag relationships and recreate
      neoUpdates.push({
        query: dedent`
          MATCH (a:Attribute)-[r:TAGS]->(p:Promotion {uid: $promotionUID})
          DELETE r;
        `,
        params: {
          promotionUID: newUUID
        }
      })

      if (p[4]) {
      // promotion has attributes
        const attributes = p[4].split(',').map(s => s.trim())
        attributes.forEach(a => {
          console.log(`Promotion "${p[0]}" has attribute ${a}, creating relationship...`)
          neoUpdates.push({
            query: dedent`
              MATCH(a:Attribute {name: $name})
              MATCH(p:Promotion {uid: $uid})
              MERGE (a)-[:TAGS]->(p);`,
            params: {
              name: a,
              uid: newUUID
            }
          })
        })
      }
    }
  }

  await instance.batch(neoUpdates)
  await googleSheetsInstance.spreadsheets.values.batchUpdate({
    spreadsheetId,
    resource: {
      valueInputOption: 'RAW',
      data: googleUpdates
    }
  })
}

async function roads (googleSheetsInstance) {
  const roads = (await googleSheetsInstance.spreadsheets.values.get({
    spreadsheetId,
    range: 'roads!A2:C'
  })).data.values

  let orphanedRoads = await instance.cypher(
    'MATCH (r:Road) WHERE NOT r.uid IN $uids RETURN r;',
    { uids: roads.filter(row => row.length > 2 && row[2]).map(row => row[2]) }
  )
  orphanedRoads = orphanedRoads.records.map(r => r.get('r').properties)

  console.log(clc.green('Roads in Google Sheets'))
  console.log(clc.green('--------------------------------------------------'))
  console.log(roads)
  console.log(clc.red('Orphaned Roads'))
  console.log(clc.red('--------------------------------------------------'))
  console.log(orphanedRoads)

  if (orphanedRoads.length) {
    console.log(clc.red(`Pruning ${orphanedRoads.length} orphaned roads`))
    await instance.writeCypher(
      'MATCH (r:Road) WHERE NOT r.uid IN $uids DETACH DELETE r;',
      {
        uids: orphanedRoads.map(r => r.uid)
      }
    )
  }

  const neo4jQueries = []
  const googleSheetsQueries = []

  for (let i = 0; i < roads.length; i++) {
    const r = roads[i]
    if (!r[0]) {
      console.log(clc.red('Error: empty row: ' + (i + 2)))
      continue
    }
    let road
    if (r[2]) {
      // has a uuid, try to find & update
      road = await instance.first('Road', { uid: r[2] })
    }

    const nextToll = await instance.first('Toll', { name: r[1] })
    if (!nextToll) {
      console.log(clc.red(`Error: Toll "${r[1]}" not found`))
      continue
    }

    if (r[2] && road) {
      // found, update
      console.log(clc.green(`Updating road "${r[0]}"`))
      neo4jQueries.push({
        query: dedent`
          MATCH (r:Road {uid: $uid})
          SET r.name = $name,
              r.next_toll = $nextToll,
              r.next_toll_name = $nextTollName
        `,
        params: {
          name: r[0],
          nextToll: nextToll.get('uid'),
          nextTollName: nextToll.get('name'),
          uid: r[2]
        }
      })
    } else {
      // not found, create
      console.log(clc.green(`Creating road "${r[0]}"`))
      const newUUID = uuidv4()
      neo4jQueries.push({
        query: dedent`
          CREATE (r:Road {
            name: $name,
            uid: $uid,
            next_toll: $nextToll,
            next_toll_name: $nextTollName
          })
        `,
        params: {
          name: r[0],
          nextToll: nextToll.get('uid'),
          nextTollName: nextToll.get('name'),
          uid: newUUID
        }
      })

      googleSheetsQueries.push({
        range: 'roads!C' + (i + 2),
        values: [[newUUID]]
      })
    }
  }

  await instance.batch(neo4jQueries)
  await googleSheetsInstance.spreadsheets.values.batchUpdate({
    spreadsheetId,
    resource: {
      valueInputOption: 'RAW',
      data: googleSheetsQueries
    }
  })
}

async function tolls (googleSheetsInstance) {
  const dateTime = new Date().toISOString()

  const tolls = (await googleSheetsInstance.spreadsheets.values.get({
    spreadsheetId,
    range: 'tolls!A2:G'
  })).data.values

  // tolls w/ UIDs in google sheets
  const uids = tolls
    .filter(t => t[0]) // is a toll (column A has a value)
    .filter(t => t[4]) // has a uuid
    .map(t => t[4]) // we just want the uuid
  let orphanedTolls = await instance.cypher(
    'MATCH (t:Toll) WHERE NOT t.uid IN $uids RETURN t;',
    { uids }
  )
  orphanedTolls = orphanedTolls.records.map(t => t.get('t').properties)

  console.log(clc.green('Tolls in Google Sheets'))
  console.log(clc.green('--------------------------------------------------'))
  console.log(tolls)
  console.log(clc.red('Orphaned Tolls'))
  console.log(clc.red('--------------------------------------------------'))
  console.log(orphanedTolls)

  if (orphanedTolls.length) {
    console.log(clc.red(`Pruning ${orphanedTolls.length} orphaned tolls`))
    await instance.writeCypher(
      'MATCH (t:Toll) WHERE NOT t.uid IN $uids DETACH DELETE t;',
      { uids }
    )
  }

  const neo4jQueries = []
  const googleSheetsQueries = []

  // first loop through and create/update all the tolls. Do this before trying to create
  // attribute relationships
  for (let i = 0; i < tolls.length; i++) {
    const row = tolls[i].map(v => v.trim())
    if (row[0]) {
      // if the toll has a uuid, update (if changed)
      // if no uuid, create and insert uuid into google sheets

      // Check to see if UUID is in google sheets but somehow there's no matching toll in database
      // this shouldn't actually happen, but checking anyways
      let toll
      if (row[4]) {
        toll = await instance.first('Toll', {
          uid: row[4]
        })
      }

      if (row[4] && toll) {
        // has uuid
        console.log(clc.green(`Updating toll "${row[0]}" (${row[4]})`))
        neo4jQueries.push({
          query: dedent`MATCH (t:Toll { uid: $uid }) SET t.name = $name, t.select_type = $select_type`,
          params: {
            uid: row[4],
            name: row[0],
            select_type: row[1]
          }
        })
      } else {
        // does not have uuid, or not found in neo4j
        const newUUID = uuidv4()
        console.log(clc.green(`Creating toll "${row[0]}" (${newUUID})`))
        neo4jQueries.push({
          query: dedent`CREATE (t:Toll {
            uid: $uid,
            name: $name,
            select_type: $select_type
          })`,
          params: {
            uid: newUUID,
            name: row[0],
            select_type: row[1]
          }
        })
        // uid
        googleSheetsQueries.push({
          range: 'tolls!E' + (i + 2),
          values: [[newUUID]]
        })
        // createdAt
        googleSheetsQueries.push({
          range: 'tolls!F' + (i + 2),
          values: [[dateTime]]
        })
      }
      // updatedAt
      googleSheetsQueries.push({
        range: 'tolls!G' + (i + 2),
        values: [[dateTime]]
      })
    }
  }

  await instance.batch(neo4jQueries)
  await googleSheetsInstance.spreadsheets.values.batchUpdate({
    spreadsheetId,
    resource: {
      valueInputOption: 'RAW',
      data: googleSheetsQueries
    }
  })

  neo4jQueries.length = 0

  let currentToll
  const attributes = [] // used in pruning step

  const pruneOrphanedAttributes = function () {
    const attributesCopy = [...attributes]
    if (attributes.length) {
      console.log('  * Pruning orphaned attributes')
      neo4jQueries.push({
        query: dedent`
              MATCH (t:Toll)-[r:HAS_TAG]->(a:Attribute)
              WHERE t.name = $tollName AND NOT a.name IN $attributes
              DETACH DELETE r;
            `,
        params: {
          tollName: currentToll,
          attributes: attributesCopy
        }
      })
    }
    attributes.length = 0
  }

  for (let i = 0; i < tolls.length; i++) {
    const row = tolls[i]
    if (row[0]) {
      pruneOrphanedAttributes()
      currentToll = row[0]
      console.log(clc.green(`Updating "${currentToll}" attributes...`))
    }
    // current row is an attribute relationship to current toll
    // look ahead until hitting next toll
    let k = 0
    do {
      const attributeName = tolls[i + k][2]
      attributes.push(attributeName)
      console.log(`  - Adding/Updating attribute: "${attributeName}"`)

      // does this attribute relationship lead to a next toll?
      let nextTollUid = ''
      let nextTollName = ''
      if (tolls[i + k] && tolls[i + k][3]) {
        const nextToll = await instance.first('Toll', {
          name: tolls[i + k][3]
        })
        if (!nextToll) {
          console.log(clc.red(`Error: "${tolls[i + k][3]}" not found.`))
          k++
          continue
        }
        nextTollUid = nextToll.get('uid')
        nextTollName = nextToll.get('name')
      }

      // does relationship exist already?
      const res = await instance.cypher(
        dedent`
          MATCH (t:Toll {name: $tollName})-[r:HAS_TAG]->(a:Attribute {name: $attributeName})
          RETURN t, r, a;
        `,
        {
          tollName: currentToll,
          attributeName
        }
      )

      if (res.records.length) {
        console.log(clc.green(`    - "${attributeName}" found, updating...`))
        neo4jQueries.push({
          query: dedent`
            MATCH (t:Toll {name: $tollName})-[r:HAS_TAG]->(a:Attribute {name: $attributeName})
            SET r.next_toll = $nextToll, r.next_toll_name = $nextTollName
          `,
          params: {
            tollName: currentToll,
            attributeName,
            nextToll: nextTollUid,
            nextTollName
          }
        })
      } else {
        console.log(clc.green(`    - "${attributeName}" not found, creating...`))
        neo4jQueries.push({
          query: dedent`
            MATCH
              (t:Toll {name: $tollName}),
              (a:Attribute {name: $attributeName})
            MERGE (t)-[r:HAS_TAG {
              next_toll: $nextToll,
              next_toll_name: $nextTollName
            }]->(a);
          `,
          params: {
            tollName: currentToll,
            attributeName,
            nextToll: nextTollUid,
            nextTollName
          }
        })
      }

      k++
    } while (tolls[i + k + 1] && tolls[i + k + 1][0] !== '')

    await instance.batch(neo4jQueries)

    // jump the main loop ahead to the next toll row
    i += k - 1 // double check the math here
  }

  // do this one last time after loop to get the last toll...
  pruneOrphanedAttributes()
  await instance.batch(neo4jQueries)
}
