import { App, Editor, MarkdownView, normalizePath, Notice, Plugin, PluginSettingTab, requestUrl,  RequestUrlParam, Setting, TAbstractFile, TFile, MarkdownPostProcessorContext } from 'obsidian';
const {SmartChatModel} = require('smart-chat-model');

import { SmartMemosAudioRecordModal } from './SmartMemosAudioRecordModal';
import { SmartMemosStatusBar } from './SmartMemosStatusBar';
import { saveFile } from 'Utils';
import { AIProvider } from './providers/AIProvider';
import { ProviderFactory, ProviderType } from './providers/ProviderFactory';

interface AudioPluginSettings {
	model: string;
    apiKey: string;
	prompt: string;
    includeTranscript: boolean;
    recordingFilePath: string;
    keepAudio: boolean;
    includeAudioFileLink : boolean;
    
    // New settings
    recordingInterface: 'modal' | 'statusbar' | 'floating';
    aiProvider: ProviderType;
    rememberTargetNote: 'remember' | 'no' | 'ask';
    statusBarPosition: 'far-left' | 'left' | 'center' | 'right' | 'far-right';
    
    // Provider-specific settings
    geminiApiKey: string;
    geminiModel: string;
}

let DEFAULT_SETTINGS: AudioPluginSettings = {
	model: 'gpt-4-0613',
    apiKey: '',
	prompt: 'You are an expert note-making AI for obsidian who specializes in the Linking Your Thinking (LYK) strategy.  The following is a transcription of recording of someone talking aloud or people in a conversation. There may be a lot of random things said given fluidity of conversation or thought process and the microphone\'s ability to pick up all audio.  Give me detailed notes in markdown language on what was said in the most easy-to-understand, detailed, and conceptual format.  Include any helpful information that can conceptualize the notes further or enhance the ideas, and then summarize what was said.  Do not mention \"the speaker\" anywhere in your response.  The notes your write should be written as if I were writting them. Finally, ensure to end with code for a mermaid chart that shows an enlightening concept map combining both the transcription and the information you added to it.  The following is the transcribed audio:\n\n',
    includeTranscript: true,
    recordingFilePath: '',
    keepAudio: true,
    includeAudioFileLink: false,
    
    // New default settings
    recordingInterface: 'modal',
    aiProvider: 'openai',
    rememberTargetNote: 'ask',
    statusBarPosition: 'right',
    
    // Provider defaults
    geminiApiKey: '',
    geminiModel: 'gemini-2.0-flash-exp'
}

const MODELS: string[] = [
    'gpt-5',
    'gpt-5-mini',
    'gpt-5-nano',
    'gpt-4.5',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-4',
    'gpt-3.5-turbo',
    'o1-preview',
    'o1-mini'
];
  

export default class SmartMemosPlugin extends Plugin {
	settings: AudioPluginSettings;
	writing: boolean;
	transcript: string;
	apiKey: string = 'sk-as123mkqwenjasdasdj12...';
    model: string = 'gpt-4-0613';

    appJsonObj : any;

    private audioContext: AudioContext;
    public aiProvider: AIProvider;
    public statusBar: SmartMemosStatusBar | null = null;


    // Add a new property to store the audio file
    audioFile: Blob;

	async onload() {

		await this.loadSettings();

        const app_json = await this.app.vault.adapter.read(".obsidian/app.json");
        this.appJsonObj = JSON.parse(app_json);

        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        
        // Initialize AI provider
        this.initializeAIProvider();
        
        // Initialize status bar if needed
        if (this.settings.recordingInterface === 'statusbar') {
            this.initializeStatusBar();
        }


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
                await this.startRecording();
            }
        });


        this.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
            const audioLinks = el.querySelectorAll('a.internal-link[data-href$=".wav"]');
            audioLinks.forEach(link => {

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
            await this.startRecording();
        });

		this.addSettingTab(new SmartMemosSettingTab(this.app, this));
		
	}

    public initializeAIProvider() {
        const providerSettings = ProviderFactory.getProviderSettings(this.settings.aiProvider, this.settings);
        this.aiProvider = ProviderFactory.createProvider({
            type: this.settings.aiProvider,
            settings: providerSettings,
            audioContext: this.audioContext
        });
    }
    
    public initializeStatusBar() {
        if (this.statusBar) {
            this.statusBar.unload();
        }
        
        // Remove any existing status bar elements from this plugin
        this.removeExistingStatusBarElements();
        
        const statusBarEl = this.addStatusBarItemAtPosition();
        this.statusBar = new SmartMemosStatusBar(
            this.app,
            statusBarEl,
            this.handleAudioRecording.bind(this),
            {
                keepAudio: this.settings.keepAudio,
                includeAudioFileLink: this.settings.includeAudioFileLink,
                rememberTargetNote: this.settings.rememberTargetNote
            }
        );
    }
    
    private removeExistingStatusBarElements() {
        const statusBar = document.querySelector('.status-bar');
        if (statusBar) {
            const existingElements = statusBar.querySelectorAll('.smart-memo-status-bar');
            existingElements.forEach(el => el.remove());
        }
    }
    
    private addStatusBarItemAtPosition(): HTMLElement {
        const statusBar = document.querySelector('.status-bar');
        if (!statusBar) {
            return this.addStatusBarItem(); // Fallback to default
        }
        
        const statusBarEl = document.createElement('div');
        statusBarEl.addClass('status-bar-item');
        
        let insertIndex = 0;
        const statusBarItems = Array.from(statusBar.children);
        
        switch (this.settings.statusBarPosition) {
            case 'far-left':
                insertIndex = 0;
                break;
            case 'left':
                // Find sync button and insert before it
                const syncIndex = statusBarItems.findIndex(el => 
                    el.querySelector('[data-tooltip*="sync"]') || 
                    el.querySelector('.sync-status-bar') ||
                    el.textContent?.includes('sync')
                );
                insertIndex = syncIndex > 0 ? syncIndex : Math.floor(statusBarItems.length * 0.3);
                break;
            case 'center':
                insertIndex = Math.floor(statusBarItems.length / 2);
                break;
            case 'right':
                insertIndex = Math.floor(statusBarItems.length * 0.8);
                break;
            case 'far-right':
            default:
                insertIndex = statusBarItems.length;
                break;
        }
        
        if (insertIndex >= statusBarItems.length) {
            statusBar.appendChild(statusBarEl);
        } else {
            statusBar.insertBefore(statusBarEl, statusBarItems[insertIndex]);
        }
        
        return statusBarEl;
    }
    
    private async startRecording() {
        if (this.settings.recordingInterface === 'statusbar') {
            // Status bar handles its own recording
            new Notice('Use the status bar controls to manage recording');
        } else {
            // Use modal (default behavior)
            this.audioFile = await new SmartMemosAudioRecordModal(this.app, this.handleAudioRecording.bind(this), this.settings).open();
        }
    }

    // Add a new method to handle the audio recording and processing
    async handleAudioRecording(audioFile: Blob, transcribe: boolean, keepAudio: boolean, includeAudioFileLink: boolean, targetNote?: TFile) {
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
                this.transcribeRecording(file, targetNote);
            }

        } catch (error) {
            console.error('Error handling audio recording:', error);
            new Notice('Failed to handle audio recording');
        }
    }

    // Add a new method to transcribe the audio file and generate text
    async transcribeRecording(audioFile: TFile, targetNote?: TFile) {
        let targetView: MarkdownView | null = null;
        let targetEditor: Editor | null = null;
        
        if (targetNote) {
            // Try to find existing view for target note
            const leaves = this.app.workspace.getLeavesOfType('markdown');
            for (const leaf of leaves) {
                const view = leaf.view as MarkdownView;
                if (view.file && view.file.path === targetNote.path) {
                    targetView = view;
                    targetEditor = view.editor;
                    break;
                }
            }
            
            // If no existing view, open the target note
            if (!targetView) {
                const leaf = this.app.workspace.getLeaf(false);
                await leaf.openFile(targetNote);
                targetView = leaf.view as MarkdownView;
                targetEditor = targetView.editor;
            }
        } else {
            // Fall back to current active view
            targetView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!targetView) {
                console.error('No active Markdown view found.');
                return;
            }
            targetEditor = targetView.editor;
        }

        if (!targetEditor) {
            console.error('Could not get editor for target note.');
            return;
        }
        
        // Determine insertion point based on whether we're using a target note
        let insertionLine: number;
        if (targetNote) {
            // When using target note, append to bottom of file
            insertionLine = targetEditor.lastLine();
            // Position cursor at end of last line to ensure proper appending
            const lastLineContent = targetEditor.getLine(insertionLine);
            targetEditor.setCursor(insertionLine, lastLineContent.length);
        } else {
            // Normal behavior: use current cursor position
            insertionLine = targetEditor.getCursor('to').line;
        }
        
        this.app.vault.readBinary(audioFile).then((audioBuffer) => {
            if (this.writing) {
                new Notice('Generator is already in progress.');
                return;
            }
            this.writing = true;
            new Notice("Generating transcript...");
            const fileType = audioFile.extension;
            this.aiProvider.transcribe(audioBuffer, this.audioContext).then((result) => {
                this.transcript = result;
                const prompt = this.settings.prompt + result;
                new Notice('Transcript generated...');
                this.generateTextWithProvider(prompt, targetEditor!, insertionLine);
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
                        this.aiProvider.transcribe(audioBuffer, this.audioContext).then((result) => {
                            this.transcript = result;
                            const prompt = this.settings.prompt + result;
                            new Notice('Transcript generated...');
                            this.generateTextWithProvider(prompt, editor, editor.getCursor('to').line);
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
    

	async generateTextWithProvider(prompt: string, editor: Editor, currentLn: number, contextPrompt?: string) {
        if (prompt.length < 1) throw new Error('Cannot find prompt.');

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

        try {
            await this.aiProvider.generateText({
                messages: messages,
                onChunk: (chunk: string) => {
                    editor.setLine(LnToWrite, editor.getLine(LnToWrite) + chunk);
                    if(chunk.includes('\n')){
                        LnToWrite = this.getNextNewLine(editor, LnToWrite);
                    }
                },
                onComplete: (final_resp: string) => {
                    LnToWrite = this.getNextNewLine(editor, lastLine);
                    if(this.settings.includeTranscript) {
                        editor.setLine(LnToWrite, editor.getLine(LnToWrite) + '\n# Transcript\n' + this.transcript);
                    }
                }
            });
        } catch (error: any) {
            console.error('Text generation failed:', error);
            new Notice(`Text generation failed: ${error.message}`);
        }
        
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

		// Recording Interface Setting
		new Setting(containerEl)
			.setName('Recording Interface')
			.setDesc('Choose how you want to interact with recording controls')
			.addDropdown(dropdown => {
				dropdown.addOption('modal', 'Modal (Default)');
				dropdown.addOption('statusbar', 'Status Bar');
				dropdown.setValue(this.plugin.settings.recordingInterface);
				dropdown.onChange(async (value: 'modal' | 'statusbar' | 'floating') => {
					this.plugin.settings.recordingInterface = value;
					await this.plugin.saveSettings();
					
					// Reinitialize interface
					if (value === 'statusbar') {
						this.plugin.initializeStatusBar();
					} else if (this.plugin.statusBar) {
						this.plugin.statusBar.unload();
						this.plugin.statusBar = null;
					}
				});
			});

		new Setting(containerEl)
			.setName('Remember Target Note')
			.setDesc('Choose how to handle recording to a specific note when using status bar interface')
			.addDropdown(dropdown => {
				dropdown.addOption('remember', 'Always Remember Current Note');
				dropdown.addOption('ask', 'Ask Each Time');
				dropdown.addOption('no', 'Never Remember (Insert at Cursor)');
				dropdown.setValue(this.plugin.settings.rememberTargetNote);
				dropdown.onChange(async (value: 'remember' | 'ask' | 'no') => {
					this.plugin.settings.rememberTargetNote = value;
					await this.plugin.saveSettings();
					
					// Update status bar with new settings
					if (this.plugin.statusBar) {
						this.plugin.statusBar.updateSettings({
							keepAudio: this.plugin.settings.keepAudio,
							includeAudioFileLink: this.plugin.settings.includeAudioFileLink,
							rememberTargetNote: this.plugin.settings.rememberTargetNote
						});
					}
				});
			});

		new Setting(containerEl)
			.setName('Status Bar Position')
			.setDesc('Choose where to position the recording controls in the status bar')
			.addDropdown(dropdown => {
				dropdown.addOption('far-left', 'Far Left');
				dropdown.addOption('left', 'Left (Before Sync)');
				dropdown.addOption('center', 'Center');
				dropdown.addOption('right', 'Right');
				dropdown.addOption('far-right', 'Far Right (Default)');
				dropdown.setValue(this.plugin.settings.statusBarPosition);
				dropdown.onChange(async (value: 'far-left' | 'left' | 'center' | 'right' | 'far-right') => {
					this.plugin.settings.statusBarPosition = value;
					await this.plugin.saveSettings();
					
					// Reinitialize status bar to apply new position
					if (this.plugin.settings.recordingInterface === 'statusbar') {
						this.plugin.initializeStatusBar();
					}
				});
			});

		// AI Provider Setting
		new Setting(containerEl)
			.setName('AI Provider')
			.setDesc('Choose your AI provider for transcription and text generation')
			.addDropdown(dropdown => {
				dropdown.addOption('openai', 'OpenAI');
				dropdown.addOption('gemini', 'Google Gemini');
				dropdown.setValue(this.plugin.settings.aiProvider);
				dropdown.onChange(async (value: 'openai' | 'gemini') => {
					this.plugin.settings.aiProvider = value;
					await this.plugin.saveSettings();
					this.plugin.initializeAIProvider();
					this.display(); // Refresh to show provider-specific settings
				});
			});

		// Provider-specific settings
		this.addProviderSettings(containerEl);


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

	private addProviderSettings(containerEl: HTMLElement) {
		if (this.plugin.settings.aiProvider === 'openai') {
			new Setting(containerEl)
				.setName('OpenAI API Key')
				.setDesc('Your OpenAI API key (supports both transcription and text generation)')
				.addText(text => text
					.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
						this.plugin.initializeAIProvider();
					}));

			new Setting(containerEl)
				.setName('OpenAI Model')
				.setDesc('Select the OpenAI model to use for text generation')
				.addDropdown(dropdown => {
					dropdown.addOptions(MODELS.reduce((models: {[key: string]: string}, model) => {
						models[model] = model;
						return models;
					}, {}));
					dropdown.setValue(this.plugin.settings.model);
					dropdown.onChange(async (value) => {
						this.plugin.settings.model = value;
						await this.plugin.saveSettings();
						this.plugin.initializeAIProvider();
					});
				});

		} else if (this.plugin.settings.aiProvider === 'gemini') {
			new Setting(containerEl)
				.setName('Google Gemini API Key')
				.setDesc('Your Google Gemini API key (supports both transcription and text generation)')
				.addText(text => text
					.setPlaceholder('AIza...')
					.setValue(this.plugin.settings.geminiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.geminiApiKey = value;
						await this.plugin.saveSettings();
						this.plugin.initializeAIProvider();
					}));

			new Setting(containerEl)
				.setName('Gemini Model')
				.setDesc('Select the Gemini model to use for transcription and text generation')
				.addDropdown(dropdown => {
					const geminiModels = {
						'gemini-2.0-flash-exp': 'Gemini 2.0 Flash (Experimental)',
						'gemini-2.0-flash-thinking-exp-1219': 'Gemini 2.0 Flash Thinking (Experimental)',
						'gemini-1.5-pro': 'Gemini 1.5 Pro',
						'gemini-1.5-flash': 'Gemini 1.5 Flash',
						'gemini-1.5-flash-8b': 'Gemini 1.5 Flash 8B'
					};
					dropdown.addOptions(geminiModels);
					dropdown.setValue(this.plugin.settings.geminiModel);
					dropdown.onChange(async (value) => {
						this.plugin.settings.geminiModel = value;
						await this.plugin.saveSettings();
						this.plugin.initializeAIProvider();
					});
				});

			// Add test connection button
			new Setting(containerEl)
				.setName('Test Connection')
				.setDesc('Verify your Gemini API key and connection')
				.addButton(button => {
					button.setButtonText('Test Connection')
						.onClick(async () => {
							try {
								const isValid = await this.plugin.aiProvider.validateSettings();
								if (isValid) {
									new Notice('✅ Gemini API connection successful!');
								} else {
									new Notice('❌ Gemini API connection failed. Check your API key.');
								}
							} catch (error) {
								new Notice('❌ Failed to test Gemini API connection');
							}
						});
				});
		}
	}
}
