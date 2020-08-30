import Exchange from '../services/exchange'

export default class extends Exchange {
  constructor(options) {
    super(options)

    this.id = 'binance'
    this.lastSubscriptionId = 0
    this.subscriptions = {}

    this.endpoints = {
      PRODUCTS: 'https://api.binance.com/api/v1/ticker/allPrices'
    }

    this.options = Object.assign(
      {
        url: `wss://stream.binance.com:9443/ws/`
      },
      this.options
    )
  }

  getMatch(pair) {
    if (!this.products) {
      return
    }

    if (this.products[pair]) {
      return this.products[pair]
    }

    return false
  }

  formatProducts(data) {
    const products = {}

    for (let product of data) {
      products[product.symbol] = product.symbol.toLowerCase()
    }

    return
    products
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

    this.subscriptions[pair] = ++this.lastSubscriptionId

    const params = [this.matchs[pair] + '@trade']

    api.send(
      JSON.stringify({
        method: 'SUBSCRIBE',
        params,
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
      return
    }

    const params = [this.matchs[pair] + '@trade']

    api.send(
      JSON.stringify({
        method: 'UNSUBSCRIBE',
        params,
        id: this.subscriptions[pair]
      })
    )

    delete this.subscriptions[pair]
  }

  onMessage(event, api) {
    const json = JSON.parse(event.data)

    if (!json) {
      return
    } else if (json.E) {
      return this.emitTrades(api.id, [
        {
          exchange: this.id,
          pair: json.s.toLowerCase(),
          timestamp: json.E,
          price: +json.p,
          size: +json.q,
          side: json.m ? 'sell' : 'buy'
        }
      ])
    }
  }
}
