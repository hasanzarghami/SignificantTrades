const Exchange = require('../exchange')
const WebSocket = require('ws')
const pako = require('pako')
const axios = require('axios')

class Okex extends Exchange {
  constructor(options) {
    super(options)

    this.id = 'okex'

    this.endpoints = {
      PRODUCTS: [
        'https://www.okex.com/api/spot/v3/instruments',
        'https://www.okex.com/api/futures/v3/instruments',
        'https://www.okex.com/api/swap/v3/instruments',
      ],
    }

    this.liquidationProducts = []
    this.liquidationProductsReferences = {}

    this.options = Object.assign(
      {
        url: 'wss://real.okex.com:8443/ws/v3'
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
        let pair;

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

          pair = product.base_currency + product.quote_currency + '-' + 'SWAP'
          
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

    const type = this.types[this.match[pair]];

    if (type !== 'spot') {
      this.liquidationProducts.push(this.match[pair])
      this.liquidationProductsReferences[this.match[pair]] = +new Date()

      if (this.liquidationProducts.length === 1) {
        this.startLiquidationTimer()
      }

      console.debug(`[${this.id}] listen ${this.match[pair]} for liquidations`)
    }
    
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

    const type = this.types[this.match[pair]];

    if (type !== 'spot' && this.liquidationProducts.indexOf(this.match[pair]) !== -1) {
      this.liquidationProducts.splice(this.liquidationProducts.indexOf(this.match[pair]), 1)

      console.debug(`[${this.id}] unsubscribe ${this.match[pair]} from liquidations loop`)

      if (this.liquidationProducts.length === 0) {
        this.stopLiquidationTimer()
      }
    }
    
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

    return this.emitTrades(api.id, json.data.map(trade => {
      let size
      let name = this.id

      if (typeof this.specs[trade.instrument_id] !== 'undefined') {
        size = ((trade.size || trade.qty) * this.specs[trade.instrument_id]) / (this.inversed[trade.instrument_id] ? trade.price : 1)
        name += '_futures';
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
    }))
  }

  onApiBinded(api) {
    this.startKeepAlive(api);
  }

  onApiUnbinded(api) {
    this.stopKeepAlive(api);
  }

  startLiquidationTimer() {
    if (this._liquidationInterval) {
      return;
    }

    console.debug(`[${this.id}] start liquidation timer`)

    this._liquidationProductIndex = 0

    this._liquidationInterval = setInterval(this.fetchLatestLiquidations.bind(this), 1500)
  }

  stopLiquidationTimer() {
    if (!this._liquidationInterval) {
      return;
    }

    console.debug(`[${this.id}] stop liquidation timer`)

    clearInterval(this._liquidationInterval)

    delete this._liquidationInterval;
  }

  fetchLatestLiquidations() {
    const productId = this.liquidationProducts[this._liquidationProductIndex++ % this.liquidationProducts.length]

    if (!productId) {
      debugger
    }

    const productType = this.types[productId];

    this._liquidationAxiosHandler && this._liquidationAxiosHandler.cancel()
    this._liquidationAxiosHandler = axios.CancelToken.source()

    axios
      .get(
        `https://www.okex.com/api/${productType}/v3/instruments/${productId}/liquidation?status=1&limit=10`
      )
      .then(response => {
        if (!response.data || (response.data.error && response.data.error.length)) {
          console.log('getLiquidations => then => contain error(s)')
          this.emitError(new Error(response.data.error.join('\n')))
          return
        }

        const liquidations = response.data.filter(a => {
          return (
            !this.liquidationProductsReferences[productId] ||
            +new Date(a.created_at) > this.liquidationProductsReferences[productId]
          )
        })

        if (!liquidations.length) {
          return
        }

        console.log(productType, productId, liquidations.map(trade => trade.price + ' * ' + trade.size + ' (' + ((trade.size * this.specs[productId]) / trade.price) + ')'))

        this.liquidationProductsReferences[productId] = +new Date(liquidations[0].created_at)

        this.emitTrades(api.id, 
          liquidations.map(trade => {
            const timestamp = +new Date(trade.created_at)
            const size = (trade.size * this.specs[productId]) / trade.price

            return {
              exchange: this.id + '_futures', 
              timestamp, 
              price: +trade.price, 
              size: size, 
              side: trade.type === '4' ? 'buy' : 'sell',
              liquidation: true
            };
          })
        )
      })
      .catch(error => {
        console.log('catch', error.message, 'on', `https://www.okex.com/api/${productType}/v3/instruments/${productId}/liquidation?status=1&limit=10`);
        if (axios.isCancel(error)) {
          console.log('axios.isCancel');
          return
        }

        this.emitError(error)

        return error
      })
      .then(() => {
        delete this._liquidationAxiosHandler
      })
  }
}

module.exports = Okex
