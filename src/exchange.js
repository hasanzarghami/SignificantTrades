const EventEmitter = require('events')
const axios = require('axios')
const WebSocket = require('ws')
const config = require('./config')
const pako = require('pako')

const { ID, mapPair, getHms } = require('./helper')

require('./typedef')

class Exchange extends EventEmitter {
  constructor(options) {
    super()

    this.lastMessages = [] // debug

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
    this.match = {}

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

    /**
     * Trades being aggregated
     * @type {{[localPair: string]: Trade]}}
     */
    this.aggrTrades = {}

    this.options = Object.assign(
      {
        // default exchanges options
      },
      options || {}
    )
  }

  /**
   * Get exchange equivalent for a given pair
   * @param {string} pair
   */
  getMatch(pair) {
    if (!this.products) {
      return false
    }

    if (Array.isArray(this.products) && this.products.indexOf(pair) !== -1) {
      return pair
    } else  {
      let remotePair = this.products[pair]

      if (!remotePair && config.matchRemotePair) {
        for (let name in this.products) {
          if (pair === this.products[name]) {
            remotePair = this.products[name]
            break
          }
        }
      }

      return remotePair || false
    }

    return false
  }

  /**
   * Get exchange ws url
   */
  getUrl() {
    return typeof this.options.url === 'function'
      ? this.options.url.apply(this, arguments)
      : this.options.url
  }

  /**
   * Link exchange to a pair
   * @param {*} pair
   * @returns {Promise<WebSocket>}
   */
  async link(pair) {
    const match = this.getMatch(pair)

    if (!match) {
      return Promise.reject(`${this.id} couldn't match with ${pair}`)
    }

    for (let localPair in this.match) {
      if (
        pair === localPair ||
        (this.match[localPair] === match &&
          this.getUrl(pair) === this.getUrl(localPair))
      ) {
        return Promise.reject(
          `${this.id} already connected to ${pair} (${this.id}:${match})`
        )
      }
    }

    this.pairs.push(match)
    this.match[pair] = match

    console.debug(`[${this.id}] linking ${pair}`)

    const api = await this.bindApi(pair)

    this.emit('match', pair, match, api.id)

    await this.subscribe(api, pair)

    return api
  }

  /**
   * Unlink a pair
   * @param {string} pair
   * @returns {Promise<void>}
   */
  async unlink(pair) {
    const api = this.getActiveApiByPair(pair)

    if (!this.match[pair] || this.pairs.indexOf(this.match[pair]) === -1) {
      return Promise.resolve()
    }

    if (!api) {
      return Promise.reject(
        new Error(
          `couldn't find active api for pair ${pair} in exchange ${this.id}`
        )
      )
    }

    console.debug(`[${this.id}] unlinking ${pair}`)

    // call exchange specific unsubscribe function
    await this.unsubscribe(api, pair)

    this.emit('unmatch', pair, this.match[pair], api.id)

    this.pairs.splice(this.pairs.indexOf(this.match[pair]), 1)
    delete this.match[pair]

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
      if (this.apis[i].url === url) {
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

      console.debug(
        `[${this.id}] initiate new ws connection ${url} (${api.id}) for pair ${pair}`
      )

      api.binaryType = 'arraybuffer'

      api._pairs = []

      this.apis.push(api)

      api._send = api.send
      api.send = (data) => {
        if (api.readyState !== WebSocket.OPEN) {
          console.error(
            `[${this.id}] attempted to send data to an non-OPEN websocket api`,
            data
          )
          return
        }

        if (!/ping|pong/.test(data)) {
          console.debug(
            `[${this.id}] sending ${data.substr(0, 64)}${
              data.length > 64 ? '...' : ''
            } to ${api.url}`
          )
        }

        api._send.apply(api, [data])
      }

      api.onmessage = (event) => {
        if (this.onMessage(event, api) === true) {
          api.timestamp = +new Date()
        } else {
          let json

          try {
            json = JSON.parse(event.data)
          } catch (error) {
            try {
              json = JSON.parse(pako.inflate(event.data, { to: 'string' }))
            } catch (error) {
              try {
                json = JSON.parse(pako.inflateRaw(event.data, { to: 'string' }))
              } catch (error) {
                //
              }
            }
          }

          if (!json) {
            return
          }
          
          this.lastMessages.push(json)

          if (this.lastMessages.length > 5) {
            this.lastMessages.splice(0, this.lastMessages.length - 5)
          }
        }
      }

      api.onopen = (event) => {
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

      api.onclose = async (event) => {
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

          for (let pair of api._pairs) {
            await this.unlink(pair)
          }

          console.log(
            `[${
              this.id
            }] connection closed unexpectedly, schedule reconnection (${pairsToReconnect.join(
              ','
            )})`
          )

          this.reconnectionDelay[api.url] = this.schedule(
            () => {
              this.reconnectPairs(pairsToReconnect)
            },
            this.reconnectionDelay[api.url],
            500,
            1.5,
            1000 * 30
          )

          console.log(this.lastMessages)
        }
      }

      api.onerror = (event) => {
        this.onError(event, api._pairs)
      }

      this.connecting[url] = {}

      toResolve = new Promise((resolve, reject) => {
        this.connecting[url].resolver = (success) =>
          success ? resolve(api) : reject()
      })

      this.connecting[url].promise = toResolve

      this.onApiBinded(api)
    } else {
      if (this.connecting[api.url]) {
        console.log(`[${this.id}] attach ${pair} to connecting api ${api.url}`)
        toResolve = this.connecting[api.url].promise
      } else {
        console.log(`[${this.id}] attach ${pair} to connected api ${api.url}`)
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

        this.disconnecting[api.url].resolver = (success) =>
          success ? resolve() : reject()
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
    console.debug(
      `[${this.id}] reconnect api (url: ${api.url}, _pairs: ${api._pairs.join(
        ', '
      )})`
    )

    this.reconnectPairs(api._pairs)
  }

  /**
   * Reconnect pairs
   * @param {string[]} pairs (local)
   * @returns {Promise<any>}
   */
  async reconnectPairs(pairs) {
    const pairsToReconnect = pairs.slice(0, pairs.length)

    console.debug(`[${this.id}] reconnect pairs ${pairsToReconnect.join(',')}`)

    for (let pair of pairsToReconnect) {
      await this.unlink(pair)
    }

    await new Promise((resolve) => setTimeout(resolve, 500))

    for (let pair of pairsToReconnect) {
      await this.link(pair)
    }
  }

  /**
   * Ensure product are fetched and connect to pairs
   * @returns {Promise<any>}
   */
  async fetchAndConnect(pairs) {
    try {
      await this.fetchProducts()
    } catch (error) {
      this.reconnectionDelay.fetch = this.schedule(
        () => {
          this.fetchAndConnect(pairs)
        },
        this.reconnectionDelay['fetch'],
        4000,
        1.5,
        1000 * 60 * 3
      )

      return
    }

    for (let pair of pairs) {
      try {
        await this.link(pair)
      } catch (error) {
        // pair mismatch
      }
    }
  }

  /**
   * Get exchange products and save them
   * @returns {Promise<any>}
   */
  async fetchProducts() {
    if (!this.endpoints || !this.endpoints.PRODUCTS) {
      if (!this.products) {
        this.products = []
      }

      return Promise.resolve()
    }

    let urls =
      typeof this.endpoints.PRODUCTS === 'function'
        ? this.endpoints.PRODUCTS()
        : this.endpoints.PRODUCTS

    if (!Array.isArray(urls)) {
      urls = [urls]
    }

    console.debug(`[${this.id}] fetching products...`, urls)

    let data = []

    for (let url of urls) {
      const action = url.split('|')

      let method = action.length > 1 ? action.shift() : 'GET'
      let target = action[0]

      data.push(
        await axios
          .get(target, {
            method: method,
          })
          .then((response) => response.data)
          .catch(err => {
            console.log(`[${this.id}] failed to fetch ${target}\n\t->`, err.message)
            throw err
          })
      )
    }

    if (this.reconnectionDelay.fetch) {
      delete this.reconnectionDelay.fetch
    }

    if (data.length === 1) {
      data = data[0]
    }

    if (data) {
      const formatedProducts = this.formatProducts(data) || []

      if (
        typeof formatedProducts === 'object' &&
        formatedProducts.hasOwnProperty('products')
      ) {
        for (let key in formatedProducts) {
          this[key] = formatedProducts[key]
        }
      } else {
        this.products = formatedProducts
      }
    } else {
      this.products = null
    }

    this.indexProducts()

    return this.products
  }

  indexProducts() {
    this.indexedProducts = []

    if (!this.products) {
      return
    }

    if (Array.isArray(this.products)) {
      this.indexedProducts = this.products.slice(0, this.products.length)
    } else if (typeof this.products === 'object') {
      this.indexedProducts = Object.keys(this.products)
    }

    console.log(`[${this.id}] ${this.indexedProducts.length} products indexed`)

    this.emit('index', this.indexedProducts)
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
  onApiBinded(api) {
    // should be overrided by exchange class
  }

  /**
   * Fire when a new websocket connection has been removed
   * @param {WebSocket} api WebSocket instance
   */
  onApiUnbinded(api) {
    // should be overrided by exchange class
  }

  /**
   * Fire when a new websocket connection received something
   * @param {Event} event
   * @param {WebSocket} api WebSocket instance
   */
  onMessage(event, api) {
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
      source: source,
      data: trades,
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
      source: source,
      data: trades,
    })

    return true
  }

  mapPair(remotePair) {
    if (this.mapping[remotePair]) {
      return this.mapping[remotePair]
    }

    let pair = remotePair

    for (let localPair in this.match) {
      if (this.match[localPair] === pair) {
        pair = localPair
        break
      }
    }

    this.mapping[remotePair] = mapPair(pair).toUpperCase()

    return this.mapping[remotePair]
  }

  startKeepAlive(api, payload = { event: 'ping' }, every = 30000) {
    if (this.keepAliveIntervals[api.url]) {
      this.stopKeepAlive(api)
    }

    console.debug(`[${this.id}] setup keepalive for ws ${api.url}`)

    this.keepAliveIntervals[api.url] = setInterval(() => {
      if (api.readyState === WebSocket.OPEN) {
        api.send(JSON.stringify(payload))
      }
    }, every)
  }

  stopKeepAlive(api) {
    if (!this.keepAliveIntervals[api.url]) {
      return
    }

    console.debug(`[${this.id}] stop keepalive for ws ${api.url}`)

    clearInterval(this.keepAliveIntervals[api.url])
    delete this.keepAliveIntervals[api.url]
  }

  schedule(fn, currentDelay, minDelay, multiplier, maxDelay) {
    if (this.scheduleTimeout) {
      clearTimeout(this.scheduleTimeout)
    }

    currentDelay = Math.max(minDelay, currentDelay || 0)

    this.scheduleTimeout = setTimeout(() => {
      delete this.scheduleTimeout

      fn()
    }, currentDelay)

    currentDelay *= multiplier

    if (typeof maxDelay === 'number' && minDelay > 0) {
      currentDelay = Math.min(maxDelay, currentDelay)
    }

    return currentDelay
  }
}

module.exports = Exchange
