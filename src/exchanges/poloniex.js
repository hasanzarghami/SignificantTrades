const Exchange = require('../exchange')
const WebSocket = require('ws')

class Poloniex extends Exchange {
  constructor(options) {
    super(options)

    this.id = 'poloniex'
    this.channels = {}

    this.endpoints = {
      PRODUCTS: 'https://www.poloniex.com/public?command=returnTicker',
    }

    this.options = Object.assign(
      {
        url: 'wss://api2.poloniex.com',
      },
      this.options
    )
  }

  getMatch(pair) {
    if (this.products[pair]) {
      return this.products[pair]
    }

    return false
  }

  formatProducts(data) {
    let output = {}

    Object.keys(data).forEach((a) => {
      output[a.split('_').reverse().join('')] = a
    })

    return output
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
        command: 'subscribe',
        channel: this.match[pair],
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
        command: 'unsubscribe',
        channel: this.match[pair],
      })
    )
  }

  onMessage(event, api) {
    const json = JSON.parse(event.data)

    if (!json || json.length !== 3) {
      return
    }

    if (json[2] && json[2].length) {
      if (json[2][0][0] === 'i') {
        this.channels[json[0]] = json[2][0][1].currencyPair
      } else {
        return this.emitTrades(
          api.id,
          json[2]
            .filter((result) => result[0] === 't')
            .map((trade) => ({
              exchange: this.id,
              pair: this.channels[json[0]],
              timestamp: +new Date(trade[5] * 1000),
              price: +trade[3],
              size: +trade[4],
              side: trade[2] ? 'buy' : 'sell',
            }))
        )
      }
    }
  }
}

module.exports = Poloniex
