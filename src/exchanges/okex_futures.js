import Okex from './okex'

export default class extends Okex {
  constructor(options) {
    super(options)

    this.id = 'okex_futures'

    this.endpoints = {
      PRODUCTS: ['https://www.okex.com/api/futures/v3/instruments', 'https://www.okex.com/api/swap/v3/instruments']
    }

    this.options = Object.assign(
      {
        url: 'wss://real.okex.com:8443/ws/v3/'
      },
      this.options
    )
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
}
