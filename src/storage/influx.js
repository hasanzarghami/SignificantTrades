const Influx = require('influx')
const getHms = require('../helper').getHms

class InfluxStorage {
  constructor(options) {
    if (!options.influxUrl) {
      throw `Please set the influxdb url using influxURL property in config.json`
    }

    this.refPoint = {}
    this.options = options
  }

  connect() {
    console.log(`[storage/influx] connecting`)

    return new Promise((resolve, reject) => {
      try {
        this.influx = new Influx.InfluxDB({
          host: this.options.influxUrl,
          database: this.options.influxDatabase
        })

        this.influx
          .getDatabaseNames()
          .then(names => {
            if (!names.includes('significant_trades')) {
              return this.influx.createDatabase('significant_trades')
            }
          })
          .then(() => {
            Promise.all(this.options.exchanges.map(exchange => this.getReferencePoint(exchange)))
              .then(() => {
                this.setupResampling().then

                resolve()
              })
              .catch(err => {
                console.error(`[storage/influx] unable to get reference points :-(`)

                reject(err)
              })
          })
          .catch(err => {
            console.error(`[storage/influx] error creating Influx database :-(`)

            reject(err)
          })
      } catch (error) {
        throw error
      }
    })
  }

  async setupResampling() {
    let from
    let into

    const promises = []

    const range = {
      to: +new Date()
    }

    range.from = range.to - this.options.influxPreheatRange

    this.options.influxResampleTo.sort((a, b) => a - b)

    let cq_created = []
    console.log(this.options.influxResampleTo)
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
          .then(res => {
            console.log(`[storage/influx] preheated ${into} data...`)
          })
          .catch(err => {
            console.log(err)
          })
      )

      await this.influx
        .query(`${query} FROM ${query_into} ${coverage} ${group} ORDER BY ASC LIMIT 1`)
        .then(res => {
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
        .catch(err => {
          console.log(err)
        })

      await this.influx.query(cq_query).catch(err => {
        // console.log(err)
      })
    }

    cq_created = this.options.influxResampleTo
      .filter((a, i) => typeof cq_created[i] !== 'undefined')
      .map(a => getHms(a))

    if (cq_created.length) {
      console.log(
        `[storage/influx] successfully created ${
          this.options.influxResampleTo.length
        } continuous queries\n\ttimeframes: ${cq_created.join(', ')}`
      )
    }

    await this.influx.query(`SHOW CONTINUOUS QUERIES`).then(cqs => {
      console.log(
        `[storage/influx] ${cqs.length} active continuous queries\n\t-> ${cqs
          .map(a => a.name)
          .join(', ')}`
      )
    })
  }

  getReferencePoint(exchange) {
    console.log(`[storage/influx] get reference point for exchange ${exchange}`)

    const now = +new Date()

    const where = [`time < ${now}ms`]

    if (exchange) {
      where.push(`exchange = '${exchange}'`)
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
      .then(data => {
        if (data.length) {
          this.refPoint[exchange] = data[0]

          console.log(
            `[storage/influx] got ${exchange}'s reference\n\tlast close: ${data[0].close}`
          )

          return data[0]
        } else {
          console.log('\tserie seems empty')
        }
      })
  }

  save(trades) {
    if (!trades || !trades.length) {
      return Promise.resolve()
    }

    const beforeTs = new Date()

    let updated = 0
    let points = []
    let pointTs = 0
    let point = {}

    for (let trade of trades) {
      const ts = Math.floor(trade[1] / this.options.influxTimeframe) * this.options.influxTimeframe

      if (ts > pointTs) {
        for (let exchange in point) {
          if (!point.close) {
            point.low = null
            point.high = null
            point.open = null
            point.close = null
          }

          this.refPoint[exchange] = point[exchange]

          points.push(this.refPoint[exchange])
        }

        point = {}

        pointTs = ts
      }

      if (!point[trade[0]]) {
        if (this.refPoint[trade[0]] && this.refPoint[trade[0]].time === ts) {
          // fix last point as trade arrived after previous batch...
          point[trade[0]] = this.refPoint[trade[0]]

          updated++
        } else {
          // create new point
          point[trade[0]] = {
            time: ts,
            exchange: trade[0],
            count: 0,
            count_buy: 0,
            count_sell: 0,
            vol: 0,
            vol_buy: 0,
            vol_sell: 0,
            liquidation_buy: 0,
            liquidation_sell: 0,
            open: null,
            high: 0,
            low: Infinity,
            close: null
          }

          if (this.refPoint[trade[0]] && this.refPoint[trade[0]].close) {
            point[trade[0]].open = this.refPoint[trade[0]].close
          }
        }
      }

      if (trade[5] == 1) {
        point[trade[0]]['liquidation_' + (trade[4] == 1 ? 'buy' : 'sell')] += trade[2] * trade[3]
      } else {
        if (point[trade[0]].open === null) {
          point[trade[0]].open = +trade[2]
        }
        point[trade[0]].count++
        point[trade[0]]['count_' + (trade[4] == 1 ? 'buy' : 'sell')]++
        point[trade[0]].vol += trade[2] * trade[3]
        point[trade[0]]['vol_' + (trade[4] == 1 ? 'buy' : 'sell')] += trade[2] * trade[3]
        point[trade[0]].high = Math.max(point[trade[0]].high, +trade[2])
        point[trade[0]].low = Math.min(point[trade[0]].low, +trade[2])
        point[trade[0]].close = +trade[2]
      }
    }

    for (let exchange in point) {
      if (point[exchange].vol) {
        this.refPoint[exchange] = point[exchange]

        points.push(this.refPoint[exchange])
      }
    }

    return this.influx
      .writePoints(
        points.map((chunk, index) => {
          const fields = {
            count: chunk.count,
            count_buy: chunk.count_buy,
            count_sell: chunk.count_sell,
            vol: chunk.vol,
            vol_buy: chunk.vol_buy,
            vol_sell: chunk.vol_sell,
            liquidation_buy: chunk.liquidation_buy,
            liquidation_sell: chunk.liquidation_sell
          }

          if (chunk.open !== null) {
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
              pair: 'BTCUSD'
            },
            fields: fields,
            timestamp: +chunk.time
          }
        }),
        {
          precision: 'ms'
        }
      )
      .then(() => {
        const afterTs = +new Date()

        console.log(
          `[storage/influx] added ${points.length - updated} points (+${trades.length} trades)${
            updated ? ', updated ' + updated + ' point' + (updated > 1 ? 's' : '') : ''
          }, took ${getHms(
            afterTs - beforeTs
          )} from ${beforeTs.getHours()}:${beforeTs.getMinutes()}:${beforeTs.getSeconds()}.${beforeTs.getMilliseconds()}`
        )
      })
      .catch(err => {
        console.log(err)
      })
  }

  fetch(from, to, timeframe = 1000 * 60) {
    return this.influx
      .query(
        `
			SELECT
				first(price) AS open,
				last(price) AS close,
				max(price) AS high,
				min(price) AS low,
				sum(buy) + sum(sell) AS volume,
				sum(buy) * median(price) as buys,
				sum(sell) * median(price) as sells,
				count(side) as records
			FROM trades 
			WHERE pair='${this.options.pair}' AND time > ${from}ms and time < ${to}ms 
			GROUP BY time(${timeframe}ms), exchange fill(none)
		`
      )
      .then(ticks =>
        ticks
          .map(tick => {
            tick.timestamp = +new Date(tick.time)

            delete tick.time

            return tick
          })
          .sort((a, b) => a.timestamp - b.timestamp)
      )
      .catch(err => {
        console.error(
          `[storage/influx] failed to retrieves trades between ${from} and ${to} with timeframe ${timeframe}\n\t`,
          err.message
        )
      })
  }
}

module.exports = InfluxStorage
