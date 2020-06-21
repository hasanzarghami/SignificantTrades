import Bitfinex from './bitfinex'

export default class extends Bitfinex {
  constructor(options) {
    super(options)

    this.id = 'bitfinex_futures'
  }

  formatProducts(data) {
    return data
      .filter(a => /ustf0/.test(a))
      .reduce((products, symbol) => {
        symbol = symbol.toUpperCase()
        products[symbol] = symbol
        products[symbol.replace(/f0|:/gi, '') + '-PERPETUAL'] = symbol

        return products
      }, {})
  }
}
