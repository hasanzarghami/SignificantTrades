'use strict'

import EventEmitter from 'eventemitter3'

import exchanges from '../exchanges'

import store from '../store'

import '../data/typedef'

class Aggregator extends EventEmitter {
  constructor() {
    super()

    // aggregating trades
    this.queueBucket = {}
    // last source prices
    this.lastPrices = {}
    // last source prices
    this.aggrBucket = []
    // aggregated stats
    this.sumsBucket = {
      vbuy: 0,
      vsell: 0,
      lbuy: 0,
      lsell: 0,
      cbuy: 0,
      csell: 0
    }

    this.matchs = {}

    this.bindTimers()
  }

  bindTimers() {
    if (store.state.settings.showCounters || store.state.settings.showStats) {
      this.setupSumsInterval()
    }

    this.setupAggrInterval()

    store.subscribe(mutation => {
      switch (mutation.type) {
        case 'settings/TOGGLE_STATS':
        case 'settings/TOGGLE_COUNTERS':
          if (!this.showStats && !this.showCounters && this._sumsInterval) {
            this.clearSumsInterval()
          } else if (this.showStats || (this.showCounters && !this._sumsInterval)) {
            this.setupSumsInterval()
          }
          break
      }
    })
  }

  loadExchanges() {
    const promisesOfProducts = []

    for (let exchange of exchanges) {
      exchange.on('trades', this.onTrades.bind(this, exchange))
      exchange.on('liquidations', this.onTrades.bind(this, exchange))
      exchange.on('subscribed', this.onSubscribed.bind(this, exchange))
      exchange.on('unsubscribed', this.onUnsubscribed.bind(this, exchange))
      exchange.on('index', this.onIndex.bind(this, exchange))

      promisesOfProducts.push(exchange.fetchProducts())
    }

    Promise.all(promisesOfProducts).then(() => {
      console.log(`[server] listen ${store.state.settings.pairs.join(',')} on ${exchanges.length} exchange(s)`)

      return this.connectExchanges()
    })
  }

  onIndex(/* exchange, { source, trades } */) {}

  onTrades(exchange, { source, trades }) {
    if (!trades || !trades.length) {
      return
    }

    const length = trades.length

    const doAggr = store.state.settings.aggregateTrades
    const doSlip = store.state.settings.showSlippage

    if (!doAggr) {
      for (let i = 0; i < length; i++) {
        const trade = trades[i]

        trade.pair = this.matchs[source + trade.pair].mapped

        if (this._sumsInterval !== null) {
          const size = (store.state.settings.preferQuoteCurrencySize ? trade.price : 1) * trade.size

          if (!this.sumsBucket.timestamp) {
            this.sumsBucket.timestamp = trade.timestamp
          }

          if (trade.liquidation) {
            this.sumsBucket['l' + trade.side] += size
          } else {
            this.sumsBucket['c' + trade.side]++
            this.sumsBucket['v' + trade.side] += size
          }
        }

        doSlip && this.calculateSlippage(trades[i])

        this.aggrBucket.push(trades[i])
      }

      this.emit('trades', trades)
    } else {
      const now = +new Date()

      for (let i = 0; i < length; i++) {
        const trade = trades[i]
        const identifier = source + trade.pair

        trade.pair = this.matchs[identifier].mapped

        if (this._sumsInterval) {
          const size = (store.state.settings.preferQuoteCurrencySize ? trade.price : 1) * trade.size

          if (!this.sumsBucket.timestamp) {
            this.sumsBucket.timestamp = trade.timestamp
          }

          if (trade.liquidation) {
            this.sumsBucket['l' + trade.side] += size
          } else {
            this.sumsBucket['c' + trade.side]++
            this.sumsBucket['v' + trade.side] += size
          }
        }

        if (trade.liquidation) {
          this.aggrBucket.push(trade)
          continue
        }

        trade.ref = this.lastPrices[identifier] || trade.price

        this.lastPrices[identifier] = trade.price

        if (this.queueBucket[identifier]) {
          const queuedTrade = this.queueBucket[identifier]

          if (queuedTrade.timestamp === trade.timestamp && queuedTrade.side === trade.side) {
            queuedTrade.size += trade.size
            queuedTrade.price += trade.price * trade.size
            queuedTrade.high = Math.max(queuedTrade.high || queuedTrade.price / queuedTrade.size, trade.price)
            queuedTrade.low = Math.min(queuedTrade.low || queuedTrade.price / queuedTrade.size, trade.price)
            continue
          } else {
            queuedTrade.price /= queuedTrade.size
            doSlip && this.calculateSlippage(this.queueBucket[identifier])
            this.aggrBucket.push(queuedTrade)
          }
        }

        this.queueBucket[identifier] = Object.assign({}, trade)
        this.queueBucket[identifier].timeout = now + 50
        this.queueBucket[identifier].high = Math.max(trade.ref, trade.price)
        this.queueBucket[identifier].low = Math.min(trade.ref, trade.price)
        this.queueBucket[identifier].price *= this.queueBucket[identifier].size
      }

      this.emit('trades', trades)
    }
  }

  onLiquidations(/*exchange, { source, trades }*/) {}

  onSubscribed(exchange, localPair, remotePair, source) {
    if (this.matchs[source + remotePair]) {
      return
    }

    this.matchs[source + remotePair] = {
      source,
      exchange: exchange.id,
      remote: remotePair,
      local: localPair,
      hit: 0,
      timestamp: null
    }
  }

  onUnsubscribed(exchange, localPair, remotePair, source) {
    if (this.matchs[source + remotePair]) {
      delete this.matchs[source + remotePair]
    }
  }

  /**
   * Trigger subscribe to pairs (settings.pairs) on all enabled exchanges
   * @param {string[]} pairs
   * @returns {Promise<any>} promises of connections
   * @memberof Server
   */
  connectExchanges(pairs) {
    if (typeof pairs === 'undefined' || !Array.isArray(pairs) || !pairs.length) {
      pairs = store.state.settings.pairs
    }

    console.log(`[server] connect exchanges`)

    return Promise.all(exchanges.filter(exchange => store.state.settings.exchanges[exchange.id].enabled).map(exchange => exchange.connect(pairs)))
  }

  /**
   * Trigger unsubscribe to pairs on all activated exchanges
   * @param {string[]} pairs
   * @returns {Promise<void>} promises of disconnection
   * @memberof Server
   */
  disconnectExchanges(pairs) {
    console.log(`[server] disconnect exchanges`)

    return Promise.all(exchanges.map(exchange => exchange.disconnect(pairs)))
  }

  getExchangeById(id) {
    for (let exchange of exchanges) {
      if (exchange.id === id) {
        return exchange
      }
    }

    return null
  }

  setupSumsInterval() {
    console.log(`[socket] setup sums interval`)

    this._sumsInterval = setInterval(this.emitSums.bind(this), 100)
  }

  clearSumsInterval() {
    if (this._sumsInterval) {
      console.log(`[socket] clear sums interval`)

      clearInterval(this._sumsInterval)
      delete this._sumsInterval
    }
  }

  setupAggrInterval() {
    console.log(`[socket] setup aggr interval`)

    this._aggrInterval = setInterval(this.emitAggr.bind(this), 100)
  }

  clearAggrInterval() {
    if (this._aggrInterval) {
      console.log(`[socket] clear aggr interval`)

      clearInterval(this._aggrInterval)
      delete this._aggrInterval
    }
  }
  emitSums() {
    if (this.sumsBucket.timestamp) {
      this.emit('sums', this.sumsBucket)

      this.sumsBucket.timestamp = null
      this.sumsBucket.vbuy = 0
      this.sumsBucket.vsell = 0
      this.sumsBucket.cbuy = 0
      this.sumsBucket.csell = 0
      this.sumsBucket.lbuy = 0
      this.sumsBucket.lsell = 0
    }
  }
  emitAggr() {
    const now = +new Date()
    const inQueue = Object.keys(this.queueBucket)

    for (let i = 0; i < inQueue.length; i++) {
      const trade = this.queueBucket[inQueue[i]]
      if (now > trade.timeout) {
        trade.price /= trade.size
        this.calculateSlippage(trade)
        this.aggrBucket.push(trade)

        delete this.queueBucket[inQueue[i]]
      }
    }

    if (this.aggrBucket.length) {
      this.emit('trades.aggr', this.aggrBucket)
      this.aggrBucket.splice(0, this.aggrBucket.length)
    }
  }
  calculateSlippage(trade) {
    const type = store.state.settings.showSlippage

    if (type === 'price') {
      trade.slippage = (trade.ref - trade.price) * -1
    } else if (type === 'bps') {
      trade.slippage = Math.floor(((trade.high - trade.low) / trade.low) * 10000)
    }

    return trade.slippage
  }
}

export default new Aggregator()
