const Exchange = require('../exchange')

class BinanceFutures extends Exchange {
  constructor(options) {
    super(options)

    this.id = 'binance_futures'
    this.lastSubscriptionId = 0
    this.subscriptions = {}

    this.endpoints = {
      PRODUCTS: 'https://fapi.binance.com/fapi/v1/exchangeInfo',
    }

    this.options = Object.assign(
      {
        url: () => 'wss://fstream.binance.com/ws',
      },
      this.options
    )
  }

  formatProducts(data) {
    return data.symbols.map((product) => product.symbol.toLowerCase())
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

    const params = [pair + '@trade', pair + '@forceOrder']

    api.send(
      JSON.stringify({
        method: 'SUBSCRIBE',
        params,
        id: this.subscriptions[pair],
      })
    )

    // BINANCE: WebSocket connections have a limit of 5 incoming messages per second.
    return new Promise((resolve) => setTimeout(resolve, 250))
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

    const params = [pair + '@trade', pair + '@forceOrder']

    api.send(
      JSON.stringify({
        method: 'UNSUBSCRIBE',
        params,
        id: this.subscriptions[pair],
      })
    )

    delete this.subscriptions[pair]

    // BINANCE: WebSocket connections have a limit of 5 incoming messages per second.
    return new Promise((resolve) => setTimeout(resolve, 250))
  }

  onMessage(event, api) {
    const json = JSON.parse(event.data)

    if (!json) {
      return
    } else {
      if (json.e === 'trade' && json.X !== 'INSURANCE_FUND') {
        return this.emitTrades(api.id, [
          {
            exchange: this.id,
            pair: json.s.toLowerCase(),
            timestamp: json.T,
            price: +json.p,
            size: +json.q,
            side: json.m ? 'sell' : 'buy',
          },
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
            liquidation: true,
          },
        ])
      }
    }
  }
}

module.exports = BinanceFutures
