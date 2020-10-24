const Exchange = require('../exchange')
const WebSocket = require('ws')

class Bybit extends Exchange {
  constructor(options) {
    super(options)

    this.id = 'bybit'

    this.endpoints = {
      PRODUCTS: 'https://api.bybit.com/v2/public/symbols',
    }

    this.mapping = (pair) => {
      if (this.pairs.indexOf(pair) !== -1) {
        return pair
      }

      return false
    }

    this.options = Object.assign(
      {
        url: (pair) => {
          return pair.indexOf('USDT') !== -1 ? 'wss://stream.bybit.com/realtime_public' : 'wss://stream.bybit.com/realtime'
        },
      },
      this.options
    )
  }

  getMatch(pair) {
    if (this.products[pair]) {
      return this.products[pair]
    }

    return false
  }

  formatProducts(data) {
    return data.result.reduce((output, product) => {
      output[product.name + '-PERPETUAL'] = product.name
      return output
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
        args: ['trade.' + this.match[pair]],
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
        args: ['trade.' + this.match[pair]],
      })
    )
  }

  onMessage(event, api) {
    const json = JSON.parse(event.data)

    if (!json.data || !json.topic || !json.data.length) {
      return
    }

    return this.emitTrades(
      api.id,
      json.data.map((trade) => {
        const size =  /USDT$/.test(trade.symbol) ? trade.size : trade.size / trade.price

        return {
          exchange: this.id,
          pair: trade.symbol,
          timestamp: +new Date(trade.timestamp),
          price: +trade.price,
          size: size,
          side: trade.side === 'Buy' ? 'buy' : 'sell',
        }
      })
    )
  }

  onApiBinded(api) {
    this.startKeepAlive(api, {op: 'ping'}, 45000);
  }

  onApiUnbinded(api) {
    this.stopKeepAlive(api);
  }
}

module.exports = Bybit
