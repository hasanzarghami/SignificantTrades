import Exchange from '../services/exchange'
import pako from 'pako'

export default class extends Exchange {
  constructor(options) {
    super(options)

    this.id = 'huobi'

    this.endpoints = {
      PRODUCTS: 'https://api.huobi.pro/v1/common/symbols'
    }

    this.options = Object.assign(
      {
        url: 'wss://api.huobi.pro/ws/'
      },
      this.options
    )
  }

  getMatch(pair) {
    if (!this.products) {
      return false
    }

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

    data.data.forEach(product => {
      let pair = (product['base-currency'] + product['quote-currency']).toUpperCase()
      products[pair] = pair.toLowerCase()
    })

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

    const remotePair = this.matchs[pair]

    api.send(
      JSON.stringify({
        sub: 'market.' + remotePair + '.trade.detail',
        id: remotePair
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

    const remotePair = this.matchs[pair]

    api.send(
      JSON.stringify({
        unsub: 'market.' + remotePair + '.trade.detail',
        id: remotePair
      })
    )
  }

  onMessage(event, api) {
    const json = JSON.parse(pako.inflate(event.data, { to: 'string' }))

    if (!json) {
      console.log(json)
      return
    }

    if (json.ping) {
      api.send(JSON.stringify({ pong: json.ping }))
      return
    } else if (json.tick && json.tick.data && json.tick.data.length) {
      const remotePair = json.ch.replace(/market.(.*).trade.detail/, '$1')

      if (!this.types[remotePair]) {
        debugger
      }

      this.emitTrades(
        api.id,
        json.tick.data.map(trade => {
          let amount = +trade.amount

          return {
            exchange: this.id,
            pair: remotePair,
            timestamp: trade.ts,
            price: +trade.price,
            size: amount,
            side: trade.direction
          }
        })
      )

      return true
    }
  }
}
