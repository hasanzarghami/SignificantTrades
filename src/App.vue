<template>
  <div
    id="app"
    :data-prefer="preferQuoteCurrencySize ? 'quote' : 'base'"
    :data-base="baseCurrency"
    :data-quote="quoteCurrency"
    :data-symbol="symbol"
    :data-pair="pair"
    :class="{
      loading: isLoading
    }"
  >
    <div class="notices">
      <Notice v-for="(notice, index) in notices" :key="index" :notice="notice" />
    </div>
    <Settings v-if="showSettings" @close="showSettings = false" />
    <div class="app__wrapper">
      <div
        v-if="showSearch"
        ref="searchWrapper"
        class="app__search"
        @click="$event.target === $refs.searchWrapper && $store.commit('app/TOGGLE_SEARCH', false)"
      >
        <Autocomplete
          :load="search"
          :selected="pairs"
          @submit="$store.commit('settings/SET_PAIRS', $event), $store.commit('app/TOGGLE_SEARCH', false)"
          v-slot="{ item }"
        >
          <span
            >{{ item.value }}
            <div class="badge">{{ item.exchanges.join(', ') }}</div></span
          >
        </Autocomplete>
      </div>
      <Header :price="price" @toggleSettings="showSettings = !showSettings" />
      <div class="app__layout">
        <div class="app__left">
          <Chart v-if="showChart" />
          <Exchanges v-if="showChart && showExchangesBar" />
        </div>
        <div class="app__right">
          <Counters v-if="showCounters" />
          <Stats v-if="showStats" />
          <TradeList />
        </div>
      </div>
    </div>
    <dialogs-wrapper></dialogs-wrapper>
  </div>
</template>

<script>
'use strict'

import { mapState } from 'vuex'
import { formatPrice, formatAmount, movingAverage, countDecimals } from './utils/helpers'

import Notice from './components/ui/Notice.vue'
import Header from './components/ui/Header.vue'
import Autocomplete from './components/ui/Autocomplete.vue'
import Settings from './components/Settings.vue'
import TradeList from './components/TradeList.vue'
import Chart from './components/chart/Chart.vue'
import Counters from './components/Counters.vue'
import Stats from './components/Stats.vue'
import Exchanges from './components/Exchanges.vue'
import upFavicon from '../src/assets/up.png'
import downFavicon from '../src/assets/down.png'
import aggregator from './services/aggregator'

const faviconDirection = {
  direction: null,
  index: 0,
  slow: 0,
  fast: 0
}

let searchLetter

export default {
  components: {
    Header,
    Settings,
    TradeList,
    Chart,
    Counters,
    Notice,
    Stats,
    Exchanges,
    Autocomplete
  },
  name: 'app',
  data() {
    return {
      price: null,
      baseCurrency: 'bitcoin',
      quoteCurrency: 'dollar',
      symbol: '$',

      showSettings: false,
      showStatistics: false,
      calculateOptimalPrice: true
    }
  },
  computed: {
    ...mapState('app', ['isLoading', 'actives', 'notices', 'showSearch', 'pairs']),
    ...mapState('settings', ['pair', 'showChart', 'showCounters', 'showStats', 'decimalPrecision', 'preferQuoteCurrencySize', 'showExchangesBar'])
  },
  created() {
    this.$root.formatPrice = formatPrice
    this.$root.formatAmount = formatAmount

    this.onStoreMutation = this.$store.subscribe(mutation => {
      switch (mutation.type) {
        case 'settings/SET_PAIRS':
          /* this.updatePairCurrency(mutation.payload)
          socket.connectExchanges(mutation.payload) */
          this.calculateOptimalPrice = true
          break
        case 'app/TOGGLE_SEARCH':
          if (mutation.payload) {
            setTimeout(() => {
              const input = this.$refs.searchWrapper.querySelector('.autocomplete__input')

              if (searchLetter) {
                input.innerText = searchLetter
                searchLetter = null
              }
            })

            this.bindSearchClickOutside()
          } else {
            this.unbindSearchClickOutside()
          }
          break
      }
    })

    // this.updatePrice()
    // this.updatePairCurrency(this.pair)
  },
  mounted() {
    this.bindSearchOpenByKey()
  },
  beforeDestroy() {
    this.unbindSearchOpenByKey()
    clearTimeout(this._updatePriceTimeout)

    this.onStoreMutation()
  },
  methods: {
    search(query) {
      return Object.values(this.$store.state.app.indexedProducts).filter(a => new RegExp(query, 'i').test(a.value))
    },
    bindSearchOpenByKey() {
      this._autocompleteHandler = (event => {
        if (
          this.showSearch ||
          document.activeElement.tagName === 'INPUT' ||
          document.activeElement.tagName === 'SELECT' ||
          document.activeElement.isContentEditable
        ) {
          return
        }

        event = event || window.event
        const charCode = event.which || event.keyCode
        const charStr = String.fromCharCode(charCode)

        if (/[a-z0-9]/i.test(charStr)) {
          searchLetter = charStr
          this.$store.commit('app/TOGGLE_SEARCH', true)
        }
      }).bind(this)

      document.addEventListener('keypress', this._autocompleteHandler)
    },
    unbindSearchOpenByKey() {
      if (this._autocompleteHandler) {
        document.removeEventListener('keypress', this._autocompleteHandler)
        delete this._autocompleteHandler
      }
    },
    updatePairCurrency(pair) {
      const name = pair.replace(/-[\w\d]*$/, '')

      const symbols = {
        BTC: ['bitcoin', '฿'],
        GBP: ['pound', '£'],
        EUR: ['euro', '€'],
        USD: ['dollar', '$'],
        JPY: ['yen', '¥'],
        ETH: ['ethereum', 'ETH'],
        XRP: ['xrp', 'XRP'],
        LTC: ['ltc', 'LTC'],
        TRX: ['trx', 'TRX'],
        ADA: ['ada', 'ADA'],
        IOTA: ['iota', 'IOTA'],
        XMR: ['xmr', 'XMR'],
        NEO: ['neo', 'NEO'],
        EOS: ['eos', 'EOS']
      }

      this.baseCurrency = 'coin'
      this.quoteCurrency = 'dollar'
      this.symbol = '$'

      for (let symbol of Object.keys(symbols)) {
        if (new RegExp(symbol + '$').test(name)) {
          this.quoteCurrency = symbols[symbol][0]
          this.symbol = symbols[symbol][1]
        }

        if (new RegExp('^' + symbol).test(name)) {
          this.baseCurrency = symbols[symbol][0]
        }
      }

      if (/^(?!XBT|BTC).*\d+$/.test(name)) {
        this.quoteCurrency = symbols.BTC[0]
        this.symbol = symbols.BTC[1]
      }
    },
    updatePrice() {
      let price = 0
      let total = 0
      let decimals = null

      const activesExchangesLength = this.actives.length

      if (this.calculateOptimalPrice) {
        decimals = []
      }

      for (let exchange of aggregator.exchanges) {
        if (exchange.price === null) {
          continue
        }

        if (this.calculateOptimalPrice) {
          decimals.push(countDecimals(exchange.price))
        }

        if (this.actives.indexOf(exchange.id) === -1) {
          continue
        }

        total++
        price += exchange.price
      }

      if (total) {
        price = price / total

        if (this.calculateOptimalPrice && total >= activesExchangesLength / 2) {
          const optimalDecimal = Math.round(decimals.reduce((a, b) => a + b, 0) / decimals.length)
          this.$store.commit('app/SET_OPTIMAL_DECIMAL', optimalDecimal)

          delete this.calculateOptimalPrice
        }
      }

      if (price) {
        this.updateFavicon(price)
      }

      this.price = formatPrice(price)

      window.document.title = this.pair + ' ' + this.price.toString().replace(/<\/?[^>]+(>|$)/g, '')

      // this._updatePriceTimeout = setTimeout(this.updatePrice, 1000)
    },
    updateFavicon(price) {
      if (faviconDirection.index) {
        faviconDirection.slow = movingAverage(faviconDirection.slow, price, 1 / (faviconDirection.index + 1))
        faviconDirection.fast = movingAverage(faviconDirection.fast, price, (1 / (faviconDirection.index + 1)) * 2)
        console.log('sloe:', faviconDirection.slow, 'fast: ', faviconDirection.fast)
      } else {
        faviconDirection.fast = faviconDirection.slow = +price
      }
      faviconDirection.index++

      const direction = faviconDirection.fast > faviconDirection.slow ? 'up' : 'down'

      if (direction !== faviconDirection.direction) {
        if (!faviconDirection.element) {
          faviconDirection.element = document.createElement('link')
          faviconDirection.element.id = 'favicon'
          faviconDirection.element.rel = 'shortcut icon'

          document.head.appendChild(faviconDirection.element)
        }

        if (direction === 'up') {
          faviconDirection.element.href = upFavicon
        } else {
          faviconDirection.element.href = downFavicon
        }
      }
    },
    bindSearchClickOutside() {
      if (this._clickSearchOutsideHandler) {
        return
      }

      this._clickSearchOutsideHandler = (event => {
        const element = this.$refs.searchWrapper.children[0]

        if (element !== event.target && !element.contains(event.target)) {
          this.$store.commit('app/TOGGLE_SEARCH', false)
        }
      }).bind(this)

      document.addEventListener('mousedown', this._clickSearchOutsideHandler)
    },
    unbindSearchClickOutside() {
      if (!this._clickSearchOutsideHandler) {
        return
      }

      document.removeEventListener('mousedown', this._clickSearchOutsideHandler)
      delete this._clickSearchOutsideHandler
    }
  }
}
</script>
