SERVER_TIME = +new Date();
setInterval(() => (SERVER_TIME = +new Date()))

module.exports = {
  getTime() {
    return SERVER_TIME
  },
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
  }
}
