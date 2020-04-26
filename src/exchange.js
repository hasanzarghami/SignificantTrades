const EventEmitter = require('events')
const axios = require('axios')
const WebSocket = require('ws')

class Exchange extends EventEmitter {
  constructor(options) {
    super()

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
     * localPair => exchangePair
     * @type {{[localPair: string]: string}}
     */
    this.match = {}

    /**
     * websocket connections awaiting onOpen event
     * @type {{[url: string]: Promise<WebSocket>}}
     */
    this.connecting = {}

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
      return false;
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
    return typeof this.options.url === 'function'
      ? this.options.url.apply(this, arguments)
      : this.options.url
  }

  /**
   * Connect to 1 pair
   * @param {*} pair
   */
  connect(pair) {
    console.log(this.id, 'connect', pair)
    const match = this.getMatch(pair)

    if (!match) {
      console.log(`[${this.id}.connect] failed to match with ${pair}`)

      return Promise.reject(`[${this.id}.connect] failed to match with ${pair}`)
    }

    if (this.pairs.indexOf(pair) !== -1) {
      console.log(`[${this.id}.connect] already listening to ${pair}`)

      return Promise.reject(`[${this.id}.connect] already listening to ${pair}`)
    }

    this.pairs.push(match)
    this.match[pair] = match

    return this.bindApi(pair).then(api => {
      this.subscribe(api, pair);
    })
  }

  /**
   * Disconnect to 1 pair
   * @param {string} pair
   */
  disconnect(pair) {
    console.log(this.id, 'disconnect', pair)
    if (this.pairs.indexOf(pair) === -1) {
      console.log(
        `[${this.id}.disconnect] can't disconnect if not connected (${pair})`
      )

      return false
    }

    const api = this.getApi(pair)

    this.unsubscribe(api, pair);

    this.pairs.splice(this.pairs.indexOf(pair), 1)
    delete this.match[pair]

    if (!api) {
      console.log(
        `[${this.id}.disconnect] couldn't find active api for "${pair}"`
      )

      return false
    }

    if (api.pairs.length === 1) {
      this.unbindApi(pair)

      return null
    }

    return api
  }

  /**
   * Get active websocket api by pair
   * @param {string} pair
   * @returns {WebSocket}
   */
  getApi(pair) {
    const url = this.getUrl(pair)

    for (let i = 0; i < this.apis.length; i++) {
      if (this.apis[i].url === url) {
        return this.apis[i]
      }
    }
  }

  /**
   * Create or attach a pair to active websocket api
   * @param {*} pair
   * @returns {Promise<WebSocket>}
   */
  bindApi(pair) {
    console.log(this.id, 'bind pair', pair)
    let api = this.getApi(pair)

    let toResolve

    if (!api) {
      const url = this.getUrl(pair)
      console.log(this.id, 'initiate ws api from pair', url)

      api = new WebSocket(this.getUrl())

      api.pairs = [pair]

      this.apis.push(api)

      toResolve = new Promise((resolve, reject) => {
        api.onmessage = (event) => {
          this.onMessage(event, api.pairs)
        }

        api.onopen = (event) => {
          console.log(this.id, api.pairs, 'onopen!');
          resolve(api)

          delete this.connecting[url]

          this.onOpen(event, api.pairs)
        }

        api.onclose = (event) => {
          reject()

          this.onClose(event, api.pairs)

          if (api.pairs.length) {
            console.log('schedule reconnection');
            setTimeout(() => {
              this.reconnectApi(api);
            }, 3000)
          }
        }

        api.onerror = (event) => {
          this.onError(event, api.pairs)
        }
      })

      this.connecting[url] = toResolve
    } else {
      if (this.connecting[api.url]) {
        console.log(this.id, 'attach pair to connecting api')
        toResolve = this.connecting[api.url]
      } else {
        console.log(this.id, 'attach pair to connected api')
        toResolve = Promise.resolve(api)
      }

      api.pairs.push(pair)
    }

    return toResolve
  }

  /**
   * Close websocket api by pair
   * @param {string} pair
   */
  unbindApi(pair) {
    console.log(this.id, 'bind pair', pair)
    const api = this.getApi(pair)

    if (!api) {
      console.log(`[${this.id}.unbind] couldn't find active api for "${pair}"`)

      return
    }

    if (api.readyState < 2) {
      api.close()
    }

    this.apis.splice(this.apis.indexOf(api), 1)
  }

  /**
   * Reconnect api
   * @param {WebSocket} api
   */
  reconnectApi(api) {
    console.log(this.id, 'reconnect api', api.url)
    const pairs = api.pairs.slice(0, api.pairs.length)

    for (let pair of pairs) {
      this.disconnect(pair)
    }

    for (let pair of pairs) {
      this.connect(pair)
    }

    this.unbindApi(pairs[0])

    this.bindApi(pairs[0]).then((api) => {
      api.pairs = pairs
    })
  }

  /**
   * Get exchange products and save them
   * @returns {Promise<any>}
   */
  fetchProducts() {
    if (!this.endpoints || !this.endpoints.PRODUCTS) {
      this.products = []

      return Promise.resolve()
    }

    let urls =
      typeof this.endpoints.PRODUCTS === 'function'
        ? this.endpoints.PRODUCTS()
        : this.endpoints.PRODUCTS

    if (!Array.isArray(urls)) {
      urls = [urls]
    }

    console.log(`[${this.id}] fetching products...`, urls)

    return new Promise((resolve, reject) => {
      return Promise.all(
        urls.map((action, index) => {
          action = action.split('|')

          let method = action.length > 1 ? action.shift() : 'GET'
          let url = action[0]

          return new Promise((resolve, reject) => {
            setTimeout(() => {
              resolve(
                axios
                  .get(url, {
                    method: method,
                  })
                  .then((response) => response.data)
                  .catch((err) => {
                    console.log(err)

                    return null
                  })
              )
            }, 500)
          })
        })
      ).then((data) => {
        console.log(
          `[${this.id}] received API products response => format products`
        )

        if (data.indexOf(null) !== -1) {
          data = null
        } else if (data.length === 1) {
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

          console.log(`[${this.id}] saving products`)
        } else {
          this.products = null
        }

        resolve(this.products)
      })
    })
  }

  /**
   * Fire when a new websocket connection opened
   * @param {Event} event
   * @param {string[]} pairs pairs attached to ws at opening
   */
  onOpen(event, pairs) {
    console.log(`[${this.id}] ${pairs.join(',')}'s api connected`)

    this.emit('open', event)
  }

  /**
   * Fire when a new websocket connection received something
   * @param {Event} event
   * @param {string[]} pairs
   */
  onMessage(event, pairs) {
    // should be overrided by exchange class
  }

  /**
   * Fire when a new websocket connection reported an error
   * @param {Event} event
   * @param {string[]} pairs
   */
  onError(event, pairs) {
    console.log(`[${this.id}] ${pairs.join(',')}'s api errored`, event)
    this.emit('err', event)
  }

  /**
   * Fire when a new websocket connection closed
   * @param {Event} event
   * @param {string[]} pairs
   */
  onClose(event, pairs) {
    console.log(`[${this.id}] ${pairs.join(',')}'s api closed`)
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
    // should be overrided by exchange class
  }

  /**
   * Unsub
   * @param {WebSocket} api 
   * @param {string} pair 
   */
  unsubscribe(api, pair) {
    // should be overrided by exchange class
  }

  /**
   * Emit trade to server
   * @param {*} trades
   */
  emitTrades(trades) {
    if (!trades || !trades.length) {
      return
    }
console.log('trades', trades);
    this.emit('data', {
      exchange: this.id,
      data: trades,
    })

    if (!this.options.websocket || !this.options.aggr) {
      return
    }

    const output = []

    for (let i = 0; i < trades.length; i++) {
      const trade = trades[i]

      if (trade[5]) {
        if (this.queueTrades) {
          this.queuedTrade[2] /= this.queuedTrade[3]
          output.push(this.queuedTrade)
          delete this.queuedTrade
          clearTimeout(this.queuedTradeTimeout)
          delete this.queuedTradeTimeout
        }
        output.push(trade)
        continue
      }

      if (this.queuedTrade) {
        if (
          trade[1] > this.queuedTrade[1] ||
          trade[4] !== this.queuedTrade[4]
        ) {
          this.queuedTrade[2] /= this.queuedTrade[3]
          output.push(this.queuedTrade)
          this.queuedTrade = trade.slice(0, trade.length)
          this.queuedTrade[2] *= this.queuedTrade[3]
          clearTimeout(this.queuedTradeTimeout)
          delete this.queuedTradeTimeout
        } else if (
          trade[1] <= this.queuedTrade[1] &&
          trade[4] === this.queuedTrade[4]
        ) {
          this.queuedTrade[3] += +trade[3]
          this.queuedTrade[2] += trade[2] * trade[3]
        }
      } else {
        this.queuedTrade = trade.slice(0, trade.length)
        this.queuedTrade[2] *= this.queuedTrade[3]
      }
    }

    if (this.queuedTrade && !this.queuedTradeTimeout) {
      this.queuedTradeTimeout = setTimeout(() => {
        this.queuedTrade[2] /= this.queuedTrade[3]
        this.emit('data.aggr', {
          exchange: this.id,
          data: [this.queuedTrade],
        })
        delete this.queuedTrade
        delete this.queuedTradeTimeout
      }, 50)
    }

    if (output.length) {
      this.emit('data.aggr', {
        exchange: this.id,
        data: output,
      })
    }
  }
}

module.exports = Exchange
