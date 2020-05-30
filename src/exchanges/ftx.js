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
      if (product.type === 'spot') {
        obj[product.name.replace('/', '')] = product.name
      } else if (product.type === 'future') {
        if (/PERP$/.test(product.name)) {
          obj[product.name.replace('-', 'USD-').replace('PERP', 'PERPETUAL')] = product.name
        } else {
          obj[product.name.replace('-', 'USD-')] = product.name
        }
      }

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

  onApiBinded(api) {
    console.log('ftx api binded', api);
    this.startKeepAlive(api, {op: 'ping'}, 15000);
  }

  onApiUnbinded(api) {
    console.log('ftx api unbinded', api);
    this.stopKeepAlive(api);
  }
}

module.exports = Ftx
