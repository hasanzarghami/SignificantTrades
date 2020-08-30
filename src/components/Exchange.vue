<template>
  <div
    class="settings-exchange"
    :class="{
      '-active': state.matchs.length,
      '-hidden': !settings.visible,
      '-enabled': settings.enabled,
      '-expanded': expanded
    }"
  >
    <div class="settings-exchange__header" @click="toggleExchange">
      <span v-if="!isNaN(settings.threshold) && settings.threshold !== 1" class="settings-exchange__threshold">{{
        $root.formatAmount(minimumThreshold * settings.threshold)
      }}</span>
      <div class="settings-exchange__identity">
        <div class="settings-exchange__name">{{ exchange.id.replace('_', ' ') }}</div>
        <small class="settings-exchange__matchs" v-if="state.matchs.length">
          <span v-for="(match, index) in state.matchs" :key="index">{{ match.localPair }}</span>
        </small>
      </div>
      <div class="settings-exchange__controls">
        <button
          class="settings-exchange__visibility"
          v-tippy
          :title="exchange.visible ? 'Show' : 'Hide (from everything)'"
          @click.stop.prevent="$store.commit('settings/TOGGLE_EXCHANGE_VISIBILITY', exchange.id)"
        >
          <i class="icon-eye"></i>
        </button>
        <button class="settings-exchange__more" @click.stop.prevent="expanded = !expanded">
          <i class="icon-down"></i>
        </button>
      </div>
    </div>
    <div class="settings-exchange__detail" v-if="expanded">
      <div class="form-group">
        <label class="column" style="justify-content:space-between">
          <span class="condensed">Adj. threshold:</span>
          <span v-if="settings.threshold !== 1">{{ $root.formatAmount(minimumThreshold * settings.threshold) }}</span>
        </label>
        <slider
          :step="0.0001"
          :min="0"
          :max="2"
          :value="settings.threshold"
          @reset="
            $store.commit('settings/SET_EXCHANGE_THRESHOLD', {
              exchange: exchange.id,
              threshold: 1
            })
          "
          @output="
            $store.commit('settings/SET_EXCHANGE_THRESHOLD', {
              exchange: exchange.id,
              threshold: $event
            })
          "
        />
      </div>
      <div v-if="state.products.length" class="form-group mt8">
        <button v-if="canRefreshProducts" class="btn -red -small" @click="refreshProducts">Refresh products ({{ state.products.length }})</button>
      </div>
    </div>
  </div>
</template>

<script>
import store from '../store'

export default {
  data() {
    return {
      canRefreshProducts: true,
      expanded: false
    }
  },
  props: ['exchange'],
  computed: {
    state: function() {
      return store.state.app.exchanges[this.exchange.id]
    },
    settings: function() {
      return store.state.settings.exchanges[this.exchange.id]
    },
    minimumThreshold: function() {
      return store.state.settings.thresholds[0].amount
    }
  },
  methods: {
    toggleExchange() {
      if (this.settings.enabled) {
        this.exchange.disconnect()
        this.$store.commit('settings/DISABLE_EXCHANGE', this.exchange.id)
      } else {
        this.exchange.connect()
        this.$store.commit('settings/ENABLE_EXCHANGE', this.exchange.id)
      }
    },
    refreshProducts() {
      this.canRefreshProducts = false

      setTimeout(() => {
        this.canRefreshProducts = true
      }, 3000)

      this.exchange.fetchProducts(true).then(() => {
        this.$store.dispatch('app/showNotice', {
          type: 'success',
          title: `${this.exchange.id}'s products refreshed`
        })
      })
    }
  }
}
</script>

<style lang="scss">
.settings-exchange {
  background-color: rgba(white, 0.15);
  color: white;
  transition: all 0.2s $easeOutExpo;
  border-radius: 2px;
  margin-bottom: 8px;

  &.-loading {
    background-color: $blue;

    .settings-exchange__header:before {
      transition: all 0.2s $easeElastic;
      display: block;
      opacity: 1;
      width: 16px;
      height: 16px;
    }
  }

  &.-enabled {
    .settings-exchange__threshold {
      display: block;
    }

    .settings-exchange__name:before {
      width: 0%;
    }
  }

  &.-active {
    background-color: $green;
    color: white;

    .settings-exchange__visibility {
      display: flex;
    }

    &.-hidden {
      .icon-visibility:before {
        transform: scale(1.2) rotateY(180deg);
      }
    }
  }

  &.-hidden {
    opacity: 0.8;

    .icon-eye:before {
      content: unicode($icon-eye-crossed);
    }
  }

  &.-error {
    background-color: $red;

    .icon-warning {
      display: block;
      margin-left: 5px;
    }
  }

  &.-unmatched {
    background-color: #555;

    color: rgba(white, 0.75);
  }

  &.-expanded {
    .settings-exchange__more i:before {
      content: unicode($icon-up);
    }
  }
}

.settings-exchange__identity {
  position: relative;
  margin: 0px 10px;
  display: flex;
  flex-direction: column;
  height: 40px;
  justify-content: center;
}

.settings-exchange__name {
  position: relative;
  margin-right: auto;

  .icon-line-chart {
    position: absolute;
    right: -1.5em;
    top: 0.05em;
  }

  &:before {
    content: '';
    position: absolute;
    top: calc(50% - 0px);
    height: 1px;
    background-color: white;
    transition: width 0.2s $easeOutExpo 0.2s;
    left: -2px;
    width: calc(100% + 4px);
  }
}

.settings-exchange__matchs {
  opacity: 0.8;

  span + span {
    margin-left: 0.1em;

    &:before {
      content: '/';
      margin-right: 0.1em;
    }
  }
}

.settings-exchange__threshold {
  display: none;
  position: absolute;
  top: -0.5em;
  right: -0.5em;
  pointer-events: none;
  font-size: 90%;
  background-color: $blue;
  border-radius: 2px;
  color: white;
  padding: 0.1em 0.2em;
  box-shadow: 0 0 0 1px rgba(black, 0.2);
}

.settings-exchange__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: relative;
  cursor: pointer;

  &:before {
    content: '';
    width: 0px;
    height: 0px;

    background-color: #fff;
    border-radius: 50%;
    animation: circle-scaleout 1s infinite ease-in-out;
    transition: all 0.2s $easeElastic, visibility 0.2s linear 0.2s;
    left: 3px;
    display: none;
    align-self: center;
    position: relative;

    opacity: 0;

    @keyframes circle-scaleout {
      0% {
        -webkit-transform: scale(0);
        transform: scale(0);
      }
      100% {
        -webkit-transform: scale(1);
        transform: scale(1);
        opacity: 0;
      }
    }
  }

  .icon-warning {
    display: none;
  }
}

.settings-exchange__controls {
  display: flex;
  margin-left: auto;
  align-self: stretch;

  .settings-exchange__visibility {
    display: none;
  }

  button {
    border: 0;
    background: none;
    cursor: pointer;
    color: white;
    font-size: 18px;
    display: flex;
    align-items: center;

    &:hover {
      background-color: rgba(white, 0.1);
    }
  }
}

.settings-exchange__detail {
  padding: 10px;
  background-color: rgba(black, 0.25);
}
</style>
