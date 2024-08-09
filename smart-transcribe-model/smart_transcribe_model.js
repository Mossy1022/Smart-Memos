// Copyright (c) Brian Joseph Petro

// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:

// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

import * as adapters from './adapters.js';
import * as transcribe_models from './models.json' assert { type: 'json' };

/**
 * An universal interface for embedding models.
 */
export class SmartTranscribeModel {
  /**
   * Create a SmartEmbed instance.
   * @param {object} env - The environment to use.
   * @param {string|object} config - The model configuration key or the model configuration object.
   * expects model to contain at least a model_key
   */
  constructor(env, config) {
    this.env = env;
    if(config.model_key) this.config = {...transcribe_models[config.model_key], ...config};
    else this.config = { ...config };
    // Initialize statistics
    this.embed_ct = 0; // Count of embeddings processed
    this.timestamp = null; // Last operation timestamp
    this.tokens = 0; // Count of tokens processed
    // Initialize adapter if specified in the configuration (else use api adapter)
    if(this.config.adapter) this.adapter = new adapters[this.config.adapter](this);
    else this.adapter = new adapters['transformers'](this);

    if(config.requestAdapter){
      this.request_adapter = config.requestAdapter;
    }

  }

  /**
   * Factory method to create a new SmartEmbed instance and initialize it.
   * @param {string} env - The environment to use.
   * @param {string} model_config - Full model configuration object or at least a model_key, api_key, and adapter
   * @returns {Promise<SmartEmbed>} A promise that resolves with an initialized SmartEmbed instance.
   */
  static async create(env, model_config) {
    const model = new this(env, model_config);
    // Initialize adapter-specific logic if adapter is present
    if (model.adapter && typeof model.adapter.init === 'function') await model.adapter.init();
    return model;
  }

  /**
   * Count the number of tokens in the input string.
   * @param {string} input - The input string to process.
   * @returns {Promise<number>} A promise that resolves with the number of tokens.
   */
  async count_tokens(input) {
    if (this.adapter && typeof this.adapter.count_tokens === 'function') {
      return await this.adapter.count_tokens(input);
    }
    // Default token counting logic here if no adapter or adapter lacks the method
  }

  /**
   * Embed the input string into a numerical array.
   * @param {string} input - The input string to embed.
   * @returns {Promise<number[]>} A promise that resolves with the embedding array.
   */
  async transcribe(audioBuffer) {
    if (this.adapter && typeof this.adapter.transcribe === 'function') {
      return await this.adapter.transcribe(audioBuffer);
    }
    // Default embedding logic here if no adapter or adapter lacks the method
  }

  /**
   * Embed a batch of input strings into arrays of numerical arrays.
   * @param {string[]} input - The array of strings to embed.
   * @returns {Promise<number[][]>} A promise that resolves with the array of embedding arrays.
   */
  async embed_batch(input) {
    if (this.adapter && typeof this.adapter.embed_batch === 'function') {
      return await this.adapter.embed_batch(input);
    }
    // Default batch embedding logic here if no adapter or adapter lacks the method
  }

  async unload() {
    if (this.adapter && typeof this.adapter.unload === 'function') {
      await this.adapter.unload();
    }
  }


  /**
   * Get the maximum number of tokens that can be processed.
   * @returns {number} The maximum number of tokens.
   */
  get max_tokens() { return this.config.max_tokens; }

  /**
   * Get the name of the model used for embedding.
   * @returns {string} The model name.
   */
  get model_name() { return this.config.model_name; }

  async request(req){
    req.url = this.endpoint;
    req.throw = false;
    // handle fallback to fetch (allows for overwriting in child classes)
    const resp = this._request_adapter ? await this._request_adapter(req) : await fetch(this.endpoint, req);
    console.log(resp);
    const resp_json = await this.get_resp_json(resp);
    console.log(resp_json);
    return resp_json;
  }
  async get_resp_json(resp) { return (typeof resp.json === 'function') ? await resp.json() : await resp.json; }

}