const config = require('./config')

module.exports = {
  getIp(req) {
    let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress

    if (ip.indexOf('::ffff:') === 0) {
      ip = ip.substr('::ffff:'.length, ip.length)
    }

    return ip
  },

  getPair(req, defaultPair) {
    let pair = req.url.substr(1);

    if (!pair || !pair.length) {
      if (defaultPair) {
        pair = defaultPair;
      } else {
        pair = 'BTCUSD';
      }
    }

    return pair.toUpperCase();
  },

  mapPair(pair) {
    for (let localPair in config.mapping) {
      if (config.mapping[localPair].test(pair)) {
        return localPair
      }
    }

    return pair
  },

  ID() {
    return Math.random().toString(36).substr(2, 9);
  },

  getHms(timestamp, round) {
    var h = Math.floor(timestamp / 1000 / 3600)
    var m = Math.floor(((timestamp / 1000) % 3600) / 60)
    var s = Math.floor(((timestamp / 1000) % 3600) % 60)
    var output = ''

    output += (!round || !output.length) && h > 0 ? h + 'h' + (!round && m ? ', ' : '') : ''
    output += (!round || !output.length) && m > 0 ? m + 'm' + (!round && s ? ', ' : '') : ''
    output += (!round || !output.length) && s > 0 ? s + 's' : ''

    if (!output.length || (!round && timestamp < 60 * 1000 && timestamp > s * 1000))
      output += (output.length ? ', ' : '') + (timestamp - s * 1000) + 'ms'

    return output.trim()
  },

  ago(timestamp) {
    const seconds = Math.floor((new Date() - timestamp) / 1000)
    let interval, output
  
    if ((interval = Math.floor(seconds / 31536000)) > 1) output = interval + 'y'
    else if ((interval = Math.floor(seconds / 2592000)) >= 1) output = interval + 'm'
    else if ((interval = Math.floor(seconds / 86400)) >= 1) output = interval + 'd'
    else if ((interval = Math.floor(seconds / 3600)) >= 1) output = interval + 'h'
    else if ((interval = Math.floor(seconds / 60)) >= 1) output = interval + 'm'
    else output = Math.ceil(seconds) + 's'
  
    return output
  },

  groupByPairs(trades, toArray = false) {
    const groups = {};

    for (let i = 0; i < trades.length; i++) {
      const trade = trades[i];
      if (!groups[trade.pair]) {
        groups[trade.pair] = [];
      }

      if (!toArray) {
        groups[trade.pair].push(trade)
      } else {
        const toPush = [
          trade.exchange,
          trade.timestamp,
          trade.price,
          trade.size,
          trade.side === 'buy' ? 1 : 0
        ];

        if (trade.liquidation) {
          toPush.push(1);
        }

        groups[trade.pair].push(toPush)
      }
    }

    return groups;
  },

  formatAmount(amount, decimals) {
    const negative = amount < 0

    if (negative) {
      amount = Math.abs(amount)
    }

    if (amount >= 1000000) {
      amount = +(amount / 1000000).toFixed(isNaN(decimals) ? 1 : decimals) + 'M'
    } else if (amount >= 100000) {
      amount = +(amount / 1000).toFixed(isNaN(decimals) ? 0 : decimals) + 'K'
    } else if (amount >= 1000) {
      amount = +(amount / 1000).toFixed(isNaN(decimals) ? 1 : decimals) + 'K'
    } else {
      amount = +amount.toFixed(4)
    }

    if (negative) {
      return '-' + amount
    } else {
      return amount
    }
  }
}
