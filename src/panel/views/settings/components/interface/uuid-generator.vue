<template>
  <div class="input-group">
    <div class="input-group-prepend">
      <span class="input-group-text">
        <template v-if="typeof translatedTitle === 'string'">{{ translatedTitle }}</template>
        <template v-else-if="typeof translatedTitle === 'object'">
          {{ translatedTitle.title }}
          <small style="cursor: help;" class="text-info ml-1" data-toggle="tooltip" data-html="true" :title="translatedTitle.help">[?]</small>
        </template>
      </span>
    </div>
    <input v-model="currentValue" class="form-control" :type="!show ? 'password' : 'text'" :readonly="true" />
    <div class="input-group-append">
      <b-button variant="secondary" @mousedown="show = true" @mouseup="show=false">Show</b-button>
      <b-button variant="primary" :disabled="copied" @click="copy">{{ copied ? 'Copied!': 'Copy to clipboard' }}</b-button>
      <b-button variant="danger" @click="generate">Regenerate</b-button>
    </div>
  </div>
</template>

<script lang="ts">
import { Vue, Component, Prop, Watch } from 'vue-property-decorator';
import { v4 as uuid } from 'uuid'
import translate from 'src/panel/helpers/translate';

@Component({})
export default class uuidGenerator extends Vue {
  @Prop() readonly value!: any;
  @Prop() readonly title!: string;

  show: boolean = false;
  currentValue = this.value;
  translatedTitle = translate(this.title);

  copied = false;

  copy() {
    navigator.clipboard.writeText(this.currentValue);
    this.copied = true;
    setTimeout(() => {
      this.copied = false;
    }, 1000)
  }

  generate() {
    this.currentValue = uuid();
  }

  @Watch('currentValue')
  update() {
    this.$emit('update', { value: this.currentValue });
  }
}
</script>

