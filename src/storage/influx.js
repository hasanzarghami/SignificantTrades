const Influx = require('influx')
const getHms = require('../helper').getHms
class InfluxStorage {
  constructor(options) {
    this.name = this.constructor.name
    this.format = 'point'

    if (!options.influxUrl) {
      throw `Please set the influxdb url using influxURL property in config.json`
    }

    this.lastBar = {}
    this.lastClose = {}
    this.options = options
  }

  connect() {
    console.log(`[storage/${this.name}] connecting`)

    return new Promise((resolve, reject) => {
      try {
        this.influx = new Influx.InfluxDB({
          host: this.options.influxUrl,
          database: this.options.influxDatabase,
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

  async resample(from) {
    let sourceTimeframe
    let destinationTimeframe

    const range = {
      from,
      to: +new Date(),
    }

    this.options.influxResampleTo.sort((a, b) => a - b)

    for (let timeframe of this.options.influxResampleTo) {
      const flooredRange = {
        from: Math.floor(range.from / timeframe) * timeframe,
        to: Math.floor(range.to / timeframe) * timeframe + timeframe,
      }

      for (let i = this.options.influxResampleTo.indexOf(timeframe); i >= 0; i--) {
        if (timeframe <= this.options.influxResampleTo[i] || timeframe % this.options.influxResampleTo[i] !== 0) {
          if (i === 0) {
            sourceTimeframe = getHms(this.options.influxTimeframe)
          }
          continue
        }

        sourceTimeframe = getHms(this.options.influxResampleTo[i])
        break
      }

      destinationTimeframe = getHms(timeframe)

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

      const query_from = `${this.options.influxDatabase}.autogen.${this.options.influxMeasurement}_${sourceTimeframe}`
      const query_into = `${this.options.influxDatabase}.autogen.${this.options.influxMeasurement}_${destinationTimeframe}`
      const coverage = `WHERE time > ${flooredRange.from}ms AND time < ${flooredRange.to}ms`
      const group = `GROUP BY time(${destinationTimeframe}), exchange, pair fill(none)`

      await this.influx
        .query(`${query} INTO ${query_into} FROM ${query_from} ${coverage} ${group}`)
        .then((res) => {
          // console.log(`[storage/${this.name}] refreshed ${destinationTimeframe} using ${sourceTimeframe} data... (from ${new Date(flooredRange.from).toUTCString()} to ${new Date(flooredRange.to).toUTCString()})`);
        })
        .catch((err) => {
          console.log(err)
        })
    }
  }

  getReferencePoint(exchange) {
    console.log(`[storage/${this.name}] get reference point for exchange ${exchange}`)

    const now = +new Date()

    const where = [`time < ${now}ms`]

    if (exchange) {
      where.push(`exchange = '${exchange}'`)
    }

    return this.influx
      .query(
        `
        SELECT * 
        FROM ${this.options.influxMeasurement}${this.options.influxTimeframe ? '_' + getHms(this.options.influxTimeframe) : ''}
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY time DESC 
        LIMIT 1
      `,
        {
          precision: 'ms',
        }
      )
      .then((data) => {
        if (data.length) {
          this.lastBar[exchange] = data[0]

          if (typeof data[0].close === 'number') {
            this.lastClose[exchange] = data[0].close
          }

          console.log(`[storage/${this.name}] got ${exchange}'s reference\n\tlast close: ${data[0].close}`)

          return data[0]
        } else {
          console.log('\tserie ' + exchange + ' seems empty')
        }
      })
  }

  save(trades) {
    if (!trades || !trades.length) {
      return Promise.resolve()
    }

    // array of bars
    let bars = []

    // array of liquidations
    let liquidations = []

    // current bar ({} of exchanges)
    let bar = {}

    // current time
    let barTs = 0

    let resampleFrom = Infinity

    for (let i = 0; i <= trades.length; i++) {
      const trade = trades[i]
      let tradeTs

      // trade timestamp floored to timeframe
      if (trade) {
        if (trade[5] == 1) {
          liquidations.push(trade)
        }

        tradeTs = Math.floor(trade[1] / this.options.influxTimeframe) * this.options.influxTimeframe

        resampleFrom = Math.min(tradeTs, resampleFrom)
      }

      if (!trade || tradeTs > barTs) {
        for (let exchange in bar) {
          this.lastBar[exchange] = bar[exchange]

          if (typeof bar[exchange].close === 'number') {
            this.lastClose[exchange] = bar[exchange].close
          }

          bars.push(this.lastBar[exchange])
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
            close: null,
          }

          if (typeof this.lastClose[trade[0]] === 'number') {
            // this bar open = last bar close (from last save or getReferencePoint on startup)
            bar[trade[0]].open = bar[trade[0]].high = bar[trade[0]].low = bar[trade[0]].close = this.lastClose[trade[0]]
          }
        }
      }

      if (trade[5] == 1) {
        // trade is a liquidation
        bar[trade[0]]['liquidation_' + (trade[4] == 1 ? 'buy' : 'sell')] += trade[2] * trade[3]
      } else {
        if (bar[trade[0]].open === null) {
          // is a new bar, and
          bar[trade[0]].open = +trade[2]
        }

        bar[trade[0]].high = Math.max(bar[trade[0]].high, +trade[2])
        bar[trade[0]].low = Math.min(bar[trade[0]].low, +trade[2])
        bar[trade[0]].close = +trade[2]

        bar[trade[0]].count++
        bar[trade[0]]['count_' + (trade[4] == 1 ? 'buy' : 'sell')]++
        bar[trade[0]].vol += trade[2] * trade[3]
        bar[trade[0]]['vol_' + (trade[4] == 1 ? 'buy' : 'sell')] += trade[2] * trade[3]
      }
    }

    const promises = []

    if (bars.length) {
      promises.push(
        this.influx
          .writePoints(
            bars.map((chunk, index) => {
              const fields = {
                count: chunk.count,
                count_buy: chunk.count_buy,
                count_sell: chunk.count_sell,
                vol: chunk.vol,
                vol_buy: chunk.vol_buy,
                vol_sell: chunk.vol_sell,
                liquidation_buy: chunk.liquidation_buy,
                liquidation_sell: chunk.liquidation_sell,
              }

              if (chunk.close !== null) {
                ;(fields.open = chunk.open), (fields.high = chunk.high), (fields.low = chunk.low), (fields.close = chunk.close)
              }

              return {
                measurement: 'trades' + (this.options.influxTimeframe ? '_' + getHms(this.options.influxTimeframe) : ''),
                tags: {
                  exchange: chunk.exchange,
                  pair: 'BTCUSD',
                },
                fields: fields,
                timestamp: +chunk.time,
              }
            }),
            {
              precision: 'ms',
            }
          )
          .catch((err) => {
            console.error('influx write failed (bars)', err.message)
          })
      )
    }

    if (liquidations.length) {
      promises.push(
        this.influx
          .writePoints(
            liquidations.map((trade, index) => {
              const fields = {
                size: +trade[2],
                price: +trade[3],
                side: trade[4] == 1 ? 'buy' : 'sell',
              }

              return {
                measurement: 'liquidations',
                tags: {
                  exchange: trade[0],
                  pair: 'BTCUSD',
                },
                fields: fields,
                timestamp: +trade[1],
              }
            }),
            {
              precision: 'ms',
            }
          )
          .catch((err) => {
            console.error('influx write failed (liquidation)', err.message)
          })
      )
    }

    promises.push(this.resample(resampleFrom))

    return Promise.all(promises)
  }

  fetch(from, to, timeframe = 60000, exchanges = []) {
    const timeframeText = getHms(timeframe)

    let query = `SELECT * FROM "${this.options.influxDatabase}"."autogen"."trades_${timeframeText}" WHERE time >= ${from}ms AND time < ${to}ms`

    if (exchanges.length) {
      query += ` AND exchange =~ /${exchanges.join('|')}/`
    }

    return this.influx
      .query(query, {
        precision: 's',
      })
      .catch((err) => {
        console.error(`[storage/${this.name}] failed to retrieves trades between ${from} and ${to} with timeframe ${timeframe}\n\t`, err.message)
      })
  }
}

module.exports = InfluxStorage
