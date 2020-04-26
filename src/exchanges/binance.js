const Exchange = require('../exchange')

class Binance extends Exchange {
  constructor(options) {
    super(options)

    this.id = 'binance'

    this.endpoints = {
      PRODUCTS: 'https://api.binance.com/api/v1/ticker/allPrices',
    }

    this.options = Object.assign(
      {
        url: (pair) => {
          return 'wss://stream.binance.com:9443/stream?streams=' + this.pairs.map(pair => `${pair}@aggTrade`).join('/')
        },
      },
      this.options
    )
  }

  getMatch(pair) {
    if (!this.products) {
      return false;
    }

    if (this.products.indexOf(pair) !== -1) {
      return pair.toLowerCase()
    }

    return false
  }

  formatProducts(data) {
    return data.map(a => a.symbol)
  }

  /**
   * Sub
   * @param {WebSocket} api 
   * @param {string} pair 
   */
  subscribe(api, pair) {
    api.send(
      JSON.stringify({
        method: 'SUBSCRIBE',
        params: [this.matchs[pair] + '@aggTrade'],
      })
    )
  }

  onMessage(event) {
    const trade = JSON.parse(event.data)

    if (trade && trade.t) {
      this.emitTrades([[this.id, trade.E, +trade.p, +trade.q, trade.m ? 0 : 1]])
    }
  }
}

module.exports = Binance
