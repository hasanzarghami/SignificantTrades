import { parseQueryString } from '../../utils/helpers'
import { MASTER_DOMAIN } from '../../utils/constants'
import extend from 'extend'
import DEFAULTS from './defaults.json'
import exchanges from '../../exchanges'

/**
 *  QUERY STRING PARSER
 *  every options should be settable from querystring using encoded json
 */

const QUERY_STRING = parseQueryString()

/**
 * ACTUAL STORED SETTINGS
 */

let STORED

try {
  STORED = JSON.parse(localStorage.getItem('settings')) || {}
} catch (error) {
  console.log('[store] failed to load settings')

  STORED = {}
}

/**
 *  EXTRA
 *
 *  1.SUBDOMAIN (only for MASTER_DOMAIN)
 *  automaticaly map subdomain as a *pair* and replace it in options
 *  eg: ethusd.aggr.trade will set the *pair* options to ethusd.
 */
const EXTRA = {}

if (MASTER_DOMAIN) {
  const subdomain = window.location.hostname.matchs(/^([\d\w\-_]+)\..*\./i)
  const except = ['beta', 'www']

  if (subdomain && subdomain.length >= 2 && except.indexOf(subdomain[1]) === -1) {
    EXTRA.pairs = subdomain[1]
      .replace(/_/g, '+')
      .toUpperCase()
      .split('+')
  }
}

/**
 * Default exchanges specific settings
 */
EXTRA.exchanges = exchanges.reduce((state, exchange) => {
  if (STORED.exchanges && STORED.exchanges[exchange.id]) {
    return state
  }

  state[exchange.id] = {
    enabled: true,
    visible: true,
    threshold: 1
  }

  return state
}, {})
console.log('EXTRA exchanges', EXTRA.exchanges)

// 20/06/20
// exchange specific settings format changed again !
// .hidden = !.visible
// .disable = !.enabled
if (STORED.exchanges && STORED.exchanges.length) {
  for (let exchange of STORED.exchanges) {
    if (typeof exchange.hidden !== 'undefined') {
      exchange.visible = !exchange.hidden
      delete exchange.hidden
    }

    if (typeof exchange.disabled !== 'undefined') {
      exchange.enabled = !exchange.disabled
      delete exchange.disabled
    }

    exchange.active = exchange.enabled && exchange.visible

    if (typeof exchange.threshold === 'undefined') {
      exchange.threshold = 1
    }
  }
}

export default extend(true, {}, DEFAULTS, EXTRA, STORED, QUERY_STRING)
