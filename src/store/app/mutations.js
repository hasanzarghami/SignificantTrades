import Vue from 'vue'

export default {
  SET_EXCHANGE_MATCH(state, { exchange, remotePair, localPair }) {
    const matchs = state.exchanges[exchange].matchs

    matchs.push({
      localPair,
      remotePair
    })

    Vue.set(state.exchanges[exchange], 'matchs', matchs)
  },
  UNSET_EXCHANGE_MATCH(state, { exchange, remotePair, localPair }) {
    const matchs = state.exchanges[exchange].matchs

    for (let match of matchs) {
      if (match.remotePair === remotePair && match.localPair === localPair) {
        matchs.splice(matchs.indexOf(match), 1)
      }
    }

    Vue.set(state.exchanges[exchange], 'matchs', matchs)
  },
  EXCHANGE_UPDATED(state, { exchange, active }) {
    if (!this.state.settings.exchanges[exchange]) {
      Vue.set(this.state.settings.exchanges, exchange, {})
    }

    const index = state.actives.indexOf(exchange)

    if (active && index === -1) {
      state.actives.push(exchange)
    } else if (!active && index !== -1) {
      state.actives.splice(index, 1)
    }
  },
  TOGGLE_LOADING(state, value) {
    state.isLoading = value ? true : false
  },
  CREATE_NOTICE(state, notice) {
    state.notices.push(notice)
  },
  REMOVE_NOTICE(state, notice) {
    const index = state.notices.indexOf(notice)

    if (index !== -1) {
      if (notice.hideTimeout) {
        clearTimeout(notice.hideTimeout)
      }

      state.notices.splice(index, 1)
    }
  },
  TOGGLE_SEARCH(state, value) {
    state.showSearch = value ? true : false
  },
  SET_OPTIMAL_DECIMAL(state, value) {
    state.optimalDecimal = value
  },
  SET_API_URL(state, value) {
    state.apiUrl = value
  },
  SET_PROXY_URL(state, value) {
    state.proxyUrl = value
  },
  SET_API_SUPPORTED_PAIRS(state, value) {
    if (!value) {
      state.apiSupportedPairs = []
    } else if (typeof value === 'string') {
      state.apiSupportedPairs = value.split(',').map(a => a.trim())
    } else {
      state.apiSupportedPairs = value
    }
  },
  SET_VERSION(state, value) {
    state.version = value
  },
  SET_BUILD_DATE(state, value) {
    state.buildDate = value
  },
  INDEX_EXCHANGE_PRODUCTS(state, { exchange, products }) {
    Vue.set(state.exchanges[exchange], 'products', products)

    for (let pair of products) {
      if (state.indexedProducts[pair]) {
        state.indexedProducts[pair].count++

        if (state.indexedProducts[pair].exchanges.indexOf(exchange) === -1) {
          state.indexedProducts[pair].exchanges.push(exchange)
        }
      } else {
        state.indexedProducts[pair] = {
          value: pair,
          count: 1,
          exchanges: [exchange]
        }
      }
    }
  }
}
