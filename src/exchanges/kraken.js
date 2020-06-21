import Exchange from '../services/exchange'

export default class extends Exchange {
  constructor(options) {
    super(options)

    this.id = 'kraken'

    this.endpoints = {
      PRODUCTS: 'https://api.kraken.com/0/public/AssetPairs'
    }

    this.options = Object.assign(
      {
        url: 'wss://ws.kraken.com/'
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

    for (let id in data.result) {
      if (data.result[id].wsname) {
        products[data.result[id].altname.replace('XBT', 'BTC')] = data.result[id].wsname
      }
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

    const event = {
      event: 'subscribe',
      pair: [this.matchs[pair]],
      subscription: {
        name: 'trade'
      }
    }

    api.send(JSON.stringify(event))
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

    const event = {
      event: 'unsubscribe',
      pair: [this.matchs[pair]],
      subscription: {
        name: 'trade'
      }
    }

    api.send(JSON.stringify(event))
  }

  onMessage(event, api) {
    const json = JSON.parse(event.data)

    if (!json || json.event === 'heartbeat') {
      return
    }

    if (json[1] && json[1].length) {
      return this.emitTrades(
        api.id,
        json[1].map(trade => ({
          exchange: this.id,
          pair: json[3],
          timestamp: trade[2] * 1000,
          price: +trade[0],
          size: +trade[1],
          side: trade[3] === 'b' ? 'buy' : 'sell'
        }))
      )
    }
  }
}
