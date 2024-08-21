import { App, Editor, MarkdownView, normalizePath, Notice, Plugin, PluginSettingTab, requestUrl,  RequestUrlParam, Setting, TAbstractFile, TFile, MarkdownPostProcessorContext } from 'obsidian';
const {SmartChatModel} = require('smart-chat-model');


import { SmartMemosAudioRecordModal } from './SmartMemosAudioRecordModal'; // Update with the correct path
import { saveFile } from 'Utils';

interface AudioPluginSettings {
	model: string;
    apiKey: string;
	prompt: string;
    includeTranscript: boolean;
    recordingFilePath: string;
    keepAudio: boolean;
    includeAudioFileLink : boolean;
}

let DEFAULT_SETTINGS: AudioPluginSettings = {
	model: 'gpt-4-0613',
    apiKey: '',
	prompt: 'You are an expert note-making AI for obsidian who specializes in the Linking Your Thinking (LYK) strategy.  The following is a transcription of recording of someone talking aloud or people in a conversation. There may be a lot of random things said given fluidity of conversation or thought process and the microphone\'s ability to pick up all audio.  Give me detailed notes in markdown language on what was said in the most easy-to-understand, detailed, and conceptual format.  Include any helpful information that can conceptualize the notes further or enhance the ideas, and then summarize what was said.  Do not mention \"the speaker\" anywhere in your response.  The notes your write should be written as if I were writting them. Finally, ensure to end with code for a mermaid chart that shows an enlightening concept map combining both the transcription and the information you added to it.  The following is the transcribed audio:\n\n',
    includeTranscript: true,
    recordingFilePath: '',
    keepAudio: true,
    includeAudioFileLink: false
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
	'gpt-4o',
    'gpt-4o-mini'
];
  

export default class SmartMemosPlugin extends Plugin {
	settings: AudioPluginSettings;
	writing: boolean;
	transcript: string;
	apiKey: string = 'sk-as123mkqwenjasdasdj12...';
    model: string = 'gpt-4-0613';

    appJsonObj : any;

    // Add a new property to store the audio file
    audioFile: Blob;

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

        this.addCommand({
            id: 'record-smart-memo',
            name: 'Record smart memo',
            editorCallback: async (editor: Editor, view: MarkdownView) => {
                // Open the audio recorder and store the recorded audio
                this.audioFile = await new SmartMemosAudioRecordModal(this.app, this.handleAudioRecording.bind(this), this.settings).open();

            }
        });


        this.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
            const audioLinks = el.querySelectorAll('a.internal-link[data-href$=".wav"]');
            console.log('audio links: ', audioLinks);
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
            this.audioFile = await new SmartMemosAudioRecordModal(this.app, this.handleAudioRecording.bind(this), this.settings).open();

        });

		this.addSettingTab(new SmartMemosSettingTab(this.app, this));
		
	}

    // Add a new method to handle the audio recording and processing
    async handleAudioRecording(audioFile: Blob, transcribe: boolean, keepAudio: boolean, includeAudioFileLink: boolean) {
        try {
            console.log('Handling audio recording:', audioFile);

            if (!audioFile) {
                console.log('No audio was recorded.');
                return;
            }

            this.audioFile = audioFile;

            // Save the audio recording as a .wav file
            const fileName = `recording-${Date.now()}.wav`;
            const file = await saveFile(this.app, this.audioFile, fileName, this.settings.recordingFilePath);

            this.settings.keepAudio = keepAudio;
            this.settings.includeAudioFileLink = includeAudioFileLink;
            this.saveSettings();

            // Only save the audio file if use wants to include it and they are keeping the audio
            if (includeAudioFileLink && keepAudio) { 
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
            }

            // Transcribe the audio file if the transcribe parameter is true
            if (transcribe) {
                this.transcribeRecording(file);
            }

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
            this.generateTranscript(audioBuffer, fileType).then((result) => {
                this.transcript = result;
                const prompt = this.settings.prompt + result;
                new Notice('Transcript generated...');
                this.generateText(prompt, editor , editor.getCursor('to').line);
                //if keepAudio is false and delete the audio file if so
                if (!this.settings.keepAudio) {
                    this.app.vault.delete(audioFile); // Delete the audio file
                }
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
					text.inputEl.classList.add('smart-memo-text-box');
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

        new Setting(containerEl)
            .setName('Recording File Path')
            .setDesc('Specify the file path where recordings will be saved. Ex. If you want to put recordings in Resources folder then path is "Resources" (Defaults to root)')
            .addText(text => text
                .setPlaceholder('Ex. Resources (if in Resources)')
                .setValue(this.plugin.settings.recordingFilePath || '')
                .onChange(async (value) => {
                    this.plugin.settings.recordingFilePath = value;
                    await this.plugin.saveSettings();
                }));
        
        new Setting(containerEl)
        .setName('Save Audio File')
        .setDesc('Toggle this setting if you want to save/remove the audio file after it has been transcribed.')
        .addToggle(toggle => toggle
            .setValue(this.plugin.settings.keepAudio) 
            .onChange(async (value) => {
                this.plugin.settings.keepAudio = value;
                await this.plugin.saveSettings();
            }));
    
        new Setting(containerEl)
            .setName('Include Audio Player')
            .setDesc('Toggle this setting if you want the audio file player to be displayed along with the transcription.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.includeAudioFileLink) 
                .onChange(async (value) => {
                    this.plugin.settings.includeAudioFileLink = value;
                    await this.plugin.saveSettings();
                }));

	}
}
