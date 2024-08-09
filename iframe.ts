import { Adapter } from './adapter';
import * as web_connector from '../web_connector';

class IframeAdapter extends Adapter {
    private frame: HTMLIFrameElement | null;
    private output: Record<string, any>;
    private response_handlers: Record<string, (response: { error: any; data: any }) => void>;
    private web_script: string;
    private frame_loaded: Promise<void> | undefined;
    private bound_handler: (event: MessageEvent) => void | undefined;
    private loaded: boolean;

    constructor(main: any) {
        super(main);
        this.frame = null;
        this.output = {};
        this.response_handlers = {};
        this.web_script = web_connector.script;
        this.loaded = false;
    }

    unload(): void {
        console.log("Unloading");
        this.frame?.contentWindow?.postMessage({ type: "smart_embed_unload" }, "*");
        this.output = {};
        this.response_handlers = {};
    }

    async init(): Promise<void> {
        if (!this.frame) {
            this.frame = document.createElement("iframe");
            this.frame.style.display = "none";
            this.frame_loaded = new Promise(resolve => this.frame!.onload = resolve);
            const model_loaded = new Promise<boolean>(async (resolve, reject) => {
                const startTime = Date.now();
                const timeout = 30000;
                while (!this.loaded) {
                    if (Date.now() - startTime > timeout) break;
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
                if (this.loaded) resolve(true);
                else reject(false);
            });
            this.frame.srcdoc = this.iframe_script;
            this.container.appendChild(this.frame);
            await this.frame_loaded;
            this.bound_handler = this.handle_iframe_messages.bind(this);
            this.frame.contentWindow!.addEventListener("message", this.bound_handler, false);
            this.frame.contentWindow!.postMessage({ type: "init", model_config: { ...this.main.config, container: null } }, "*");
            await model_loaded;
        }
        console.log("Connected");
    }

    request_embedding(embed_input: string | any[], retries = 0): Promise<any> {
        if (!embed_input?.length) return Promise.reject("embed_input is empty");
        const handler_id = (typeof embed_input === "string") ? embed_input : create_uid(embed_input);
        this.frame!.contentWindow!.postMessage({ type: "smart_embed", embed_input, handler_id }, "*");
        return new Promise((resolve, reject) => {
            this.response_handlers[handler_id] = ({ error, data }) => {
                if (error) {
                    console.log(error);
                    reject(error);
                } else {
                    resolve(data);
                }
            };
            setTimeout(() => {
                if (this.response_handlers[handler_id]) {
                    reject(new Error("Timeout waiting for response"));
                    delete this.response_handlers[handler_id];
                }
            }, 60000);
        });
    }

    async embed_batch(items: { embed_input: any; vec?: any; tokens?: any; }[]): Promise<any[]> {
        items = items.filter(item => item.embed_input?.length > 0);
        if (!items?.length) return [];
        const resp = await this.request_embedding(items.map(item => ({ embed_input: item.embed_input })));
        return items.map((item, i) => {
            const resp_item = resp.data[i];
            item.vec = resp_item.vec;
            item.tokens = resp_item.tokens;
            return item;
        });
    }

    embed(input: string | any[]): Promise<any> {
        return this.request_embedding(input);
    }

    count_tokens(input: string, timeout = 60000): Promise<any> {
        this.frame!.contentWindow!.postMessage({ type: "smart_embed_token_ct", embed_input: input }, "*");
        return new Promise((resolve, reject) => {
            this.response_handlers["count:" + input] = ({ error, data }) => {
                if (error) {
                    console.log(error);
                    reject(error);
                } else {
                    resolve(data);
                }
            };
            setTimeout(() => {
                if (this.response_handlers["count:" + input]) {
                    reject(new Error("Timeout waiting for response"));
                    delete this.response_handlers["count:" + input];
                }
            }, timeout);
        });
    }

    get iframe_script(): string {
        return `<script type="module">${this.web_script}</script>`;
    }

    get is_embedding(): boolean {
        return Object.keys(this.response_handlers).length > 0;
    }

    get queue_length(): number {
        return Object.keys(this.response_handlers).length;
    }

    get container_id(): string {
        return this.model_name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    }

    remove_frame(): void {
        if (this.frame) this.frame.remove();
        const frame_check = this.container.querySelector("#" + this.container_id);
        if (frame_check) frame_check.remove();
        console.log("IframeAdapter Disconnected");
    }

    handle_iframe_messages(event: MessageEvent): void {
        if (event.data.type === "smart_embed_resp" || event.data.type === "smart_embed_token_ct") {
            const handler = this.response_handlers[event.data.handler_id || event.data.text];
            if (handler) {
                handler({ error: null, data: event.data });
                delete this.response_handlers[event.data.handler_id || event.data.text];
            }
        } else if (event.data.type === "smart_embed_unloaded") {
            console.log("IframeAdapter Unloaded");
            this.frame!.contentWindow!.removeEventListener("message", this.bound_handler!);
            this.remove_frame();
            this.frame = null;
        } else if (event.data.type === "model_loaded") {
            console.log("Model Loaded: " + this.model_name);
            this.loaded = true;
        }
    }
}

export { IframeAdapter };

function create_uid(data: any): string {
    const str = JSON.stringify(data);
    let hash = 0;
    if (str.length === 0) return hash.toString();
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
        if (hash < 0) hash = hash * -1;
    }
    return hash.toString() + str.length;
}