const fs = require('fs')

console.log(`[init] reading config.json...`)

/* Default configuration (its not ok to change here!, use config.json.)
 */

const DEFAULTS = {
  // default pair we track
  pair: 'BTCUSD',

  // default server port
  port: 3000,

  // dont broadcast below ms interval
  delay: 0,

  // restrict origin (now using regex)
  origin: '.*',

  // max interval an ip can fetch in a limited amount of time (usage restriction, default 7 day)
  maxFetchUsage: 1000 * 60 * 60 * 24,

  // the limited amount of time in which the user usage will be stored
  fetchUsageResetInterval: 1000 * 60 * 10,

  // admin access type (whitelist, all, none)
  admin: 'whitelist',

  // enable websocket server (if you only use this for storing trade data set to false)
  websocket: true,

  // enable api (historical/{from: timestamp}/{to: timestamp})
  api: true,

  // storage solution, either
  // "none" (no storage, everything is wiped out after broadcast)
  // "files" (periodical text file),
  // "influx" (timeserie database),
  // "es" (experimental)
  storage: 'files',

  // store interval (in ms)
  backupInterval: 1000 * 10,

  // elasticsearch server to use when storage is set to "es"
  esUrl: 'localhost:9200',

  // influx db server to use when storage is set to "influx"
  influxUrl: 'localhost:9200',
  influxDatabase: 'significant_trades',
  influxMeasurement: 'trades',
  influxTimeframe: 10000,
  influxResampleTo: [1000 * 30, 1000 * 60, 1000 * 60 * 3, 1000 * 60 * 5, 1000 * 60 * 15],
  influxPreheatRange: 1000 * 60 * 60 * 24,

  // create new text file every N ms when storage is set to "file"
  filesInterval: 3600000,

  // default place to store the trades data files
  filesLocation: './data',

  // downsample every trade that come to the same ms
  sameMs: true
}

/* Load custom server configuration
 */

let config

try {
  if (!fs.existsSync('../config.json') && fs.existsSync('../config.json.example')) {
    fs.copyFileSync('../config.json.example', './config.json')
  }

  config = require('../config')
} catch (error) {
  throw new Error(`Unable to parse configuration file\n\n${error.message}`)
}

/* Merge default
 */

config = Object.assign(DEFAULTS, config)

module.exports = config
