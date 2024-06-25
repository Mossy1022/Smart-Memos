import { App, Editor, MarkdownView, normalizePath, Notice, Plugin, PluginSettingTab, requestUrl,  RequestUrlParam, Setting, TAbstractFile, TFile } from 'obsidian';
const {SmartChatModel} = require('smart-chat-model');


interface AudioPluginSettings {
	model: string;
    apiKey: string;
	prompt: string;
    includeTranscript: boolean;
}

let DEFAULT_SETTINGS: AudioPluginSettings = {
	model: 'gpt-4-0613',
    apiKey: '',
	prompt: 'You are an expert note-making AI for obsidian who specializes in the Linking Your Thinking (LYK) strategy.  The following is a transcription of recording of someone talking aloud or people in a conversation. There may be a lot of random things said given fluidity of conversation or thought process and the microphone\'s ability to pick up all audio.  Give me detailed notes in markdown language on what was said in the most easy-to-understand, detailed, and conceptual format.  Include any helpful information that can conceptualize the notes further or enhance the ideas, and then summarize what was said.  Do not mention \"the speaker\" anywhere in your response.  The notes your write should be written as if I were writting them. Finally, ensure to end with code for a mermaid chart that shows an enlightening concept map combining both the transcription and the information you added to it.  The following is the transcribed audio:\n\n',
    includeTranscript: true
}

interface TokenLimits {
    [key: string]: number;
  }
  
const TOKEN_LIMITS: TokenLimits = {
	'gpt-3.5-turbo-16k': 16000,
	'gpt-3.5-turbo-0613':4096,
	'text-davinci-003': 4097,
	'text-davinci-002': 4097,
	'code-davinci-002': 8001,
	'code-davinci-001': 8001,
	'gpt-4-0613': 8192,
	'gpt-4-32k-0613': 32768,
	'gpt-4o': 32768
}


const MODELS: string[] = [
	'gpt-3.5-turbo-16k',
	'gpt-3.5-turbo-0613',
	'text-davinci-003',
	'text-davinci-002',
	'code-davinci-002',
	'code-davinci-001',
	'gpt-4-0613',
	'gpt-4-32k-0613',
	'gpt-4o'
];
  

export default class SmartMemosPlugin extends Plugin {
	settings: AudioPluginSettings;
	writing: boolean;
	transcript: string;

	apiKey: string = 'sk-as123mkqwenjasdasdj12...';
    model: string = 'gpt-4-0613';

    appJsonObj : any;

	async onload() {

		await this.loadSettings();

        const app_json = await this.app.vault.adapter.read(".obsidian/app.json");
        this.appJsonObj = JSON.parse(app_json);


		this.addCommand({
			id: 'open-transcript-modal',
			name: 'Smart transcribe',
			editorCallback: (editor: Editor, view: MarkdownView) => {
                this.commandGenerateTranscript(editor);
            }
		});

		this.addSettingTab(new SmartMemosSettingTab(this.app, this));
		
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
        const regex = [/(?<=\[\[)(([^[\]])+)\.(mp3|mp4|mpeg|mpga|m4a|wav|webm)(?=]])/g,
            /(?<=\[(.*)]\()(([^[\]])+)\.(mp3|mp4|mpeg|mpga|m4a|wav|webm)(?=\))/g];
        this.findFilePath(text, regex).then((audioFile: TFile) => {
            this.app.vault.readBinary(audioFile).then((audioBuffer) => {
                if (this.writing) {
                    new Notice('Generator is already in progress.');
                    return;
                }
                this.writing = true;
                new Notice("Generating transcript...");
                const fileType = audioFile.extension;
                this.generateTranscript(audioBuffer, fileType).then((result) => {
                    this.transcript = result;
                    const prompt = this.settings.prompt + result;
                    new Notice('Transcript generated...');
                    this.generateText(prompt, editor , editor.getCursor('to').line);
                }).catch(error => {
                    console.warn(error.message);
                    new Notice(error.message);
                    this.writing = false;
                });
            });
        }).catch(error => {
            console.warn(error.message);
            new Notice(error.message);
        });
    }

	async generateTranscript(audioBuffer: ArrayBuffer, filetype: string) {
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
    
            const options: RequestUrlParam = {
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
                results.push(response.json.text);
            }
            else throw new Error('Error. ' + JSON.stringify(response.json));

            // Wait for 1 second before processing the next chunk
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        // Return all the results
        return results.join(' ');
    }

    async findFilePath(text: string, regex: RegExp[]) {
        let filename = '';
        let result: RegExpExecArray | null;
        for (const reg of regex) {
            while ((result = reg.exec(text)) !== null) {
                filename = normalizePath(decodeURI(result[0])).trim();
            }
        }
    
        if (filename == '') throw new Error('No file found in the text.');
    
        // Use the attachment folder path from the plugin settings
        const fullPath = this.appJsonObj.attachmentFolderPath + '/' + filename;
    
        const file = this.app.vault.getAbstractFileByPath(fullPath);
        if (file instanceof TFile) {
            return file;
        } else {
            throw new Error('File not found at ' + fullPath);
        }
    }

	async generateText(prompt: string, editor: Editor, currentLn: number, contextPrompt?: string) {
        if (prompt.length < 1) throw new Error('Cannot find prompt.');
        if ( this.settings.apiKey.length <= 1) throw new Error('OpenAI API Key is not provided.');

		prompt = prompt + '.';

        let newPrompt = prompt;

        const messages = [];

        messages.push({
            role: 'user',
            content: newPrompt,
        });

		new Notice(`Performing customized superhuman analysis...`);


        let LnToWrite = this.getNextNewLine(editor, currentLn);
        let lastLine = LnToWrite;
        const mock_env = {
            chunk_handler: (chunk: string) => {
                editor.setLine(LnToWrite, editor.getLine(LnToWrite) + chunk);
                if(chunk.includes('\n')){
                    LnToWrite = this.getNextNewLine(editor, LnToWrite);
                }
            },
            done_handler: (final_resp: string) => {
                LnToWrite = this.getNextNewLine(editor, lastLine);
                if(this.settings.includeTranscript) {
                    editor.setLine(LnToWrite, editor.getLine(LnToWrite) + '\n# Transcript\n' + this.transcript);
                }
            }
        };

        const smart_chat_model = new SmartChatModel(
            mock_env,
            "openai",
            {
                api_key: this.settings.apiKey,
                model: this.settings.model,
            }
        );
        const resp = await smart_chat_model.complete({messages: messages});
        console.log('resp: ', resp);
        // editor.setLine(LnToWrite, editor.getLine(LnToWrite) + resp);
        
        // const response = await requestUrl(options);
        
        // if (response.status !== 200) {
        //     const errorResponse = JSON.parse(response.text);
        //     const errorMessage = errorResponse && errorResponse.error.message ? errorResponse.error.message : "Error";
        //     new Notice(`Error. ${errorMessage}`);
        //     throw new Error(`Error. ${errorMessage}`);
        // } else {
        //     new Notice(`Superhuman analysis complete!`);
        // }
                
        // // Assuming the responseBody is an array of data
        // const data = response.text.split('\n');
        
        // let LnToWrite = this.getNextNewLine(editor, currentLn);
        // editor.setLine(LnToWrite++, '\n');
        // let end = false;
        // let buffer = '';
        
        // for (const datum of data) {
        //     if (datum.trim() === 'data: [DONE]') {
        //         end = true;
        //         break;
        //     }
        //     if (datum.startsWith('data:')) {
        //         const json = JSON.parse(datum.substring(6));
        //         if ('error' in json) throw new Error('Error: ' + json.error.message);
        //         if (!('choices' in json)) throw new Error('Error: ' + JSON.stringify(json));
        //         if ('content' in json.choices[0].delta) {
        //             const text = json.choices[0].delta.content;
        //             if (buffer.length < 1) buffer += text.trim();
        //             if (buffer.length > 0) {
        //                 const lines = text.split('\n');
        //                 if (lines.length > 1) {
        //                     for (const word of lines) {
        //                         editor.setLine(LnToWrite, editor.getLine(LnToWrite++) + word + '\n');
        //                     }
        //                 } else {
        //                     editor.setLine(LnToWrite, editor.getLine(LnToWrite) + text);
        //                 }
        //             }
        //         }
        //     }
        // }
        // editor.setLine(LnToWrite, editor.getLine(LnToWrite) + '\n');
        
        // // Add the raw transcript at the end
        // if (this.transcript) {
        //     editor.setLine(LnToWrite++, '# Transcript');
        //     editor.setLine(LnToWrite++, this.transcript);
        // }
        
        this.writing = false;
    }

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}


class SmartMemosSettingTab extends PluginSettingTab {
	plugin: SmartMemosPlugin;

	constructor(app: App, plugin: SmartMemosPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		let {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('OpenAI api key')
			.setDesc('Ex: sk-as123mkqwenjasdasdj12...')
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.apiKey)
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					// console.log('API Key: ' + value);
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Model')
			.setDesc('Select the model to use for note-generation')
			.addDropdown(dropdown => {
				dropdown.addOptions(MODELS.reduce((models: {[key: string]: string}, model) => {
					models[model] = model;
					return models;
				}, {}));
				dropdown.setValue(this.plugin.settings.model);
				dropdown.onChange(async (value) => {
					// console.log('Model: ' + value);
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				});
			});

        new Setting(containerEl)
			.setName('Custom transcription-to-notes prompt')
			.setDesc('Prompt that will be sent to Chatpgt right before adding your transcribed audio')
			.addTextArea(text => {
				if (text.inputEl) {
					text.inputEl.classList.add('text-box');
				}				
				text.setPlaceholder(
                    'Act as my personal secretary and worlds greatest entreprenuer and know I will put these notes in my personal obsidian where I have all my notes linked by categories, tags, etc. The following is a transcription of recording of someone talking aloud or people in a conversation. May be a lot of random things that are said given fluidity of conversation and the microphone ability to pick up all audio. Make outline of all topics and points within a structured hierarchy. Make sure to include any quantifiable information said such as the cost of headphones being $400.  Then go into to detail with summaries that explain things more eloquently. Finally, Create a mermaid chart code that complements the outline.\n\n')
				.setValue(this.plugin.settings.prompt)
				.onChange(async (value) => {
					this.plugin.settings.prompt = value;
					await this.plugin.saveSettings();
				})});

        new Setting(containerEl)
            .setName('Include Transcript')
            .setDesc('Toggle this setting if you want to include the raw transcript on top of custom notes.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.includeTranscript)
                .onChange(async (value) => {
                    this.plugin.settings.includeTranscript = value;
                    await this.plugin.saveSettings();
                }));
	}
}
