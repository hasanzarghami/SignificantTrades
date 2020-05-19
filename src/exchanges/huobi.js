const Exchange = require('../exchange')
const pako = require('pako')

class Huobi extends Exchange {
  constructor(options) {
    super(options)

    this.id = 'huobi'

    this.types = []
    this.contractTypesAliases = {
      this_week: 'CW',
      next_week: 'NW',
      quarter: 'CQ',
    }

    this.endpoints = {
      PRODUCTS: [
        'https://api.huobi.pro/v1/common/symbols',
        'https://api.hbdm.com/api/v1/contract_contract_info',
      ],
    }

    this.options = Object.assign(
      {
        url: (pair) => {
          if (this.types[pair] === 'futures') {
            return 'wss://www.hbdm.com/ws'
          } else {
            return 'wss://api.huobi.pro/ws'
          }
        },
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

    if (remotePair) {
      if (remotePair.indexOf('_') !== -1) {
        this.types[remotePair] = 'futures'
      } else {
        this.types[remotePair] = 'spot'
      }
    }

    return remotePair || false
  }

  formatProducts(response) {
    const products = {}
    const specs = {}

    const types = ['spot', 'futures']

    response.forEach((data, index) => {
      data.data.forEach((product) => {
        let pair

        switch (types[index]) {
          case 'spot':
            pair = (
              product['base-currency'] + product['quote-currency']
            ).toUpperCase()
            products[pair] = pair
            break
          case 'futures':
            pair =
              product.symbol +
              '_' +
              this.contractTypesAliases[product.contract_type]
            products[
              product.symbol + 'USD' + '-' + product.contract_type.toUpperCase()
            ] = pair
            products[product.contract_code] = pair
            specs[pair] = +product.contract_size
            break
        }
      })
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

    const remotePair = this.match[pair]

    api.send(
      JSON.stringify({
        sub:
          'market.' +
          (this.types[remotePair] === 'futures'
            ? remotePair.toUpperCase()
            : remotePair.toLowerCase()) +
          '.trade.detail',
        id: remotePair,
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

    const remotePair = this.match[pair]

    api.send(
      JSON.stringify({
        unsub:
          'market.' +
          (this.types[remotePair] === 'futures'
            ? remotePair.toUpperCase()
            : remotePair.toLowerCase()) +
          '.trade.detail',
        id: remotePair,
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
      const remotePair = json.ch
        .replace(/market.(.*).trade.detail/, '$1')
        .toUpperCase()

      this.emitTrades(
        api.id,
        json.tick.data.map((trade) => {
          let amount = +trade.amount
          let name = this.id

          if (typeof this.specs[remotePair] !== 'undefined') {
            amount = (amount * this.specs[remotePair]) / trade.price
            name += '_futures'
          }

          return {
            exchange: name,
            pair: remotePair,
            timestamp: trade.ts,
            price: +trade.price,
            size: amount,
            side: trade.direction,
          }
        })
      )

      return true
    }
  }
}

module.exports = Huobi
