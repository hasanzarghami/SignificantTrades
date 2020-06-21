import exchanges from '../../exchanges'

export default {
  pairs: [],
  exchanges: exchanges.reduce((state, exchange) => {
    state[exchange.id] = {
      products: [],
      matchs: [],
      apis: []
    }

    return state
  }, {}),
  showSearch: false,
  actives: [],
  activeSeries: [],
  notices: [],
  isLoading: false,
  supportedPairs: [],
  indexedProducts: {},
  proxyUrl: null,
  apiUrl: null,
  version: 'DEV',
  buildDate: 'now'
}
