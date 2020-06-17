import Exchange from '../services/exchange'

import pako from 'pako'

class Okex extends Exchange {
  constructor(options) {
    super(options)

    this.id = 'okex'
    this.hasFutures = true

    this.endpoints = {
      PRODUCTS: [
        'https://www.okex.com/api/spot/v3/instruments',
        'https://www.okex.com/api/futures/v3/instruments',
        'https://www.okex.com/api/swap/v3/instruments'
      ]
    }

    this.options = Object.assign(
      {
        url: 'wss://real.okex.com:8443/ws/v3/'
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

  formatProducts(response) {
    const products = {}
    const specs = {}
    const types = {}
    const inversed = {}

    response.forEach(data => {
      for (let product of data) {
        let pair

        if (product.alias) {
          // futures

          pair = product.base_currency + product.quote_currency + '-' + product.alias.toUpperCase()

          products[pair] = product.instrument_id
          specs[product.instrument_id] = +product.contract_val
          types[product.instrument_id] = 'futures'

          if (product.is_inverse) {
            inversed[product.instrument_id] = true
          }
        } else if (/-SWAP/.test(product.instrument_id)) {
          // swap

          pair = product.base_currency + product.quote_currency + '-' + 'PERPETUAL'

          products[pair] = product.instrument_id
          specs[product.instrument_id] = +product.contract_val
          types[product.instrument_id] = 'swap'

          if (product.is_inverse) {
            inversed[product.instrument_id] = true
          }
        } else {
          pair = product.base_currency + product.quote_currency

          products[pair] = product.instrument_id
          types[product.instrument_id] = 'spot'
        }
      }
    })

    return {
      products,
      specs,
      types,
      inversed
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

    const type = this.types[this.match[pair]]

    api.send(
      JSON.stringify({
        op: 'subscribe',
        args: [`${type}/trade:${this.match[pair]}`]
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

    const type = this.types[this.match[pair]]

    api.send(
      JSON.stringify({
        op: 'unsubscribe',
        args: [`${type}/trade:${this.match[pair]}`]
      })
    )
  }

  onMessage(event, api) {
    let json

    try {
      if (event instanceof String) {
        json = JSON.parse(event)
      } else {
        json = JSON.parse(pako.inflateRaw(event.data, { to: 'string' }))
      }
    } catch (error) {
      return
    }

    if (!json || !json.data || !json.data.length) {
      return
    }

    return this.emitTrades(
      api.id,
      json.data.map(trade => {
        let size
        let name = this.id

        if (typeof this.specs[trade.instrument_id] !== 'undefined') {
          size = ((trade.size || trade.qty) * this.specs[trade.instrument_id]) / (this.inversed[trade.instrument_id] ? trade.price : 1)
          name += '_futures'
        } else {
          size = trade.size
        }

        return {
          exchange: name,
          pair: trade.instrument_id,
          timestamp: +new Date(trade.timestamp),
          price: +trade.price,
          size: +size,
          side: trade.side
        }
      })
    )
  }

  onApiBinded(api) {
    this.startKeepAlive(api)
  }

  onApiUnbinded(api) {
    this.stopKeepAlive(api)
  }
}

export default Okex
