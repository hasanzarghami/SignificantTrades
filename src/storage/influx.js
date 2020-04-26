const Influx = require('influx')
const getHms = require('../helper').getHms

require('../typedef')

class InfluxStorage {
  constructor(options) {
    this.name = this.constructor.name
    this.format = 'point'

    if (!options.influxUrl) {
      throw `Please set the influxdb url using influxURL property in config.json`
    }

    this.lastBar = {}
    this.options = options
  }

  connect() {
    console.log(`[storage/${this.name}] connecting`)

    return new Promise((resolve, reject) => {
      try {
        this.influx = new Influx.InfluxDB({
          host: this.options.influxUrl,
          database: this.options.influxDatabase
        })

        this.influx
          .getDatabaseNames()
          .then((names) => {
            if (!names.includes('significant_trades')) {
              return this.influx.createDatabase('significant_trades')
            }
          })
          .then(() => {
            Promise.all(this.options.exchanges.map((exchange) => this.getReferencePoint(exchange)))
              .then(() => {
                if (this.options.api) {
                  this.setupResampling()
                }

                resolve()
              })
              .catch((err) => {
                console.error(`[storage/${this.name}] unable to get reference points :-(`)

                reject(err)
              })
          })
          .catch((err) => {
            console.error(`[storage/${this.name}] error creating Influx database :-(`)

            reject(err)
          })
      } catch (error) {
        throw error
      }
    })
  }

  /**
   * Create continuous queries if not exists
   * Preheat continuous queries with *options.influxPreheatRange* ms of data from base measurement
   *
   * @memberof InfluxStorage
   */
  async setupResampling() {
    let from
    let into

    const range = {
      to: +new Date()
    }

    range.from = range.to - this.options.influxPreheatRange

    this.options.influxResampleTo.sort((a, b) => a - b)

    let cq_created = []
    
    for (let timeframe of this.options.influxResampleTo) {
      if (!from) {
        from = getHms(this.options.influxTimeframe)
      } else {
        from = into
      }

      into = getHms(timeframe)

      const query = `SELECT min(low) AS low, 
      max(high) AS high, 
      first(open) AS open, 
      last(close) AS close, 
      sum(count) AS count, 
      sum(count_buy) AS count_buy, 
      sum(count_sell) AS count_sell, 
      sum(liquidation_buy) AS liquidation_buy, 
      sum(liquidation_sell) AS liquidation_sell, 
      sum(vol) AS vol, 
      sum(vol_buy) AS vol_buy, 
      sum(vol_sell) AS vol_sell`

      const query_from = `${this.options.influxDatabase}.autogen.${this.options.influxMeasurement}_${from}`
      const query_into = `${this.options.influxDatabase}.autogen.${this.options.influxMeasurement}_${into}`

      const coverage = `WHERE time > ${range.from}ms AND time < ${range.to}ms`
      const group = `GROUP BY time(${into}), exchange, pair fill(none)`

      const cq_query = `
        CREATE CONTINUOUS QUERY cq_${into} ON ${this.options.influxDatabase} 
        RESAMPLE FOR ${getHms(timeframe * 2)} 
        BEGIN 
          ${query} INTO ${query_into} FROM ${query_from} ${group}
        END
      `

      cq_created.push(
        await this.influx
          .query(`${query} INTO ${query_into} FROM ${query_from} ${coverage} ${group}`)
          .then((res) => {
            console.log(`[storage/${this.name}] preheated ${into} data...`)
          })
          .catch((err) => {
            console.log(err)
          })
      )

      await this.influx
        .query(`${query} FROM ${query_into} ${coverage} ${group} ORDER BY ASC LIMIT 1`)
        .then((res) => {
          if (res[0]) {
            console.log(
              `\t-> first point in ${query_into}: ${new Date(res[0].time).toUTCString()}\n`
            )
          } else {
            console.log(
              `\t-> 0 points found in ${query_into} (${getHms(
                this.options.influxPreheatRange
              )} timespan)\n`
            )
          }
        })
        .catch((err) => {
          console.log(err)
        })

      await this.influx.query(cq_query).catch((err) => {
        // console.log(err)
      })
    }

    cq_created = this.options.influxResampleTo
      .filter((a, i) => typeof cq_created[i] !== 'undefined')
      .map((a) => getHms(a))

    if (cq_created.length) {
      console.log(
        `[storage/${this.name}] successfully created ${
          this.options.influxResampleTo.length
        } continuous queries\n\ttimeframes: ${cq_created.join(', ')}`
      )
    }

    await this.influx.query(`SHOW CONTINUOUS QUERIES`).then((cqs) => {
      console.log(
        `[storage/${this.name}] ${cqs.length} active continuous queries\n\t-> ${cqs
          .map((a) => a.name)
          .join(', ')}`
      )
    })
  }

  /**
   * Get last stored bar for given exchange & pair
   *
   * @param {string} exchange
   * @param {string} pair
   * @returns {Bar | null}
   * @memberof InfluxStorage
   */
  getReferencePoint(exchange, pair) {
    if (!exchange) {
      throw new Error(`cannot get reference point of undefined exchange`)
    }

    if (!pair) {
      throw new Error(`cannot get reference point of undefined pair`)
    }
    
    console.log(`[storage/${this.name}] get reference point for exchange ${exchange}/${pair}`)

    const now = +new Date()

    const where = [`time < ${now}ms`]

    if (exchange) {
      where.push(`exchange = '${exchange}'`)
    }

    if (pair) {
      where.push(`pair = '${pair}'`)
    }

    return this.influx
      .query(
        `
        SELECT * 
        FROM ${this.options.influxMeasurement}${
          this.options.influxTimeframe ? '_' + getHms(this.options.influxTimeframe) : ''
        }
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY time DESC 
        LIMIT 1
      `,
        {
          precision: 'ms'
        }
      )
      .then((data) => {
        if (data.length) {
          this.lastBar[exchange + pair] = data[0]

          console.log(
            `[storage/${this.name}] got ${exchange}'s reference\n\tlast close: ${data[0].close}`
          )

          return data[0]
        } else {
          console.log('\tserie ' + exchange + ' seems empty')
        }
      })
  }

  /**
   * Trigger when save fired from main controller
   *
   * @param {Trade[]} trades
   * @returns {Promise<any>}
   * @memberof InfluxStorage
   */
  save(trades) {
    if (!trades || !trades.length) {
      return Promise.resolve()
    }

    const groups = groupByPairs(trades);

    return Promise.all(Object.keys(groups).map(pair => this.import(groups[pair], pair)))
  }

  /**
   * Import the trades to influx db 
   *
   * @param {Trade[]} trades
   * @param {*} pair
   * @returns {Promise<any>}
   * @memberof InfluxStorage
   */
  import(trades, pair) {
    // array of bars
    let output = []

    // current bar ({} of exchanges)
    let bar = {}

    // current time
    let barTs = 0

    for (let i = 0; i <= trades.length; i++) {
      const trade = trades[i]
      let tradeTs

      // trade timestamp floored to timeframe
      if (trade) {
        tradeTs = Math.floor(trade[1] / this.options.influxTimeframe) * this.options.influxTimeframe
      }

      if (!trade || tradeTs > barTs) {
        for (let exchange in bar) {
          this.lastBar[exchange] = bar[exchange]

          output.push(this.lastBar[exchange])
        }

        if (!trade) {
          break
        }

        bar = {}
        barTs = tradeTs
      }

      if (!bar[trade[0]]) {
        if (this.lastBar[trade[0]] && this.lastBar[trade[0]].time === tradeTs) {
          // trades passed in save() contains some of the last batch (trade time = last bar time)
          // recover exchange point of lastbar
          bar[trade[0]] = this.lastBar[trade[0]]
        } else {
          // create new point
          bar[trade[0]] = {
            time: tradeTs,
            exchange: trade[0],
            cbuy: 0,
            csell: 0,
            vbuy: 0,
            vsell: 0,
            lbuy: 0,
            lsell: 0,
            open: null,
            high: 0,
            low: Infinity,
            close: null
          }

          if (this.lastBar[trade[0]] && this.lastBar[trade[0]].close) {
            // this bar open = last bar close (from last save or getReferencePoint on startup)
            bar[trade[0]].open = bar[trade[0]].high = bar[trade[0]].low = bar[
              trade[0]
            ].close = this.lastBar[trade[0]].close
          }
        }
      }

      if (bar[trade[0]].open === null) {
        // is a new bar, and
        bar[trade[0]].open = +trade[2]
      }

      bar[trade[0]].high = Math.max(bar[trade[0]].high, +trade[2])
      bar[trade[0]].low = Math.min(bar[trade[0]].low, +trade[2])
      bar[trade[0]].close = +trade[2]

      if (trade[5] == 1) {
        // trade is a liquidation
        bar[trade[0]]['l' + (trade[4] == 1 ? 'buy' : 'sell')] += trade[2] * trade[3]
      } else {
        // normal trade
        bar[trade[0]]['c' + (trade[4] == 1 ? 'buy' : 'sell')]++
        bar[trade[0]]['v' + (trade[4] == 1 ? 'buy' : 'sell')] += trade[2] * trade[3]
      }
    }

    return this.influx
      .writePoints(
        output.map((chunk, index) => {
          const fields = {
            cbuy: chunk.cbuy,
            csell: chunk.csell,
            vbuy: chunk.vbuy,
            vsell: chunk.vsell,
            lbuy: chunk.lbuy,
            lsell: chunk.lsell
          }

          if (chunk.close !== null) {
            ;(fields.open = chunk.open),
              (fields.high = chunk.high),
              (fields.low = chunk.low),
              (fields.close = chunk.close)
          }

          return {
            measurement:
              'trades' +
              (this.options.influxTimeframe ? '_' + getHms(this.options.influxTimeframe) : ''),
            tags: {
              exchange: chunk.exchange,
              pair: pair
            },
            fields: fields,
            timestamp: +chunk.time
          }
        }),
        {
          precision: 'ms'
        }
      )
      .catch((err) => {
        console.log(err.message)
      })
  }

  fetch({from, to, timeframe = 60000, exchanges = [], pair}) {
    const timeframeText = getHms(timeframe)
    
    let query = `SELECT * FROM "${this.options.influxDatabase}"."autogen"."trades_${timeframeText}" WHERE time >= ${from}ms AND time < ${to}ms`;

    if (exchanges.length) {
      query += ` AND exchange =~ /${exchanges.join(
        '|'
      )}/`
    }

    return this.influx
      .query(query,
        {
          precision: 's'
        }
      )
      .catch((err) => {
        console.error(
          `[storage/${this.name}] failed to retrieves trades between ${from} and ${to} with timeframe ${timeframe}\n\t`,
          err.message
        )
      })
  }
}

module.exports = InfluxStorage
