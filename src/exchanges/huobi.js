const Exchange = require('../exchange')
const pako = require('pako')

class Huobi extends Exchange {
  constructor(options) {
    super(options)

    this.id = 'huobi'

    this.contractTypesAliases = {
      this_week: 'CW',
      next_week: 'NW',
      quarter: 'CQ',
    }

    this.endpoints = {
      PRODUCTS: [
        'https://api.huobi.pro/v1/common/symbols',
        'https://api.hbdm.com/api/v1/contract_contract_info',
        'https://api.hbdm.com/swap-api/v1/swap_contract_info',
      ],
    }

    this.options = Object.assign(
      {
        url: (pair) => {
          if (this.types[this.match[pair]] === 'futures') {
            return 'wss://www.hbdm.com/ws'
          } else if (this.types[this.match[pair]] === 'swap') {
            return 'wss://api.hbdm.com/swap-ws'
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

    return remotePair || false
  }

  formatProducts(response) {
    const products = {}
    const specs = {}
    const types = {}

    response.forEach((data, index) => {
      data.data.forEach((product) => {
        let pair

        switch (['spot', 'futures', 'swap'][index]) {
          case 'spot':
            pair = (
              product['base-currency'] + product['quote-currency']
            ).toUpperCase()
            products[pair] = pair.toLowerCase()
            types[products[pair]] = 'spot'
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
            types[pair] = 'futures'
            break
          case 'swap':
            products[product.symbol + 'USD' + '-PERPETUAL'] =
              product.contract_code
            types[product.contract_code] = 'swap'
            specs[product.contract_code] = +product.contract_size
            break
        }
      })
    })

    return {
      products,
      specs,
      types,
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
        sub: 'market.' + remotePair + '.trade.detail',
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
        unsub: 'market.' + remotePair + '.trade.detail',
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

      let name = this.id;

      if (!this.types[remotePair]) {
        debugger;
      }

      if (this.types[remotePair] !== 'spot') {
        name += '_futures'
      }

      this.emitTrades(
        api.id,
        json.tick.data.map((trade) => {
          let amount = +trade.amount

          if (typeof this.specs[remotePair] !== 'undefined') {
            amount = (amount * this.specs[remotePair]) / trade.price
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
