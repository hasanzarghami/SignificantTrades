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
        this.channels[json.chanId] = {
          name: json.channel,
          pair: json.pair
        }
      }
      return
    }

    if (!this.channels[json[0]] || json[1] === 'hb') {
      return
    }

    const channel = this.channels[json[0]];

    if (channel.name !== 'status' && !channel.hasReceivedInitialData) {
      console.log('set hasReceivedInitialData = true for channel', channel.name, channel.pair)
      channel.hasReceivedInitialData = true;
      return
    }

    if (channel.name === 'trades' && json[1] === 'te') {
      this.price = +json[2][3]

      this.emitTrades([
        {
          exchange: this.id,
          pair: this.mapPair(channel.pair),
          timestamp: +new Date(json[2][1]),
          price: +json[2][3],
          size: Math.abs(json[2][2]),
          side: json[2][2] < 0 ? 'sell' : 'buy',
        },
      ])

      return true;
    } else if (channel.name === 'status' && json[1]) {
      this.emitTrades(
        json[1]
          .filter((a) => this.pairs.indexOf(a[4].substring(1)) !== -1)
          .map((a) => { 
            return {
            exchange: this.id,
            pair: this.mapPair(a[4].substring(1)),
            timestamp: parseInt(a[2]),
            price: this.price,
            size: Math.abs(a[5]),
            side: a[5] > 1 ? 'buy' : 'sell',
            liquidation: true,
          }})
      )
      return true;
    }
  }
}

module.exports = Bitfinex
