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
          return 'wss://stream.binance.com:9443/stream?streams=' + this.pairs.map(pair => `${pair}@trade`).join('/')
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
        params: [this.matchs[pair] + '@trade'],
      })
    )
  }

  onMessage(event) {
    const json = JSON.parse(event.data)

    if (!json || !json.data) {
      return false;
    }

    const trade = json.data;
    
    this.emitTrades([{exchange: this.id, pair: this.mapPair(trade.s), timestamp: trade.E, price: +trade.p, size: +trade.q, side: trade.m ? 'sell' : 'buy'}])
  }
}

module.exports = Binance
