import Exchange from '../services/exchange'

export default class extends Exchange {
  constructor(options) {
    super(options)

    this.id = 'hitbtc'

    this.endpoints = {
      PRODUCTS: 'https://api.hitbtc.com/api/2/public/symbol'
    }

    this.options = Object.assign(
      {
        url: 'wss://api.hitbtc.com/api/2/ws/'
      },
      this.options
    )
  }

  formatProducts(data) {
    return data.map(a => a.id)
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
        method: 'subscribeTrades',
        params: {
          symbol: this.matchs[pair]
        }
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
        method: 'unsubscribeTrades',
        params: {
          symbol: this.matchs[pair]
        }
      })
    )
  }

  onMessage(event, api) {
    const json = JSON.parse(event.data)

    if (!json || json.method !== 'updateTrades' || !json.params || !json.params.data || !json.params.data.length) {
      return
    }

    return this.emitTrades(
      api.id,
      json.params.data.map(trade => ({
        exchange: this.id,
        pair: json.params.symbol,
        timestamp: +new Date(trade.timestamp),
        price: +trade.price,
        size: +trade.quantity,
        side: trade.side
      }))
    )
  }
}
