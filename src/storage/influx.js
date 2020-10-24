const Influx = require('influx')
const { getHms, groupByPairs } = require('../helper')

require('../typedef')

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

  async connect() {
    console.log(`[storage/${this.name}] connecting`)

    if (/\-/.test(this.options.influxDatabase)) {
      throw new Error('dashes not allowed inside influxdb database')
    }

    this.influx = new Influx.InfluxDB({
      host: this.options.influxUrl,
      database: this.options.influxDatabase,
    })

    const databases = await this.influx.getDatabaseNames()

    console.log(databases);

    if (!databases.includes(this.options.influxDatabase)) {
      await this.influx.createDatabase(this.options.influxDatabase)
    }

    await this.getPreviousCloses()
  }

  /**
   * Create continuous queries if not exists
   *
   * @memberof InfluxStorage
   */
  async resample(range) {
    let sourceTimeframe
    let destinationTimeframe

    this.options.influxResampleTo.sort((a, b) => a - b)

    for (let timeframe of this.options.influxResampleTo) {
      const flooredRange = {
        from: Math.floor(range.from / timeframe) * timeframe,
        to: Math.floor(range.to / timeframe) * timeframe + timeframe,
      }

      for (
        let i = this.options.influxResampleTo.indexOf(timeframe);
        i >= 0;
        i--
      ) {
        if (
          timeframe <= this.options.influxResampleTo[i] ||
          timeframe % this.options.influxResampleTo[i] !== 0
        ) {
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
      sum(cbuy) AS cbuy, 
      sum(csell) AS csell, 
      sum(lbuy) AS lbuy, 
      sum(lsell) AS lsell, 
      sum(vol) AS vol, 
      sum(vbuy) AS vbuy, 
      sum(vsell) AS vsell`

      const query_from = `${this.options.influxDatabase}.autogen.${this.options.influxMeasurement}_${sourceTimeframe}`
      const query_into = `${this.options.influxDatabase}.autogen.${this.options.influxMeasurement}_${destinationTimeframe}`
      const coverage = `WHERE time > ${flooredRange.from}ms AND time < ${flooredRange.to}ms`
      const group = `GROUP BY time(${destinationTimeframe}), exchange, pair fill(none)`

      await this.influx
        .query(
          `${query} INTO ${query_into} FROM ${query_from} ${coverage} ${group}`
        )
        .catch((err) => {
          console.log(err.message, '\nquery:\n', `${query} INTO ${query_into} FROM ${query_from} ${coverage} ${group}`)
        })
    }
  }

  getPreviousCloses() {
    this.influx
      .query(
        `SELECT close FROM ${this.options.influxMeasurement}${
          this.options.influxTimeframe
            ? '_' + getHms(this.options.influxTimeframe)
            : ''
        } GROUP BY "exchange", "pair" ORDER BY time DESC LIMIT 1`
      )
      .then((data) => {
        for (let bar of data) {
          this.lastClose[bar.exchange + bar.pair] = bar.close
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
  async save(trades) {
    if (!trades || !trades.length) {
      return Promise.resolve()
    }

    const groups = groupByPairs(trades)
    const resampleRange = {
      from: Infinity,
      to: 0,
    }

    for (let pair in groups) {
      const { from, to } = await this.import(groups[pair], pair)

      resampleRange.from = Math.min(from, resampleRange.from)
      resampleRange.to = Math.max(to, resampleRange.to)
    }

    await this.resample(resampleRange)
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
    let bars = []

    // array of liquidations
    let liquidations = []

    // current bar ({} of exchanges)
    let bar = {}

    // current time
    let barTs = 0

    const resampleRange = {
      from: Infinity,
      to: 0,
    }

    for (let i = 0; i <= trades.length; i++) {
      const trade = trades[i]
      let tradeTs

      // trade timestamp floored to timeframe
      if (trade) {
        if (trade.liquidation) {
          liquidations.push(trade)
        }

        tradeTs =
          Math.floor(trade.timestamp / this.options.influxTimeframe) *
          this.options.influxTimeframe

        resampleRange.from = Math.min(tradeTs, resampleRange.from)
        resampleRange.to = Math.max(tradeTs, resampleRange.to)
      }

      if (!trade || tradeTs > barTs) {
        for (let exchange in bar) {
          this.lastBar[exchange + pair] = bar[exchange]

          if (typeof bar[exchange].close === 'number') {
            // reg close for next bar
            this.lastClose[exchange + pair] = bar[exchange].close
          }

          bars.push(this.lastBar[exchange + pair])
        }

        if (!trade) {
          break
        }

        bar = {}
        barTs = tradeTs
      }

      const exchange = trade.exchange
      const identifier = exchange + pair

      if (!bar[exchange]) {
        if (
          this.lastBar[identifier] &&
          this.lastBar[identifier].time === tradeTs
        ) {
          // trades passed in save() contains some of the last batch (trade time = last bar time)
          // recover exchange point of lastbar
          bar[exchange] = this.lastBar[identifier]
        } else {
          // create new point
          bar[exchange] = {
            time: tradeTs,
            exchange: exchange,
            cbuy: 0,
            csell: 0,
            vbuy: 0,
            vsell: 0,
            lbuy: 0,
            lsell: 0,
            open: null,
            high: null,
            low: null,
            close: null,
          }

          if (typeof this.lastClose[identifier] === 'number') {
            // this bar open = last bar close (from last save or getReferencePoint on startup)
            bar[exchange].open = bar[exchange].high = bar[exchange].low = bar[
              exchange
            ].close = this.lastClose[identifier]
          }
        }
      }

      if (trade.liquidation) {
        // trade is a liquidation
        bar[exchange]['l' + trade.side] += trade.price * trade.size
      } else {
        if (bar[exchange].open === null) {
          // new bar without close in db, should only happen once
          console.log(`[influx] register new serie ${exchange}:${pair}`)
          bar[exchange].open = bar[exchange].high = bar[exchange].low = bar[
            exchange
          ].close = +trade.price
        }

        bar[exchange].high = Math.max(bar[exchange].high, +trade.price)
        bar[exchange].low = Math.min(bar[exchange].low, +trade.price)
        bar[exchange].close = +trade.price

        bar[exchange]['c' + trade.side]++
        bar[exchange]['v' + trade.side] += trade.price * trade.size
      }
    }

    const promises = []

    if (bars.length) {
      promises.push(
        this.influx.writePoints(
          bars.map((chunk, index) => {
            const fields = {
              cbuy: chunk.cbuy,
              csell: chunk.csell,
              vbuy: chunk.vbuy,
              vsell: chunk.vsell,
              lbuy: chunk.lbuy,
              lsell: chunk.lsell,
            }

            if (chunk.close !== null) {
              ;(fields.open = chunk.open),
                (fields.high = chunk.high),
                (fields.low = chunk.low),
                (fields.close = chunk.close)
            }

            if (chunk.high < chunk.open || chunk.high < chunk.close) {
              console.log('inside high', chunk.high, chunk)
            }
            if (chunk.low > chunk.open || chunk.low > chunk.close) {
              console.log('inside low', chunk.low, chunk)
            }

            return {
              measurement:
                'trades' +
                (this.options.influxTimeframe
                  ? '_' + getHms(this.options.influxTimeframe)
                  : ''),
              tags: {
                exchange: chunk.exchange,
                pair: pair,
              },
              fields: fields,
              timestamp: +chunk.time,
            }
          }),
          {
            precision: 'ms',
          }
        )
      )
    }

    if (liquidations.length) {
      promises.push(
        this.influx
          .writePoints(
            liquidations.map((trade, index) => {
              const fields = {
                size: +trade.price,
                price: +trade.size,
                side: trade[4] == 1 ? 'buy' : 'sell',
              }

              return {
                measurement: 'liquidations',
                tags: {
                  exchange: trade.exchange,
                  pair: pair,
                },
                fields: fields,
                timestamp: +trade.timestamp,
              }
            })
          )
          .catch((err) => {
            console.error('influx write failed (liquidation)', err.message)
          })
      )
    }

    return Promise.all(promises).then(() => ({
      ...resampleRange,
    }))
  }

  fetch({ from, to, timeframe = 60000, exchanges = [], pairs }) {
    const timeframeText = getHms(timeframe)

    let query = `SELECT * FROM "${this.options.influxDatabase}"."autogen"."trades_${timeframeText}" WHERE time >= ${from}ms AND time < ${to}ms`

    if (pairs.length) {
      query += ` AND pair =~ /${pairs.join('|')}/`
    }

    if (exchanges.length) {
      query += ` AND exchange =~ /${exchanges.join('|')}/`
    }

    return this.influx
      .query(query, {
        precision: 's',
      })
      .catch((err) => {
        console.error(
          `[storage/${this.name}] failed to retrieves trades between ${from} and ${to} with timeframe ${timeframe}\n\t`,
          err.message
        )
      })
  }
}

module.exports = InfluxStorage
