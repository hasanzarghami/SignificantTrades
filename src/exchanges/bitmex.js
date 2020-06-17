import Exchange from '../services/exchange'

class Bitmex extends Exchange {
  constructor(options) {
    super(options)

    this.id = 'bitmex'
    this.pairCurrencies = {}

    this.endpoints = {
      PRODUCTS: 'https://www.bitmex.com/api/v1/instrument/active'
    }

    this.options = Object.assign(
      {
        url: () => {
          return `wss://www.bitmex.com/realtime/`
        }
      },
      this.options
    )
  }

  getMatch(pair) {
    let remotePair = this.products[pair]

    if (!remotePair) {
      for (let name in this.products) {
        if (pair === this.products[name]) {
          remotePair = this.products[name]
          break
        }
      }
    }

    return remotePair || false
  }

  formatProducts(data) {
    const products = {}

    for (let product of data) {
      let pair = product.symbol.replace('XBT', 'BTC')

      if (!product.expiry) {
        pair = pair + '-PERPETUAL'
      }

      products[pair] = product.symbol

      this.pairCurrencies[product.symbol] = product.quoteCurrency
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
        op: 'subscribe',
        args: ['trade:' + this.match[pair], 'liquidation:' + this.match[pair]]
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
        op: 'subscribe',
        args: ['trade:' + this.match[pair], 'liquidation:' + this.match[pair]]
      })
    )
  }

  onMessage(event, api) {
    const json = JSON.parse(event.data)

    if (json && json.data && json.data.length) {
      if (json.table === 'liquidation' && json.action === 'insert') {
        return this.emitLiquidations(
          api.id,
          json.data.map(trade => ({
            exchange: this.id,
            pair: trade.symbol,
            timestamp: +new Date(),
            price: trade.price,
            size: trade.leavesQty / (this.pairCurrencies[trade.symbol] === 'USD' ? trade.price : 1),
            side: trade.side === 'Buy' ? 'buy' : 'sell',
            liquidation: true
          }))
        )
      } else if (json.table === 'trade' && json.action === 'insert') {
        return this.emitTrades(
          api.id,
          json.data.map(trade => ({
            exchange: this.id,
            pair: trade.symbol,
            timestamp: +new Date(trade.timestamp),
            price: trade.price,
            size: trade.size / (this.pairCurrencies[trade.symbol] === 'USD' ? trade.price : 1),
            side: trade.side === 'Buy' ? 'buy' : 'sell'
          }))
        )
      }
    }
  }
}

export default Bitmex
