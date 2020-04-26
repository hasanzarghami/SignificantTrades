const Exchange = require('../exchange')

class Bitfinex extends Exchange {
  constructor(options) {
    super(options)

    this.id = 'bitfinex'

    this.channels = {};

    this.endpoints = {
      PRODUCTS: 'https://api.bitfinex.com/v1/symbols',
    }

    this.options = Object.assign(
      {
        url: 'wss://api.bitfinex.com/ws/2',
      },
      this.options
    )
  }

  formatProducts(data) {
    return data.map(a => a.toUpperCase())
  }

  /**
   * Sub
   * @param {WebSocket} api 
   * @param {string} pair 
   */
  subscribe(api, pair) {
    api.send(
      JSON.stringify({
        event: 'subscribe',
        channel: 'trades',
        symbol: 't' + this.match[pair],
      })
    )
  }

  onMessage(event) {
    const json = JSON.parse(event.data)

    if (json.event) {
      if (json.chanId) {
        this.channels[json.chanId] = json.channel
      }
      return
    }

    if (!this.channels[json[0]] || json[1] === 'hb') {
      return
    }

    switch (this.channels[json[0]]) {
      case 'trades':
        if (json[1] === 'te') {
          this.price = +json[2][3]

          this.emitTrades([
            [
              this.id,
              +new Date(json[2][1]),
              +json[2][3],
              Math.abs(json[2][2]),
              json[2][2] < 0 ? 0 : 1,
            ],
          ])
        }
        break
      case 'status':
        if (!json[1]) {
          return
        }

        this.emitTrades(
          json[1]
            .filter((a) => this.pairs.indexOf(a[4].substring(1)) !== -1)
            .map((a) => [
              this.id,
              parseInt(a[2]),
              this.price,
              Math.abs(a[5]),
              a[5] > 1 ? 1 : 0,
              1,
            ])
        )
        break
    }
  }
}

module.exports = Bitfinex
