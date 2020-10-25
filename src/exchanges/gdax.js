const Exchange = require('../exchange')
const WebSocket = require('ws')
class Gdax extends Exchange {
  constructor(options) {
    super(options)

    this.id = 'gdax'

    this.endpoints = {
      PRODUCTS: 'https://api.pro.coinbase.com/products',
    }

    this.options = Object.assign(
      {
        url: 'wss://ws-feed.pro.coinbase.com',
      },
      this.options
    )
  }

  formatProducts(data) {
    const products = {}

    for (let symbol of data) {
      products[symbol.id.replace('-', '')] = symbol.id
    }

    return {
      products
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
        type: 'subscribe',
        channels: [{ name: 'matches', product_ids: [this.match[pair]] }],
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
        type: 'unsubscribe',
        channels: [{ name: 'matches', product_ids: [this.match[pair]] }],
      })
    )
  }

  onMessage(event, api) {
    const json = JSON.parse(event.data)

    if (json && json.size > 0) {
      return this.emitTrades(api.id, [
        {
          exchange: this.id,
          pair: json.product_id,
          timestamp: +new Date(json.time),
          price: +json.price,
          size: +json.size,
          side: json.side === 'buy' ? 'sell' : 'buy',
        },
      ])
    }
  }
}

module.exports = Gdax
