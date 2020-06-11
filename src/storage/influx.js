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

    this.influx = new Influx.InfluxDB({
      host: this.options.influxUrl,
      database: this.options.influxDatabase
    })

    const databases = await this.influx.getDatabaseNames()
    
    if (!databases.includes('significant_trades')) {
      await this.influx.createDatabase('significant_trades')
    }

    await this.getPreviousCloses()

    /* const exchanges = await this.getStoredExchanges()

    for (let exchange of this.options.exchanges) {
      for (let pair of this.options.pairs) {
        promisesOfReferences.push(this.getReferencePoint(exchange, pair))
      }
    } */

    
    if (this.options.api) {
      await this.setupResampling()
    }
  }

  /**
   * Create continuous queries if not exists
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

      const group = `GROUP BY time(${into}), exchange, pair fill(none)`

      const cq_query = `
        CREATE CONTINUOUS QUERY cq_${into} ON ${this.options.influxDatabase} 
        RESAMPLE FOR ${getHms(timeframe * 2)} 
        BEGIN 
          ${query} INTO ${query_into} FROM ${query_from} ${group}
        END
      `
      try {
        await this.influx.query(cq_query)
      } catch (error) {
        console.error(`[influx] failed to create cq query`, error);
      }
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

    const cqs = await this.influx.query(`SHOW CONTINUOUS QUERIES`)

    if (cqs) {
      console.log(
        `[storage/${this.name}] ${cqs.length} active continuous queries\n\t-> ${cqs
          .map((a) => a.name)
          .join(', ')}`
      )
    }
  }

  
  getPreviousCloses() {
    this.influx
      .query(`SELECT close FROM ${this.options.influxMeasurement}${this.options.influxTimeframe ? '_' + getHms(this.options.influxTimeframe) : ''} GROUP BY "exchange", "pair" ORDER BY time DESC LIMIT 1`)
      .then((data) => {
        for (let bar of data) {
          this.lastClose[bar.exchange + bar.pair] = bar.close
        }
      });
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
    let bars = []

    // array of liquidations
    let liquidations = [];

    // current bar ({} of exchanges)
    let bar = {}

    // current time
    let barTs = 0

    for (let i = 0; i <= trades.length; i++) {
      const trade = trades[i]
      let tradeTs

      // trade timestamp floored to timeframe
      if (trade) {
        if (trade.liquidation) {
          liquidations.push(trade);
        }

        tradeTs = Math.floor(trade.timestamp / this.options.influxTimeframe) * this.options.influxTimeframe
      }

      if (!trade || tradeTs > barTs) {
        for (let exchange in bar) {
          this.lastBar[exchange + pair] = bar[exchange]

          if (typeof bar[exchange].close === 'number') {
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

      const exchange = trade.exchange;
      const identifier = exchange + pair;

      if (!bar[exchange]) {
        if (this.lastBar[identifier] && this.lastBar[identifier].time === tradeTs) {
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
            high: 0,
            low: Infinity,
            close: null
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
          // is a new bar, and
          bar[exchange].open = +trade.price
        }
  
        bar[exchange].high = Math.max(bar[exchange].high, +trade.price)
        bar[exchange].low = Math.min(bar[exchange].low, +trade.price)
        bar[exchange].close = +trade.price
  
        bar[exchange]['c' + trade.side]++
        bar[exchange]['v' + trade.side] += trade.price * trade.size
      }
    }

    const promises = [];

    if (bars.length) {
      promises.push(this.influx
      .writePoints(
        bars.map((chunk, index) => {
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
        console.error('influx write failed (bars)', err.message)
      }))
    }

    if (liquidations.length) {
      promises.push(this.influx
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
                pair: pair
              },
              fields: fields,
              timestamp: +trade.timestamp
            }
          }),
          {
            precision: 'ms'
          }
        )
        .catch((err) => {
          console.error('influx write failed (liquidation)', err.message)
        }))
    }

    return Promise.all(promises);
  }

  fetch({from, to, timeframe = 60000, exchanges = [], pairs}) {
    const timeframeText = getHms(timeframe)
    
    let query = `SELECT * FROM "${this.options.influxDatabase}"."autogen"."trades_${timeframeText}" WHERE time >= ${from}ms AND time < ${to}ms`;

    if (pairs.length) {
      query += ` AND pair =~ /${pairs.join(
        '|'
      )}/`
    }

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
