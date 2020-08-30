import Exchange from '../services/exchange'

export default class extends Exchange {
  constructor(options) {
    super(options)

    this.id = 'bitstamp'

    this.endpoints = {
      PRODUCTS: 'https://www.bitstamp.net/api/v2/trading-pairs-info/'
    }

    this.options = Object.assign(
      {
        url: () => {
          return `wss://ws.bitstamp.net/`
        }
      },
      this.options
    )
  }

  getMatch(pair) {
    if (!this.products) {
      return
    }

    if (this.products.indexOf(pair) !== -1) {
      return pair.toLowerCase()
    }

    return false
  }

  formatProducts(data) {
    return data.map(a => a.name.replace('/', ''))
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
        event: 'bts:subscribe',
        data: {
          channel: 'live_trades_' + this.matchs[pair]
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
        event: 'bts:unsubscribe',
        data: {
          channel: 'live_trades_' + this.matchs[pair]
        }
      })
    )
  }

  onMessage(event, api) {
    // channel:"live_trades_btcusd"
    const json = JSON.parse(event.data)

    if (!json || !json.data || !json.data.amount) {
      return
    }

    const trade = json.data

    return this.emitTrades(api.id, [
      {
        exchange: this.id,
        pair: json.channel.split('_').pop(),
        timestamp: +new Date(trade.microtimestamp / 1000),
        price: trade.price,
        size: trade.amount,
        side: trade.type === 0 ? 'buy' : 'sell'
      }
    ])
  }
}
