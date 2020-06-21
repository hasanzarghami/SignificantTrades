import EventEmitter from 'eventemitter3'

import store from '../store'

import { ID, getHms } from '../utils/helpers'

class Exchange extends EventEmitter {
  constructor(options) {
    super()

    /**
     * ping timers
     * @type {{[url: string]: number}}
     */
    this.keepAliveIntervals = {}

    /**
     * localPairs
     * @type {string[]}
     */
    this.pairs = []

    /**
     * active websocket apis
     * @type {WebSocket[]}
     */
    this.apis = []

    /**
     * Active match (localPair => remotePair)
     * @type {{[localPair: string]: string}}
     */
    this.matchs = {}

    /**
     * promises of ws. opens
     * @type {{[url: string]: {promise: Promise<void>, resolver: Function}}}
     */
    this.connecting = {}

    /**
     * promises of ws. closes
     * @type {{[url: string]: {promise: Promise<void>, resolver: Function}}}
     */
    this.disconnecting = {}

    /**
     * Cached mapping (remotePair => localPair)
     * @type {{[remotePair: string]: string]}}
     */
    this.mapping = {}

    /**
     * Reconnection timeout delay by apiUrl
     * @type {{[apiUrl: string]: number]}}
     */
    this.reconnectionDelay = {}

    /**
     * Cached active timeouts by pair
     * 1 timeout = 1 trade being aggregated for 1 pair
     * @type {{[localPair: string]: number]}}
     */
    this.aggrTradeTimeouts = {}

    this.options = Object.assign(
      {
        // default exchanges options
      },
      options || {}
    )
  }

  /**
   * Connect exchange to pairs (given or from global settings)
   * @param {string[]} pairs
   */
  connect(pairs) {
    if (typeof pairs === 'undefined' || !Array.isArray(pairs) || !pairs.length) {
      pairs = store.state.settings.pairs
    }

    if (!pairs.length) {
      return Promise.resolve()
    }

    return Promise.all(pairs.map(pair => this.link(pair)))
  }

  /**
   * Disconnect exchange from pairs (given or from exchange current pairs)
   * @param {string[]} pairs
   */
  disconnect(pairs) {
    if (typeof pairs === 'undefined' || !Array.isArray(pairs) || !pairs.length) {
      pairs = Object.keys(this.matchs)
    }

    if (!pairs.length) {
      return Promise.resolve()
    }

    return Promise.all(pairs.map(pair => this.unlink(pair)))
  }

  /**
   * Get exchange equivalent for a given pair
   * @param {string} pair
   */
  getMatch(pair) {
    if (!this.products) {
      return false
    }

    if (this.products.indexOf(pair) !== -1) {
      return pair
    }

    return false
  }

  /**
   * Get exchange ws url
   */
  getUrl() {
    return typeof this.options.url === 'function' ? this.options.url.apply(this, arguments) : this.options.url
  }

  /**
   * Link exchange to a pair
   * @param {*} pair
   * @returns {Promise<WebSocket>}
   */
  link(pair) {
    const match = this.getMatch(pair)

    if (!match) {
      return Promise.reject(`${this.id} couldn't match with ${pair}`)
    }

    pair = this.fixLocalPair(pair, match)

    for (let localPair in this.matchs) {
      if (pair === localPair || (this.matchs[localPair] === match && this.getUrl(pair) === this.getUrl(localPair))) {
        return Promise.reject(`${this.id} already connected to ${pair} (${this.id}:${match})`)
      }
    }

    this.pairs.push(match)
    this.matchs[pair] = match

    store.commit('app/SET_EXCHANGE_MATCH', {
      exchange: this.id,
      localPair: pair,
      remotePair: match
    })

    console.debug(`[${this.id}] linking ${pair}`)

    return this.bindApi(pair).then(api => {
      if (api.readyState !== WebSocket.OPEN) {
        debugger
      }

      this.subscribe(api, pair)

      return api
    })
  }

  /**
   * Unlink a pair
   * @param {string} pair
   * @returns {Promise<void>}
   */
  unlink(pair) {
    const api = this.getActiveApiByPair(pair)

    if (!this.matchs[pair] || this.pairs.indexOf(this.matchs[pair]) === -1) {
      return Promise.resolve()
    }

    if (!api) {
      return Promise.reject(new Error(`couldn't find active api for pair ${pair} in exchange ${this.id}`))
    }

    console.debug(`[${this.id}] unlinking ${pair}`)

    // call exchange specific unsubscribe function
    this.unsubscribe(api, pair)

    store.commit('app/UNSET_EXCHANGE_MATCH', {
      exchange: this.id,
      localPair: pair,
      remotePair: this.matchs[pair]
    })

    this.pairs.splice(this.pairs.indexOf(this.matchs[pair]), 1)
    delete this.matchs[pair]

    if (!api._pairs.length) {
      return this.unbindApi(api)
    } else {
      return Promise.resolve()
    }
  }

  /**
   * Get active websocket api by pair
   * @param {string} pair
   * @returns {WebSocket}
   */
  getActiveApiByPair(pair) {
    const url = this.getUrl(pair)

    for (let i = 0; i < this.apis.length; i++) {
      if (this.apis[i].url.replace(/\/$/, '') === url.replace(/\/$/, '')) {
        return this.apis[i]
      }
    }
  }

  /**
   * Create or attach a pair subscription to active websocket api
   * @param {*} pair
   * @returns {Promise<WebSocket>}
   */
  bindApi(pair) {
    let api = this.getActiveApiByPair(pair)

    let toResolve

    if (!api) {
      const url = this.getUrl(pair)

      api = new WebSocket(url)
      api.id = ID()

      console.debug(`[${this.id}] initiate new ws connection ${url} (${api.id}) for pair ${pair}`)

      api.binaryType = 'arraybuffer'

      api._pairs = []

      this.apis.push(api)

      api._send = api.send
      api.send = data => {
        if (!/ping|pong/.test(data)) {
          console.debug(`[${this.id}] sending ${data.substr(0, 64)}${data.length > 64 ? '...' : ''} to ${api.url}`)
        }

        api._send.apply(api, [data])
      }

      api.onmessage = event => {
        if (this.onMessage(event, api) === true) {
          api.timestamp = +new Date()
        }
      }

      api.onopen = event => {
        if (typeof this.reconnectionDelay[url] !== 'undefined') {
          console.debug(`[${this.id}] clear reconnection delay (${url})`)
          delete this.reconnectionDelay[url]
        }

        if (this.connecting[url]) {
          this.connecting[url].resolver(true)
          delete this.connecting[url]
        }

        this.onOpen(event, api._pairs)
      }

      api.onclose = event => {
        if (this.connecting[url]) {
          this.connecting[url].resolver(false)
          delete this.connecting[url]
        }

        this.onClose(event, api._pairs)

        if (this.disconnecting[url]) {
          this.disconnecting[url].resolver(true)
          delete this.disconnecting[url]
        }

        if (api._pairs.length) {
          const pairsToReconnect = api._pairs.slice(0, api._pairs.length)

          console.log(`[${this.id}] connection closed unexpectedly, schedule reconnection (${pairsToReconnect.join(',')})`)

          Promise.all(api._pairs.map(pair => this.unlink(pair))).then(() => {
            const delay = this.reconnectionDelay[api.url] || 0

            setTimeout(() => {
              this.reconnectPairs(pairsToReconnect)
            }, delay)

            this.reconnectionDelay[api.url] = Math.min(1000 * 30, (delay || 1000) * 1.5)
            console.debug(`[${this.id}] increment reconnection delay (${url}) = ${getHms(this.reconnectionDelay[api.url])}`)
          })
        }
      }

      api.onerror = event => {
        this.onError(event, api._pairs)
      }

      this.connecting[url] = {}

      toResolve = new Promise((resolve, reject) => {
        this.connecting[url].resolver = success => (success ? resolve(api) : reject())
      })

      this.connecting[url].promise = toResolve

      this.onApiBinded(api)
    } else {
      if (this.connecting[api.url]) {
        console.debug(`[${this.id}] attach ${pair} to connecting api ${api.url}`)
        toResolve = this.connecting[api.url].promise
      } else {
        console.debug(`[${this.id}] attach ${pair} to connected api ${api.url}`)
        toResolve = Promise.resolve(api)
      }
    }

    return toResolve
  }

  /**
   * Close websocket api
   * @param {WebSocket} api
   * @returns {Promise<void>}
   */
  unbindApi(api) {
    console.debug(`[${this.id}] unbind api ${api.url}`)

    if (api._pairs.length) {
      throw new Error(`cannot unbind api that still has pairs linked to it`)
    }

    let promiseOfClose

    if (api.readyState !== WebSocket.CLOSED) {
      this.disconnecting[api.url] = {}

      promiseOfClose = new Promise((resolve, reject) => {
        if (api.readyState < WebSocket.CLOSING) {
          api.close()
        }

        this.disconnecting[api.url].resolver = success => (success ? resolve() : reject())
      })

      this.disconnecting[api.url].promise = promiseOfClose
    } else {
      promiseOfClose = Promise.resolve()
    }

    return promiseOfClose.then(() => {
      console.debug(`[${this.id}] splice api ${api.url} from exchange`)
      this.onApiUnbinded(api)
      this.apis.splice(this.apis.indexOf(api), 1)
    })
  }

  /**
   * Reconnect api
   * @param {WebSocket} api
   */
  reconnectApi(api) {
    console.debug(`[${this.id}] reconnect api (url: ${api.url}, _pairs: ${api._pairs.join(', ')})`)

    this.reconnectPairs(api._pairs)
  }

  /**
   * Reconnect pairs
   * @param {string[]} pairs (local)
   * @returns {Promise<any>}
   */
  reconnectPairs(pairs) {
    const pairsToReconnect = pairs.slice(0, pairs.length)

    console.debug(`[${this.id}] reconnect pairs ${pairsToReconnect.join(',')}`)

    Promise.all(pairsToReconnect.map(pair => this.unlink(pair))).then(() => {
      return Promise.all(pairsToReconnect.map(pair => this.link(pair)))
    })
  }

  /**
   * Get exchange products and save them
   * @returns {Promise<void>}
   */
  fetchProducts(forceRenew = false) {
    return new Promise(resolve => {
      if (!this.endpoints || !this.endpoints.PRODUCTS) {
        if (!this.products) {
          this.products = []
        }

        resolve()
      } else {
        if (forceRenew || typeof this.products === 'undefined') {
          delete this.products
          this.getStoredProducts()
        }

        if (typeof this.products === 'undefined') {
          let urls = typeof this.endpoints.PRODUCTS === 'function' ? this.endpoints.PRODUCTS() : this.endpoints.PRODUCTS

          if (!Array.isArray(urls)) {
            urls = [urls]
          }

          console.log(`[${this.id}] fetching new products...`, urls)

          Promise.all(
            urls.map(action => {
              action = action.split('|')

              let method = action.length > 1 ? action.shift() : 'GET'
              let url = action[0]

              if (store.state.app.proxyUrl) {
                url = store.state.app.proxyUrl + url
              }

              return new Promise(resolve => {
                setTimeout(() => {
                  resolve(
                    fetch(url, {
                      method: method
                    })
                      .then(response => response.json())
                      .catch(err => {
                        console.log(err)

                        return null
                      })
                  )
                }, 500)
              })
            })
          ).then(data => {
            console.log(`[${this.id}] received API products response => format products`)

            if (data.indexOf(null) !== -1) {
              data = null
            } else if (data.length === 1) {
              data = data[0]
            }

            if (data) {
              const formatedProducts = this.formatProducts(data) || []

              if (typeof formatedProducts === 'object' && Object.prototype.hasOwnProperty.call(formatedProducts, 'products')) {
                for (let key in formatedProducts) {
                  this[key] = formatedProducts[key]
                }
              } else {
                this.products = formatedProducts
              }

              console.debug(`[${this.id}] saving products`)

              localStorage.setItem(
                this.id,
                JSON.stringify({
                  timestamp: +new Date(),
                  data: formatedProducts
                })
              )
            } else {
              this.products = null
            }

            resolve()
          })
        } else {
          resolve()
        }
      }
    }).then(() => {
      this.indexProducts()
    })
  }

  getStoredProducts() {
    try {
      const storage = JSON.parse(localStorage.getItem(this.id))

      if (storage && +new Date() - storage.timestamp < 1000 * 60 * 60 * 24 * 7 && (this.id !== 'okex' || storage.timestamp > 1560235687982)) {
        if (storage.data && typeof storage.data === 'object' && Object.prototype.hasOwnProperty.call(storage.data, 'products')) {
          for (let key in storage.data) {
            this[key] = storage.data[key]
          }
        } else {
          this.products = storage.data
        }

        if (
          !this.products ||
          (Array.isArray(this.products) && !this.products.length) ||
          (typeof this.products === 'object' && !Object.keys(this.products).length)
        ) {
          this.products = null
        }
      } else {
        console.info(`[${this.id}] products data expired`)
      }
    } catch (error) {
      console.error(`[${this.id}] unable to retrieve stored products`, error)
    }
  }

  indexProducts() {
    let products = []

    if (this.products) {
      if (Array.isArray(this.products)) {
        products = this.products.slice(0, this.products.length)
      } else if (typeof this.products === 'object') {
        products = Object.keys(this.products)
      }
    }

    store.commit('app/INDEX_EXCHANGE_PRODUCTS', {
      exchange: this.id,
      products
    })
  }

  /**
   * Fire when a new websocket connection opened
   * @param {Event} event
   * @param {string[]} pairs pairs attached to ws at opening
   */
  onOpen(event, pairs) {
    console.debug(`[${this.id}] ${pairs.join(',')}'s api connected`)

    this.emit('open', event)
  }

  /**
   * Fire when a new websocket connection is created
   * @param {WebSocket} api WebSocket instance
   */
  onApiBinded(/* api */) {
    // should be overrided by exchange class
  }

  /**
   * Fire when a new websocket connection has been removed
   * @param {WebSocket} api WebSocket instance
   */
  onApiUnbinded(/* api */) {
    // should be overrided by exchange class
  }

  /**
   * Fire when a new websocket connection received something
   * @param {Event} event
   * @param {WebSocket} api WebSocket instance
   */
  onMessage(/* event, api */) {
    // should be overrided by exchange class
  }

  /**
   * Fire when a new websocket connection reported an error
   * @param {Event} event
   * @param {string[]} pairs
   */
  onError(event, pairs) {
    console.debug(`[${this.id}] ${pairs.join(',')}'s api errored`, event)
    this.emit('err', event)
  }

  /**
   * Fire when a new websocket connection closed
   * @param {Event} event
   * @param {string[]} pairs
   */
  onClose(event, pairs) {
    console.debug(`[${this.id}] ${pairs.join(',')}'s api closed`)
    this.emit('close', event)
  }

  /**
   *
   * @param {any} data products from HTTP response
   */
  formatProducts(data) {
    // should be overrided by exchange class

    return data
  }

  /**
   * Sub
   * @param {WebSocket} api
   * @param {string} pair
   */
  subscribe(api, pair) {
    const index = api._pairs.indexOf(pair)

    if (index !== -1) {
      return false
    }

    api._pairs.push(pair)

    this.emit('subscribed', pair, this.matchs[pair], api.id)

    return true
  }

  /**
   * Unsub
   * @param {WebSocket} api
   * @param {string} pair
   */
  unsubscribe(api, pair) {
    const index = api._pairs.indexOf(pair)

    if (index === -1) {
      return false
    }

    api._pairs.splice(index, 1)

    this.emit('unsubscribed', pair, this.matchs[pair], api.id)

    return api.readyState === WebSocket.OPEN
  }

  /**
   * Emit trade to server
   * @param {string} source api id
   * @param {Trade[]} trades
   */
  emitTrades(source, trades) {
    if (!trades || !trades.length) {
      return
    }

    this.emit('trades', {
      source,
      trades
    })

    return true
  }

  /**
   * Emit liquidations to server
   * @param {string} source api id
   * @param {Trade[]} trades
   */
  emitLiquidations(source, trades) {
    if (!trades || !trades.length) {
      return
    }

    this.emit('liquidations', {
      source,
      trades
    })

    return true
  }

  mapPair(remotePair) {
    if (this.mapping[remotePair]) {
      return this.mapping[remotePair]
    }

    let pair = remotePair

    for (let localPair in this.matchs) {
      if (this.matchs[localPair] === pair) {
        pair = localPair
        break
      }
    }

    this.mapping[remotePair] = pair

    return this.mapping[remotePair]
  }

  startKeepAlive(api, payload = { event: 'ping' }, every = 30000) {
    if (this.keepAliveIntervals[api.id]) {
      this.stopKeepAlive(api)
    }

    console.debug(`[${this.id}] setup keepalive for ws ${api.id}`)

    this.keepAliveIntervals[api.id] = setInterval(() => {
      if (api.readyState === WebSocket.OPEN) {
        api.send(JSON.stringify(payload))
      }
    }, every)
  }

  stopKeepAlive(api) {
    if (!this.keepAliveIntervals[api.id]) {
      return
    }

    console.debug(`[${this.id}] stop keepalive for ws ${api.id}`)

    clearInterval(this.keepAliveIntervals[api.id])
    delete this.keepAliveIntervals[api.id]
  }

  fixLocalPair(localPair, remotePair) {
    if (this.products && !Array.isArray(this.products) && !this.products[localPair]) {
      // remote pair match ? fix local pair...

      console.log('FIX LOCAL PAIR', this.id, 'provided local pair (prolly remote):', localPair, 'matched with remote pair:', remotePair)

      for (let _localPair in this.products) {
        if (remotePair === this.products[_localPair]) {
          console.log('found true local pair', this.id, _localPair)
          return _localPair
        }
      }
    }

    return localPair
  }
}

export default Exchange
