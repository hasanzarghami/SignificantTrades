const fs = require('fs')
const path = require('path');
const {getHms, groupByPairs} = require('../helper')

class FilesStorage {
  constructor(options) {
    this.name = this.constructor.name
    this.options = options
    this.format = 'trade'

    /** @type {{[timestamp: string]: {stream: fs.WriteStream, updatedAt: number}}} */
    this.writableStreams = {}

    if (!this.options.filesInterval) {
      this.options.filesInterval = 3600000 // 1h file default
    }

    if (!fs.existsSync(this.options.filesLocation)) {
      fs.mkdirSync(this.options.filesLocation)
    }

    console.log(`[storage/${this.name}] destination folder: ${this.options.filesLocation}`)
  }

  /**
   * Construit le nom du fichier a partir d'une date
   * BTCUSD_2018-12-01-22
   *
   * @param {Date} date
   * @returns {string}
   * @memberof FilesStorage
   */
  getBackupFilename(pair, date) {
    let filename = `
			${this.options.filesLocation}/${pair}
			_${date.getFullYear()}
			-${('0' + (date.getMonth() + 1)).slice(-2)}
			-${('0' + date.getDate()).slice(-2)}
		`

    if (this.options.filesInterval < 1000 * 60 * 60 * 24) {
      filename += `-${('0' + date.getHours()).slice(-2)}`
    }

    if (this.options.filesInterval < 1000 * 60 * 60) {
      filename += `-${('0' + date.getMinutes()).slice(-2)}`
    }

    if (this.options.filesInterval < 1000 * 60) {
      filename += `-${('0' + date.getSeconds()).slice(-2)}`
    }

    return filename.replace(/\s+/g, '');
  }

  addWritableStream(pair, ts) {
    const date = new Date(+ts);
    if (!(date instanceof Date) || !isFinite(date)) {
      debugger
    }
    const name = this.getBackupFilename(pair, date)

    this.writableStreams[pair + ts] = {
      updatedAt: null,
      stream: fs.createWriteStream(name, { flags: 'a' })
    }

    console.log(`[storage/${this.name}] created writable stream ${date.toUTCString()} => ${name}`)
  }

  reviewStreams() {
    const now = +new Date()

    for (let pairTs in this.writableStreams) {
      if (now - this.writableStreams[pairTs].updatedAt > 1000 * 60 * 10) {
        this.writableStreams[pairTs].stream.end()
        delete this.writableStreams[pairTs]

        console.log(`[storage/${this.name}] closed stream ${new Date(+ts).toUTCString()}`)
      }
    }
  }

  save(trades) {
    const now = +new Date()

    const groups = groupByPairs(trades);

    const output = Object.keys(groups).reduce((obj, pair) => {
      obj[pair] = {}
      return obj
    }, {})

    return new Promise((resolve, reject) => {
      if (!trades.length) {
        return resolve(true)
      }

      for (let pair in groups) {
        for (let i = 0; i < groups[pair].length; i++) {
          const trade = groups[pair][i];

          const ts = Math.floor(trade.timestamp / this.options.filesInterval) * this.options.filesInterval

          if (!output[pair][ts]) {
            output[pair][ts] = ''
          }

          const forWrite = [trade.exchange, trade.timestamp, trade.price, trade.size, trade.side === 'buy' ? 1 : 0];

          if (trade.liquidation) {
            forWrite.push(1);
          }

          output[pair][ts] += forWrite.join(' ') + '\n'
        }
      }

      const promises = []

      for (let pair in output) {
        for (let ts in output[pair]) {
          if (!this.writableStreams[pair + ts]) {
            this.addWritableStream(pair, ts)
          }

          promises.push(
            new Promise(resolve => {
              this.writableStreams[pair + ts].stream.write(output[pair][ts], err => {
                if (err) {
                  console.log(`[storage/${this.name}] stream.write encountered an error\n\t${err}`)
                } else {
                  this.writableStreams[pair + ts].updatedAt = now
                }

                resolve()
              })
            })
          )
        }
      }

      Promise.all(promises).then(() => resolve())
    }).then(success => {
      this.reviewStreams()

      return success
    })
  }

  fetch({from, to, pair}) {
    const paths = []

    for (
      let i = Math.floor(from / this.options.filesInterval) * this.options.filesInterval;
      i <= to;
      i += this.options.filesInterval
    ) {
      paths.push(this.getBackupFilename(pair, new Date(i)))
    }

    if (!paths.length) {
      return Promise.resolve([])
    }

    return Promise.all(
      paths.map(filePath => {
        return new Promise((resolve, reject) => {
          fs.readFile(filePath, 'utf8', (error, data) => {
            if (error) {
              // console.error(`[storage/${this.name}] unable to get ${path}\n\t`, error.message);
              return resolve([])
            }

            data = data.trim().split('\n')

            if (data[0].split(' ')[1] >= from && data[data.length - 1].split(' ')[1] <= to) {
              return resolve(data.map(row => row.split(' ')))
            } else {
              const chunk = []

              for (let j = 0; j < data.length; j++) {
                const trade = data[j].split(' ')

                if (trade[1] <= from || trade[1] >= to) {
                  continue
                }

                chunk.push(trade)
              }

              return resolve(chunk)
            }
          })
        })
      })
    ).then(chunks => [].concat.apply([], chunks))
  }
}

module.exports = FilesStorage
