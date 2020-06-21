import Exchange from '../services/exchange'

export default class extends Exchange {
  constructor(options) {
    super(options)

    this.id = 'kraken_futures'

    this.endpoints = {
      PRODUCTS: 'https://futures.kraken.com/derivatives/api/v3/instruments'
    }

    this.options = Object.assign(
      {
        url: 'wss://futures.kraken.com/ws/v1/'
      },
      this.options
    )
  }

  getMatch(pair) {
    if (this.products[pair]) {
      return this.products[pair]
    }

    for (let id in this.products) {
      if (this.products[id].toLowerCase() === pair.toLowerCase()) {
        return this.products[id]
      }
    }

    return false
  }

  formatProducts(data) {
    const products = {}
    const specs = {}

    for (let product of data.instruments) {
      if (!product.tradeable) {
        continue
      }

      const remotePair = product.symbol.toUpperCase()
      let pair = remotePair

      if (/^PI_/i.test(pair)) {
        pair = pair.replace(/^PI_/, '').replace('XBT', 'BTC') + '-PERPETUAL'
      }

      specs[remotePair] = product.contractSize
      products[pair] = remotePair
    }

    return {
      products,
      specs
    }
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
        event: 'subscribe',
        product_ids: [this.matchs[pair]],
        feed: 'trade'
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
        event: 'unsubscribe',
        product_ids: [this.matchs[pair]],
        feed: 'trade'
      })
    )
  }

  onMessage(event, api) {
    const json = JSON.parse(event.data)

    if (!json || json.event === 'heartbeat') {
      return
    }

    if (json.feed === 'trade' && json.qty) {
      return this.emitTrades(api.id, [
        {
          exchange: this.id,
          pair: json.product_id,
          timestamp: json.time,
          price: json.price,
          size: json.qty / json.price,
          side: json.side
        }
      ])
    }

    return false
  }

  onApiBinded(api) {
    if (/futures/.test(api.url)) {
      this.startKeepAlive(api)
    }
  }

  onApiUnbinded(api) {
    if (/futures/.test(api.url)) {
      this.stopKeepAlive(api)
    }
  }
}
