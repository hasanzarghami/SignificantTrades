import Vue from 'vue'
import Vuex from 'vuex'
import settings from './settings'
import app from './app'

Vue.use(Vuex)

const store = new Vuex.Store({
  modules: {
    app,
    settings
  }
})

let saveTimeout

store.subscribe((mutation, state) => {
  if (/^settings/.test(mutation.type)) {
    clearTimeout(saveTimeout)

    saveTimeout = setTimeout(() => {
      console.log(mutation, 'save..')
      const copy = JSON.parse(JSON.stringify(state.settings))
      localStorage.setItem('settings', JSON.stringify(copy))
    }, 200)
  }
})

export default store
