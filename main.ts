import {
    App,
    Editor,
    MarkdownView,
    normalizePath,
    Notice,
    Plugin,
    PluginSettingTab,
    requestUrl,
    RequestUrlParam,
    Setting,
    TAbstractFile,
    TFile,
    MarkdownPostProcessorContext
} from 'obsidian';
// import Obsidian from 'obsidian';
import { SmartEnv } from 'smart-environment';
import views from "./dist/views.json";

import { SmartMemosAudioRecordModal } from './SmartMemosAudioRecordModal'; // Update with the correct path
import { saveFile } from 'Utils';

import { SmartTranscribeModel } from 'smart-transcribe-model';

class ExtendedSmartEnv extends SmartEnv {
    chunk_handler: (chunk: string) => void;
    done_handler: (final_resp: string) => void;
}


interface AudioPluginSettings {
	model: string;
    apiKey: string;
	prompt: string;
    includeTranscript: boolean;
    recordingFilePath: string;
}

let DEFAULT_SETTINGS: AudioPluginSettings = {
	model: 'gpt-4-0613',
    apiKey: '',
	prompt: 'You are an expert note-making AI for obsidian who specializes in the Linking Your Thinking (LYK) strategy.  The following is a transcription of recording of someone talking aloud or people in a conversation. There may be a lot of random things said given fluidity of conversation or thought process and the microphone\'s ability to pick up all audio.  Give me detailed notes in markdown language on what was said in the most easy-to-understand, detailed, and conceptual format.  Include any helpful information that can conceptualize the notes further or enhance the ideas, and then summarize what was said.  Do not mention \"the speaker\" anywhere in your response.  The notes your write should be written as if I were writting them. Finally, ensure to end with code for a mermaid chart that shows an enlightening concept map combining both the transcription and the information you added to it.  The following is the transcribed audio:\n\n',
    includeTranscript: true,
    recordingFilePath: ''
}



export default class SmartMemosPlugin extends Plugin {
    writing: boolean;
    transcript: string;

    apiKey: string = 'sk-as123mkqwenjasdasdj12...';
    model: string = 'gpt-4-0613';

    appJsonObj: any;

    // Add a new property to store the audio file
    audioFile: Blob;

    settings: any;
    active_template: string | null = null;
    env: ExtendedSmartEnv;
    obsidian: any;

    smartTranscribeModel: SmartTranscribeModel;

    async onload() {
        this.obsidian = {
            Setting,
        };
        await this.load_settings();
        this.env = SmartEnv.create(this, {
            views: views,
            global_ref: window,
        });

        const app_json = await this.app.vault.adapter.read(".obsidian/app.json");
        this.appJsonObj = JSON.parse(app_json);


        this.addCommand({
            id: 'open-transcript-modal',
            name: 'Smart transcribe',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                this.commandGenerateTranscript(editor);
            }
        });

        this.addCommand({
            id: 'record-smart-memo',
            name: 'Record smart memo',
            editorCallback: async (editor: Editor, view: MarkdownView) => {
                // Open the audio recorder and store the recorded audio
                this.audioFile = await new SmartMemosAudioRecordModal(this.app, this.handleAudioRecording.bind(this)).open();

            }
        });


        this.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
            const audioLinks = el.querySelectorAll('a.internal-link[data-href$=".wav"]');
            // console.log('audio links: ', audioLinks);
            audioLinks.forEach(link => {

                console.log('linksss');

                const href = link.getAttribute('data-href');
                if (href === null) {
                    console.error('Failed to get the href attribute from the link element.');
                    return; // Skip this iteration because there's no href
                }

                const abstractFile = this.app.vault.getAbstractFileByPath(href);
                if (!(abstractFile instanceof TFile)) {
                    console.error('The path does not point to a valid file in the vault.');
                    return; // Skip this iteration because there's no file
                }

                const audio = document.createElement('audio');
                audio.src = this.app.vault.getResourcePath(abstractFile);
                audio.controls = true;
                audio.addEventListener('loadedmetadata', () => {
                    if (audio.parentNode) {
                        const durationDisplay = document.createElement('span');
                        durationDisplay.textContent = `Duration: ${audio.duration.toFixed(2)} seconds`;
                        audio.parentNode.insertBefore(durationDisplay, audio.nextSibling);
                    }
                });
                audio.load(); // Trigger metadata loading
                link.replaceWith(audio); // Replace the link with the audio player
            });
        });


        // Add the audio recorder ribbon
        // Update the callback for the audio recorder ribbon
        this.addRibbonIcon('microphone', 'Record smart memo', async (evt: MouseEvent) => {
            // Open the audio recorder and store the recorded audio
            this.audioFile = await new SmartMemosAudioRecordModal(this.app, this.handleAudioRecording.bind(this)).open();

        });

        this.addSettingTab(new SmartMemosSettingTab(this.app, this));


    }
    static get defaults() {
        return {
            openai: {},
            chat_model_platform_key: 'openai',
            system_prompt: 'You are an expert note-making AI for obsidian who specializes in the Linking Your Thinking (LYK) strategy.  The following is a transcription of recording of someone talking aloud or people in a conversation. There may be a lot of random things said given fluidity of conversation or thought process and the microphone\'s ability to pick up all audio.  Give me detailed notes in markdown language on what was said in the most easy-to-understand, detailed, and conceptual format.  Include any helpful information that can conceptualize the notes further or enhance the ideas, and then summarize what was said.  Do not mention \"the speaker\" anywhere in your response.  The notes your write should be written as if I were writting them. Finally, ensure to end with code for a mermaid chart that shows an enlightening concept map combining both the transcription and the information you added to it.  The following is the transcribed audio:\n\n',
            includeTranscript: true
        }
    }
    async load_settings() {
        this.settings = {
            ...SmartMemosPlugin.defaults,
            ...(await this.loadData()),
        };
    }
    async save_settings() {
        await this.saveData(this.settings); // Obsidian API->saveData
        await this.load_settings(); // re-load settings into memory
    }

    // Add a new method to handle the audio recording and processing
    async handleAudioRecording(audioFile: Blob, transcribe: boolean, template: string | null) {
        try {
            if (template) this.active_template = template;
            console.log('Handling audio recording:', audioFile);

            if (!audioFile) {
                console.log('No audio was recorded.');
                return;
            }

            this.audioFile = audioFile;

            // Save the audio recording as a .wav file
            const fileName = `recording-${Date.now()}.wav`;
            const file = await saveFile(this.app, this.audioFile, fileName, this.settings.recordingFilePath);

            // Insert a link to the audio file in the current note
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView) {
                const editor = activeView.editor;
                const cursor = editor.getCursor();
                const link = `![[${file.path}]]`;
                editor.replaceRange(link, cursor);

                // Trigger a change in the editor to force Obsidian to re-render the note
                editor.replaceRange('', { line: cursor.line, ch: cursor.ch }, { line: cursor.line, ch: cursor.ch });
            }

            // Transcribe the audio file if the transcribe parameter is true
            if (transcribe) {
                this.transcribeRecording(file);
            }

            // Handle the saved audio file
            // You can replace this with your own handling logic
            console.log(file);
        } catch (error) {
            console.error('Error handling audio recording:', error);
            new Notice('Failed to handle audio recording');
        }
    }

    // Add a new method to transcribe the audio file and generate text
    async transcribeRecording(audioFile: TFile) {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) {
            console.error('No active Markdown view found.');
            return;
        }

        const editor = activeView.editor;
        this.app.vault.readBinary(audioFile).then((audioBuffer) => {
            if (this.writing) {
                new Notice('Generator is already in progress.');
                return;
            }
            this.writing = true;
            new Notice("Generating transcript...");
            const fileType = audioFile.extension;



            let config = {
                model_key: 'Xenova/whisper-large-v3',
                requestAdapter: requestUrl,
                adapter: 'iframe'
            }

            // //@ts-ignore
            // this.smartTranscribeModel = new SmartTranscribeModel(this.env, config);

            // this.smartTranscribeModel.transcribe(audioBuffer)

             // Calculate the size of each chunk
             const chunkSize = 20 * 1024 * 1024; // 15 MB
             // Calculate the number of chunks
             const numChunks = Math.ceil(audioBuffer.byteLength / chunkSize);
 
             if (numChunks < 2) {
                 new Notice(`Transcribing audio...`);
             } else {
                 new Notice(`Transcribing audio in ${numChunks} chunks. This may take a minute or two...`);
             }
 
             let audioConfig = {
                 numChunks: numChunks,
                 chunkSize: chunkSize
             }

            this.generateTranscript(audioBuffer, fileType, config.requestAdapter, audioConfig).then((result) => {
                this.transcript = result;
                const prompt = this.settings.prompt + result;
                new Notice('Transcript generated...');
                this.generateText(prompt, editor, editor.getCursor('to').line);
            }).catch(error => {
                console.warn(error.message);
                new Notice(error.message);
                this.writing = false;
            });
        });
    }

    writeText(editor: Editor, LnToWrite: number, text: string) {
        const newLine = this.getNextNewLine(editor, LnToWrite);
        editor.setLine(newLine, '\n' + text.trim() + '\n');
        return newLine;
    }

    getNextNewLine(editor: Editor, Ln: number) {
        let newLine = Ln;
        while (editor.getLine(newLine).trim().length > 0) {
            if (newLine == editor.lastLine()) editor.setLine(newLine, editor.getLine(newLine) + '\n');
            newLine++;
        }
        return newLine;
    }

    commandGenerateTranscript(editor: Editor) {
        const position = editor.getCursor();
        const text = editor.getRange({ line: 0, ch: 0 }, position);
        const regex = [
            /(?<=\[\[)(([^[\]])+)\.(mp3|mp4|mpeg|mpga|m4a|wav|webm)(?=]])/g,
            /(?<=\[(.*)]\()(([^[\]])+)\.(mp3|mp4|mpeg|mpga|m4a|wav|webm)(?=\))/g
        ];
        this.findFilePath(text, regex).then((path) => {
            const fileType = path.split('.').pop();
            if (fileType == undefined || fileType == null || fileType == '') {
                new Notice('No audio file found');
            } else {
                this.app.vault.adapter.exists(path).then((exists) => {
                    if (!exists) throw new Error(path + ' does not exist');
                    this.app.vault.adapter.readBinary(path).then((audioBuffer) => {
                        if (this.writing) {
                            new Notice('Generator is already in progress.');
                            return;
                        }
                        this.writing = true;
                        new Notice("Generating transcript...");
                        this.generateTranscript(audioBuffer, fileType).then((result) => {
                            this.transcript = result;
                            const prompt = this.settings.prompt + result;
                            new Notice('Transcript generated...');
                            this.generateText(prompt, editor, editor.getCursor('to').line);
                        }).catch(error => {
                            console.warn(error.message);
                            new Notice(error.message);
                            this.writing = false;
                        });
                    });
                });
            }
        }).catch(error => {
            console.warn(error.message);
            new Notice(error.message);
        });
    }

    
    async findFilePath(text: string, regex: RegExp[]) {
        console.log('dir text: ', text);
    
        let filename = '';
        let result: RegExpExecArray | null;
    
        // Extract the filename using the provided regex patterns
        for (const reg of regex) {
            while ((result = reg.exec(text)) !== null) {
                filename = normalizePath(decodeURI(result[0])).trim();
            }
        }
    
        if (filename === '') throw new Error('No file found in the text.');
    
        console.log('file name: ', filename);
    
        // Use the filename directly as the full path
        const fullPath = filename;
    
        console.log('full path: ', fullPath);
    
        // Check if the file exists at the constructed path
        const fileExists = this.app.vault.getAbstractFileByPath(fullPath) instanceof TAbstractFile;
        if (fileExists) return fullPath;
    
        // If not found, search through all files in the vault
        const allFiles = this.app.vault.getFiles();
        const foundFile = allFiles.find(file => file.name === filename.split('/').pop());
        if (foundFile) return foundFile.path;
    
        throw new Error('File not found');
    }
    

	async generateTranscript(audioBuffer: ArrayBuffer, filetype: string, requestAdapter : any, audioConfig : any) {
      
        let config = {
            model_key: 'Xenova/whisper-large-v3',
            requestAdapter: requestUrl,
            adapter: 'iframe'
        }

        // //@ts-ignore
        this.smartTranscribeModel = new SmartTranscribeModel(this.env, config);

        this.smartTranscribeModel.transcribe(audioBuffer)
    }

    

    async generateText(prompt: string, editor: Editor, currentLn: number, contextPrompt?: string) {
        if (prompt.length < 1) throw new Error('Cannot find prompt.');
        if (this.settings.apiKey.length <= 1) throw new Error('OpenAI API Key is not provided.');

        prompt = prompt + '.';

        let newPrompt = prompt;

        const messages: { role: string; content: string }[] = [];

        messages.push({
            role: 'user',
            content: newPrompt,
        });

        new Notice(`Performing customized superhuman analysis...`);
        let LnToWrite = this.getNextNewLine(editor, currentLn);
        if (this.active_template && window.smart_env?.smart_templates) {
            const resp = await window.smart_env.smart_templates.render(this.active_template, this.transcript);
            console.log('resp: ', resp);
            editor.setLine(LnToWrite, editor.getLine(LnToWrite) + resp);
        } else {
            let lastLine = LnToWrite;
            this.env.chunk_handler = (chunk: string) => {
                editor.setLine(LnToWrite, editor.getLine(LnToWrite) + chunk);
                if (chunk.includes('\n')) {
                    LnToWrite = this.getNextNewLine(editor, LnToWrite);
                }
            };
            this.env.done_handler = (final_resp: string) => {
                LnToWrite = this.getNextNewLine(editor, lastLine);
                if (this.settings.includeTranscript) {
                    editor.setLine(LnToWrite, editor.getLine(LnToWrite) + '\n# Transcript\n' + this.transcript);
                }
            };

            const smart_chat_model = new SmartChatModel(
                this.env,
                "openai",
                {
                    api_key: this.settings.apiKey,
                    model: this.settings.model,
                }
            );
            await smart_chat_model.complete({ messages: messages });
        }


        this.writing = false;
    }
}


class SmartMemosSettingTab extends PluginSettingTab {
    plugin: SmartMemosPlugin;
    smart_settings: SmartMemosSettings;
    config: any;
    constructor(app: App, plugin: SmartMemosPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.config = plugin.settings;
    }
    display() {
        this.smart_settings = new SmartMemosSettings(this.plugin.env, this.containerEl, "smart-memos-settings");
        return this.smart_settings.render();
    }
}

import { SmartChatModel } from "smart-chat-model";
import { SmartSettings } from "smart-setting";

// Smart Templates Specific Settings
class SmartMemosSettings extends SmartSettings {
    get settings() { return this.env.smart_memos_plugin.settings; }
    set settings(settings) {
        this.env.smart_memos_plugin.settings = settings;
    }
    get model_config() { return this.settings[this.settings.chat_model_platform_key]; }
    async get_view_data() {
        // get chat platforms
        const chat_platforms = SmartChatModel.platforms;
        console.log(chat_platforms);
        const smart_chat_model = new SmartChatModel(
            this.env,
            this.settings.chat_model_platform_key || 'openai',
            this.model_config,
        )
        const platform_chat_models = await smart_chat_model.get_models();
        console.log(platform_chat_models);
        return {
            chat_platforms,
            platform_chat_models,
            chat_platform: smart_chat_model.platform,
            settings: this.settings,
            //@ts-ignore
            hasSmartConnections: (!window.SmartSearch)
        };
    }
    get template() { return this.env.views[this.template_name]; }
    async changed_smart_chat_platform(render = true) {
        if (render) this.render();
    }
    // import model config from smart-connections
    async import_model_config_from_smart_connections() {
        const config_file = await this.env.smart_memos_plugin.app.vault.adapter.read('.obsidian/plugins/smart-connections/data.json');
        if (!config_file) return new Notice("[Smart Templates] No model config found in smart-connections");
        const config = JSON.parse(config_file);
        const settings = this.settings;
        SmartChatModel.platforms.forEach(platform => {
            if (config[platform.key]) settings[platform.key] = config[platform.key];
        });
        if (config.chat_model_platform_key) settings.chat_model_platform_key = config.chat_model_platform_key;
        this.settings = settings;
        await this.env.smart_memos_plugin.save_settings();
        this.render();
    }
}