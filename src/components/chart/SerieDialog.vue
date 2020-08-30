<template>
  <div class="serie-dialog dialog-mask" @mousedown="cancelIfOutside($event)">
    <div class="dialog-content">
      <header>
        <div class="title">{{ title }}</div>
        <div class="column -center">
          <dropdown
            class="available-types -left -center"
            :selected="type"
            label="Type"
            :options="availableTypes"
            placeholder="type"
            @output="$store.commit('settings/SET_SERIE_TYPE', { id, value: $event })"
          ></dropdown>
          <div class="form-group">
            <label
              class="checkbox-control -on-off"
              v-tippy="{ placement: 'bottom' }"
              :title="!enabled ? 'Enable ' + id : 'Disable ' + id"
              @change="$store.commit('settings/TOGGLE_SERIE', { id, value: $event.target.checked })"
            >
              <input type="checkbox" class="form-control" :checked="enabled" />
              <div></div>
            </label>
          </div>
        </div>
      </header>
      <div class="dialog-body">
        <v-jsoneditor v-model="options" :options="editorOptions" :plus="false" height="400px" @error="onError" />
      </div>
    </div>
  </div>
</template>

<script>
import seriesData from '../../data/series'
import store from '../../store'
import VJsoneditor from 'v-jsoneditor'
import { snakeToSentence } from '../../utils/helpers'

export default {
  components: {
    VJsoneditor
  },
  data: () => ({
    title: 'Serie',
    enabled: true,
    type: 'line',
    availableTypes: { line: 'Line', histogram: 'Histogram', candlestick: 'Candlestick', bar: 'Bar' },
    editorOptions: {
      mode: 'code',
      enableTransform: false,
      enableSort: false,
      mainMenuBar: false
    }
  }),
  computed: {
    options: function() {
      const options = Object.assign({}, store.state.settings.series[this.id] || {})

      if (options.input) {
        delete options.input
      }

      return options
    },
    input: function() {
      return (store.state.settings.series[this.id] || {}).input || 'bar.close'
    }
  },
  created() {
    this.title = snakeToSentence(this.id)
    this.enabled = typeof this.options.enabled === 'undefined' ? true : this.options.enabled
    this.type = typeof this.options.type === 'undefined' ? seriesData[this.id].type : this.options.type
  },
  methods: {
    cancelIfOutside(event) {
      if (event.target.classList.contains('dialog-mask')) {
        this.$close(false)
      }
    },
    getType(value, key) {
      let type = 'string'

      try {
        value = JSON.parse(value)
      } catch (error) {
        // empty
      }

      if (typeof value === 'number') {
        type = 'number'
      } else if (typeof value === 'boolean') {
        type = 'boolean'
      } else if (/^rgba?/.test(value) || /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(value)) {
        type = 'color'
      } else if (key === 'scaleMargins') {
        type = 'position'
      }

      return type
    },
    onError(event, a, b, c) {
      console.error(event, a, b, c)
    }
  }
}
</script>
