import Exchange from '../services/exchange'

class Bybit extends Exchange {
  constructor(options) {
    super(options)

    this.id = 'bybit'

    this.products = ['BTCUSD', 'ETHUSD', 'EOSUSD', 'XRPUSD']

    this.mapping = pair => {
      if (this.pairs.indexOf(pair) !== -1) {
        return pair
      }

      return false
    }

    this.options = Object.assign(
      {
        url: () => {
          return `wss://stream.bybit.com/realtime/`
        }
      },
      this.options
    )
  }

  getMatch(pair) {
    if (this.products.indexOf(pair) !== -1) {
      return pair
    }

    return false
  }

  /**
   * Sub
   * @param {WebSocket} api
   * @param {string} pair
   */
  subscribe(api /*, pair */) {
    if (!super.subscribe.apply(this, arguments)) {
      return
    }

    api.send(
      JSON.stringify({
        op: 'subscribe',
        args: ['trade']
      })
    )
  }

  onMessage(event, api) {
    const json = JSON.parse(event.data)

    if (!json.data || !json.topic || !json.data.length) {
      return
    }

    const pair = json.topic.split('.').pop()

    if (this.pairs.indexOf(pair) === -1) {
      return
    }

    return this.emitTrades(
      api.id,
      json.data.map(trade => {
        return {
          exchange: this.id,
          pair: pair,
          timestamp: +new Date(trade.timestamp),
          price: +trade.price,
          size: trade.size / trade.price,
          side: trade.side === 'Buy' ? 'buy' : 'sell'
        }
      })
    )
  }
}

export default Bybit
