'use strict'

import EventEmitter from 'eventemitter3'

import store from '../store'

import '../data/typedef'

class Historical extends EventEmitter {
  canFetch() {
    return store.state.app.apiUrl && (!store.state.app.apiSupportedPairs || store.state.app.apiSupportedPairs.indexOf(this.pair) !== -1)
  }
  getApiUrl(from, to) {
    let url = store.state.app.apiUrl

    url = url.replace(/\{from\}/, from)
    url = url.replace(/\{to\}/, to)
    url = url.replace(/\{timeframe\}/, this.timeframe * 1000)
    url = url.replace(/\{pair\}/, this.pair.toLowerCase())
    url = url.replace(/\{exchanges\}/, this.actives.join('+'))

    return url
  }
  fetch(from, to) {
    const url = this.getApiUrl(from, to)

    if (this.lastFetchUrl === url) {
      return Promise.reject()
    }

    this.lastFetchUrl = url

    store.commit('app/TOGGLE_LOADING', true)

    this.emit('fetchStart', to - from)

    return new Promise((resolve, reject) => {
      fetch(url)
        .then(response => response.json())
        .then(json => {
          if (!json || typeof json !== 'object') {
            return reject()
          }

          const format = json.format
          let data = json.results

          if (!data.length) {
            return reject()
          }

          switch (json.format) {
            case 'point':
              ;({ from, to, data } = this.normalisePoints(data))
              break
            default:
              break
          }

          const output = {
            format: format,
            data: data,
            from: from,
            to: to
          }

          resolve(output)
        })
        .catch(err => {
          err &&
            store.dispatch('app/showNotice', {
              type: 'error',
              message: `API error (${
                err.response && err.response.data && err.response.data.error ? err.response.data.error : err.message || 'unknown error'
              })`
            })

          reject()
        })
        .then(() => {
          store.commit('app/TOGGLE_LOADING', false)
        })
    })
  }
  normalisePoints(data) {
    if (!data || !data.length) {
      return data
    }

    const initialTs = +new Date(data[0].time) / 1000
    const exchanges = []

    let refs = {}

    for (let i = data.length - 1; i >= 0; i--) {
      refs[data[i].exchange] = data[i].open
      if (typeof data[i].vol_buy !== 'undefined') {
        data[i].vbuy = data[i].vol_buy
        data[i].vsell = data[i].vol_sell
        data[i].cbuy = data[i].count_buy
        data[i].csell = data[i].count_sell
        data[i].lbuy = data[i].liquidation_buy
        data[i].lsell = data[i].liquidation_sell
      }
      data[i].timestamp = +new Date(data[i].time) / 1000

      delete data[i].time
      delete data[i].count
      delete data[i].vol
      if (typeof data[i].vol_buy !== 'undefined') {
        delete data[i].vol_buy
        delete data[i].vol_sell
        delete data[i].count_buy
        delete data[i].count_sell
        delete data[i].liquidation_buy
        delete data[i].liquidation_sell
      }

      if (data[i].time === initialTs) {
        delete refs[data[i].exchange]
        exchanges.push(data[i].exchange)
      }
    }

    for (let exchange in refs) {
      data.unshift({
        timestamp: initialTs,
        exchange: exchange,
        open: refs[exchange],
        high: refs[exchange],
        low: refs[exchange],
        close: refs[exchange],
        vbuy: 0,
        vsell: 0,
        lbuy: 0,
        lsell: 0,
        cbuy: 0,
        csell: 0
      })

      exchanges.push(exchange)
    }

    return {
      data,
      exchanges,
      from: data[0].timestamp,
      to: data[data.length - 1].timestamp
    }
  }
}

export default new Historical()
