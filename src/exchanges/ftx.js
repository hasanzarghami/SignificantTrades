const Exchange = require('../exchange')
const WebSocket = require('ws')

class Ftx extends Exchange {
  constructor(options) {
    super(options)

    this.id = 'ftx'

    this.endpoints = {
      PRODUCTS: 'https://ftx.com/api/markets',
    }

    this.options = Object.assign(
      {
        url: () => {
          return `wss://ftx.com/ws/`
        },
      },
      this.options
    )
  }

  getMatch(pair) {
    let remotePair = this.products[pair]

    if (!remotePair) {
      for (let name in this.products) {
        if (pair === this.products[name]) {
          remotePair = this.products[name]
          break
        }
      }
    }

    return remotePair || false
  }

  formatProducts(data) {
    return data.result.reduce((obj, product) => {
      let standardName = product.name
        .replace('/', 'SPOT')
        .replace(/-PERP$/g, '-USD')
        .replace(/[/-]/g, '')

      obj[standardName] = product.name

      return obj
    }, {})
  }

  /**
   * Sub
   * @param {WebSocket} api
   * @param {string} pair
   */
  subscribe(api, pair) {
    if (!super.subscribe.apply(this, arguments)) {
      return
    }

    api.send(
      JSON.stringify({
        op: 'subscribe',
        channel: 'trades',
        market: this.match[pair],
      })
    )
  }

  /**
   * Sub
   * @param {WebSocket} api
   * @param {string} pair
   */
  unsubscribe(api, pair) {
    if (!super.unsubscribe.apply(this, arguments)) {
      return
    }

    api.send(
      JSON.stringify({
        op: 'unsubscribe',
        channel: 'trades',
        market: this.match[pair],
      })
    )
  }

  onMessage(event, api) {
    const json = JSON.parse(event.data)

    if (!json || !json.data || !json.data.length) {
      return
    }

    return this.emitTrades(
      api.id,
      json.data.map((trade) => {
        const output = {
          exchange: this.id,
          pair: json.market,
          timestamp: +new Date(trade.time),
          price: +trade.price,
          size: trade.size,
          side: trade.side,
        }

        if (trade.liquidation) {
          output.liquidation = true
        }

        return output
      })
    )
  }
}

module.exports = Ftx
