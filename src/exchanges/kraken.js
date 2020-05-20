const Exchange = require('../exchange')
const WebSocket = require('ws')

class Kraken extends Exchange {
  constructor(options) {
    super(options)

    this.id = 'kraken'
    this.keepAliveIntervals = {}

    this.endpoints = {
      PRODUCTS: [
        'https://api.kraken.com/0/public/AssetPairs',
        'https://futures.kraken.com/derivatives/api/v3/instruments',
      ],
    }

    this.options = Object.assign(
      {
        url: (pair) => {
          if (typeof this.specs[pair] !== 'undefined') {
            return 'wss://futures.kraken.com/ws/v1'
          } else {
            return 'wss://ws.kraken.com'
          }
        },
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

    response.forEach((data, index) => {
      if (data.instruments) {
        for (let product of data.instruments) {
          if (!product.tradeable) {
            continue
          }

          const symbol = product.symbol.toUpperCase()

          specs[symbol] = product.contractSize
          products[symbol] = product.symbol
        }
      } else if (data.result) {
        for (let id in data.result) {
          if (data.result[id].wsname) {
            products[data.result[id].altname] = data.result[id].wsname
          }
        }
      }
    })

    return {
      products,
      specs,
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

    const event = {
      event: 'subscribe',
    }

    if (typeof this.specs[pair] !== 'undefined') {
      // futures contract
      event.product_ids = [this.match[pair]]
      event.feed = 'trade'
    } else {
      // spot
      event.pair = [this.match[pair]]
      event.subscription = {
        name: 'trade',
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
    }

    if (typeof this.specs[pair] !== 'undefined') {
      // futures contract
      event.product_ids = [this.match[pair]]
      event.feed = 'trade'
    } else {
      // spot
      event.pair = [this.match[pair]]
      event.subscription = {
        name: 'trade',
      }
    }

    api.send(JSON.stringify(event))
  }

  onMessage(event, api) {
    const json = JSON.parse(event.data)

    if (!json || json.event === 'heartbeat') {
      return
    }

    if (json.feed === 'trade' && json.qty) {
      // futures

      return this.emitTrades(api.id, [
        {
          exchange: this.id + '_futures',
          pair: json.product_id,
          timestamp: json.time,
          price: json.price,
          size: json.qty / json.price,
          side: json.side,
        },
      ])
    } else if (json[1] && json[1].length) {
      // spot

      return this.emitTrades(
        api.id,
        json[1].map((trade) => ({
          exchange: this.id,
          pair: json[3],
          timestamp: trade[2] * 1000,
          price: +trade[0],
          size: +trade[1],
          side: trade[3] === 'b' ? 'buy' : 'sell',
        }))
      )
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

module.exports = Kraken
