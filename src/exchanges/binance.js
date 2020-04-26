const Exchange = require('../exchange')

class Binance extends Exchange {
  constructor(options) {
    super(options)

    this.id = 'binance'
    this.lastSubscriptionId = 0;
    this.subscriptions = {}

    this.endpoints = {
      PRODUCTS: 'https://api.binance.com/api/v1/ticker/allPrices',
    }

    this.options = Object.assign(
      {
        url: (pair) => {
          return `wss://stream.binance.com:9443/ws`
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
    if (!super.subscribe.apply(this, arguments)) {
      return;
    }

    this.subscriptions[pair] = ++this.lastSubscriptionId

    api.send(
      JSON.stringify({
        method: 'SUBSCRIBE',
        params: [this.match[pair] + '@trade'],
        id: this.subscriptions[pair]
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
      return;
    }

    console.log(`[${this.id}] send unsubscribe event (pair: ${pair}, id: ${this.subscriptions[pair]})`)

    api.send(
      JSON.stringify({
        method: 'UNSUBSCRIBE',
        params: [this.match[pair] + '@trade'],
        id: this.subscriptions[pair]
      })
    )

    delete this.subscriptions[pair];
  }

  onMessage(event) {
    const trade = JSON.parse(event.data)

    if (!trade || !trade.E) {
      console.warn(`[${this.id}] received unknown event ${event.data}`)
      return;
    }

    this.reportedVolume += trade.p * trade.q;
    
    this.emitTrades([{exchange: this.id, pair: this.mapPair(trade.s), timestamp: trade.E, price: +trade.p, size: +trade.q, side: trade.m ? 'sell' : 'buy'}])
  
    return true;
  }
}

module.exports = Binance
