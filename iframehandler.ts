export class TransformersIframeConnector {
    model: any;
    running_init: boolean;
    window: Window & typeof globalThis;
    embed_ct: number;
    timestamp: number | null;
    tokens: number;
    model_config: any;
    tokenizer: any;

    constructor(model_config: any, window: Window & typeof globalThis) {
        this.model_config = model_config;
        this.window = window;
        this.model = null;
        this.running_init = false;
        this.embed_ct = 0;
        this.timestamp = null;
        this.tokens = 0;
    }

    static async create(model_config: any, window: Window & typeof globalThis) {
        const connector = new TransformersIframeConnector(model_config, window);
        await connector.init();
        return connector;
    }

    async init() {
        if (this.model) return console.log("Model already loaded");
        if (this.running_init) await new Promise(resolve => setTimeout(resolve, 3000));
        if (!this.model && !this.running_init) this.running_init = true;
        console.log("Loading model");

        const { pipeline, env, AutoTokenizer } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@latest');
        env.allowLocalModels = false;
        this.model = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
        this.tokenizer = await AutoTokenizer.from_pretrained('Xenova/whisper-tiny.en');
        this.running_init = false;
        this.window.tokenizer = this.tokenizer;
        console.log(await this.embed("test"));
        this.window.postMessage({ type: "model_loaded", data: true }, "*");
        this.window.addEventListener("message", this.handle_ipc.bind(this), false);
    }

    async handle_ipc(event: MessageEvent) {
        if (event.data.type == "smart_embed") this.embed_handler(event.data);
        if (event.data.type == "smart_embed_token_ct") this.count_tokens_handler(event.data.embed_input);
        if (event.data.type == "smart_embed_unload") await this.unload();
    }

    async embed_handler(event_data: any) {
        const { embed_input, handler_id } = event_data;
        if (!this.timestamp) this.timestamp = Date.now();
        if (Array.isArray(embed_input)) {
            const resp = await this.embed_batch(embed_input);
            const send_data = {
                type: "smart_embed_resp",
                handler_id,
                data: resp,
            };
            this.window.postMessage(send_data, "*");
            this.tokens += resp.reduce((acc, item) => acc + item.tokens, 0);
            this.embed_ct += resp.length;
        } else {
            const send_data = await this.embed(embed_input);
            send_data.type = "smart_embed_resp";
            if (handler_id) send_data.handler_id = handler_id;
            this.window.postMessage(send_data, "*");
            this.tokens += send_data.tokens;
            this.embed_ct++;
        }
        if (Date.now() - this.timestamp > 10000) {
            console.log(`Embedded: ${this.embed_ct} inputs (${this.tokens} tokens, ${(this.tokens / ((Date.now() - this.timestamp) / 1000)).toFixed(0)} tokens/sec)`);
            this.timestamp = null;
            this.tokens = 0;
            this.embed_ct = 0;
        }
    }

    async count_tokens_handler(input: any) {
        const output = await this.count_tokens(input);
        const send_data = {
            type: "smart_embed_token_ct",
            text: "count:" + input,
            count: output
        };
        this.window.postMessage(send_data, "*");
    }

    async unload() {
        try {
            await this.model?.dispose();
        } catch (error) {
            console.warn("Failed to unload model:", error);
        }
        this.window.postMessage({ type: "smart_embed_unloaded", unloaded: true }, "*");
    }

    private async embed(input: any): Promise<any> {
        const encoded = await this.tokenizer.encode(input);
        const embeddings = await this.model(encoded);
        return {
            vec: embeddings.data,
            tokens: encoded.length
        };
    }

    private async embed_batch(inputs: any[]): Promise<any[]> {
        const results = [];
        for (const input of inputs) {
            const encoded = await this.tokenizer.encode(input);
            const embeddings = await this.model(encoded);
            results.push({
                vec: embeddings.data,
                tokens: encoded.length
            });
        }
        return results;
    }

    private async count_tokens(input: any): Promise<number> {
        const encoded = await this.tokenizer.encode(input);
        return encoded.length;
    }
}
