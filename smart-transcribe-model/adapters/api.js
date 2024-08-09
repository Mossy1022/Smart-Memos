import { Adapter } from "./adapter.js";
import { Tiktoken } from 'js-tiktoken/lite';
import cl100k_base from "../cl100k_base.json" assert { type: 'json' };

/**
 * ApiAdapter is the base class for all API adapters.
 * It provides the basic functionality for making requests to the API.
 * Implements OpenAI API.
 * @extends Adapter
 * Requires model_config.request_adapter to be set.
 */
export class ApiAdapter extends Adapter {
  /**
   * Counts the number of tokens in the input.
   * Override in child classes to implement third-party token counters.
   * @param {string} input - The input to count tokens for.
   * @returns {Promise<number>} The number of tokens in the input.
   */
  count_tokens(input) {
    if(!this.enc) this.enc = new Tiktoken(cl100k_base);
    const tokens = this.enc.encode(input).length;
    return tokens;
  }
  
  /**
   * Estimates the number of tokens in the input.
   * @param {string|object} input - The input to estimate tokens for.
   * @returns {number} The estimated number of tokens.
   */
  estimate_tokens(input) {
    if(typeof this.adapter?.estimate_tokens === 'function') return this.adapter.estimate_tokens(input);
    if(typeof input === 'object') input = JSON.stringify(input);
    return input.length / 3.7;
  }

  /**
   * Gets the maximum number of characters allowed in the input based on max_tokens.
   * @returns {number} The maximum number of characters.
   */
  get max_chars() { return (this.max_tokens * 4) - 100; }



  async transcribe(audioBuffer,) {
    if (this.settings.apiKey.length <= 1) throw new Error('OpenAI API Key is not provided.');

    // Reference: www.stackoverflow.com/questions/74276173/how-to-send-multipart-form-data-payload-with-typescript-obsidian-library
    const N = 16 // The length of our random boundry string
    const randomBoundryString = 'WebKitFormBoundary' + Array(N + 1).join((Math.random().toString(36) + '00000000000000000').slice(2, 18)).slice(0, N)
    const pre_string = `------${randomBoundryString}\r\nContent-Disposition: form-data; name="file"; filename="audio.mp3"\r\nContent-Type: "application/octet-stream"\r\n\r\n`;
    const post_string = `\r\n------${randomBoundryString}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n------${randomBoundryString}--\r\n`
    const pre_string_encoded = new TextEncoder().encode(pre_string);
    const post_string_encoded = new TextEncoder().encode(post_string);

    // Calculate the size of each chunk
    const chunkSize = 20 * 1024 * 1024; // 15 MB

    // Calculate the number of chunks
    const numChunks = Math.ceil(audioBuffer.byteLength / chunkSize);

    if (numChunks < 2) {
        new Notice(`Transcribing audio...`);
    } else {
        new Notice(`Transcribing audio in ${numChunks} chunks. This may take a minute or two...`);
    }


    // Create an array to store the results
    let results = [];

    // Process each chunk
    for (let i = 0; i < numChunks; i++) {

        new Notice(`Transcribing chunk #${i + 1}...`);

        // Get the start and end indices for this chunk
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, audioBuffer.byteLength);

        // Extract the chunk from the audio buffer
        const chunk = audioBuffer.slice(start, end);

        // Concatenate the chunk with the pre and post strings
        const concatenated = await new Blob([pre_string_encoded, chunk, post_string_encoded]).arrayBuffer()

        const options = {
            url: 'https://api.openai.com/v1/audio/transcriptions',
            method: 'POST',
            contentType: `multipart/form-data; boundary=----${randomBoundryString}`,
            headers: {
                'Authorization': 'Bearer ' + this.settings.apiKey
            },
            body: concatenated
        };

        const response = await requestUrl(options).catch((error) => {
            if (error.message.includes('401')) throw new Error('OpenAI API Key is not valid.');
            else throw error;
        });
        
        if ('text' in response.json) {
            // Add the result to the results array
            // @ts-ignore
            results.push(response.json.text);
        }
        else throw new Error('Error. ' + JSON.stringify(response.json));

        // Wait for 1 second before processing the next chunk
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    // Return all the results
    return results.join(' ');
}

  /**
   * Parses the embedding output for each input.
   * @param {Array} embed_inputs - The inputs used for embedding.
   * @param {object} embedding - The embedding result.
   * @param {number} i - The index of the current embedding.
   * @returns {object} The parsed embedding output.
   */
  parse_embedding_output(embed_inputs, embedding, i) {
    const total_chars = this.count_embed_input_chars(embed_inputs);
    return {
      vec: embedding.vec,
      tokens: Math.round((embed_inputs[i].length / total_chars) * embedding.tokens)
    };
  }

  /**
   * Counts the total number of characters in all embed inputs.
   * @param {Array} embed_inputs - The inputs used for embedding.
   * @returns {number} The total number of characters.
   */
  count_embed_input_chars(embed_inputs) { return embed_inputs.reduce((acc, curr) => acc + curr.length, 0); }

  /**
   * Prepares the batch input by processing each item's embed input.
   * @param {Array} items - The items to prepare.
   * @returns {Array} The prepared batch input.
   */
  prepare_batch_input(items) { return items.map(item => this.prepare_embed_input(item.embed_input)); }

  /**
   * Prepares the embed input by truncating it if necessary.
   * @param {string} embed_input - The input to prepare.
   * @returns {string} The prepared embed input.
   */
  prepare_embed_input(embed_input) {
    const tokens_ct = this.count_tokens(embed_input);
    if(tokens_ct < this.max_tokens) return embed_input;
    // console.log(`tokens_ct: ${tokens_ct} (max: ${this.max_tokens})`);
    const reduce_rt = (tokens_ct - this.max_tokens) / tokens_ct;
    // console.log(`reduce_rt: ${reduce_rt}`);
    embed_input = embed_input.slice(0, embed_input.length - Math.floor(embed_input.length * reduce_rt) - 100);
    // console.log(`truncated input: ${embed_input.length}`);
    return this.prepare_embed_input(embed_input);
  }

  /**
   * Prepares the request body for embedding.
   * @param {string[]} embed_input - The input to embed.
   * @returns {object} The prepared request body.
   */
  prepare_request_body(embed_input){
    const body = {
      model: this.model_name,
      input: embed_input,
    };
    if (this.model_name.startsWith("text-embedding-3")) {
      body.dimensions = this.dims;
    }
    return body;
  }

  /**
   * Prepares the request headers for the API call.
   * @returns {object} The prepared request headers.
   */
  prepare_request_headers() {
    let headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.api_key}`
    };
    if (this.headers) headers = { ...headers, ...this.headers };
    return headers;
  }

  /**
   * Requests the embedding from the API.
   * @param {string|string[]} embed_input - The input to embed. May be a string or an array of strings.
   * @returns {Promise<object[]>} The embedding objects {vec, tokens}.
   */
  async request_embedding(embed_input) {
    // Check if embed_input is empty
    if (embed_input.length === 0) {
      console.log("embed_input is empty");
      return null;
    }
    const request = {
      url: this.endpoint,
      method: "POST",
      body: JSON.stringify(this.prepare_request_body(embed_input)),
      headers: this.prepare_request_headers()
    };
    const resp = await this.request(request);
    return this.parse_response(resp);
  }

  /**
   * Parses the response from the API.
   * @param {object} resp - The response from the API.
   * @returns {Array} The parsed response data.
   */
  parse_response(resp) {
    return resp.data.map(item => ({
      vec: item.embedding,
      tokens: resp.usage.total_tokens
    }));
  }

  /**
   * Checks if the response JSON indicates an error.
   * @param {object} resp_json - The response JSON to check.
   * @returns {boolean} True if there is an error, false otherwise.
   */
  is_error(resp_json) { return !resp_json.data || !resp_json.usage; }

  /**
   * Retrieves the JSON from the response.
   * @param {Response} resp - The response object.
   * @returns {Promise<object>} The response JSON.
   */
  async get_resp_json(resp) { return (typeof resp.json === 'function') ? await resp.json() : await resp.json; }

  /**
   * Handles the request, including retries for specific errors.
   * @param {object} req - The request object.
   * @param {number} retries - The current retry count.
   * @returns {Promise<object|null>} The response JSON or null if an error occurs.
   */
  async request(req, retries = 0){
    try {
      req.throw = false;
      // handle fallback to fetch (allows for overwriting in child classes)
      const resp = this.request_adapter ? await this.request_adapter({url: this.endpoint, ...req}) : await fetch(this.endpoint, req);
      const resp_json = await this.get_resp_json(resp);
      if(this.is_error(resp_json)) return await this.handle_request_err(resp_json, req, retries);
      return resp_json;
    } catch (error) {
      return await this.handle_request_err(error, req, retries);
    }
  }

  /**
   * Handles errors during the request, including retrying the request.
   * @param {Error} error - The error encountered.
   * @param {object} req - The request object.
   * @param {number} retries - The current retry count.
   * @returns {Promise<object|null>} The response JSON or null if an error persists.
   */
  async handle_request_err(error, req, retries) {
    // error = error.error || error;
    // if(error.message?.includes("maximum context length is")) {
    //   const max_len = parseInt(error.message.split("length is ")[1].split("tokens")[0].trim());
    //   const requested_len = parseInt(error.message.split("requested")[1].split("tokens")[0].trim());
    //   console.log(`max context length: ${max_len}, requested: ${requested_len}`);
    //   const body = JSON.parse(req.body);
    //   const longest_len = Math.max(...body.input.map(item => item.length));
    //   const longest_i = body.input.findIndex(i => i.length === longest_len);
    //   // reduce the longest input by the same ratio as the requested length to the max length (10 requested, 8 max, reduce longest by 20% to 8)
    //   const reduce_factor = (requested_len - max_len) / requested_len;
    //   // console.log(`reduce factor: ${reduce_factor}`);
    //   body.input[longest_i] = body.input[longest_i].slice(0, longest_len - Math.floor(reduce_factor * longest_len) - (100 * retries));
    //   console.log(`truncated input: ${body.input[longest_i].length}`);
    //   req.body = JSON.stringify(body);
    //   return await this.request(req, retries + 1);
    // }
    if (error.status === 429 && retries < 3) {
      const backoff = Math.pow(retries + 1, 2); // exponential backoff
      console.log(`Retrying request (429) in ${backoff} seconds...`);
      await new Promise(r => setTimeout(r, 1000 * backoff));
      return await this.request(req, retries + 1);
    }
    console.error(error);
    return null;
  }
}