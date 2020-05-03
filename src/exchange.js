const EventEmitter = require('events')
const axios = require('axios')
const WebSocket = require('ws')
const getTime = require('./helper').getTime

require('./typedef')

class Exchange extends EventEmitter {
  constructor(options) {
    super()

    // debug
    this.reportedVolume = 0;

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
     * @type {{[url: string]: Promise<WebSocket>}}
     */
    this.connecting = {}

    /**
     * promises of ws. closes
     * @type {{[url: string]: Promise<void>}}
     */
    this.disconnecting = {}
    
    /**
     * Cached mapping (remotePair => localPair)
     * @type {{[remotePair: string]: string]}}
     */
    this.mapping = {};
    
    /**
     * Cached active timeouts by pair
     * 1 timeout = 1 trade being aggregated for 1 pair
     * @type {{[localPair: string]: number]}}
     */
    this.aggrTradeTimeouts = {};
    
    /**
     * Trades being aggregated
     * @type {{[localPair: string]: Trade]}}
     */
    this.aggrTrades = {};

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
   * Link exchange to a pair
   * @param {*} pair
   * @returns {Promise<WebSocket>}
   */
  link(pair) {
    const match = this.getMatch(pair)

    if (!match) {
      return Promise.reject(`${this.id} couldn't match with ${pair}`)
    }

    if (this.pairs.indexOf(match) !== -1) {
      return Promise.reject(`${this.id} already connected to ${pair}`)
    }

    this.pairs.push(match)
    this.match[pair] = match

    console.debug(`[${this.id}] linking ${pair}`)

    return this.bindApi(pair).then(api => {
      this.subscribe(api, pair);

      return api;
    })
  }

  /**
   * Unlink a pair
   * @param {string} pair
   * @returns {Promise<void>}
   */
  unlink(pair) {
    const api = this.getActiveApiByPair(pair)

    if (!this.match[pair] || this.pairs.indexOf(this.match[pair]) === -1) {
      return Promise.reject(new Error(`${this.id} cannot unlink ${pair} as ${this.id} is not actually connected to it`))
    }

    if (!api) {
      return Promise.reject(new Error(`couldn't find active api for pair ${pair} in exchange ${this.id}`))
    }

    console.debug(`[${this.id}] unlinking ${pair}`)

    // call exchange specific unsubscribe function
    this.unsubscribe(api, pair)

    this.pairs.splice(this.pairs.indexOf(pair), 1)
    delete this.match[pair]

    if (!api._pairs.length) {
      return this.unbindApi(api)
    } else {
      return Promise.resolve();
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

      console.debug(`[${this.id}] initiate new ws connection ${url} for pair ${pair}`)

      api = new WebSocket(this.getUrl())

      api._pairs = []

      this.apis.push(api)

      api._send = api.send;
      api.send = (data) => {
        console.debug(`[${this.id}] sending ${data.substr(0, 64)}${data.length > 64 ? '...' : ''} to ${api.url}`);

        api._send.apply(api, [data]);
      }

      api.onmessage = (event) => {
        if (this.onMessage(event, api._pairs) === true) {
          api.timestamp = getTime()
        }
      }

      api.onopen = (event) => {
        if (this.connecting[url]) {
          this.connecting[url](true);
          delete this.connecting[url]
        }

        this.onOpen(event, api._pairs)
      }

      api.onclose = (event) => {
        if (this.connecting[url]) {
          this.connecting[url](false);
          delete this.connecting[url]
        }

        this.onClose(event, api._pairs)

        if (this.disconnecting[url]) {
          this.disconnecting[url](true);
          delete this.disconnecting[url]
        }

        if (api._pairs.length) {
          api._pairs.forEach(pair => this.unlink(pair));

          console.log(`[${this.id}] connection closed unexpectedly, schedule reconnection`);
          
          setTimeout(() => {
            this.reconnectApi(api);
          }, 3000)
        }
      }

      api.onerror = (event) => {
        this.onError(event, api._pairs)
      }

      toResolve = new Promise((resolve, reject) => {
        this.connecting[url] = (success) => success ? resolve(api) : reject()
      });
    } else {
      if (this.connecting[api.url]) {
        console.log(`[${this.id}] attach ${pair} to connecting api ${api.url}`)
        toResolve = this.connecting[api.url]
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
      promiseOfClose = new Promise((resolve, reject) => {
        if (api.readyState < WebSocket.CLOSING) {
           api.close()
        }
      
        this.disconnecting[api.url] = (success) => success ? resolve() : reject()
      });
    } else {
      promiseOfClose = Promise.resolve();
    }

    return promiseOfClose.then(() => {
      console.debug(`[${this.id}] splice api ${api.url} from exchange`)
      this.apis.splice(this.apis.indexOf(api), 1)
    })
  }

  /**
   * Reconnect api
   * @param {WebSocket} api
   */
  reconnectPairs(pairs) {
    console.debug(`[${this.id}] reconnect pairs ${pairs.join(',')}`)
    
    Promise
      .all(pairs.map(pair => this.unlink(pair)))
      .then(pairs.map(pair => this.link(pair)))
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

          console.debug(`[${this.id}] saving products`)
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
    console.debug(`[${this.id}] ${pairs.join(',')}'s api connected`)

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
    const index = api._pairs.indexOf(pair);

    if (index !== -1) {
      return false;
    }

    api._pairs.push(pair);

    return true;
  }

  /**
   * Unsub
   * @param {WebSocket} api 
   * @param {string} pair 
   */
  unsubscribe(api, pair) {
    const index = api._pairs.indexOf(pair);

    if (index === -1) {
      return false;
    }

    api._pairs.splice(index, 1);
    
    return api.readyState === WebSocket.OPEN;
  }

  /**
   * Emit trade to server
   * @param {Trade[]} trades
   */
  emitTrades(trades) {
    if (!trades || !trades.length) {
      return
    }

    this.emit('data', {
      exchange: this.id,
      data: trades,
    })

    if (!this.options.websocket || !this.options.aggr) {
      return
    }

    const output = []
    const toTimeout = [];

    for (let i = 0; i < trades.length; i++) {
      const trade = trades[i]
      const aggrTrade = this.aggrTrades[trade.pair];

      if (trade.liquidation) {
        output.push(trade)
        continue
      }

      if (aggrTrade) {
        if (
          trade.timestamp > aggrTrade.timestamp ||
          trade.side !== aggrTrade.side
        ) {
          aggrTrade.price /= aggrTrade.size
          output.push(aggrTrade)
          this.aggrTrades[trade.pair] = trade
          this.aggrTrades[trade.pair].price *= this.aggrTrades[trade.pair].size

          if (toTimeout.indexOf(trade.pair) === -1) {
            // will create timeout referencing aggrTrade for this pair
            toTimeout.push(trade.pair);
          }

          clearTimeout(this.aggrTradeTimeouts[trade.pair])
          delete this.aggrTradeTimeouts[trade.pair]
        } else if (
          trade.timestamp <= aggrTrade.timestamp &&
          trade.side === aggrTrade.side
        ) {
          aggrTrade.size += +trade.size
          aggrTrade.price += trade.price * trade.size
        } else {
          debugger;
        }
      } else {
        this.aggrTrades[trade.pair] = trade
        this.aggrTrades[trade.pair].price *= this.aggrTrades[trade.pair].size
      
        if (toTimeout.indexOf(trade.pair) === -1) {
          // will create timeout referencing aggrTrade for this pair
          toTimeout.push(trade.pair);
        }
      }
    }

    for (let j = 0; j < toTimeout.length; j++) {
      if (this.aggrTrades[toTimeout[j]] && !this.aggrTradeTimeouts[toTimeout[j]]) {
        this.aggrTradeTimeouts[toTimeout[j]] = setTimeout((trade => {
          trade.price /= trade.size
          this.emit('data.aggr', {
            exchange: this.id,
            data: [trade],
          })
          delete this.aggrTrades[trade.pair]
          delete this.aggrTradeTimeouts[trade.pair]
        }).bind(this, this.aggrTrades[toTimeout[j]]), 50)
      }
    }

    if (output.length) {
      this.emit('data.aggr', {
        exchange: this.id,
        data: output,
      })
    }
  }

  mapPair(remotePair) {
   if (this.mapping[remotePair]) {
     return this.mapping[remotePair]
   } 

   for (let localPair in this.options.mapping) {
     if (this.options.mapping[localPair].test(remotePair)) {
       this.mapping[remotePair] = localPair;
       
       return this.mapping[remotePair]
     }
   }

   this.mapping[remotePair] = remotePair;

   return remotePair
  }
}

module.exports = Exchange
