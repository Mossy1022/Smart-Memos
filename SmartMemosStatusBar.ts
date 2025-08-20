import { setIcon, Component, TFile, Modal, MarkdownView, App } from 'obsidian';

interface StatusBarSettings {
    keepAudio: boolean;
    includeAudioFileLink: boolean;
    rememberTargetNote: 'remember' | 'no' | 'ask';
}

class NoteConfirmationModal extends Modal {
    private result: boolean | null = null;
    private noteName: string;
    
    constructor(app: App, noteName: string) {
        super(app);
        this.noteName = noteName;
    }
    
    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h3', { text: 'Record to Note?' });
        contentEl.createEl('p', { text: `Record audio to "${this.noteName}"?` });
        contentEl.createEl('p', { text: 'Transcription will be added to this note even if you navigate away.' });
        
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
        buttonContainer.style.display = 'flex';
        buttonContainer.style.gap = '10px';
        buttonContainer.style.justifyContent = 'center';
        buttonContainer.style.marginTop = '20px';
        
        const yesButton = buttonContainer.createEl('button', { text: 'Yes, Record to This Note', cls: 'mod-cta' });
        const noButton = buttonContainer.createEl('button', { text: 'Cancel' });
        
        yesButton.onclick = () => {
            this.result = true;
            this.close();
        };
        
        noButton.onclick = () => {
            this.result = false;
            this.close();
        };
    }
    
    async showAndWait(): Promise<boolean> {
        return new Promise((resolve) => {
            this.onClose = () => {
                resolve(this.result === true);
            };
            this.open();
        });
    }
}

export class SmartMemosStatusBar extends Component {
    private statusBarEl: HTMLElement;
    private app: App;
    private handleAudioRecording: (audioFile: Blob | null, transcribe: boolean, keepAudio: boolean, includeAudioFileLink: boolean, targetNote?: TFile) => void;
    private settings: StatusBarSettings;
    private targetNote: TFile | null = null;
    
    // Recording state
    private mediaRecorder: MediaRecorder | null = null;
    private chunks: BlobPart[] = [];
    private isRecording: boolean = false;
    private isPaused: boolean = false;
    private startTime: number = 0;
    private elapsedTime: number = 0;
    private intervalId: number | null = null;
    
    // UI elements
    private timerEl: HTMLElement;
    private recordButtonEl: HTMLElement;
    private transcribeButtonEl: HTMLElement;
    private extendedControlsEl: HTMLElement;
    private isExtended: boolean = false;
    
    constructor(
        app: App,
        statusBarEl: HTMLElement,
        handleAudioRecording: (audioFile: Blob | null, transcribe: boolean, keepAudio: boolean, includeAudioFileLink: boolean, targetNote?: TFile) => void,
        settings: StatusBarSettings
    ) {
        super();
        this.app = app;
        this.statusBarEl = statusBarEl;
        this.handleAudioRecording = handleAudioRecording;
        this.settings = settings;
        
        this.createStatusBarElements();
    }
    
    private createStatusBarElements() {
        this.statusBarEl.addClass('smart-memo-status-bar');
        
        // Main container with timer (always visible)
        const mainContainer = this.statusBarEl.createDiv({ cls: 'smart-memo-status-main' });
        
        // Timer display
        this.timerEl = mainContainer.createSpan({ cls: 'smart-memo-timer', text: '00:00' });
        this.timerEl.addEventListener('click', () => this.toggleExtendedControls());
        
        // Record button (always visible)
        this.recordButtonEl = mainContainer.createEl('button', { cls: 'smart-memo-status-btn' });
        setIcon(this.recordButtonEl, 'circle');
        this.recordButtonEl.addEventListener('click', () => this.toggleRecording());
        
        // Extended controls (hidden by default)
        this.extendedControlsEl = this.statusBarEl.createDiv({ cls: 'smart-memo-extended-controls smart-memo-hidden' });
        
        // Stop & Transcribe button (primary action)
        this.transcribeButtonEl = this.extendedControlsEl.createEl('button', { cls: 'smart-memo-status-btn smart-memo-transcribe-primary' });
        setIcon(this.transcribeButtonEl, 'file-text');
        this.transcribeButtonEl.title = 'Stop & Transcribe';
        this.transcribeButtonEl.addEventListener('click', () => this.stopAndTranscribe());
        
        this.updateButtonStates();
    }
    
    private toggleExtendedControls() {
        this.isExtended = !this.isExtended;
        if (this.isExtended) {
            this.extendedControlsEl.removeClass('smart-memo-hidden');
        } else {
            this.extendedControlsEl.addClass('smart-memo-hidden');
        }
    }
    
    private async toggleRecording() {
        console.log('Toggle recording clicked', { isRecording: this.isRecording, isPaused: this.isPaused });
        if (!this.isRecording && !this.isPaused) {
            await this.startRecording();
        } else if (this.isRecording) {
            this.pauseRecording();
        } else if (this.isPaused) {
            this.resumeRecording();
        }
    }
    
    private async startRecording() {
        try {
            console.log('Starting recording...');
            
            // Handle target note based on setting
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            console.log('Active view:', activeView?.file?.name);
            
            if (activeView && activeView.file && this.settings.rememberTargetNote !== 'no') {
                if (this.settings.rememberTargetNote === 'remember') {
                    // Always remember current note
                    this.targetNote = activeView.file;
                    console.log('Automatically remembering note:', activeView.file.name);
                } else if (this.settings.rememberTargetNote === 'ask') {
                    // Ask user for confirmation
                    const modal = new NoteConfirmationModal(this.app, activeView.file.name);
                    const confirmed = await modal.showAndWait();
                    console.log('Modal confirmed:', confirmed);
                    
                    if (!confirmed) {
                        console.log('User cancelled recording');
                        return; // User cancelled
                    }
                    
                    this.targetNote = activeView.file;
                }
            } else {
                // No active note or setting is 'no', proceed without target
                console.log('No target note (setting:', this.settings.rememberTargetNote, ')');
                this.targetNote = null;
            }
            
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(stream);
            
            this.mediaRecorder.addEventListener('dataavailable', (event) => {
                this.chunks.push(event.data);
            });
            
            this.mediaRecorder.start(1000);
            this.isRecording = true;
            this.isPaused = false;
            this.startTime = Date.now();
            this.startTimer();
            
            this.updateButtonStates();
            this.showExtendedControls();
            this.updateTimerDisplay();
            
        } catch (error) {
            console.error('Error starting recording:', error);
        }
    }
    
    private pauseRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.pause();
            this.isRecording = false;
            this.isPaused = true;
            this.stopTimer();
            this.elapsedTime += Date.now() - this.startTime;
            this.updateButtonStates();
        }
    }
    
    private resumeRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
            this.mediaRecorder.resume();
            this.isRecording = true;
            this.isPaused = false;
            this.startTime = Date.now();
            this.startTimer();
            this.updateButtonStates();
        }
    }
    
    private async stopRecording(): Promise<Blob | null> {
        return new Promise((resolve) => {
            if (this.mediaRecorder) {
                this.mediaRecorder.addEventListener('stop', () => {
                    const blob = new Blob(this.chunks, { type: 'audio/wav' });
                    this.resetRecording();
                    resolve(blob);
                });
                
                this.mediaRecorder.stop();
                // Stop all tracks to release microphone
                this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
            } else {
                resolve(null);
            }
        });
    }
    
    private async stopAndTranscribe() {
        const audioFile = await this.stopRecording();
        if (audioFile) {
            this.handleAudioRecording(audioFile, true, this.settings.keepAudio, this.settings.includeAudioFileLink, this.targetNote || undefined);
        }
    }
    
    private resetRecording() {
        this.isRecording = false;
        this.isPaused = false;
        this.elapsedTime = 0;
        this.chunks = [];
        this.mediaRecorder = null;
        this.targetNote = null;
        this.stopTimer();
        this.timerEl.textContent = '00:00';
        this.updateButtonStates();
        this.hideExtendedControls();
        this.updateTimerDisplay();
    }
    
    private updateButtonStates() {
        if (!this.isRecording && !this.isPaused) {
            // Ready to record
            setIcon(this.recordButtonEl, 'circle');
            this.recordButtonEl.removeClass('smart-memo-recording', 'smart-memo-paused');
            this.recordButtonEl.title = 'Start Recording';
        } else if (this.isRecording) {
            // Currently recording
            setIcon(this.recordButtonEl, 'pause');
            this.recordButtonEl.addClass('smart-memo-recording');
            this.recordButtonEl.removeClass('smart-memo-paused');
            this.recordButtonEl.title = 'Pause Recording';
        } else if (this.isPaused) {
            // Paused
            setIcon(this.recordButtonEl, 'play');
            this.recordButtonEl.addClass('smart-memo-paused');
            this.recordButtonEl.removeClass('smart-memo-recording');
            this.recordButtonEl.title = 'Resume Recording';
        }
    }
    
    private showExtendedControls() {
        this.isExtended = true;
        this.extendedControlsEl.removeClass('smart-memo-hidden');
    }
    
    private hideExtendedControls() {
        this.isExtended = false;
        this.extendedControlsEl.addClass('smart-memo-hidden');
    }
    
    private startTimer() {
        this.stopTimer();
        this.intervalId = window.setInterval(() => {
            const elapsedTimeInSeconds = Math.floor(this.elapsedTime / 1000) + Math.floor((Date.now() - this.startTime) / 1000);
            const minutes = Math.floor(elapsedTimeInSeconds / 60);
            const seconds = elapsedTimeInSeconds % 60;
            this.timerEl.textContent = `${this.padNumber(minutes)}:${this.padNumber(seconds)}`;
        }, 1000);
    }
    
    private stopTimer() {
        if (this.intervalId !== null) {
            window.clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
    
    private padNumber(num: number): string {
        return num.toString().padStart(2, '0');
    }
    
    private updateTimerDisplay() {
        if (this.targetNote) {
            this.timerEl.title = `Recording to: ${this.targetNote.name}`;
            this.timerEl.style.color = '#007acc'; // Visual indicator
        } else {
            this.timerEl.title = 'Click to expand controls';
            this.timerEl.style.color = ''; // Reset to default
        }
    }
    
    public updateSettings(settings: StatusBarSettings) {
        this.settings = settings;
    }
    
    onunload() {
        this.resetRecording();
        super.onunload();
    }
}