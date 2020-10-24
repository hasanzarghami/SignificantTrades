const Exchange = require('../exchange')

class Deribit extends Exchange {
  constructor(options) {
    super(options)

    this.id = 'deribit'

    this.endpoints = {
      PRODUCTS: 'https://www.deribit.com/api/v1/public/getinstruments',
    }

    this.options = Object.assign(
      {
        url: () => {
          return `wss://www.deribit.com/ws/api/v2`
        },
      },
      this.options
    )
  }

  getMatch(pair) {
    if (!this.products) {
      return false
    }

    if (this.products[pair]) {
      return this.products[pair]
    }

    // allow match to remote pair syntax also
    // so both BTCUSD and BTC-PERPETUAL as localPair will work
    for (let localPair in this.products) {
      if (this.products[localPair] === pair) {
        return this.products[localPair]
      }
    }

    return false
  }

  formatProducts(data) {
    return data.result.reduce((output, product) => {
      output[
        product.settlement === 'perpetual'
          ? product.baseCurrency + product.currency + '-PERPETUAL'
          : product.instrumentName
      ] = product.instrumentName
      return output
    }, {})
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
        method: 'public/subscribe',
        params: {
          channels: ['trades.' + this.match[pair] + '.raw'],
        },
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
        method: 'public/unsubscribe',
        params: {
          channels: ['trades.' + this.match[pair] + '.raw'],
        },
      })
    )
  }

  onMessage(event, api) {
    const json = JSON.parse(event.data)

    if (
      !json ||
      !json.params ||
      !json.params.data ||
      !json.params.data.length
    ) {
      return
    }

    return this.emitTrades(
      api.id,
      json.params.data.map((a) => {
        const trade = {
          exchange: this.id,
          pair: a.instrument_name,
          timestamp: +a.timestamp,
          price: +a.price,
          size: a.amount / a.price,
          side: a.direction,
        }

        if (a.liquidation) {
          trade.liquidation = true
        }

        return trade
      })
    )
  }

  onApiBinded(api) {
    this.startKeepAlive(api, { action: '/api/v1/public/ping' }, 45000)
  }

  onApiUnbinded(api) {
    this.stopKeepAlive(api)
  }
}

module.exports = Deribit
