import Exchange from '../services/exchange'

export default class extends Exchange {
  constructor(options) {
    super(options)

    this.id = 'binance_futures'
    this.lastSubscriptionId = 0
    this.subscriptions = {}

    this.endpoints = {
      PRODUCTS: 'https://fapi.binance.com/fapi/v1/exchangeInfo'
    }

    this.options = Object.assign(
      {
        url: 'wss://fstream.binance.com/ws/'
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
    const products = {}

    for (let product of data.symbols) {
      products[product.symbol + '-PERPETUAL'] = product.symbol.toLowerCase()
    }

    return products
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

    if (/-PERPETUAL/.test(pair)) {
      params.push(this.matchs[pair] + '@forceOrder')
    }

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

    if (/-PERPETUAL/.test(pair)) {
      params.push(this.matchs[pair] + '@forceOrder')
    }

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
    } else if (json.e === 'trade' && json.X !== 'INSURANCE_FUND') {
      return this.emitTrades(api.id, [
        {
          exchange: this.id,
          pair: json.s.toLowerCase(),
          timestamp: json.T,
          price: +json.p,
          size: +json.q,
          side: json.m ? 'sell' : 'buy'
        }
      ])
    } else if (json.e === 'forceOrder') {
      return this.emitLiquidations(api.id, [
        {
          exchange: this.id,
          pair: json.o.s.toLowerCase(),
          timestamp: json.o.T,
          price: +json.o.p,
          size: +json.o.q,
          side: json.o.S === 'BUY' ? 'buy' : 'sell',
          liquidation: true
        }
      ])
    }
  }
}
